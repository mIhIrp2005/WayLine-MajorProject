// Verification test for Phone A -> Phone B -> Phone C multi-hop chain relay
import assert from 'node:assert';

function crc16Ccitt(data) {
  let crc = 0xFFFF;
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc;
}

console.log('[TEST] Starting Phone A -> Phone B -> Phone C Chain Relay Test...');

// Mock nodes
class MeshNode {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.seen = new Set();
    this.inbox = [];
    this.connectedPeers = new Set();
  }

  connect(peer) {
    this.connectedPeers.add(peer);
    peer.connectedPeers.add(this);
  }

  disconnect(peer) {
    this.connectedPeers.delete(peer);
    peer.connectedPeers.delete(this);
  }

  receivePacket(packet, fromPeer) {
    if (this.seen.has(packet.id)) return false;
    this.seen.add(packet.id);
    this.inbox.push(packet);

    // Multi-hop relay forwarding
    if (packet.hopCount < packet.ttl) {
      const relayPacket = { ...packet, hopCount: packet.hopCount + 1 };
      for (const peer of this.connectedPeers) {
        if (peer !== fromPeer) {
          peer.receivePacket(relayPacket, this);
        }
      }
    }
    return true;
  }
}

// Topology: Phone A <-> Phone B <-> Phone C
// Phone A and Phone C have NO direct link (they are out of range of each other).
const phoneA = new MeshNode('phone_a', 'Phone A');
const phoneB = new MeshNode('phone_b', 'Phone B');
const phoneC = new MeshNode('phone_c', 'Phone C');

phoneA.connect(phoneB);
phoneB.connect(phoneC);

assert.strictEqual(phoneA.connectedPeers.has(phoneC), false, 'Phone A and Phone C must have NO direct link');
assert.strictEqual(phoneB.connectedPeers.has(phoneA), true, 'Phone B must be linked to Phone A');
assert.strictEqual(phoneB.connectedPeers.has(phoneC), true, 'Phone B must be linked to Phone C');

// Phone A originates a message
const packet = {
  version: 1,
  id: 'msg_chain_test_001',
  type: 'CHAT',
  senderId: phoneA.id,
  senderName: phoneA.name,
  recipientId: '*',
  timestamp: Date.now(),
  ttl: 3,
  hopCount: 0,
  payload: { content: 'Urgent medical aid needed in Sector 4' }
};

// Dispatch from Phone A to Phone B
phoneB.receivePacket(packet, phoneA);

// Assert Phone B received it at hop 0
assert.strictEqual(phoneB.inbox.length, 1, 'Phone B must have received the packet');
assert.strictEqual(phoneB.inbox[0].id, 'msg_chain_test_001');

// Assert Phone C received it forwarded by Phone B at hop 1
assert.strictEqual(phoneC.inbox.length, 1, 'Phone C must have received the packet via Phone B relay');
assert.strictEqual(phoneC.inbox[0].id, 'msg_chain_test_001');
assert.strictEqual(phoneC.inbox[0].hopCount, 1, 'Hop count at Phone C must be 1');

// Test Duplicate Loop Suppression: Re-sending to Phone B must drop silently
const duplicateResult = phoneB.receivePacket(packet, phoneA);
assert.strictEqual(duplicateResult, false, 'Duplicate packet must be dropped');
assert.strictEqual(phoneC.inbox.length, 1, 'Phone C inbox must not receive duplicate');

console.log('✓ Multi-hop chain relay Phone A -> Phone B -> Phone C verified');
console.log('✓ TTL incrementation and duplicate suppression across hops verified');
console.log('[TEST] Chain Relay Test PASSED!\n');
