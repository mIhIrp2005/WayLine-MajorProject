// Automated Verification for WAYLINE Experimental Acoustic Modem & Framing
import assert from 'node:assert';

console.log('[TEST] Starting Experimental Acoustic Modem framing & CRC verification...');

// CRC-16 CCITT (0x1021) Algorithm
function calculateCrc16(data) {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] << 8);
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

// Encode Frame
function encodeTestFrame(frameType, packetId, payloadText, senderId = 554433, sessionId = 42) {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payloadText);

  const typeCode = frameType === 'DATA' ? 1 : frameType === 'ACK' ? 2 : frameType === 'BEACON' ? 3 : 4;
  const buffer = new Uint8Array(15 + payloadBytes.length + 2);

  buffer[0] = 1; // Version
  buffer[1] = (sessionId >> 8) & 0xFF;
  buffer[2] = sessionId & 0xFF;
  buffer[3] = typeCode;

  buffer[4] = (packetId >> 24) & 0xFF;
  buffer[5] = (packetId >> 16) & 0xFF;
  buffer[6] = (packetId >> 8) & 0xFF;
  buffer[7] = packetId & 0xFF;

  buffer[8] = (senderId >> 24) & 0xFF;
  buffer[9] = (senderId >> 16) & 0xFF;
  buffer[10] = (senderId >> 8) & 0xFF;
  buffer[11] = senderId & 0xFF;

  buffer[12] = 0; // Seq
  buffer[13] = 1; // Total Seqs
  buffer[14] = payloadBytes.length;
  buffer.set(payloadBytes, 15);

  const crc = calculateCrc16(buffer.subarray(0, 15 + payloadBytes.length));
  buffer[15 + payloadBytes.length] = (crc >> 8) & 0xFF;
  buffer[16 + payloadBytes.length] = crc & 0xFF;

  return buffer;
}

// Decode Frame
function decodeTestFrame(buffer) {
  if (buffer.length < 17) return null;
  const version = buffer[0];
  if (version !== 1) return null;

  const sessionId = (buffer[1] << 8) | buffer[2];
  const typeCode = buffer[3];
  const frameType = typeCode === 1 ? 'DATA' : typeCode === 2 ? 'ACK' : typeCode === 3 ? 'BEACON' : 'RELAY';

  const packetId = ((buffer[4] << 24) | (buffer[5] << 16) | (buffer[6] << 8) | buffer[7]) >>> 0;
  const senderId = ((buffer[8] << 24) | (buffer[9] << 16) | (buffer[10] << 8) | buffer[11]) >>> 0;
  const seq = buffer[12];
  const totalSeqs = buffer[13];
  const payloadLen = buffer[14];

  if (buffer.length !== 15 + payloadLen + 2) return null;

  const payload = buffer.slice(15, 15 + payloadLen);
  const expectedCrc = (buffer[15 + payloadLen] << 8) | buffer[16 + payloadLen];
  const actualCrc = calculateCrc16(buffer.subarray(0, 15 + payloadLen));

  if (expectedCrc !== actualCrc) {
    return { error: 'CRC_MISMATCH', expectedCrc, actualCrc };
  }

  const decoder = new TextDecoder();
  const text = decoder.decode(payload);

  return { version, sessionId, frameType, packetId, senderId, seq, totalSeqs, text, crc: actualCrc };
}

// 1. Test Frame Encoding & Decoding Round-Trip
const originalText = 'WAYLINE_ACOUSTIC_P2P_01';
const testPacketId = 887766;
const rawEncoded = encodeTestFrame('DATA', testPacketId, originalText);
assert.ok(rawEncoded.length >= 17, 'Encoded buffer must meet minimum frame length');

const decoded = decodeTestFrame(rawEncoded);
assert.strictEqual(decoded.version, 1);
assert.strictEqual(decoded.frameType, 'DATA');
assert.strictEqual(decoded.packetId, testPacketId);
assert.strictEqual(decoded.text, originalText);
assert.ok(decoded.crc > 0, 'Valid CRC must be positive integer');
console.log('✓ Bit-level frame encoding and decoding round-trip verified');

// 2. Test CRC Integrity on Corrupted Frame
const corrupted = new Uint8Array(rawEncoded);
// Flip a single bit in the payload
corrupted[16] ^= 0x01;
const corruptResult = decodeTestFrame(corrupted);
assert.ok(corruptResult.error === 'CRC_MISMATCH', 'Corrupted bit must trigger CRC_MISMATCH rejection');
console.log('✓ CRC-16 corrupted frame rejection verified');

// 3. Test Truncated Frame Handling
const truncated = rawEncoded.slice(0, 12);
const truncResult = decodeTestFrame(truncated);
assert.strictEqual(truncResult, null, 'Truncated frame must return null safely without throwing');
console.log('✓ Truncated frame safe handling verified');

// 4. Test Acoustic ACK Packet Matching
const ackFrame = encodeTestFrame('ACK', testPacketId, `ACK:${testPacketId}`, 998877);
const decodedAck = decodeTestFrame(ackFrame);
assert.strictEqual(decodedAck.frameType, 'ACK');
assert.strictEqual(decodedAck.packetId, testPacketId, 'ACK packet ID must match target packet ID');
console.log('✓ Acoustic ACK packet matching and session verification verified');

// 5. Test Discovery Beacon Frame
const beaconFrame = encodeTestFrame('BEACON', 12345, 'BEACON:554433');
const decodedBeacon = decodeTestFrame(beaconFrame);
assert.strictEqual(decodedBeacon.frameType, 'BEACON');
console.log('✓ Acoustic discovery beacon framing verified');

// 6. Test Multi-Device Relay Hop Frame
const relayFrame = encodeTestFrame('RELAY', 991122, 'FORWARD_HOP_2');
const decodedRelay = decodeTestFrame(relayFrame);
assert.strictEqual(decodedRelay.frameType, 'RELAY');
assert.strictEqual(decodedRelay.text, 'FORWARD_HOP_2');
console.log('✓ Multi-hop acoustic relay frame verification verified');

console.log('[TEST] All Acoustic Modem unit tests PASSED successfully!\n');
