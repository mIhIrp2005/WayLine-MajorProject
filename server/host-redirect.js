// WAYLINE Host-Level Network Redirection & Captive Portal Layer
// Non-destructive host-level transport wrapper: handles local DNS/DHCP interception and Port 80 redirection.
// Operates strictly external to the PWA application codebase.

import dgram from 'node:dgram';
import http from 'node:http';
import dns from 'node:dns';

// Captive Portal Probe Domains for OS Handshake Capture (Android, iOS, Windows, Linux, macOS)
export const CAPTIVE_PROBE_DOMAINS = [
  'connectivitycheck.gstatic.com',
  'clients3.google.com',
  'play.googleapis.com',
  'connectivitycheck.android.com',
  'captive.apple.com',
  'appleiphonecell.com',
  'airport.us',
  'ibook.info',
  'itools.info',
  'thinkdifferent.us',
  'www.apple.com',
  'msftconnecttest.com',
  'www.msftconnecttest.com',
  'msftncsi.com',
  'www.msftncsi.com',
  'ipv6.msftncsi.com',
  'detectportal.firefox.com',
  'connectivity-check.ubuntu.com',
  'nmcheck.gnome.org',
  'wayline.local',
  'hotspot.local'
];

/**
 * Extracts domain name from a raw DNS question payload
 */
export function extractDomain(query) {
  try {
    if (!query || query.length < 13) return '';
    let offset = 12;
    const labels = [];
    while (offset < query.length) {
      const len = query[offset++];
      if (len === 0) break;
      if (offset + len > query.length) return '';
      labels.push(query.toString('utf8', offset, offset + len));
      offset += len;
    }
    return labels.join('.').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Checks if a domain is an OS captive network connectivity probe
 */
export function isCaptiveProbeDomain(domain) {
  if (!domain) return false;
  const clean = domain.toLowerCase();
  return CAPTIVE_PROBE_DOMAINS.some(d => clean === d || clean.endsWith('.' + d));
}

/**
 * Builds an RFC 1035 compliant DNS response packet
 */
export function buildDnsResponse(query, targetIp, ttl = 5) {
  let qEnd = 12;
  while (qEnd < query.length && query[qEnd] !== 0) qEnd++;
  qEnd += 5; // skip null byte + 2 bytes qtype + 2 bytes qclass
  if (qEnd > query.length) return null;

  const question = query.slice(12, qEnd);
  const id = query.slice(0, 2);
  const qtype = query.readUInt16BE(qEnd - 4);

  if (qtype === 28) {
    // Return NOERROR with 0 answers for AAAA to prompt instant IPv4 A fallback
    const header = Buffer.from([
      id[0], id[1],
      0x81, 0x80, // Response, Authoritative, NOERROR
      0x00, 0x01, // 1 question
      0x00, 0x00, // 0 answers
      0x00, 0x00,
      0x00, 0x00
    ]);
    return Buffer.concat([header, question]);
  }

  const ipParts = targetIp.split('.').map(Number);
  if (ipParts.length !== 4 || ipParts.some(isNaN)) return null;

  const header = Buffer.from([
    id[0], id[1],
    0x81, 0x80, // Response, Authoritative
    0x00, 0x01, // 1 question
    0x00, 0x01, // 1 answer
    0x00, 0x00,
    0x00, 0x00
  ]);

  const answer = Buffer.from([
    0xc0, 0x0c, // Pointer to domain in question
    0x00, 0x01, // Type A
    0x00, 0x01, // Class IN
    0x00, 0x00, 0x00, ttl & 0xff, // Short TTL to ensure reconnection re-checks
    0x00, 0x04, // Length 4
    ipParts[0], ipParts[1], ipParts[2], ipParts[3]
  ]);

  return Buffer.concat([header, question, answer]);
}

/**
 * Forwards an external DNS query to an upstream resolver (Internet Fallback Mode)
 */
export function forwardDnsQuery(query, rinfo, dnsSocket, upstreamServer = '8.8.8.8') {
  const forwardSocket = dgram.createSocket('udp4');
  let closed = false;
  const safeClose = () => {
    if (!closed) {
      closed = true;
      try { forwardSocket.close(); } catch {}
    }
  };

  forwardSocket.on('message', (response) => {
    try {
      dnsSocket.send(response, 0, response.length, rinfo.port, rinfo.address);
    } catch {}
    safeClose();
  });

  forwardSocket.on('error', () => {
    safeClose();
  });

  forwardSocket.send(query, 0, query.length, 53, upstreamServer, (err) => {
    if (err) safeClose();
  });

  setTimeout(safeClose, 2500);
}

/**
 * Host-Level Captive Portal & Dynamic PWA Redirection Controller
 */
export class HostRedirectLayer {
  constructor(options = {}) {
    this.getBestIpForClient = options.getBestIpForClient || ((ip) => '127.0.0.1');
    this.getDynamicPwaUrl = options.getDynamicPwaUrl || ((clientIp, rawLocal) => 'http://127.0.0.1:8765/');
    this.isVerbose = options.isVerbose || false;
    this.upstreamDns = options.upstreamDns || '8.8.8.8';

    this.hasInternet = false;
    this.lastInternetCheck = 0;
    this.dnsSocket = null;
    this.captiveHttp = null;
  }

  /**
   * Checks upstream internet connectivity
   */
  checkInternetConnectivity(callback) {
    const now = Date.now();
    if (now - this.lastInternetCheck < 10000 && typeof callback !== 'function') return;
    this.lastInternetCheck = now;

    dns.lookup('one.one.one.one', (err) => {
      const prev = this.hasInternet;
      this.hasInternet = !err;
      if (this.isVerbose && prev !== this.hasInternet) {
        console.log(`[WAYLINE HostRedirect] Network mode: ${this.hasInternet ? 'INTERNET FALLBACK' : 'PURE OFFLINE MESH'}`);
      }
      if (callback) callback(this.hasInternet);
    });
  }

  /**
   * Starts the Host-Level UDP 53 Captive DNS Service
   */
  startDnsService(port = 53, host = '0.0.0.0') {
    try {
      this.dnsSocket = dgram.createSocket('udp4');

      this.dnsSocket.on('error', (err) => {
        if (this.isVerbose) console.warn('[WAYLINE HostRedirect] Port 53 DNS notice:', err.message);
      });

      this.dnsSocket.on('message', (query, rinfo) => {
        try {
          this.checkInternetConnectivity();
          if (query.length < 12) return;

          const domain = extractDomain(query);
          const isProbe = isCaptiveProbeDomain(domain);
          const targetIp = this.getBestIpForClient(rinfo.address);

          // Multi-mode handling:
          // 1. Probe domains ALWAYS resolve to targetIp (ensures captive portal handshake on first & repeated connects)
          // 2. In Pure Offline Mesh Mode (!hasInternet), ALL queries resolve to targetIp (sinkhole)
          // 3. In Internet Fallback Mode (hasInternet && !isProbe), forward to upstream DNS so external web works normally
          if (isProbe || !this.hasInternet) {
            const response = buildDnsResponse(query, targetIp, 5); // 5s TTL ensures reconnection re-check
            if (response) {
              this.dnsSocket.send(response, 0, response.length, rinfo.port, rinfo.address);
            }
          } else {
            forwardDnsQuery(query, rinfo, this.dnsSocket, this.upstreamDns);
          }
        } catch (err) {
          if (this.isVerbose) console.warn('[WAYLINE HostRedirect] DNS handling notice:', err.message);
        }
      });

      this.dnsSocket.bind(port, host, () => {
        console.log(`[WAYLINE] Captive DNS Server:        UDP:${port} (Multi-Mode Probe & Mesh Sinkhole)`);
      });
    } catch (err) {
      if (this.isVerbose) console.warn('[WAYLINE HostRedirect] DNS bind failed:', err.message);
    }
  }

  /**
   * Starts the Host-Level Port 80 Captive HTTP Redirect Service
   */
  startHttpRedirectService(port = 80, host = '0.0.0.0') {
    try {
      this.captiveHttp = http.createServer((req, res) => {
        const rawLocal = (req.socket.localAddress || '').replace(/^.*:/, '');
        const clientIp = (req.socket.remoteAddress || '').replace(/^.*:/, '');
        const targetUrl = this.getDynamicPwaUrl(clientIp, rawLocal);

        // RFC 8908 Captive Portal JSON API
        if (req.url && req.url.includes('.well-known/captive-portal')) {
          res.writeHead(200, {
            'Content-Type': 'application/captive+json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          });
          res.end(JSON.stringify({
            captive: true,
            'user-portal-url': targetUrl,
            'venue-info-url': targetUrl,
            'can-extend-session': false
          }));
          return;
        }

        // Standard OS captive probe and web traffic redirect
        res.writeHead(302, {
          'Location': targetUrl,
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${targetUrl}"><title>WAYLINE Emergency Network</title></head><body><script>window.location.replace("${targetUrl}");</script><p>Redirecting to <a href="${targetUrl}">WAYLINE Emergency Network</a>...</p></body></html>`);
      });

      this.captiveHttp.on('error', (err) => {
        if (this.isVerbose) console.warn('[WAYLINE HostRedirect] Port 80 redirect notice:', err.message);
      });

      this.captiveHttp.listen(port, host, () => {
        console.log(`[WAYLINE] Captive Portal Redirect:   http://${host}:${port} (Auto-popup on Wi-Fi connection)`);
      });
    } catch (err) {
      if (this.isVerbose) console.warn('[WAYLINE HostRedirect] HTTP bind failed:', err.message);
    }
  }

  /**
   * Starts both services
   */
  start() {
    this.checkInternetConnectivity();
    this.startHttpRedirectService();
    this.startDnsService();
  }

  /**
   * Stops both services
   */
  stop() {
    if (this.dnsSocket) {
      try { this.dnsSocket.close(); } catch {}
      this.dnsSocket = null;
    }
    if (this.captiveHttp) {
      try { this.captiveHttp.close(); } catch {}
      this.captiveHttp = null;
    }
  }
}
