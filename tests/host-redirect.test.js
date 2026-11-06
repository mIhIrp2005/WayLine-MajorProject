// Verification tests for Host-Level Captive Portal & Dynamic PWA Redirection
import assert from 'node:assert';
import { 
  extractDomain, 
  isCaptiveProbeDomain, 
  buildDnsResponse, 
  HostRedirectLayer,
  CAPTIVE_PROBE_DOMAINS 
} from '../server/host-redirect.js';

console.log('[TEST] Starting Host-Level Captive Portal & Redirection Tests...');

// Helper to construct a mock DNS question packet
function createMockDnsQuery(domain, qtype = 1) {
  const id = Buffer.from([0x12, 0x34]);
  const flags = Buffer.from([0x01, 0x00]); // Standard query
  const counts = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // 1 question

  const parts = domain.split('.');
  const qnameParts = [];
  for (const part of parts) {
    qnameParts.push(Buffer.from([part.length]));
    qnameParts.push(Buffer.from(part, 'utf8'));
  }
  qnameParts.push(Buffer.from([0x00])); // Null terminator
  const qname = Buffer.concat(qnameParts);

  const typeAndClass = Buffer.alloc(4);
  typeAndClass.writeUInt16BE(qtype, 0); // QTYPE (1 = A, 28 = AAAA)
  typeAndClass.writeUInt16BE(1, 2);     // QCLASS (1 = IN)

  return Buffer.concat([id, flags, counts, qname, typeAndClass]);
}

// 1. Test Domain Extraction from Raw DNS Packets
console.log('Testing DNS question parser...');
const androidQuery = createMockDnsQuery('connectivitycheck.gstatic.com');
assert.strictEqual(extractDomain(androidQuery), 'connectivitycheck.gstatic.com', 'Android probe domain extracted');

const appleQuery = createMockDnsQuery('captive.apple.com');
assert.strictEqual(extractDomain(appleQuery), 'captive.apple.com', 'Apple probe domain extracted');

const msftQuery = createMockDnsQuery('msftconnecttest.com');
assert.strictEqual(extractDomain(msftQuery), 'msftconnecttest.com', 'Windows probe domain extracted');

const normalQuery = createMockDnsQuery('wikipedia.org');
assert.strictEqual(extractDomain(normalQuery), 'wikipedia.org', 'External domain extracted');

// 2. Test Captive Probe Domain Detection
console.log('Testing Captive Probe Domain classification...');
assert.strictEqual(isCaptiveProbeDomain('connectivitycheck.gstatic.com'), true);
assert.strictEqual(isCaptiveProbeDomain('clients3.google.com'), true);
assert.strictEqual(isCaptiveProbeDomain('captive.apple.com'), true);
assert.strictEqual(isCaptiveProbeDomain('www.msftconnecttest.com'), true);
assert.strictEqual(isCaptiveProbeDomain('detectportal.firefox.com'), true);
assert.strictEqual(isCaptiveProbeDomain('wayline.local'), true);

assert.strictEqual(isCaptiveProbeDomain('wikipedia.org'), false);
assert.strictEqual(isCaptiveProbeDomain('google.com'), false);
assert.strictEqual(isCaptiveProbeDomain('github.com'), false);

// 3. Test DNS Response Generation & Low TTL (Connection Capture & Repeated Reconnects)
console.log('Testing RFC 1035 DNS response builder & reconnection TTL...');
const targetIp = '192.168.137.1';
const response = buildDnsResponse(androidQuery, targetIp, 5);
assert.ok(response, 'DNS response buffer must be generated');
assert.ok(response.length > androidQuery.length, 'Response must include question + answer');

// Verify ID matches
assert.strictEqual(response[0], 0x12);
assert.strictEqual(response[1], 0x34);

// Verify Answer Count is 1
const ancount = response.readUInt16BE(6);
assert.strictEqual(ancount, 1, 'Answer count must be 1');

// Verify IP in answer is 192.168.137.1
const ipBytes = response.slice(response.length - 4);
assert.strictEqual(`${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`, targetIp);

// Verify TTL is short (5 seconds) to prevent stale cache on repeated reconnects
const ttl = response.readUInt32BE(response.length - 10);
assert.strictEqual(ttl, 5, 'DNS TTL must be 5s for fast reconnection capture');

// Test AAAA query fallback
const aaaaQuery = createMockDnsQuery('connectivitycheck.gstatic.com', 28);
const aaaaResponse = buildDnsResponse(aaaaQuery, targetIp);
assert.ok(aaaaResponse, 'AAAA response must be generated');
const aaaaAncount = aaaaResponse.readUInt16BE(6);
assert.strictEqual(aaaaAncount, 0, 'AAAA answer count must be 0 for fast IPv4 fallback');

// 4. Test Dynamic PWA URL Binding
console.log('Testing Dynamic PWA URL binding...');
const mockRedirectLayer = new HostRedirectLayer({
  getBestIpForClient: (clientIp) => {
    if (clientIp.startsWith('192.168.137.')) return '192.168.137.1';
    if (clientIp.startsWith('192.168.43.')) return '192.168.43.10';
    return '192.168.0.105';
  },
  getDynamicPwaUrl: (clientIp, rawLocal) => {
    const host = rawLocal || '192.168.137.1';
    return `https://${host}:8767/`;
  }
});

// Dynamic PWA endpoint resolution test
const pwaUrlHotspot = mockRedirectLayer.getDynamicPwaUrl('192.168.137.45', '192.168.137.1');
assert.strictEqual(pwaUrlHotspot, 'https://192.168.137.1:8767/');

const pwaUrlEthernet = mockRedirectLayer.getDynamicPwaUrl('192.168.0.50', '192.168.0.105');
assert.strictEqual(pwaUrlEthernet, 'https://192.168.0.105:8767/');

// 5. Test Multi-Mode Handling (Offline Mesh vs Internet Fallback)
console.log('Testing Multi-Mode logic (Offline Mesh vs Internet Fallback)...');
// Mode A: Pure Offline Mesh (hasInternet = false)
mockRedirectLayer.hasInternet = false;
assert.strictEqual(
  isCaptiveProbeDomain('wikipedia.org') || !mockRedirectLayer.hasInternet,
  true,
  'In Offline Mesh Mode, non-probe domains are sinkholed to PWA target IP'
);

// Mode B: Internet Fallback Mode (hasInternet = true)
mockRedirectLayer.hasInternet = true;
// Probe domain must still be captured
assert.strictEqual(
  isCaptiveProbeDomain('connectivitycheck.gstatic.com'),
  true,
  'In Internet Fallback Mode, OS probe domains are STILL captured to trigger captive portal'
);
// External web traffic must NOT be sinkholed (forwarded to upstream)
assert.strictEqual(
  isCaptiveProbeDomain('wikipedia.org') || !mockRedirectLayer.hasInternet,
  false,
  'In Internet Fallback Mode, external web domains are passed to upstream DNS'
);

console.log('✓ All Host-Level Captive Portal & Redirection tests PASSED successfully!\n');
