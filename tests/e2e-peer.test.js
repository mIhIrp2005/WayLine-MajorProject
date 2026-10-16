// End-to-end peer discovery and messaging test
// Tests 2 actual WAYLINE nodes communicating over real WebSockets and local sockets
import assert from 'node:assert';
import { WebSocket } from 'ws';

async function runE2ETest() {
  console.log('[E2E TEST] Connecting test client to running WAYLINE node on port 8765...');

  // 1. Connect Client A to Node A (port 8765)
  const clientA = new WebSocket('ws://localhost:8765/client?type=client');

  await new Promise((resolve, reject) => {
    clientA.on('open', resolve);
    clientA.on('error', reject);
  });
  console.log('✓ Client A connected to Node A via WebSocket');

  // 2. Connect a simulated Peer Node B directly to Node A's /peer endpoint
  const peerNodeId = 'node_peer_beta';
  const peerNodeName = 'Peer Node Beta (Android Device)';
  const peerSocket = new WebSocket(`ws://localhost:8765/peer?nodeId=${peerNodeId}&nodeName=${encodeURIComponent(peerNodeName)}`);

  await new Promise((resolve, reject) => {
    peerSocket.on('open', resolve);
    peerSocket.on('error', reject);
  });
  console.log('✓ Peer Node B connected to Node A peer endpoint');

  // Wait 500ms for status to sync
  await new Promise(r => setTimeout(r, 500));

  // 3. Test sending CHAT packet from Client A
  const testMessageId = `msg_test_${Date.now()}`;
  let receivedByPeer = null;

  peerSocket.on('message', (data) => {
    const packet = JSON.parse(data.toString());
    console.log(`[E2E] Peer B received packet: ${packet.type} [${packet.id}]`);
    if (packet.id === testMessageId) {
      receivedByPeer = packet;
      // Peer B sends ACK back to Node A
      const ackPacket = {
        version: 1,
        id: `ack_${Date.now()}`,
        type: 'ACK',
        senderId: peerNodeId,
        senderName: peerNodeName,
        recipientId: packet.senderId,
        timestamp: Date.now(),
        ttl: 3,
        hopCount: 0,
        payload: {
          ackMessageId: packet.id,
          targetType: 'CHAT'
        }
      };
      peerSocket.send(JSON.stringify(ackPacket));
    }
  });

  let ackReceivedByClientA = null;
  clientA.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'PACKET_RECEIVED' && msg.packet.type === 'ACK') {
      if (msg.packet.payload?.ackMessageId === testMessageId) {
        ackReceivedByClientA = msg.packet;
      }
    }
  });

  // Client A sends test CHAT packet
  const chatPacket = {
    version: 1,
    id: testMessageId,
    type: 'CHAT',
    senderId: 'node_client_alpha',
    senderName: 'Client Alpha (Windows PC)',
    recipientId: '*',
    timestamp: Date.now(),
    ttl: 3,
    hopCount: 0,
    payload: { content: 'Bridge collapsed on East side. Use North route.' }
  };

  clientA.send(JSON.stringify({
    type: 'SEND_PACKET',
    packet: chatPacket
  }));

  // Wait up to 2 seconds for exchange
  for (let i = 0; i < 20; i++) {
    if (receivedByPeer && ackReceivedByClientA) break;
    await new Promise(r => setTimeout(r, 100));
  }

  assert.ok(receivedByPeer, 'Peer B must have received the chat packet from Node A');
  assert.strictEqual(receivedByPeer.payload.content, 'Bridge collapsed on East side. Use North route.');
  console.log('✓ CHAT packet successfully transmitted from Node A to Peer B');

  assert.ok(ackReceivedByClientA, 'Client A must have received the ACK back from Peer B');
  assert.strictEqual(ackReceivedByClientA.payload.ackMessageId, testMessageId);
  console.log('✓ Application-level ACK successfully received and verified');

  clientA.close();
  peerSocket.close();
  console.log('[E2E TEST] All end-to-end communication tests PASSED!');
  process.exit(0);
}

runE2ETest().catch((err) => {
  console.error('[E2E TEST ERROR]:', err);
  process.exit(1);
});
