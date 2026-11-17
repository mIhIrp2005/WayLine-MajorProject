import assert from 'node:assert';

// Self-check for native Web Crypto AES-GCM 256-bit, ECDH PFS, ECDSA Signatures, and Metadata Blinding
const PBKDF2_SALT = new TextEncoder().encode('wayline_mesh_salt_v1');

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const clean = hex.trim().replace(/^0x/, '');
  const matches = clean.match(/.{1,2}/g);
  if (!matches) return new Uint8Array(0);
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(hash));
}

// --- 1. AES-GCM 256-bit ---
async function deriveKey(passphrase) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: PBKDF2_SALT,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptAes(text, passphrase) {
  if (!passphrase || !passphrase.trim()) return text;
  const key = await deriveKey(passphrase.trim());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return `aes:${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

async function decryptAes(cipherStr, passphrase) {
  if (!cipherStr || !cipherStr.startsWith('aes:')) return cipherStr;
  if (!passphrase || !passphrase.trim()) return '🔒 [Encrypted Message — Enter Passphrase to Decrypt]';

  try {
    const parts = cipherStr.split(':');
    if (parts.length !== 3) return cipherStr;
    const iv = hexToBytes(parts[1]);
    const cipherBytes = hexToBytes(parts[2]);

    const key = await deriveKey(passphrase.trim());
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherBytes
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return '🔒 [Decryption Failed — Incorrect Passphrase]';
  }
}

// --- 2. ECDH P-256 Perfect Forward Secrecy ---
async function generateEcdhKeyPair() {
  return await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

async function exportRawPublicKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToHex(new Uint8Array(raw));
}

async function importEcdhPublicKey(hex) {
  return await crypto.subtle.importKey(
    'raw',
    hexToBytes(hex),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

async function encryptEcdh(text, peerPublicKeyHex) {
  const peerKey = await importEcdhPublicKey(peerPublicKeyHex);
  const ephemeralPair = await generateEcdhKeyPair();

  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerKey },
    ephemeralPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoded
  );

  const ephemPubHex = await exportRawPublicKey(ephemeralPair.publicKey);
  return `ecdh:${ephemPubHex}:${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

async function decryptEcdh(cipherStr, myPrivateKey) {
  if (!cipherStr || !cipherStr.startsWith('ecdh:')) return cipherStr;
  try {
    const parts = cipherStr.split(':');
    if (parts.length !== 4) return cipherStr;
    const ephemPubHex = parts[1];
    const iv = hexToBytes(parts[2]);
    const cipherBytes = hexToBytes(parts[3]);

    const ephemPubKey = await importEcdhPublicKey(ephemPubHex);
    const sharedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: ephemPubKey },
      myPrivateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      cipherBytes
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return '🔒 [ECDH Decryption Failed]';
  }
}

// --- 3. ECDSA P-256 Signatures & Anti-Spoofing ---
async function generateIdentityKeyPair() {
  return await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
}

async function signPacketData(canonicalString, privateKey) {
  const data = new TextEncoder().encode(canonicalString);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    data
  );
  return bytesToHex(new Uint8Array(signature));
}

async function verifyPacketSignature(canonicalString, signatureHex, publicKeyHex) {
  try {
    const pubKey = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKeyHex),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const sig = hexToBytes(signatureHex);
    const data = new TextEncoder().encode(canonicalString);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      sig,
      data
    );
  } catch {
    return false;
  }
}

async function deriveFingerprint(publicKeyHex) {
  const hash = await sha256Hex(publicKeyHex);
  return `node_${hash.substring(0, 10)}`;
}

// --- 4. Metadata Blinding ---
async function blindRecipientId(recipientId, epochHours = 24) {
  if (recipientId === '*') return '*';
  const epoch = Math.floor(Date.now() / (epochHours * 3600 * 1000));
  const raw = `${recipientId}:epoch_${epoch}:wayline_anonymity`;
  const hash = await sha256Hex(raw);
  return `mask:${hash.substring(0, 16)}`;
}

async function matchesBlindedRecipient(blindedId, myNodeId, epochHours = 24) {
  if (blindedId === '*' || blindedId === myNodeId) return true;
  if (!blindedId.startsWith('mask:')) return blindedId === myNodeId;
  const currentEpoch = Math.floor(Date.now() / (epochHours * 3600 * 1000));
  for (const ep of [currentEpoch, currentEpoch - 1]) {
    const raw = `${myNodeId}:epoch_${ep}:wayline_anonymity`;
    const hash = await sha256Hex(raw);
    if (`mask:${hash.substring(0, 16)}` === blindedId) return true;
  }
  return false;
}

async function runTests() {
  console.log('[TEST] Starting Native Web Crypto Security Self-Checks...');

  // =========================================================================
  // TEST SUITE 1: Symmetric AES-GCM 256-bit
  // =========================================================================
  console.log('--- 1. Testing AES-GCM 256-bit Encryption ---');
  const secretMessage = 'Sector 4 bridge clear. Team moving south.';
  const password = 'DisasterRescuePass2026!';

  const cipher1 = await encryptAes(secretMessage, password);
  const cipher2 = await encryptAes(secretMessage, password);

  assert(cipher1.startsWith('aes:'), 'Ciphertext must start with aes: prefix');
  assert.notStrictEqual(cipher1, cipher2, 'Subsequent encryptions of same text must have unique IVs');

  const decrypted = await decryptAes(cipher1, password);
  assert.strictEqual(decrypted, secretMessage, 'Decrypted text must match original');

  const failed = await decryptAes(cipher1, 'WrongPassword');
  assert.strictEqual(failed, '🔒 [Decryption Failed — Incorrect Passphrase]');

  const locked = await decryptAes(cipher1, '');
  assert.strictEqual(locked, '🔒 [Encrypted Message — Enter Passphrase to Decrypt]');

  const plain = await decryptAes('Plain message', password);
  assert.strictEqual(plain, 'Plain message');
  console.log('  ✓ AES-GCM 256-bit encryption, random IV, and wrong key rejection verified');

  // =========================================================================
  // TEST SUITE 2: ECDH P-256 Perfect Forward Secrecy (PFS)
  // =========================================================================
  console.log('--- 2. Testing ECDH P-256 Pairwise Ephemeral Forward Secrecy ---');
  const aliceEcdh = await generateEcdhKeyPair();
  const bobEcdh = await generateEcdhKeyPair();
  const bobPubHex = await exportRawPublicKey(bobEcdh.publicKey);

  const pfsMessage = 'Confidential: Survivor count is 14 at primary shelter.';
  const ecdhCipher1 = await encryptEcdh(pfsMessage, bobPubHex);
  const ecdhCipher2 = await encryptEcdh(pfsMessage, bobPubHex);

  assert(ecdhCipher1.startsWith('ecdh:'), 'PFS ciphertext must start with ecdh: prefix');
  assert.notStrictEqual(ecdhCipher1, ecdhCipher2, 'Each PFS encryption must generate a unique ephemeral key & IV');

  // Bob decrypts with Bob's private key
  const bobDecrypted = await decryptEcdh(ecdhCipher1, bobEcdh.privateKey);
  assert.strictEqual(bobDecrypted, pfsMessage, 'Bob must successfully decrypt Alice’s PFS message');

  // Alice cannot decrypt with her own static private key (only Bob and the ephemeral key can)
  const aliceFail = await decryptEcdh(ecdhCipher1, aliceEcdh.privateKey);
  assert.strictEqual(aliceFail, '🔒 [ECDH Decryption Failed]', 'Wrong private key must be rejected');

  console.log('  ✓ ECDH P-256 pairwise ephemeral key exchange & PFS forward secrecy verified');

  // =========================================================================
  // TEST SUITE 3: ECDSA P-256 Cryptographic Identity & Anti-Spoofing
  // =========================================================================
  console.log('--- 3. Testing ECDSA P-256 Cryptographic Identity & Anti-Spoofing ---');
  const identityA = await generateIdentityKeyPair();
  const identityB = await generateIdentityKeyPair();
  const pubHexA = await exportRawPublicKey(identityA.publicKey);
  const pubHexB = await exportRawPublicKey(identityB.publicKey);

  const fpA = await deriveFingerprint(pubHexA);
  assert(fpA.startsWith('node_'), 'Fingerprint must format as node_<hash>');

  const canonicalPacket = '1:msg_123:node_alice:*:CHAT:1700000000:{"content":"Test"}';
  const sigA = await signPacketData(canonicalPacket, identityA.privateKey);

  // Valid signature matches public key
  const isValid = await verifyPacketSignature(canonicalPacket, sigA, pubHexA);
  assert.strictEqual(isValid, true, 'Valid ECDSA signature must verify true');

  // Tampered payload rejected
  const tamperedPacket = '1:msg_123:node_alice:*:CHAT:1700000000:{"content":"Tampered"}';
  const isTamperValid = await verifyPacketSignature(tamperedPacket, sigA, pubHexA);
  assert.strictEqual(isTamperValid, false, 'Tampered packet content must fail signature verification');

  // Impersonator key fails verification against claimed identity
  const isSpoofedValid = await verifyPacketSignature(canonicalPacket, sigA, pubHexB);
  assert.strictEqual(isSpoofedValid, false, 'Signature from node A verified against node B public key must fail');

  console.log('  ✓ ECDSA P-256 identity signing, anti-tamper, and anti-spoofing verified');

  // =========================================================================
  // TEST SUITE 4: Metadata Blinding (Hop-by-Hop Eavesdropping Protection)
  // =========================================================================
  console.log('--- 4. Testing Hop-by-Hop Metadata Blinding ---');
  const recipientNodeId = 'node_target_responder_99';
  const bystanderNodeId = 'node_eavesdropper_12';

  const maskedId = await blindRecipientId(recipientNodeId);
  assert(maskedId.startsWith('mask:'), 'Masked recipient ID must start with mask:');
  assert.notStrictEqual(maskedId, recipientNodeId, 'Recipient ID must not appear in plaintext on the wire');

  // Matching tests
  const targetMatches = await matchesBlindedRecipient(maskedId, recipientNodeId);
  assert.strictEqual(targetMatches, true, 'Target recipient must match blinded mask');

  const bystanderMatches = await matchesBlindedRecipient(maskedId, bystanderNodeId);
  assert.strictEqual(bystanderMatches, false, 'Eavesdropping intermediate hop must NOT match blinded mask');

  const broadcastMatches = await matchesBlindedRecipient('*', bystanderNodeId);
  assert.strictEqual(broadcastMatches, true, 'Broadcast (*) must match all nodes');

  console.log('  ✓ Metadata blinding & blinded recipient matching verified');

  console.log('\n[TEST] All Web Crypto security tests (AES-GCM, ECDH PFS, ECDSA Signatures, Blinding) PASSED!\n');
}

runTests().catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
