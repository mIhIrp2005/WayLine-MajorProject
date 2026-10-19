// Standard Web Crypto AES-GCM 256-bit chat encryption utility
// Zero extra npm dependencies: runs natively in all modern browsers and Node.js

const PBKDF2_SALT = new TextEncoder().encode('wayline_mesh_salt_v1');

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

// Encrypt plain text using AES-GCM (returns `aes:<iv_hex>:<ciphertext_hex>`)
export async function encryptAes(text: string, passphrase: string): Promise<string> {
  if (!passphrase || !passphrase.trim()) return text;
  const key = await deriveKey(passphrase.trim());
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV standard for GCM
  const encoded = new TextEncoder().encode(text);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  const cipherHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `aes:${ivHex}:${cipherHex}`;
}

// Decrypt text if encrypted with AES-GCM
export async function decryptAes(cipherStr: string, passphrase?: string): Promise<string> {
  if (!cipherStr || !cipherStr.startsWith('aes:')) {
    return cipherStr; // Not encrypted
  }

  if (!passphrase || !passphrase.trim()) {
    return '🔒 [Encrypted Message — Enter Passphrase to Decrypt]';
  }

  try {
    const parts = cipherStr.split(':');
    if (parts.length !== 3) return cipherStr;
    const ivHex = parts[1];
    const cipherHex = parts[2];

    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const cipherBytes = new Uint8Array(cipherHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

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
