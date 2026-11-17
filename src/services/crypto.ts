// WAYLINE Native Web Crypto Layer (AES-GCM-256, ECDH PFS, ECDSA Signatures)
// Zero external npm dependencies: runs natively in modern browsers and Node.js (via crypto.subtle)

const PBKDF2_SALT = new TextEncoder().encode('wayline_mesh_salt_v1');

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/, '');
  const matches = clean.match(/.{1,2}/g);
  if (!matches) return new Uint8Array(0);
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes as any);
  return bytesToHex(new Uint8Array(hash));
}

// ============================================================================
// 1. Symmetric AES-GCM 256-bit Encryption (Shared Channel Passphrase)
// ============================================================================

async function deriveKey(passphrase: string): Promise<CryptoKey> {
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

export async function encryptAes(text: string, passphrase: string): Promise<string> {
  if (!passphrase || !passphrase.trim()) return text;
  const key = await deriveKey(passphrase.trim());
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit standard IV
  const encoded = new TextEncoder().encode(text);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return `aes:${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

export async function decryptAes(cipherStr: string, passphrase?: string): Promise<string> {
  if (!cipherStr || !cipherStr.startsWith('aes:')) return cipherStr;
  if (!passphrase || !passphrase.trim()) {
    return '🔒 [Encrypted Message — Enter Passphrase to Decrypt]';
  }

  try {
    const parts = cipherStr.split(':');
    if (parts.length !== 3) return cipherStr;
    const iv = hexToBytes(parts[1]);
    const cipherBytes = hexToBytes(parts[2]);

    const key = await deriveKey(passphrase.trim());
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as any },
      key,
      cipherBytes as any
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return '🔒 [Decryption Failed — Incorrect Passphrase]';
  }
}

// ============================================================================
// 2. ECDH Pairwise Forward Secrecy (PFS - Elliptic Curve Diffie-Hellman P-256)
// ============================================================================

export async function generateEcdhKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

export async function exportRawPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToHex(new Uint8Array(raw));
}

export async function importEcdhPublicKey(hex: string): Promise<CryptoKey> {
  const bytes = hexToBytes(hex);
  return await crypto.subtle.importKey(
    'raw',
    bytes as any,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

export async function exportEcdhKeys(keyPair: CryptoKeyPair): Promise<{ publicKeyHex: string; privateKeyJwk: string }> {
  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return {
    publicKeyHex: bytesToHex(new Uint8Array(pubRaw)),
    privateKeyJwk: JSON.stringify(privJwk)
  };
}

export async function importEcdhKeys(publicKeyHex: string, privateKeyJwk: string): Promise<CryptoKeyPair> {
  const pubKey = await importEcdhPublicKey(publicKeyHex);
  const privKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(privateKeyJwk),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  return { publicKey: pubKey, privateKey: privKey };
}

export async function deriveEcdhSharedKey(myPrivateKey: CryptoKey, peerPublicKey: CryptoKey): Promise<CryptoKey> {
  return await crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a pairwise message with Perfect Forward Secrecy.
 * Generates an ephemeral keypair per message, derives a pairwise AES-GCM key,
 * and packages the ephemeral public key alongside the ciphertext:
 * Format: `ecdh:<ephemeralPubHex>:<ivHex>:<cipherHex>`
 */
export async function encryptEcdh(text: string, peerPublicKeyHex: string): Promise<string> {
  if (!peerPublicKeyHex) return text;
  const peerKey = await importEcdhPublicKey(peerPublicKeyHex);
  const ephemeralPair = await generateEcdhKeyPair();

  const sharedKey = await deriveEcdhSharedKey(ephemeralPair.privateKey, peerKey);
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

/**
 * Decrypts a pairwise message encrypted via ECDH PFS
 */
export async function decryptEcdh(cipherStr: string, myPrivateKey: CryptoKey): Promise<string> {
  if (!cipherStr || !cipherStr.startsWith('ecdh:')) return cipherStr;

  try {
    const parts = cipherStr.split(':');
    if (parts.length !== 4) return cipherStr;
    const ephemPubHex = parts[1];
    const iv = hexToBytes(parts[2]);
    const cipherBytes = hexToBytes(parts[3]);

    const ephemPubKey = await importEcdhPublicKey(ephemPubHex);
    const sharedKey = await deriveEcdhSharedKey(myPrivateKey, ephemPubKey);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as any },
      sharedKey,
      cipherBytes as any
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return '🔒 [ECDH Decryption Failed — Invalid Key or Corrupted Data]';
  }
}

// ============================================================================
// 3. ECDSA Cryptographic Node Identity & Packet Signing (P-256)
// ============================================================================

export async function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
}

export async function exportIdentityKeys(keyPair: CryptoKeyPair): Promise<{ publicKeyHex: string; privateKeyJwk: string }> {
  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return {
    publicKeyHex: bytesToHex(new Uint8Array(pubRaw)),
    privateKeyJwk: JSON.stringify(privJwk)
  };
}

export async function importIdentityKeys(publicKeyHex: string, privateKeyJwk: string): Promise<CryptoKeyPair> {
  const pubKey = await crypto.subtle.importKey(
    'raw',
    hexToBytes(publicKeyHex) as any,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );

  const privKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(privateKeyJwk),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );

  return { publicKey: pubKey, privateKey: privKey };
}

export async function signPacketData(canonicalString: string, privateKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(canonicalString);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    data as any
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function verifyPacketSignature(canonicalString: string, signatureHex: string, publicKeyHex: string): Promise<boolean> {
  try {
    const pubKey = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKeyHex) as any,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const sig = hexToBytes(signatureHex);
    const data = new TextEncoder().encode(canonicalString);

    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      sig as any,
      data as any
    );
  } catch {
    return false;
  }
}

export async function deriveFingerprint(publicKeyHex: string): Promise<string> {
  const hash = await sha256Hex(publicKeyHex);
  return `node_${hash.substring(0, 10)}`;
}

// ============================================================================
// 4. Metadata Blinding (Hop-by-Hop Eavesdropping Prevention)
// ============================================================================

export async function blindRecipientId(recipientId: string, epochHours: number = 24): Promise<string> {
  if (recipientId === '*') return '*';
  const epoch = Math.floor(Date.now() / (epochHours * 3600 * 1000));
  const raw = `${recipientId}:epoch_${epoch}:wayline_anonymity`;
  const hash = await sha256Hex(raw);
  return `mask:${hash.substring(0, 16)}`;
}

export async function matchesBlindedRecipient(blindedId: string, myNodeId: string, epochHours: number = 24): Promise<boolean> {
  if (blindedId === '*' || blindedId === myNodeId) return true;
  if (!blindedId.startsWith('mask:')) return blindedId === myNodeId;

  // Check current and previous epoch window to handle boundary clock differences
  const currentEpoch = Math.floor(Date.now() / (epochHours * 3600 * 1000));
  for (const ep of [currentEpoch, currentEpoch - 1]) {
    const raw = `${myNodeId}:epoch_${ep}:wayline_anonymity`;
    const hash = await sha256Hex(raw);
    if (`mask:${hash.substring(0, 16)}` === blindedId) return true;
  }
  return false;
}

// ============================================================================
// 5. Unified Message Decryptor
// ============================================================================

export async function decryptMessage(
  cipherStr: string,
  passphrase?: string,
  myEcdhPrivateKey?: CryptoKey
): Promise<string> {
  if (!cipherStr) return cipherStr;
  if (cipherStr.startsWith('ecdh:') && myEcdhPrivateKey) {
    return await decryptEcdh(cipherStr, myEcdhPrivateKey);
  }
  if (cipherStr.startsWith('aes:')) {
    return await decryptAes(cipherStr, passphrase);
  }
  return cipherStr;
}
