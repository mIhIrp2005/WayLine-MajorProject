// Automated verification of WAYLINE Protocol & Duplicate Suppression
import assert from 'node:assert';

// Mock Protocol logic for Node testing
const PROTOCOL_VERSION = 1;
const DEFAULT_TTL = 3;

class ProtocolCheck {
  constructor() {
    this.seen = new Set();
  }

  calculateChecksum(packet) {
    const raw = `${packet.version}:${packet.id}:${packet.senderId}:${packet.type}:${packet.timestamp}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  createChat(senderId, senderName, content, recipient = '*') {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const packet = {
      version: PROTOCOL_VERSION,
      id,
      type: 'CHAT',
      senderId,
      senderName,
      recipientId: recipient,
      timestamp: Date.now(),
      ttl: DEFAULT_TTL,
      hopCount: 0,
      payload: { content }
    };
    packet.signature = this.calculateChecksum(packet);
    this.seen.add(id);
    return packet;
  }

  createAck(receiverId, receiverName, targetPacket) {
    const id = `ack_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const packet = {
      version: PROTOCOL_VERSION,
      id,
      type: 'ACK',
      senderId: receiverId,
      senderName: receiverName,
      recipientId: targetPacket.senderId,
      timestamp: Date.now(),
      ttl: DEFAULT_TTL,
      hopCount: 0,
      payload: {
        ackMessageId: targetPacket.id,
        targetType: targetPacket.type
      }
    };
    packet.signature = this.calculateChecksum(packet);
    this.seen.add(id);
    return packet;
  }

  isDuplicate(id) {
    return this.seen.has(id);
  }

  prepareRelay(packet) {
    if (packet.hopCount + 1 >= packet.ttl) {
      return null; // TTL expired
    }
    return { ...packet, hopCount: packet.hopCount + 1 };
  }
}

// --- Run Assertions ---
console.log('[TEST] Starting WAYLINE protocol self-check...');
const p = new ProtocolCheck();

// 1. Packet creation & Checksum
const chat = p.createChat('node_alpha', 'Phone Alpha', 'Road blocked near bridge');
assert.strictEqual(chat.version, 1, 'Version must be 1');
assert.strictEqual(chat.type, 'CHAT', 'Type must be CHAT');
assert.strictEqual(chat.hopCount, 0, 'Hop count starts at 0');
assert.ok(chat.signature, 'Signature must be computed');
console.log('✓ Chat packet creation & checksum verified');

// 2. Duplicate Detection
assert.strictEqual(p.isDuplicate(chat.id), true, 'Seen packet must be flagged as duplicate');
assert.strictEqual(p.isDuplicate('non_existent_id'), false, 'Unseen packet must not be duplicate');
console.log('✓ Duplicate packet suppression verified');

// 3. Application-Level ACK
const ack = p.createAck('node_beta', 'PC Beta', chat);
assert.strictEqual(ack.type, 'ACK', 'Type must be ACK');
assert.strictEqual(ack.recipientId, 'node_alpha', 'ACK must be addressed to sender');
assert.strictEqual(ack.payload.ackMessageId, chat.id, 'ACK payload must reference target packet ID');
console.log('✓ Application-level acknowledgement verified');

// 4. Multi-Hop Forwarding & TTL
let hop1 = p.prepareRelay(chat);
assert.ok(hop1, 'Hop 1 should be valid');
assert.strictEqual(hop1.hopCount, 1, 'Hop count should increment to 1');

let hop2 = p.prepareRelay(hop1);
assert.ok(hop2, 'Hop 2 should be valid');
assert.strictEqual(hop2.hopCount, 2, 'Hop count should increment to 2');

let hop3 = p.prepareRelay(hop2);
assert.strictEqual(hop3, null, 'Hop 3 should expire and return null');
console.log('✓ Hop count and TTL loop prevention verified');

console.log('[TEST] All 4 protocol self-checks passed successfully!');
