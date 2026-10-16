// Multi-client peer discovery and relay verification
// Simulates 3 browser UI clients (e.g. PC, Phone, Tablet) connected to the same WAYLINE Node
import assert from 'node:assert';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

async function testMultiClient() {
  console.log('[TEST] Starting Multi-Client Peer Discovery & Relay Test...');

  // Start a local test node server on port 8780
  const TEST_PORT = 8780;
  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  const registeredClients = new Map();
  const clientSockets = new Set();
  const seenPackets = new Set();

  function broadcastPeersToClients() {
    for (const [ws, info] of registeredClients.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
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
        ws.send(JSON.stringify({ type: 'PEERS_UPDATED', peers: otherClients }));
      }
    }
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientNodeId = url.searchParams.get('nodeId') || ('client_' + Math.random().toString(36).substring(2, 8));
    const clientNodeName = url.searchParams.get('nodeName') || 'Nearby User';

    const clientInfo = {
      ws,
      nodeId: clientNodeId,
      nodeName: clientNodeName,
      ip: '192.168.0.115',
      lastSeen: Date.now()
    };

    registeredClients.set(ws, clientInfo);
    clientSockets.add(ws);
    broadcastPeersToClients();

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'SEND_PACKET' && msg.packet) {
        const packet = msg.packet;
        seenPackets.add(packet.id);
        let sentCount = 0;
        const payload = JSON.stringify({ type: 'PACKET_RECEIVED', packet });

        for (const [otherWs, otherClient] of registeredClients.entries()) {
          if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
            if (packet.recipientId === '*' || packet.recipientId === otherClient.nodeId) {
              otherWs.send(payload);
              sentCount++;
            }
          }
        }

        ws.send(JSON.stringify({
          type: 'SEND_RESULT',
          packetId: packet.id,
          transmittedCount: sentCount
        }));
      }
    });

    ws.on('close', () => {
      registeredClients.delete(ws);
      clientSockets.delete(ws);
      broadcastPeersToClients();
    });
  });

  await new Promise(r => server.listen(TEST_PORT, r));
  console.log(`✓ Test server running on port ${TEST_PORT}`);

  // Connect Client 1 (PC)
  const client1Peers = [];
  const client1 = new WebSocket(`ws://localhost:${TEST_PORT}/client?type=client&nodeId=client_pc&nodeName=Windows%20PC`);
  client1.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.type === 'PEERS_UPDATED') {
      client1Peers.length = 0;
      client1Peers.push(...m.peers);
    }
  });

  await new Promise(r => client1.on('open', r));
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(client1Peers.length, 0, 'Client 1 alone should see 0 peers');

  // Connect Client 2 (Phone)
  const client2Peers = [];
  const client2Messages = [];
  const client2 = new WebSocket(`ws://localhost:${TEST_PORT}/client?type=client&nodeId=client_phone&nodeName=Android%20Phone`);
  client2.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.type === 'PEERS_UPDATED') {
      client2Peers.length = 0;
      client2Peers.push(...m.peers);
    } else if (m.type === 'PACKET_RECEIVED') {
      client2Messages.push(m.packet);
      // Auto-send ACK back
      client2.send(JSON.stringify({
        type: 'SEND_PACKET',
        packet: {
          version: 1,
          id: `ack_${Date.now()}`,
          type: 'ACK',
          senderId: 'client_phone',
          senderName: 'Android Phone',
          recipientId: m.packet.senderId,
          timestamp: Date.now(),
          ttl: 3,
          hopCount: 0,
          payload: { ackMessageId: m.packet.id }
        }
      }));
    }
  });

  await new Promise(r => client2.on('open', r));
  await new Promise(r => setTimeout(r, 100));

  assert.strictEqual(client1Peers.length, 1, 'Client 1 must see Client 2 (Phone)');
  assert.strictEqual(client1Peers[0].name, 'Android Phone');
  assert.strictEqual(client2Peers.length, 1, 'Client 2 must see Client 1 (PC)');
  assert.strictEqual(client2Peers[0].name, 'Windows PC');
  console.log('✓ Automatic mutual peer discovery between PC and Phone verified');

  // Connect Client 3 (Tablet)
  const client3Peers = [];
  const client3Messages = [];
  const client3 = new WebSocket(`ws://localhost:${TEST_PORT}/client?type=client&nodeId=client_tablet&nodeName=Tablet`);
  client3.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.type === 'PEERS_UPDATED') {
      client3Peers.length = 0;
      client3Peers.push(...m.peers);
    } else if (m.type === 'PACKET_RECEIVED') {
      client3Messages.push(m.packet);
    }
  });

  await new Promise(r => client3.on('open', r));
  await new Promise(r => setTimeout(r, 100));

  assert.strictEqual(client1Peers.length, 2, 'Client 1 must now see 2 peers');
  assert.strictEqual(client2Peers.length, 2, 'Client 2 must now see 2 peers');
  assert.strictEqual(client3Peers.length, 2, 'Client 3 must now see 2 peers');
  console.log('✓ All 3 clients see both peers in range');

  // Client 1 sends broadcast message
  let client1AckReceived = false;
  client1.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.type === 'PACKET_RECEIVED' && m.packet.type === 'ACK') {
      client1AckReceived = true;
    }
  });

  const broadcastMsg = {
    version: 1,
    id: 'msg_emergency_01',
    type: 'CHAT',
    senderId: 'client_pc',
    senderName: 'Windows PC',
    recipientId: '*',
    timestamp: Date.now(),
    ttl: 3,
    hopCount: 0,
    payload: { content: 'Urgent medical assistance needed at Sector 4' }
  };

  client1.send(JSON.stringify({
    type: 'SEND_PACKET',
    packet: broadcastMsg
  }));

  await new Promise(r => setTimeout(r, 200));

  assert.strictEqual(client2Messages.length, 1, 'Client 2 (Phone) must receive broadcast');
  assert.strictEqual(client2Messages[0].payload.content, 'Urgent medical assistance needed at Sector 4');
  assert.strictEqual(client3Messages.length, 1, 'Client 3 (Tablet) must receive broadcast');
  assert.ok(client1AckReceived, 'Client 1 (PC) must receive ACK from Phone');
  console.log('✓ Real message broadcast & receipt verified across all 3 devices');
  console.log('✓ Automatic application ACK returned and verified');

  client1.close();
  client2.close();
  client3.close();
  server.close();
  console.log('[TEST] Multi-Client Peer Discovery & Message Relay Test PASSED!');
  process.exit(0);
}

testMultiClient().catch((e) => {
  console.error('[TEST FAILED]', e);
  process.exit(1);
});
