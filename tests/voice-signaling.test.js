// Verification and regression tests for WAYLINE Voice Communication System
// Tests real WebSocket signaling for 1-on-1 calls, group voice rooms, and mesh limits
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const TEST_PORT = 8791;
const TEST_HTTPS_PORT = 8792;
const TEST_UDP_PORT = 8793;

console.log('[TEST] Starting WAYLINE Voice Signaling & Mesh Integration Tests...');

// Helper to wait
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  // 1. Spawn wayline node on dedicated test ports
  const nodeProcess = spawn('node', ['server/wayline-node.js'], {
    env: {
      ...process.env,
      WAYLINE_PORT: String(TEST_PORT),
      WAYLINE_HTTPS_PORT: String(TEST_HTTPS_PORT),
      WAYLINE_UDP_PORT: String(TEST_UDP_PORT)
    },
    stdio: 'pipe'
  });

  nodeProcess.stderr.on('data', (d) => {
    // console.error('[NODE ERR]', d.toString());
  });

  // Wait for node to bind ports
  await new Promise((resolve) => {
    nodeProcess.stdout.on('data', (d) => {
      if (d.toString().includes('CANONICAL APPLICATION URL')) resolve();
    });
    setTimeout(resolve, 4500);
  });

  try {
    // Helper to create and connect a client
    const createClient = (nodeId, nodeName) => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/client?nodeId=${nodeId}&nodeName=${encodeURIComponent(nodeName)}`);
        const messages = [];

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'CLIENT_REGISTER',
            nodeId,
            nodeName
          }));
          resolve({
            ws,
            nodeId,
            messages,
            send: (obj) => ws.send(JSON.stringify(obj)),
            waitForMessage: (typeOrPredicate, timeout = 3000) => {
              const start = Date.now();
              const matcher = typeof typeOrPredicate === 'function' 
                ? typeOrPredicate 
                : (m) => m.type === typeOrPredicate;

              return new Promise((res, rej) => {
                const interval = setInterval(() => {
                  const idx = messages.findIndex(matcher);
                  if (idx !== -1) {
                    clearInterval(interval);
                    const msg = messages.splice(idx, 1)[0];
                    res(msg);
                  } else if (Date.now() - start > timeout) {
                    clearInterval(interval);
                    rej(new Error(`Timeout waiting for message: ${typeOrPredicate}`));
                  }
                }, 50);
              });
            },
            close: () => ws.close()
          });
        });

        ws.on('message', (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            messages.push(parsed);
          } catch {}
        });

        ws.on('error', (err) => reject(err));
      });
    };

    const clientA = await createClient('node_alice', 'Alice Field');
    const clientB = await createClient('node_bob', 'Bob Rescue');

    console.log('✓ Clients Alice and Bob registered with node');

    // --- TEST 1: 1-on-1 Voice Call Lifecycle ---
    console.log('Testing 1-on-1 voice calling signaling flow...');

    // Alice invites Bob
    clientA.send({
      type: 'VOICE_CALL_INVITE',
      targetPeerId: 'node_bob',
      callId: 'call_test_101'
    });

    const inviteMsg = await clientB.waitForMessage('VOICE_CALL_INVITE');
    assert.strictEqual(inviteMsg.callerId, 'node_alice');
    assert.strictEqual(inviteMsg.callId, 'call_test_101');
    console.log('✓ Inbound call invite routed to recipient');

    // Bob accepts
    clientB.send({
      type: 'VOICE_CALL_ACCEPT',
      targetPeerId: 'node_alice',
      callId: 'call_test_101'
    });

    const acceptMsg = await clientA.waitForMessage('VOICE_CALL_ACCEPT');
    assert.strictEqual(acceptMsg.calleeId, 'node_bob');
    console.log('✓ Call accept signal routed to caller');

    // Exchange WebRTC ICE/SDP signal
    clientA.send({
      type: 'VOICE_SIGNAL',
      targetPeerId: 'node_bob',
      callId: 'call_test_101',
      signal: { sdp: 'fake_offer_sdp' }
    });

    const signalMsg = await clientB.waitForMessage('VOICE_SIGNAL');
    assert.strictEqual(signalMsg.senderId, 'node_alice');
    assert.strictEqual(signalMsg.signal.sdp, 'fake_offer_sdp');
    console.log('✓ WebRTC signaling envelope relayed accurately');

    // Bob ends call
    clientB.send({
      type: 'VOICE_CALL_END',
      targetPeerId: 'node_alice',
      callId: 'call_test_101'
    });

    const endMsg = await clientA.waitForMessage('VOICE_CALL_END');
    assert.strictEqual(endMsg.senderId, 'node_bob');
    console.log('✓ Call termination routed correctly');

    // --- TEST 2: Group Voice Room Mesh ---
    console.log('Testing group voice rooms mesh signaling...');

    // Alice creates room
    clientA.send({
      type: 'VOICE_ROOM_CREATE',
      roomId: 'room_field_alpha',
      name: 'Field Alpha Command'
    });

    // Wait for room to register
    await sleep(300);

    // Bob requests room list
    clientB.send({
      type: 'VOICE_ROOM_LIST'
    });

    const listMsg = await clientB.waitForMessage(m => m.type === 'VOICE_ROOM_LIST' && m.rooms && m.rooms.some(r => r.id === 'room_field_alpha'));
    const createdRoom = listMsg.rooms.find(r => r.id === 'room_field_alpha');
    assert(createdRoom, 'Created room should appear in room list');
    assert.strictEqual(createdRoom.name, 'Field Alpha Command');
    console.log('✓ Group voice room created and listed on mesh');

    // Bob joins room
    clientB.send({
      type: 'VOICE_ROOM_JOIN',
      roomId: 'room_field_alpha'
    });

    const joinedMsg = await clientB.waitForMessage('VOICE_ROOM_JOINED');
    assert.strictEqual(joinedMsg.roomId, 'room_field_alpha');
    assert.strictEqual(joinedMsg.participants.length, 2);
    console.log('✓ Bob received participant roster on room join');

    const peerJoinedMsg = await clientA.waitForMessage('VOICE_ROOM_PARTICIPANT_JOINED');
    assert.strictEqual(peerJoinedMsg.participant.peerId, 'node_bob');
    console.log('✓ Alice notified of new participant join');

    // Bob sends mute state update
    clientB.send({
      type: 'VOICE_ROOM_MUTE_UPDATE',
      roomId: 'room_field_alpha',
      isMuted: true
    });

    const muteMsg = await clientA.waitForMessage('VOICE_ROOM_MUTE_UPDATE');
    assert.strictEqual(muteMsg.peerId, 'node_bob');
    assert.strictEqual(muteMsg.isMuted, true);
    console.log('✓ Participant mute state broadcasted to room members');

    // Bob leaves room
    clientB.send({
      type: 'VOICE_ROOM_LEAVE',
      roomId: 'room_field_alpha'
    });

    const leftMsg = await clientA.waitForMessage('VOICE_ROOM_PARTICIPANT_LEFT');
    assert.strictEqual(leftMsg.peerId, 'node_bob');
    console.log('✓ Room participant leave event handled');

    // Alice terminates room
    clientA.send({
      type: 'VOICE_ROOM_END',
      roomId: 'room_field_alpha'
    });

    await sleep(200);

    // Verify room terminated
    clientB.send({
      type: 'VOICE_ROOM_LIST'
    });
    const updatedList = await clientB.waitForMessage('VOICE_ROOM_LIST');
    assert(!updatedList.rooms.some(r => r.id === 'room_field_alpha'), 'Room must be removed after END');
    console.log('✓ Voice room successfully destroyed on termination');

    // --- TEST 3: Room Capacity Limit (Max 4 Mesh peers) ---
    console.log('Testing max participant mesh enforcement...');
    clientA.send({
      type: 'VOICE_ROOM_CREATE',
      roomId: 'room_mesh_limit',
      name: 'Small Ops'
    });
    await sleep(200);

    const clientC = await createClient('node_charlie', 'Charlie');
    const clientD = await createClient('node_david', 'David');
    const clientE = await createClient('node_eve', 'Eve');

    // 2nd, 3rd, 4th join
    clientB.send({ type: 'VOICE_ROOM_JOIN', roomId: 'room_mesh_limit' });
    await clientB.waitForMessage('VOICE_ROOM_JOINED');

    clientC.send({ type: 'VOICE_ROOM_JOIN', roomId: 'room_mesh_limit' });
    await clientC.waitForMessage('VOICE_ROOM_JOINED');

    clientD.send({ type: 'VOICE_ROOM_JOIN', roomId: 'room_mesh_limit' });
    await clientD.waitForMessage('VOICE_ROOM_JOINED');

    // 5th join attempt (should be rejected as room is at max capacity: 4)
    clientE.send({ type: 'VOICE_ROOM_JOIN', roomId: 'room_mesh_limit' });
    const err = await clientE.waitForMessage('ERROR');
    assert(err.message.includes('limit reached'), `Expected 'limit reached' error, got: ${err.message}`);
    console.log('✓ Mesh capacity safety limit (4 participants) enforced strictly');

    // --- TEST 4: Callsign Update Propagation ---
    console.log('Testing callsign update propagation across peers...');
    clientA.send({
      type: 'CLIENT_REGISTER',
      nodeId: 'node_alice',
      nodeName: 'Alice Commander'
    });

    const peersMsg = await clientB.waitForMessage(m => 
      m.type === 'PEERS_UPDATED' && m.peers && m.peers.some(p => p.id === 'node_alice' && p.name === 'Alice Commander')
    );
    assert(peersMsg, 'Bob must receive updated callsign for Alice');
    console.log('✓ Callsign change broadcasted and verified on remote peer');

    // Close clients
    clientA.close();
    clientB.close();
    clientC.close();
    clientD.close();
    clientE.close();

    console.log('\n[TEST] All WAYLINE Voice Signaling tests PASSED successfully!\n');

  } finally {
    nodeProcess.kill('SIGINT');
  }
}

run().catch((err) => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
