// WAYLINE Local Discovery & Peer Relay Node Engine
// Provides real UDP broadcast discovery and WebSocket peer-to-peer transport over Wi-Fi / LAN without internet.

import dgram from 'node:dgram';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';

const HTTP_PORT = parseInt(process.env.WAYLINE_PORT || '8765', 10);
const UDP_PORT = parseInt(process.env.WAYLINE_UDP_PORT || '8766', 10);
const BROADCAST_INTERVAL_MS = 3000;

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
    const isVirtual = /virtual|vbox|vmware|wsl|pseudo|loopback/i.test(name);
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const isVboxSubnet = iface.address.startsWith('192.168.56.') || iface.address.startsWith('169.254.');
        const isEthernetOrWifi = /ethernet|wi-fi|wlan|lan|en|eth/i.test(name);

        let priority = 10;
        // High priority for physical Ethernet & Wi-Fi with valid DHCP/LAN IP
        if (isEthernetOrWifi && !isVirtual && !isVboxSubnet) priority = 100;
        else if (!isVirtual && !isVboxSubnet) priority = 50;
        else if (isVboxSubnet || isVirtual) priority = 1;

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

console.log(`[WAYLINE] Primary Interface: ${primaryIface.name} (${LOCAL_IP})`);
if (activeInterfaces.length > 1) {
  console.log(`[WAYLINE] Detected other adapters: ${activeInterfaces.slice(1).map(i => `${i.name}: ${i.address}`).join(', ')}`);
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // Basic health/diagnostic endpoint
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      nodeId: NODE_ID,
      nodeName: NODE_NAME,
      localIp: LOCAL_IP,
      httpPort: HTTP_PORT,
      udpPort: UDP_PORT,
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
});

// --- 2. WebSocket Server for UI Clients and Peer Nodes ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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
      lastSeen: Date.now()
    };

    registeredClients.set(ws, clientInfo);
    clientSockets.add(ws);
    console.log(`[WAYLINE] Browser UI connected: ${clientInfo.nodeName} (${clientInfo.nodeId}) [${clientSockets.size} active]`);

    // Send initial status to this client
    ws.send(JSON.stringify({
      type: 'NODE_STATUS',
      nodeId: NODE_ID,
      nodeName: NODE_NAME,
      listeningAddress: `${LOCAL_IP}:${HTTP_PORT}`
    }));

    // Broadcast updated peer list to all clients so they immediately see each other!
    broadcastPeersToClients();

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'CLIENT_REGISTER') {
          if (msg.nodeId) clientInfo.nodeId = msg.nodeId;
          if (msg.nodeName) clientInfo.nodeName = msg.nodeName;
          broadcastPeersToClients();
        } else {
          handleClientMessage(msg, ws);
        }
      } catch (err) {
        console.error('[WAYLINE] Invalid client JSON:', err.message);
      }
    });

    ws.on('close', () => {
      registeredClients.delete(ws);
      clientSockets.delete(ws);
      console.log(`[WAYLINE] Browser UI disconnected: ${clientInfo.nodeName}`);
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
  } else if (msg.type === 'REFRESH_DISCOVERY') {
    broadcastUdpBeacon();
    broadcastPeersToClients();
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

  // Also send directly to each physical subnet broadcast address (e.g. Ethernet 192.168.0.255)
  for (const iface of activeInterfaces) {
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

// Start HTTP & WebSocket server
server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[WAYLINE] Emergency node active on http://0.0.0.0:${HTTP_PORT}`);
  console.log(`[WAYLINE] Accessible on this PC at:       http://localhost:${HTTP_PORT}`);
  console.log(`[WAYLINE] Accessible on local LAN/Phone at: http://${LOCAL_IP}:${HTTP_PORT}\n`);
});
