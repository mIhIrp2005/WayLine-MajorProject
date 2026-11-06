// WAYLINE Local Discovery & Peer Relay Node Engine
// Provides real UDP broadcast discovery and WebSocket peer-to-peer transport over Wi-Fi / LAN without internet.

import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { generateCertificates } from './generate-cert.js';
import { HostRedirectLayer } from './host-redirect.js';

// Native .env file loader
try {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...v] = trimmed.split('=');
        const key = k.trim();
        const val = v.join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch {}

const HTTP_PORT = parseInt(process.env.WAYLINE_PORT || '8765', 10);
const HTTPS_PORT = parseInt(process.env.WAYLINE_HTTPS_PORT || '8767', 10);
const UDP_PORT = parseInt(process.env.WAYLINE_UDP_PORT || '8766', 10);
const BROADCAST_INTERVAL_MS = 3000;

// Load SSL/TLS Credentials if available for Secure WebRTC Voice Calling
function loadSslCredentials() {
  const certsDir = path.resolve('server', 'certs');
  const pfxPath = path.join(certsDir, 'wayline.pfx');
  const certPath = path.join(certsDir, 'cert.pem');
  const keyPath = path.join(certsDir, 'key.pem');
  const metaPath = path.join(certsDir, 'cert-ips.json');

  // Verify certificate covers current LAN IP addresses; regenerate dynamically if IP changed
  const currentIps = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) currentIps.push(iface.address);
    }
  }
  const currentIpKey = currentIps.sort().join(',');

  let needsGen = !fs.existsSync(pfxPath);
  if (!needsGen && fs.existsSync(metaPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (saved.ips !== currentIpKey) needsGen = true;
    } catch { needsGen = true; }
  } else if (!fs.existsSync(metaPath)) {
    needsGen = true;
  }

  if (needsGen) {
    try {
      const ok = generateCertificates();
      if (ok) {
        fs.writeFileSync(metaPath, JSON.stringify({ ips: currentIpKey }), 'utf8');
      }
    } catch (e) {
      console.warn('[WAYLINE] Auto-certificate generation note:', e.message);
    }
  }

  if (fs.existsSync(pfxPath)) {
    try {
      return { pfx: fs.readFileSync(pfxPath), passphrase: 'wayline_offline' };
    } catch (e) {
      console.warn('[WAYLINE] Error reading PFX certificate:', e.message);
    }
  }

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    } catch (e) {
      console.warn('[WAYLINE] Error reading PEM certificate/key:', e.message);
    }
  }

  return null;
}

const sslCredentials = loadSslCredentials();

// Generate Node Identity for this instance
const NODE_ID = 'node_' + Math.random().toString(36).substring(2, 10);
const HOSTNAME = os.hostname() || 'Device';
const NODE_NAME = `WAYLINE [${HOSTNAME}]`;

// Discovered peers and active peer sockets
const discoveredPeers = new Map(); // id -> { id, name, ip, port, lastSeen, ws }
const peerSockets = new Map();     // id -> ws
const clientSockets = new Set();   // Set of browser UI clients
const registeredClients = new Map(); // ws -> { ws, nodeId, nodeName, ip, lastSeen }
const seenPackets = new Set();

// Active Voice Rooms Registry: roomId -> { id, name, creatorId, creatorName, createdAt, participants: Map<peerId, { peerId, peerName, joinedAt, isMuted }> }
const activeVoiceRooms = new Map();

// Calculate subnet broadcast address from IP and netmask
function getBroadcastAddress(ip, netmask) {
  try {
    const ipParts = ip.split('.').map(Number);
    const maskParts = (netmask || '255.255.255.0').split('.').map(Number);
    const broadcastParts = ipParts.map((part, i) => (part | (~maskParts[i] & 255)));
    return broadcastParts.join('.');
  } catch {
    return '255.255.255.255';
  }
}

// Discover and rank network interfaces (prioritizing physical Ethernet and Wi-Fi over virtual adapters)
function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const isVirtual = /virtual|vbox|vmware|wsl|pseudo|loopback|vethernet|hyper-v|default switch/i.test(name);
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const isExcludedSubnet = iface.address.startsWith('192.168.56.') || 
                                 iface.address.startsWith('169.254.') || 
                                 iface.address.startsWith('127.');
        const isEthernetOrWifi = /ethernet|wi-fi|wlan|lan|en|eth|wireless/i.test(name);
        const isHotspotSubnet = iface.address.startsWith('192.168.137.') || 
                                iface.address.startsWith('192.168.43.');

        let priority = 10;
        // Top priority for active Mobile Hotspot interface
        if (isHotspotSubnet) priority = 150;
        else if (isEthernetOrWifi && !isVirtual && !isExcludedSubnet) priority = 100;
        else if (!isVirtual && !isExcludedSubnet) priority = 50;
        else if (isExcludedSubnet || isVirtual) priority = 1;

        const broadcast = getBroadcastAddress(iface.address, iface.netmask);
        candidates.push({
          name,
          address: iface.address,
          netmask: iface.netmask,
          broadcast,
          priority
        });
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates;
}

const activeInterfaces = getNetworkInterfaces();
const primaryIface = activeInterfaces[0] || { name: 'Loopback', address: '127.0.0.1', broadcast: '255.255.255.255' };
const LOCAL_IP = primaryIface.address;
const IS_VERBOSE = process.argv.includes('--verbose');

// Helper to dynamically match client subnet to the best local interface IP
function getBestIpForClient(clientIp) {
  const ifaces = getNetworkInterfaces();
  if (clientIp) {
    const clean = String(clientIp).replace(/^.*:/, '');
    const clientSubnet3 = clean.split('.').slice(0, 3).join('.');
    const matched = ifaces.find(i => i.address.startsWith(clientSubnet3 + '.'));
    if (matched) return matched.address;
  }
  return ifaces[0]?.address || LOCAL_IP;
}

console.log(`[WAYLINE] Primary Interface: ${primaryIface.name} (${LOCAL_IP})`);
if (IS_VERBOSE && activeInterfaces.length > 1) {
  console.log(`[WAYLINE] Other adapters: ${activeInterfaces.slice(1).map(i => `${i.name}: ${i.address}`).join(', ')}`);
}
console.log(`[WAYLINE] Starting node ${NODE_ID} (${NODE_NAME}) on ${LOCAL_IP}:${HTTP_PORT}`);

// --- 1. HTTP Server for Static PWA & API ---
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const handleHttpRequest = (req, res) => {
  const isHttps = Boolean(req.socket.encrypted);
  const protocol = isHttps ? 'https' : 'http';
  const url = new URL(req.url, `${protocol}://${req.headers.host}`);
  
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    res.end();
    return;
  }

  // Download CA Certificate for Mobile WebRTC HTTPS trust
  if (url.pathname === '/wayline-ca.crt') {
    const caPath = path.resolve('server', 'certs', 'wayline-ca.crt');
    if (fs.existsSync(caPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="wayline-ca.crt"'
      });
      fs.createReadStream(caPath).pipe(res);
      return;
    }
  }

  // RFC 8908 Captive Portal API & Probe Redirects (Android, iOS, Windows)
  if (url.pathname === '/.well-known/captive-portal' || url.pathname === '/captive-portal') {
    const rawLocal = (req.socket.localAddress || '').replace(/^.*:/, '');
    const clientIp = (req.socket.remoteAddress || '').replace(/^.*:/, '');
    const targetHost = (rawLocal && rawLocal !== '127.0.0.1' && rawLocal !== '0.0.0.0')
      ? rawLocal 
      : getBestIpForClient(clientIp);
    const useHttps = Boolean(httpsServer || sslCredentials);
    const target = `${useHttps ? 'https' : 'http'}://${targetHost}:${useHttps ? HTTPS_PORT : HTTP_PORT}/`;
    res.writeHead(200, {
      'Content-Type': 'application/captive+json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify({
      captive: true,
      'user-portal-url': target,
      'venue-info-url': target
    }));
    return;
  }

  if (/generate_204|gen_204|hotspot-detect\.html|connecttest\.txt|ncsi\.txt/i.test(url.pathname)) {
    const rawLocal = (req.socket.localAddress || '').replace(/^.*:/, '');
    const clientIp = (req.socket.remoteAddress || '').replace(/^.*:/, '');
    const targetHost = (rawLocal && rawLocal !== '127.0.0.1' && rawLocal !== '0.0.0.0')
      ? rawLocal 
      : getBestIpForClient(clientIp);
    const useHttps = Boolean(httpsServer || sslCredentials);
    const target = `${useHttps ? 'https' : 'http'}://${targetHost}:${useHttps ? HTTPS_PORT : HTTP_PORT}/`;
    res.writeHead(302, { 
      'Location': target, 
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${target}"><title>WAYLINE Emergency Network</title></head><body><script>window.location.replace("${target}");</script><p><a href="${target}">Connect to WAYLINE</a></p></body></html>`);
    return;
  }

  // Dynamic health and subnet discovery endpoint
  if (url.pathname === '/api/status') {
    const currentIfaces = getNetworkInterfaces();
    const primary = currentIfaces[0] || primaryIface;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    res.end(JSON.stringify({
      nodeId: NODE_ID,
      nodeName: NODE_NAME,
      localIp: primary.address,
      httpPort: HTTP_PORT,
      httpsPort: sslCredentials ? HTTPS_PORT : null,
      udpPort: UDP_PORT,
      hasHttps: Boolean(sslCredentials),
      interfaces: currentIfaces.map(i => ({ 
        name: i.name, 
        ip: i.address, 
        url: `http://${i.address}:${HTTP_PORT}`,
        httpsUrl: sslCredentials ? `https://${i.address}:${HTTPS_PORT}` : null
      })),
      peerCount: peerSockets.size,
      discoveredCount: discoveredPeers.size
    }));
    return;
  }

  // Serve static dist files if they exist
  const distDir = path.resolve('dist');
  let filePath = path.join(distDir, url.pathname === '/' ? 'index.html' : url.pathname);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // SPA fallback
    const indexHtml = path.join(distDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(indexHtml).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<h3>WAYLINE Node Active</h3><p>Node: ${NODE_NAME} (${NODE_ID})</p><p>Run <code>npm run build</code> to serve PWA.</p>`);
    }
  }
};

const server = http.createServer(handleHttpRequest);
let httpsServer = null;

if (sslCredentials) {
  try {
    httpsServer = https.createServer(sslCredentials, handleHttpRequest);
  } catch (err) {
    console.warn('[WAYLINE] Failed to initialize HTTPS server:', err.message);
  }
}

// --- 2. WebSocket Server for UI Clients and Peer Nodes ---
// Defensive limit: 64 KiB maximum frame payload to prevent denial of service
const MAX_WS_PAYLOAD = 64 * 1024;
const wss = new WebSocketServer({ 
  noServer: true, 
  maxPayload: MAX_WS_PAYLOAD 
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

if (httpsServer) {
  httpsServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
}

wss.on('connection', (ws, req) => {
  const isHttps = Boolean(req.socket.encrypted);
  const protocol = isHttps ? 'https' : 'http';
  const url = new URL(req.url, `${protocol}://${req.headers.host}`);
  const clientType = url.searchParams.get('type') || (url.pathname.includes('/peer') ? 'peer' : 'client');

  if (clientType === 'client') {
    // Local browser UI
    const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || '127.0.0.1';
    const clientNodeId = url.searchParams.get('nodeId') || ('client_' + Math.random().toString(36).substring(2, 8));
    const clientNodeName = url.searchParams.get('nodeName') || 'Nearby User';

    const clientInfo = {
      ws,
      nodeId: clientNodeId,
      nodeName: clientNodeName,
      ip: clientIp,
      lastSeen: Date.now(),
      messageCount: 0,
      windowStart: Date.now()
    };

    registeredClients.set(ws, clientInfo);
    clientSockets.add(ws);
    console.log(`[WAYLINE] Browser UI connected: ${clientInfo.nodeName} (${clientInfo.nodeId}) [${clientSockets.size} active]`);

    // Send initial status with dynamically refreshed network interfaces
    const currentIfaces = getNetworkInterfaces();
    const primary = currentIfaces[0] || primaryIface;
    ws.send(JSON.stringify({
      type: 'NODE_STATUS',
      nodeId: NODE_ID,
      nodeName: NODE_NAME,
      listeningAddress: `${primary.address}:${HTTP_PORT}`,
      httpsListeningAddress: httpsServer ? `${primary.address}:${HTTPS_PORT}` : null,
      hasHttps: Boolean(httpsServer),
      localIp: primary.address,
      interfaces: currentIfaces.map(i => ({ 
        name: i.name, 
        ip: i.address, 
        url: `http://${i.address}:${HTTP_PORT}`,
        httpsUrl: httpsServer ? `https://${i.address}:${HTTPS_PORT}` : null
      }))
    }));

    // Broadcast updated peer list to all clients so they immediately see each other!
    broadcastPeersToClients();
    // Send active voice rooms list to this newly connected client
    broadcastVoiceRoomList(ws);

    ws.on('message', (data, isBinary) => {
      // 1. Reject binary data immediately
      if (isBinary) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Binary frames not supported' }));
        return;
      }

      // 2. Reject raw frame sizes exceeding 64 KiB
      if (data.length > MAX_WS_PAYLOAD) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Payload exceeds 64KB limit' }));
        return;
      }

      // 3. Per-connection rate limit: max 20 messages per second
      const now = Date.now();
      if (now - clientInfo.windowStart < 1000) {
        clientInfo.messageCount++;
        if (clientInfo.messageCount > 20) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Rate limit exceeded (max 20 msg/s)' }));
          return;
        }
      } else {
        clientInfo.windowStart = now;
        clientInfo.messageCount = 1;
      }

      try {
        const msg = JSON.parse(data.toString('utf8'));
        if (!msg || typeof msg !== 'object' || !msg.type) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid message structure' }));
          return;
        }

        if (msg.type === 'CLIENT_REGISTER') {
          if (typeof msg.nodeId === 'string' && msg.nodeId.length <= 64) clientInfo.nodeId = msg.nodeId;
          if (typeof msg.nodeName === 'string' && msg.nodeName.length <= 64) clientInfo.nodeName = msg.nodeName;

          // Propagate updated callsign into any active voice rooms
          for (const room of activeVoiceRooms.values()) {
            if (room.participants.has(clientInfo.nodeId)) {
              room.participants.get(clientInfo.nodeId).peerName = clientInfo.nodeName;
            }
            if (room.creatorId === clientInfo.nodeId) {
              room.creatorName = clientInfo.nodeName;
            }
          }

          broadcastPeersToClients();
          broadcastVoiceRoomList();
        } else {
          handleClientMessage(msg, ws);
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Malformed JSON payload' }));
      }
    });

    ws.on('close', () => {
      registeredClients.delete(ws);
      clientSockets.delete(ws);
      console.log(`[WAYLINE] Browser UI disconnected: ${clientInfo.nodeName}`);

      // Clean up any voice rooms this client was participating in
      for (const [roomId, room] of activeVoiceRooms.entries()) {
        if (room.participants.has(clientInfo.nodeId)) {
          room.participants.delete(clientInfo.nodeId);
          broadcastToRoom(roomId, {
            type: 'VOICE_ROOM_PARTICIPANT_LEFT',
            roomId,
            peerId: clientInfo.nodeId,
            peerName: clientInfo.nodeName
          });
          if (room.participants.size === 0) {
            activeVoiceRooms.delete(roomId);
          }
        }
      }
      broadcastVoiceRoomList();
      broadcastPeersToClients();
    });

  } else {
    // Incoming connection from another WAYLINE peer node
    const peerNodeId = url.searchParams.get('nodeId');
    const peerName = url.searchParams.get('nodeName') || 'Nearby Peer';

    if (peerNodeId && peerNodeId !== NODE_ID) {
      console.log(`[WAYLINE] Inbound peer connection from ${peerName} (${peerNodeId})`);
      setupPeerSocket(peerNodeId, peerName, ws);
    }
  }
});

function setupPeerSocket(peerId, peerName, ws) {
  peerSockets.set(peerId, ws);
  broadcastPeersToClients();

  ws.on('message', (data) => {
    try {
      const packet = JSON.parse(data.toString());
      handlePeerPacket(packet, peerId);
    } catch (e) {
      console.error('[WAYLINE] Error parsing peer packet:', e.message);
    }
  });

  ws.on('close', () => {
    peerSockets.delete(peerId);
    console.log(`[WAYLINE] Peer disconnected: ${peerName} (${peerId})`);
    broadcastPeersToClients();
  });

  ws.on('error', (err) => {
    console.error(`[WAYLINE] Peer socket error with ${peerId}:`, err.message);
  });
}

// Connect outbound to a discovered peer node
function connectOutboundPeer(peer) {
  if (peer.id === NODE_ID) return;
  if (peerSockets.has(peer.id)) return;

  const targetUrl = `ws://${peer.ip}:${peer.port}/peer?nodeId=${encodeURIComponent(NODE_ID)}&nodeName=${encodeURIComponent(NODE_NAME)}`;
  console.log(`[WAYLINE] Connecting outbound to peer: ${targetUrl}`);

  try {
    const ws = new WebSocket(targetUrl, { timeout: 4000 });

    ws.on('open', () => {
      console.log(`[WAYLINE] Outbound peer connection established with ${peer.name} (${peer.id})`);
      setupPeerSocket(peer.id, peer.name, ws);
    });

    ws.on('error', (err) => {
      // Peer might be starting or on different subnet
    });
  } catch (err) {
    // Ignore outbound connection error
  }
}

// Handle packet from a peer node
function handlePeerPacket(packet, sourcePeerId) {
  if (!packet || !packet.id) return;

  // Duplicate drop
  if (seenPackets.has(packet.id)) return;
  seenPackets.add(packet.id);
  if (seenPackets.size > 2000) {
    const first = seenPackets.values().next().value;
    seenPackets.delete(first);
  }

  console.log(`[WAYLINE] Received ${packet.type} [${packet.id}] from ${packet.senderName}`);

  // 1. Deliver to local browser UI clients
  const payload = JSON.stringify({ type: 'PACKET_RECEIVED', packet });
  for (const client of clientSockets) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }

  // 2. Multi-hop relay forwarding: if TTL allows and not expired
  if (packet.hopCount < packet.ttl) {
    const relayPacket = { ...packet, hopCount: packet.hopCount + 1 };
    const relayPayload = JSON.stringify(relayPacket);

    // Forward to all other connected peers except the sender
    for (const [peerId, ws] of peerSockets.entries()) {
      if (peerId !== sourcePeerId && ws.readyState === WebSocket.OPEN) {
        console.log(`[WAYLINE] Relaying packet [${packet.id}] (hop ${relayPacket.hopCount}) to peer ${peerId}`);
        ws.send(relayPayload);
      }
    }
  }
}

// Handle message from browser UI client
function handleClientMessage(msg, clientWs) {
  if (msg.type === 'SEND_PACKET' && msg.packet) {
    const packet = msg.packet;
    seenPackets.add(packet.id);

    console.log(`[WAYLINE] Client [${packet.senderName}] queued ${packet.type} [${packet.id}] for broadcast`);
    let sentCount = 0;

    // 1. Deliver to all OTHER connected browser clients
    const clientPayload = JSON.stringify({ type: 'PACKET_RECEIVED', packet });
    for (const [otherWs, otherClient] of registeredClients.entries()) {
      if (otherWs !== clientWs && otherWs.readyState === WebSocket.OPEN) {
        if (packet.recipientId === '*' || packet.recipientId === otherClient.nodeId) {
          otherWs.send(clientPayload);
          sentCount++;
        }
      }
    }

    // 2. Deliver to all peer daemon sockets (mesh)
    const peerPayload = JSON.stringify(packet);
    for (const [peerId, ws] of peerSockets.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        if (packet.recipientId === '*' || packet.recipientId === peerId) {
          ws.send(peerPayload);
          sentCount++;
        }
      }
    }

    clientWs.send(JSON.stringify({
      type: 'SEND_RESULT',
      packetId: packet.id,
      transmittedCount: sentCount,
      timestamp: Date.now()
    }));
  } else if (msg.type === 'SIGNALING') {
    // WebRTC Signaling Relay between browser clients (Offers, Answers, ICE candidates)
    const { targetPeerId, signal, senderId } = msg;
    if (!targetPeerId || !signal) return;

    const senderClient = registeredClients.get(clientWs);
    const resolvedSenderId = senderId || senderClient?.nodeId || 'unknown';
    const resolvedSenderName = senderClient?.nodeName || 'Peer';

    for (const [ws, client] of registeredClients.entries()) {
      if (client.nodeId === targetPeerId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'SIGNALING',
          senderId: resolvedSenderId,
          senderName: resolvedSenderName,
          signal
        }));
        break;
      }
    }
  } else if (msg.type === 'VOICE_CALL_INVITE') {
    // 1-to-1 Call Invitation
    const { targetPeerId, callId } = msg;
    const sender = registeredClients.get(clientWs);
    if (!targetPeerId || !callId || !sender) return;

    for (const [ws, client] of registeredClients.entries()) {
      if (client.nodeId === targetPeerId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'VOICE_CALL_INVITE',
          callId,
          callerId: sender.nodeId,
          callerName: sender.nodeName
        }));
        break;
      }
    }
  } else if (msg.type === 'VOICE_CALL_ACCEPT') {
    const { targetPeerId, callId } = msg;
    const sender = registeredClients.get(clientWs);
    if (!targetPeerId || !callId || !sender) return;

    for (const [ws, client] of registeredClients.entries()) {
      if (client.nodeId === targetPeerId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'VOICE_CALL_ACCEPT',
          callId,
          calleeId: sender.nodeId,
          calleeName: sender.nodeName
        }));
        break;
      }
    }
  } else if (msg.type === 'VOICE_CALL_REJECT') {
    const { targetPeerId, callId, reason } = msg;
    const sender = registeredClients.get(clientWs);
    if (!targetPeerId || !callId || !sender) return;

    for (const [ws, client] of registeredClients.entries()) {
      if (client.nodeId === targetPeerId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'VOICE_CALL_REJECT',
          callId,
          reason: reason || 'declined',
          senderId: sender.nodeId
        }));
        break;
      }
    }
  } else if (msg.type === 'VOICE_CALL_END') {
    const { targetPeerId, callId } = msg;
    const sender = registeredClients.get(clientWs);
    if (!targetPeerId || !callId || !sender) return;

    for (const [ws, client] of registeredClients.entries()) {
      if (client.nodeId === targetPeerId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'VOICE_CALL_END',
          callId,
          senderId: sender.nodeId
        }));
        break;
      }
    }
  } else if (msg.type === 'VOICE_SIGNAL') {
    // Forward WebRTC audio SDP offer, answer, or ICE candidate
    const { targetPeerId, signal, callId, roomId } = msg;
    const sender = registeredClients.get(clientWs);
    if (!targetPeerId || !signal || !sender) return;

    for (const [ws, client] of registeredClients.entries()) {
      if (client.nodeId === targetPeerId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'VOICE_SIGNAL',
          senderId: sender.nodeId,
          senderName: sender.nodeName,
          signal,
          callId,
          roomId
        }));
        break;
      }
    }
  } else if (msg.type === 'VOICE_ROOM_CREATE') {
    const { roomId, name } = msg;
    const sender = registeredClients.get(clientWs);
    if (!roomId || !sender) return;

    activeVoiceRooms.set(roomId, {
      id: roomId,
      name: name || `Room ${roomId.slice(-4)}`,
      creatorId: sender.nodeId,
      creatorName: sender.nodeName,
      createdAt: Date.now(),
      participants: new Map([
        [sender.nodeId, { peerId: sender.nodeId, peerName: sender.nodeName, joinedAt: Date.now(), isMuted: false }]
      ])
    });
    console.log(`[WAYLINE] Voice room created: "${name}" (${roomId}) by ${sender.nodeName}`);
    broadcastVoiceRoomList();
    clientWs.send(JSON.stringify({
      type: 'VOICE_ROOM_JOINED',
      roomId,
      name: name || `Room ${roomId.slice(-4)}`,
      creatorId: sender.nodeId,
      participants: [{ peerId: sender.nodeId, peerName: sender.nodeName, joinedAt: Date.now(), isMuted: false }]
    }));
  } else if (msg.type === 'VOICE_ROOM_JOIN') {
    const { roomId } = msg;
    const sender = registeredClients.get(clientWs);
    if (!roomId || !sender) return;

    let room = activeVoiceRooms.get(roomId);
    if (!room) {
      clientWs.send(JSON.stringify({ type: 'ERROR', message: 'Room not found or expired' }));
      return;
    }

    // Default mesh limit of 4
    if (room.participants.size >= 4 && !room.participants.has(sender.nodeId)) {
      clientWs.send(JSON.stringify({ type: 'ERROR', message: 'Room mesh participant limit reached (max 4)' }));
      return;
    }

    const participantInfo = {
      peerId: sender.nodeId,
      peerName: sender.nodeName,
      joinedAt: Date.now(),
      isMuted: false
    };

    room.participants.set(sender.nodeId, participantInfo);
    console.log(`[WAYLINE] ${sender.nodeName} joined voice room "${room.name}" (${roomId})`);

    // Notify other room participants that a new peer joined
    broadcastToRoom(roomId, {
      type: 'VOICE_ROOM_PARTICIPANT_JOINED',
      roomId,
      participant: participantInfo
    }, clientWs);

    // Send room joined confirmation with full existing participant list to joiner
    clientWs.send(JSON.stringify({
      type: 'VOICE_ROOM_JOINED',
      roomId,
      name: room.name,
      creatorId: room.creatorId,
      participants: Array.from(room.participants.values())
    }));

    broadcastVoiceRoomList();
  } else if (msg.type === 'VOICE_ROOM_LEAVE') {
    const { roomId } = msg;
    const sender = registeredClients.get(clientWs);
    if (!roomId || !sender) return;

    const room = activeVoiceRooms.get(roomId);
    if (room && room.participants.has(sender.nodeId)) {
      room.participants.delete(sender.nodeId);
      console.log(`[WAYLINE] ${sender.nodeName} left voice room "${room.name}" (${roomId})`);

      broadcastToRoom(roomId, {
        type: 'VOICE_ROOM_PARTICIPANT_LEFT',
        roomId,
        peerId: sender.nodeId,
        peerName: sender.nodeName
      });

      if (room.participants.size === 0) {
        activeVoiceRooms.delete(roomId);
      }
      broadcastVoiceRoomList();
    }
  } else if (msg.type === 'VOICE_ROOM_END') {
    const { roomId } = msg;
    const sender = registeredClients.get(clientWs);
    if (!roomId || !sender) return;

    const room = activeVoiceRooms.get(roomId);
    if (room && room.creatorId === sender.nodeId) {
      console.log(`[WAYLINE] Voice room "${room.name}" (${roomId}) terminated by creator`);
      broadcastToRoom(roomId, {
        type: 'VOICE_ROOM_TERMINATED',
        roomId,
        reason: 'Room ended by creator'
      });
      activeVoiceRooms.delete(roomId);
      broadcastVoiceRoomList();
    }
  } else if (msg.type === 'VOICE_ROOM_LIST') {
    broadcastVoiceRoomList(clientWs);
  } else if (msg.type === 'VOICE_ROOM_MUTE_UPDATE') {
    const { roomId, isMuted } = msg;
    const sender = registeredClients.get(clientWs);
    if (!roomId || !sender) return;

    const room = activeVoiceRooms.get(roomId);
    if (room && room.participants.has(sender.nodeId)) {
      const p = room.participants.get(sender.nodeId);
      p.isMuted = Boolean(isMuted);
      broadcastToRoom(roomId, {
        type: 'VOICE_ROOM_MUTE_UPDATE',
        roomId,
        peerId: sender.nodeId,
        isMuted: Boolean(isMuted)
      }, clientWs);
    }
  } else if (msg.type === 'REFRESH_DISCOVERY') {
    broadcastUdpBeacon();
    broadcastPeersToClients();
  }
}

function broadcastVoiceRoomList(targetWs = null) {
  const roomsList = Array.from(activeVoiceRooms.values()).map(r => ({
    id: r.id,
    name: r.name,
    creatorId: r.creatorId,
    creatorName: r.creatorName,
    createdAt: r.createdAt,
    participantCount: r.participants.size,
    participants: Array.from(r.participants.values())
  }));
  const payload = JSON.stringify({ type: 'VOICE_ROOM_LIST', rooms: roomsList });
  if (targetWs && targetWs.readyState === WebSocket.OPEN) {
    targetWs.send(payload);
    return;
  }
  for (const client of clientSockets) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function broadcastToRoom(roomId, msg, excludeWs = null) {
  const room = activeVoiceRooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(msg);
  for (const [ws, client] of registeredClients.entries()) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN && room.participants.has(client.nodeId)) {
      ws.send(payload);
    }
  }
}

function broadcastPeersToClients() {
  const daemonPeers = Array.from(discoveredPeers.values()).map(p => ({
    id: p.id,
    name: p.name,
    address: `${p.ip}:${p.port}`,
    status: peerSockets.has(p.id) ? 'CONNECTED' : 'DISCOVERED',
    lastSeen: p.lastSeen,
    transport: 'UDP_LAN',
    isRelay: true
  }));

  for (const [ws, info] of registeredClients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      // All other connected browser clients on this LAN
      const otherClients = Array.from(registeredClients.entries())
        .filter(([cWs]) => cWs !== ws)
        .map(([_, c]) => ({
          id: c.nodeId,
          name: c.nodeName,
          address: c.ip,
          status: 'CONNECTED',
          transport: 'WEBSOCKET',
          lastSeen: c.lastSeen,
          isRelay: true
        }));

      const combinedPeers = [...otherClients, ...daemonPeers];
      ws.send(JSON.stringify({ type: 'PEERS_UPDATED', peers: combinedPeers }));
    }
  }
}

// --- 3. UDP Broadcast Discovery ---
const udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udpSocket.on('error', (err) => {
  console.warn(`[WAYLINE] UDP socket error: ${err.message}`);
});

udpSocket.on('message', (msg, rinfo) => {
  try {
    const str = msg.toString();
    if (!str.startsWith('WAYLINE_BEACON:')) return;

    const beaconData = JSON.parse(str.slice('WAYLINE_BEACON:'.length));
    if (beaconData.nodeId === NODE_ID) return; // Ignore self

    const peerId = beaconData.nodeId;
    const peerName = beaconData.nodeName || 'Nearby Peer';
    const peerHttpPort = beaconData.port || HTTP_PORT;
    const peerIp = rinfo.address;

    const isNew = !discoveredPeers.has(peerId);
    discoveredPeers.set(peerId, {
      id: peerId,
      name: peerName,
      ip: peerIp,
      port: peerHttpPort,
      lastSeen: Date.now()
    });

    if (isNew) {
      console.log(`[WAYLINE] Discovered nearby peer over UDP: ${peerName} at ${peerIp}:${peerHttpPort}`);
      broadcastPeersToClients();
      // Automatically connect outbound
      connectOutboundPeer(discoveredPeers.get(peerId));
    } else {
      // Re-verify connection if dropped
      if (!peerSockets.has(peerId)) {
        connectOutboundPeer(discoveredPeers.get(peerId));
      }
    }
  } catch (e) {
    // Ignore invalid beacon
  }
});

function broadcastUdpBeacon() {
  const beacon = Buffer.from('WAYLINE_BEACON:' + JSON.stringify({
    nodeId: NODE_ID,
    nodeName: NODE_NAME,
    port: HTTP_PORT,
    timestamp: Date.now()
  }));

  // Send to 255.255.255.255 global broadcast address
  udpSocket.send(beacon, 0, beacon.length, UDP_PORT, '255.255.255.255', () => {});

  // Also send directly to each physical subnet broadcast address (dynamically queries current adapters)
  const currentIfaces = getNetworkInterfaces();
  for (const iface of currentIfaces) {
    if (iface.broadcast && iface.broadcast !== '255.255.255.255') {
      udpSocket.send(beacon, 0, beacon.length, UDP_PORT, iface.broadcast, () => {});
    }
  }

  // Prune dead peers (not seen for > 15 seconds)
  const now = Date.now();
  let changed = false;
  for (const [id, peer] of discoveredPeers.entries()) {
    if (now - peer.lastSeen > 15000) {
      discoveredPeers.delete(id);
      const ws = peerSockets.get(id);
      if (ws) {
        ws.close();
        peerSockets.delete(id);
      }
      changed = true;
    }
  }
  if (changed) broadcastPeersToClients();
}

udpSocket.bind(UDP_PORT, () => {
  try {
    udpSocket.setBroadcast(true);
    console.log(`[WAYLINE] UDP discovery listening on port ${UDP_PORT}`);
  } catch (err) {
    console.warn('[WAYLINE] UDP setBroadcast error:', err.message);
  }
  setInterval(broadcastUdpBeacon, BROADCAST_INTERVAL_MS);
  broadcastUdpBeacon();
});

// Handle server errors (such as EADDRINUSE)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[WAYLINE ERROR] Port ${HTTP_PORT} is already in use by another process.`);
    console.error(`- Kill the existing process, or start on another port:`);
    console.error(`  WAYLINE_PORT=${HTTP_PORT + 1} npm start\n`);
    process.exit(1);
  } else {
    console.error('[WAYLINE ERROR]', err);
    process.exit(1);
  }
});

// --- 4. mDNS Responder for wayline.local (Port 5353) ---
const mdnsSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
mdnsSocket.on('error', () => {}); // Silently ignore if port 5353 is used by OS service

mdnsSocket.on('message', (msg, rinfo) => {
  try {
    const str = msg.toString('binary');
    if (str.includes('\x07wayline\x05local')) {
      const targetIp = getBestIpForClient(rinfo.address);
      const ipParts = targetIp.split('.').map(Number);
      if (ipParts.length !== 4) return;

      const response = Buffer.from([
        0x00, 0x00, 0x84, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x07, 0x77, 0x61, 0x79, 0x6c, 0x69, 0x6e, 0x65, 0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c, 0x00,
        0x00, 0x01, 0x80, 0x01, 0x00, 0x00, 0x00, 0x78, 0x00, 0x04,
        ipParts[0], ipParts[1], ipParts[2], ipParts[3]
      ]);

      mdnsSocket.send(response, 0, response.length, rinfo.port, rinfo.address);
    }
  } catch {}
});

try {
  mdnsSocket.bind(5353, () => {
    try {
      mdnsSocket.addMembership('224.0.0.251');
    } catch {}
  });
} catch {}

// --- 5. Host-Level Captive Portal & Dynamic PWA Redirection Layer ---
// Encapsulated host transport: handles local DNS/DHCP interception and Port 80 redirection
// Operates strictly external to the PWA application codebase with pure offline & internet fallback support
const hostRedirect = new HostRedirectLayer({
  getBestIpForClient,
  getDynamicPwaUrl: (clientIp, rawLocal) => {
    const targetHost = (rawLocal && rawLocal !== '127.0.0.1' && rawLocal !== '0.0.0.0')
      ? rawLocal 
      : getBestIpForClient(clientIp);
    const useHttps = Boolean(httpsServer || sslCredentials);
    return `${useHttps ? 'https' : 'http'}://${targetHost}:${useHttps ? HTTPS_PORT : HTTP_PORT}/`;
  },
  isVerbose: IS_VERBOSE,
  upstreamDns: process.env.WAYLINE_UPSTREAM_DNS || '8.8.8.8'
});
hostRedirect.start();

// Start HTTP & WebSocket server
server.listen(HTTP_PORT, '0.0.0.0', () => {
  const canonicalUrl = process.env.VITE_PUBLIC_APP_URL || (httpsServer ? `https://${LOCAL_IP}:${HTTPS_PORT}` : `http://${LOCAL_IP}:${HTTP_PORT}`);
  console.log(`\n======================================================`);
  console.log(`[WAYLINE] CANONICAL APPLICATION URL: ${canonicalUrl}`);
  console.log(`[WAYLINE] (Open this exact URL on PC and phones to cache PWA)`);
  console.log(`======================================================`);
  console.log(`[WAYLINE] Local HTTP Server:         http://0.0.0.0:${HTTP_PORT}`);
  console.log(`[WAYLINE] Local Subnet IP:           http://${LOCAL_IP}:${HTTP_PORT}`);
  console.log(`[WAYLINE] Zero-Config mDNS:          http://wayline.local:${HTTP_PORT}`);
  if (httpsServer) {
    console.log(`[WAYLINE] Secure HTTPS Server:       https://${LOCAL_IP}:${HTTPS_PORT} (WebRTC Voice Ready)`);
    console.log(`[WAYLINE] Root CA Certificate:       http://${LOCAL_IP}:${HTTP_PORT}/wayline-ca.crt\n`);
  }
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`[WAYLINE] HTTPS Server listening on port ${HTTPS_PORT}`);
  });
}
