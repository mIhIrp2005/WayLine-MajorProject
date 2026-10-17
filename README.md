# ⚡ WAYLINE
### *Zero-Install Offline-First Emergency Mesh & Acoustic Communication PWA*

[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![PWA Ready](https://img.shields.io/badge/PWA-Precached_&_Offline-FF5722?style=flat-square)](public/manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

```
                       _     _            
__      ____ _ _   _ | |   (_)_ __   ___ 
\ \ /\ / / _` | | | || |   | | '_ \ / _ \
 \ V  V / (_| | |_| || |___| | | | |  __/
  \_/\_/ \__,_|\__, ||_____|_|_| |_|\___|
               |___/                     
      OFFLINE EMERGENCY DISPATCH MESH
```

> **WAYLINE** is a resilient emergency communication Progressive Web App engineered to operate when central infrastructure fails—**no internet, no mobile towers, no cloud servers, and no app store installation required.**
>
> Built with a tactile **Bento Crayon** visual identity, local Wi-Fi/hotspot UDP discovery, IndexedDB storage, and an isolated **2-FSK browser acoustic sound transceiver**.

---

## 🌟 Key Capabilities

- 📱 **Zero Native Installation**: Runs entirely inside ordinary mobile browsers (optimized for Android Chrome) as an installable PWA.
- 💾 **100% Offline Reopening**: Service Worker precaches the application shell; all messages, distress records, and peer profiles persist in IndexedDB (`wayline_offline_db`).
- 📡 **Local UDP & WebSocket Mesh**: Companion Node daemon provides zero-config broadcast discovery (`UDP:8766`) and real-time P2P message relay (`WS:8765`) over local Wi-Fi or portable hotspots.
- 🔊 **Isolated Acoustic Lab (Experimental)**: Audible **2-FSK sound transceiver** over device speakers and microphones (2000 Hz Mark / 1500 Hz Space, CRC-16 CCITT framing, stop-and-wait ACKs) for air-gapped data transfers.
- 🎯 **Truthful Delivery Statuses**: No fake peers or simulated confirmations. Transparent message lifecycle: `SAVED_LOCALLY` → `TRANSMITTED` → `ACKNOWLEDGED`.
- 🚨 **Field Triage & SOS Dispatch**: One-tap distress beaconing with category tagging (Medical, Trapped, Flood, Rescue), incident resolution workflows, and optional GPS coordinates.

---

## 🏗️ Architecture Overview

```
                      +---------------------------------------+
                      |       WAYLINE Browser PWA Client      |
                      |   (React 19 + TypeScript + Bento UI)  |
                      +---------------------------------------+
                                  |                 |
                   (Local Subnet) |                 | (Acoustic Air-Gap)
                                  v                 v
                 +----------------------+    +----------------------+
                 | Local Node Daemon    |    | Acoustic Lab Modem   |
                 | - HTTP Server (8765) |    | - 2-FSK Web Audio    |
                 | - UDP Beacon (8766)  |    | - Mic Demodulator    |
                 | - WebSocket Mesh     |    | - Isolated Lab DB    |
                 +----------------------+    +----------------------+
                            |
                 (Subnet Broadcast Relay)
                            v
                 +----------------------+
                 | Discovered Peer UIs  |
                 +----------------------+
```

### Stable Dual-Link Architecture
| Link Type | Role | Target |
| :--- | :--- | :--- |
| **Canonical PWA URL** | Precache & bookmark the app before disaster blackout | `VITE_PUBLIC_APP_URL` / HTTPS Origin |
| **Local Node Address** | Direct peer mesh pairing on shared Wi-Fi/hotspot | Dynamic IP:Port (e.g. `http://192.168.1.X:8765`) |

---

## 🚀 Quick Start

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/your-username/wayline.git
cd wayline
npm install
```

### 2. Development Server (Vite)
Runs the interactive frontend with Hot Module Replacement:
```bash
npm run dev
```

### 3. Production Node Daemon & PWA
Builds the production bundle and launches the local mesh node:
```bash
# 1. Compile TypeScript & bundle assets
npm run build

# 2. Start the local emergency discovery daemon
npm start
```
The node will output active interfaces and quick links:
```text
[WAYLINE] Emergency node active on http://0.0.0.0:8765
[WAYLINE] Simple Link (Zero-Config):  http://wayline.local:8765
[WAYLINE] Direct IP Fallback:         http://192.168.1.140:8765
```

---

## 🧪 Testing & Verification

WAYLINE comes with automated unit and integration tests verifying protocol boundaries, network isolation, and modem framing:

```bash
# Protocol & Hop-count verification (TTL, duplicate suppression, checksums)
node tests/protocol.test.js

# Multi-client peer discovery & relay test
node tests/multi-client.test.js

# Access link resolution & network adapter ranking test
node tests/access-link.test.js

# Acoustic modem framing, CRC-16 & ACK verification
node tests/acoustic-modem.test.js
```

---

## 🔬 Acoustic Lab — Experimental Facility

Located under **Acoustic Lab** in the navigation sidebar, this sandboxed test lab allows testing speaker-to-microphone data transfers without radio networks:

- **Modulation**: Audible 2-FSK (2000 Hz Mark / 1500 Hz Space, 2300 Hz Start Delimiter).
- **Framing**: Binary header + session ID + sequence numbering + CRC-16 CCITT.
- **Round-Trip Test**: Automated transmission &rarr; receiver decoding &rarr; acoustic ACK return &rarr; latency measurement.
- **Strict Isolation**: Writes solely to `wayline_acoustic_lab_db`. Never alters production chat or emergency incident records.

> [!NOTE]
> **Android Chrome Permission Rule:** Mobile browsers require a **Secure Context** (`https://` or `localhost`) for microphone access (`getUserMedia`). For local testing over `http://<IP>:8765`, enable Chrome's bypass flag: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.

---

## 🎨 Visual Identity

WAYLINE uses the custom **Bento Crayon** design language:
- **Palette**: Tactile cream paper (`#F7F3E8`), emergency coral (`#EA644B`), safety green (`#73966A`), and carbon ink (`#292D29`).
- **Typography**: Clean humanist grotesk for UI reading paired with JetBrains Mono for packet hashes, coordinates, and diagnostic telemetry.
- **Feedback**: Hard tactile drop-shadows with honest state pills (`SAVED_LOCALLY`, `TRANSMITTED`, `ACKNOWLEDGED`).

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.
