# WAYLINE Browser-Only Offline Architecture

## 1. Overview & Core Philosophy

WAYLINE is a zero-install, browser-based emergency communication system designed to operate in disaster zones where cellular networks, centralized internet backbones, and cloud services are impaired or unavailable.

The core constraint of WAYLINE is **strict zero-install**:
- Runs in standard mobile (Android Chrome, iOS Safari) and desktop browsers as a Progressive Web Application (PWA).
- No APK installation, Kotlin/Java native apps, background daemons, or custom Chromium forks required on client phones.
- All critical application code, assets, icons, and shell logic are cached locally via Service Worker (`public/sw.js`) and IndexedDB.

---

## 2. Capabilities Matrix

| Communication Mode | Connectivity Required | Range / Topology | Zero-Install Browser Support | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **PWA Offline Startup** | None (after initial cache) | Local device | Full (Cache API + Service Worker) | Opens instantly without cell service. |
| **IndexedDB Offline Storage** | None | Local device | Full (IndexedDB `idb`) | Stores messages, incidents, outbox queue, deduplication table. |
| **Stationary Anchor (Local Wi-Fi / Hotspot)** | Phone hotspot or portable Wi-Fi router (no internet) | Entire Wi-Fi subnet coverage | Full (WebSocket) | Optional Node.js anchor or portable battery-powered hotspot router. |
| **WebRTC Direct Data Channels** | Same LAN or direct signaling exchange (QR/manual) | Direct browser-to-browser | Full (`RTCDataChannel`) | Low-latency binary/text datachannels. |
| **Store-and-Forward Mesh (Phone A → B → C)** | Step-by-step local connectivity | Multi-hop mesh (bounded TTL) | Full | Intermediate nodes relay messages without accessing plaintext if encrypted. |
| **Acoustic Modem (Ultrasound / Audio FSK)** | None (Air-gapped) | Line-of-sight audio (< 5 meters) | Full (Web Audio API + AudioWorklet) | Zero RF dependencies, ultrasonic/audible carrier frequency. |
| **End-to-End Chat Encryption (AES-GCM)** | None | Any transport | Full (Web Crypto API `crypto.subtle`) | 256-bit AES-GCM + PBKDF2 (100,000 iterations), zero third-party dependencies. |

---

## 3. What the Browser Platform CANNOT Do (Honest Technical Boundaries)

In accordance with strict web security standards, browsers enforce the following boundaries:
1. **No Ad-Hoc Wi-Fi Direct or Raw Wi-Fi Management**: Browsers cannot programmatically toggle Wi-Fi Direct or force connection to an SSID. Users connect to an open local emergency hotspot manually in Android/iOS Wi-Fi settings.
2. **No Raw Bluetooth Classic / BLE Advertising**: Web Bluetooth allows connecting to existing BLE peripherals (GATT client), but standard browsers cannot advertise as BLE peripherals to form pure BLE browser-to-browser ad-hoc networks without an external peripheral.
3. **No Background Execution While Device is Suspended**: When a phone screen locks or Chrome enters deep sleep, browser CPU cycles and timers are throttled or suspended. Reliable store-and-forward relaying happens reactively while active or open in the foreground.
4. **No Raw UDP Sockets**: Direct UDP broadcasting (mDNS / SSDP) is restricted to native platforms. The optional stationary anchor (`server/wayline-node.js`) bridges UDP discovery onto the local subnet.

---

## 4. Multi-Hop Store-and-Forward Mesh

```
+---------------+         WebRTC / Wi-Fi         +---------------+         WebRTC / Wi-Fi         +---------------+
|    Node A     | -----------------------------> |    Node B     | -----------------------------> |    Node C     |
| (Originator)  |                                |    (Relay)    |                                | (Destination) |
+---------------+                                +---------------+                                +---------------+
       |                                                 |                                                |
Outbox Enqueued                                  Durable Dedupe Check                             Message Received
Dispatched via active transport                 Packet Stored & Relayed                           UI Bubble Displayed
```

### Transport-Independent Messaging Pipeline
- **Unified Wire Format**: Every message is serialized into an envelope containing `id`, `type`, `senderId`, `senderName`, `recipientId`, `content`, `timestamp`, `ttl`, and `hopCount`.
- **Durable Deduplication**: A persistent IndexedDB deduplication table ensures that even across browser reloads or simultaneous delivery over multiple transports (WebSocket, WebRTC, Acoustic), duplicates are rejected atomically.
- **TTL & Loop Prevention**: Default TTL of 3 hops; every hop increments `hopCount`. If `hopCount >= ttl` or the packet was already processed, it is dropped from further forwarding.
- **Reconnection Outbox Flush**: Whenever any transport (WebSocket, WebRTC) reconnects, the unified scheduler inspects the outbox and flushes pending packets automatically.

---

## 5. Security & Cryptography Architecture

- **Native Web Crypto**: Uses hardware-accelerated `crypto.subtle` available in all modern browsers.
- **AES-GCM-256**: Authenticated encryption ensuring confidentiality and tamper resistance.
- **PBKDF2 Key Derivation**: SHA-256 with 100,000 iterations to derive a 256-bit key from human-memorable shared disaster passphrases.
- **Payload Format**: `aes:<12-byte-iv-hex>:<ciphertext-and-tag-hex>`.
- **Transparent Relaying**: Intermediate nodes in the chain mesh can forward encrypted packets without knowledge of the passphrase.

---

## 6. Verification Test Suites

Automated verification tests located in `tests/`:
- `tests/protocol.test.js`: Packet serialization, validation, and TTL enforcement.
- `tests/hardening.test.js`: CRC-16 checks, JSON boundary attacks, malformed payloads, and rate limits.
- `tests/crypto.test.js`: AES-256 GCM encryption/decryption roundtrip, incorrect passphrase rejection, and authentication tag tamper resistance.
- `tests/chain-relay.test.js`: Multi-hop Phone A → Phone B → Phone C store-and-forward relay across simulated transport connections.
