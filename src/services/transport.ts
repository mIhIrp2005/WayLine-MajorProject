import { WaylinePacket, DiscoveredPeer, TransportState, LocalIdentity, StoredMessage, EmergencyIncident } from '../types';
import { storage } from './storage';
import { protocol } from './protocol';
import { WebRTCTransportManager } from './transports/webrtcTransport';

type Listener = () => void;

class WaylineTransportService {
  private socket: WebSocket | null = null;
  private listeners: Set<Listener> = new Set();
  private reconnectTimer: any = null;
  private identity: LocalIdentity | null = null;
  public webrtc: WebRTCTransportManager;

  public state: TransportState = {
    isCompanionConnected: false,
    activeTransport: 'Initializing...',
    listeningAddress: 'Awaiting local node...',
    peerCount: 0,
    isScanning: false,
    packetsSent: 0,
    packetsReceived: 0,
    lastError: null,
    availableInterfaces: [],
    customHost: typeof localStorage !== 'undefined' ? localStorage.getItem('wayline_host_override') || '' : ''
  };

  public peers: DiscoveredPeer[] = [];

  constructor() {
    this.webrtc = new WebRTCTransportManager(
      (packet) => this.processReceivedPacket(packet),
      () => this.updatePeersFromTransports()
    );
    this.init();
  }

  private async init() {
    this.identity = await storage.getOrCreateIdentity();
    this.webrtc.setIdentity(this.identity.nodeId, this.identity.nodeName);
    this.connectCompanion();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(cb => cb());
  }

  // Retrieve current target host (custom override, browser host, or loopback)
  public getTargetHost(): string {
    const override = typeof localStorage !== 'undefined' ? localStorage.getItem('wayline_host_override') : null;
    if (override && override.trim()) return override.trim();
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    return host || 'localhost';
  }

  // Set or clear custom host target (allows switching host without rebuilding)
  public setHostOverride(host: string | null) {
    if (typeof localStorage !== 'undefined') {
      if (host && host.trim()) {
        const clean = host.trim().replace(/^https?:\/\//i, '').replace(/:\d+$/, '');
        localStorage.setItem('wayline_host_override', clean);
        this.state.customHost = clean;
      } else {
        localStorage.removeItem('wayline_host_override');
        this.state.customHost = '';
      }
    }
    this.notify();
    this.connectCompanion();
  }

  // Dynamic subnet and gateway auto-discovery (finds host even when host isn't giving the hotspot)
  public async autoDiscoverHost(): Promise<string | null> {
    this.state.isScanning = true;
    this.state.lastError = 'Scanning network for active WAYLINE host...';
    this.notify();

    const probe = async (hostIp: string): Promise<string | null> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 600);
        const res = await fetch(`http://${hostIp}:8765/api/status`, {
          signal: controller.signal,
          mode: 'cors'
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          if (data && data.nodeId) return hostIp;
        }
      } catch {}
      return null;
    };

    // 1. Common hotspot gateways & mDNS
    const candidates = [
      '192.168.43.1',   // Android Hotspot gateway
      '192.168.137.1',  // Windows Hotspot gateway
      '192.168.1.1',    // Router default 1
      '192.168.0.1',    // Router default 2
      '10.0.0.1',       // Alternate router gateway
      'wayline.local'   // mDNS query
    ];

    if (typeof window !== 'undefined' && window.location?.hostname && !candidates.includes(window.location.hostname)) {
      candidates.unshift(window.location.hostname);
    }

    const gatewayChecks = await Promise.all(candidates.map(c => probe(c)));
    const foundGateway = gatewayChecks.find(Boolean);
    if (foundGateway) {
      console.log(`[Transport] Discovered active host at ${foundGateway}`);
      this.setHostOverride(foundGateway);
      this.state.isScanning = false;
      this.state.lastError = null;
      this.notify();
      return foundGateway;
    }

    // 2. Subnet sweep for when host is NOT the hotspot gateway (e.g. laptop connected to phone hotspot)
    const baseSubnets = ['192.168.43', '192.168.137', '192.168.0', '192.168.1'];
    const currentHost = this.state.customHost || (typeof window !== 'undefined' ? window.location.hostname : '');
    const match = currentHost.match(/^(\d+\.\d+\.\d+)\./);
    if (match && !baseSubnets.includes(match[1])) {
      baseSubnets.unshift(match[1]);
    }

    for (const subnet of baseSubnets.slice(0, 2)) {
      const targets: string[] = [];
      for (let i = 2; i <= 35; i++) targets.push(`${subnet}.${i}`);
      for (let i = 100; i <= 115; i++) targets.push(`${subnet}.${i}`);

      const batchSize = 10;
      for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(ip => probe(ip)));
        const matchIp = results.find(Boolean);
        if (matchIp) {
          console.log(`[Transport] Subnet sweep found host at ${matchIp}`);
          this.setHostOverride(matchIp);
          this.state.isScanning = false;
          this.state.lastError = null;
          this.notify();
          return matchIp;
        }
      }
    }

    this.state.isScanning = false;
    this.state.lastError = 'No host found on local network. Enter IP manually or scan QR.';
    this.notify();
    return null;
  }

  // Attempt connection to the local Node companion
  private connectCompanion() {
    if (this.socket) {
      try { this.socket.close(); } catch (e) {}
    }

    const host = this.getTargetHost();
    const port = (typeof window !== 'undefined' && window.location.port && window.location.port !== '5173') 
      ? window.location.port 
      : '8765';
    const nodeId = this.identity?.nodeId || '';
    const nodeName = this.identity?.nodeName || '';
    const wsUrl = `ws://${host}:${port}/client?type=client&nodeId=${encodeURIComponent(nodeId)}&nodeName=${encodeURIComponent(nodeName)}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.state.isCompanionConnected = true;
        this.state.activeTransport = 'UDP Local Wi-Fi Mesh Adapter';
        this.state.isScanning = true;
        this.state.lastError = null;
        console.log(`[Transport] Connected to WAYLINE companion at ${host}:${port}`);
        
        if (this.identity) {
          this.socket?.send(JSON.stringify({
            type: 'CLIENT_REGISTER',
            nodeId: this.identity.nodeId,
            nodeName: this.identity.nodeName
          }));
        }

        // Automatically flush pending outbox messages over newly available transport
        this.flushOutboxQueue();

        this.notify();
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleCompanionMessage(data);
        } catch (err: any) {
          console.error('[Transport] JSON error:', err.message);
        }
      };

      this.socket.onclose = () => {
        this.state.isCompanionConnected = false;
        this.state.activeTransport = 'Offline Local Storage Mode';
        this.state.listeningAddress = 'Local node unreachable';
        this.state.isScanning = false;
        this.state.peerCount = 0;
        this.peers = [];
        this.notify();

        // Retry connection every 4 seconds
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connectCompanion(), 4000);
      };

      this.socket.onerror = () => {
        this.state.isCompanionConnected = false;
        this.state.activeTransport = 'Offline Local Storage Mode';
        this.state.listeningAddress = 'Local node unreachable';
        this.state.lastError = `Host ${host}:${port} unreachable`;
        this.notify();
      };
    } catch (e: any) {
      this.state.isCompanionConnected = false;
      this.state.activeTransport = 'Offline Local Storage Mode';
      this.state.lastError = e.message;
      this.notify();
    }
  }

  // Process inbound companion messages
  private async handleCompanionMessage(data: any) {
    if (data.type === 'NODE_STATUS') {
      this.state.listeningAddress = data.listeningAddress;
      this.state.availableInterfaces = data.interfaces || [];
      this.peers = data.peers || [];
      this.state.peerCount = this.peers.filter(p => p.status === 'CONNECTED').length;
      this.notify();
    } else if (data.type === 'PEERS_UPDATED') {
      this.peers = data.peers || [];
      this.updatePeersFromTransports();
      // Persist peers to IndexedDB
      for (const peer of this.peers) {
        await storage.savePeer(peer);
      }
      this.notify();
    } else if (data.type === 'SIGNALING') {
      // Inbound WebRTC handshake from peer via host relay
      const { senderId, senderName, signal } = data;
      this.webrtc.handleSignal(senderId, senderName, signal, (outgoingSignal) => {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
            type: 'SIGNALING',
            targetPeerId: senderId,
            signal: outgoingSignal
          }));
        }
      });
    } else if (data.type === 'PACKET_RECEIVED') {
      await this.processReceivedPacket(data.packet);
    } else if (data.type === 'SEND_RESULT') {
      const { packetId, transmittedCount } = data;
      const status: StoredMessage['status'] = transmittedCount > 0 ? 'TRANSMITTED' : 'SAVED_LOCALLY';
      await storage.updateMessageStatus(packetId, status);
      this.notify();
    }
  }

  // Merge direct WebRTC peers with daemon LAN peers
  public updatePeersFromTransports() {
    const directPeers = this.webrtc.getConnectedPeers();
    const existingIds = new Set(this.peers.map(p => p.id));
    
    for (const dp of directPeers) {
      if (!existingIds.has(dp.id)) {
        this.peers.push(dp);
      }
    }
    this.state.peerCount = this.peers.filter(p => p.status === 'CONNECTED').length;
    this.notify();
  }

  // Handle packet received from any transport (WebSocket, WebRTC, Acoustic)
  public async processReceivedPacket(packet: WaylinePacket): Promise<boolean> {
    if (!protocol.validatePacket(packet)) return false;
    if (this.identity && packet.senderId === this.identity.nodeId) return false; // Ignore own echoes
    if (protocol.isDuplicate(packet.id)) return false; // Deduplication drop

    protocol.markSeen(packet.id);
    this.state.packetsReceived++;

    if (packet.type === 'CHAT') {
      const stored: StoredMessage = {
        id: packet.id,
        senderId: packet.senderId,
        senderName: packet.senderName,
        recipientId: packet.recipientId,
        type: 'CHAT',
        content: packet.payload?.content || '',
        timestamp: packet.timestamp,
        status: 'TRANSMITTED',
        hopCount: packet.hopCount,
        ttl: packet.ttl
      };
      await storage.saveMessage(stored);

      // Automatically send ACK back to sender
      if (this.identity) {
        const ackPacket = protocol.createAckPacket(this.identity, packet);
        this.sendPacket(ackPacket);
      }
      this.notify();
    } else if (packet.type === 'SOS') {
      const incident: EmergencyIncident = {
        id: packet.id,
        senderId: packet.senderId,
        senderName: packet.senderName,
        category: packet.payload?.category || 'GENERAL',
        description: packet.payload?.description || '',
        location: packet.payload?.location,
        timestamp: packet.timestamp,
        status: 'ACTIVE',
        isLocal: false,
        deliveryStatus: 'TRANSMITTED'
      };
      await storage.saveIncident(incident);

      // Automatically send ACK for emergency reception
      if (this.identity) {
        const ackPacket = protocol.createAckPacket(this.identity, packet);
        this.sendPacket(ackPacket);
      }
      this.notify();
    } else if (packet.type === 'ACK') {
      const targetId = packet.payload?.ackMessageId;
      if (targetId) {
        console.log(`[Transport] Received ACK for [${targetId}] from ${packet.senderName}`);
        await storage.updateMessageStatus(targetId, 'ACKNOWLEDGED', packet.senderName);
        this.notify();
      }
    } else if (packet.type === 'STATUS_UPDATE') {
      const { incidentId, status } = packet.payload || {};
      if (incidentId && status) {
        await storage.updateIncidentStatus(incidentId, status);
        this.notify();
      }
    }

    // Phone A -> Phone B -> Phone C store-and-forward relay:
    // If packet has hops remaining and is broadcast or not addressed exclusively to us, forward to other peers!
    const relayPacket = protocol.prepareRelayPacket(packet);
    if (relayPacket) {
      console.log(`[Transport] Relaying packet [${packet.id}] (hop ${relayPacket.hopCount}/${relayPacket.ttl}) across connected peers`);
      this.webrtc.broadcastPacket(relayPacket);
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'SEND_PACKET', packet: relayPacket }));
      }
    }

    return true;
  }

  // Automatic Outbox Scheduler: Flush pending/saved messages when transport is ready
  private isFlushingOutbox = false;
  public async flushOutboxQueue(): Promise<void> {
    if (this.isFlushingOutbox) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    this.isFlushingOutbox = true;
    try {
      const pending = await storage.getPendingOutboxMessages();
      if (pending.length === 0) return;

      console.log(`[Transport] Flushing outbox queue: ${pending.length} pending messages...`);

      // Stream up to 10 messages per batch with delay to avoid flooding
      const batch = pending.slice(0, 10);
      for (const msg of batch) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) break;

        // Skip messages older than 24 hours (expired)
        if (Date.now() - msg.timestamp > 86400000) {
          await storage.updateMessageStatus(msg.id, 'EXPIRED');
          continue;
        }

        const packet: WaylinePacket = {
          version: 1,
          id: msg.id,
          type: msg.type,
          senderId: msg.senderId,
          senderName: msg.senderName,
          recipientId: msg.recipientId,
          timestamp: msg.timestamp,
          ttl: msg.ttl,
          hopCount: msg.hopCount,
          payload: { content: msg.content }
        };
        packet.signature = protocol.calculateChecksum(packet);

        this.socket.send(JSON.stringify({
          type: 'SEND_PACKET',
          packet
        }));

        // Bounded delay between sends
        await new Promise(r => setTimeout(r, 60));
      }
    } catch (e: any) {
      console.warn('[Transport] Error flushing outbox queue:', e.message);
    } finally {
      this.isFlushingOutbox = false;
      this.notify();
    }
  }

  // Send a packet via all available transports (WebSocket host & direct WebRTC peer channels)
  public async sendPacket(packet: WaylinePacket): Promise<void> {
    this.state.packetsSent++;
    let transmittedCount = 0;

    // 1. Direct WebRTC DataChannels (genuine phone-to-phone links)
    const webrtcSent = this.webrtc.broadcastPacket(packet);
    transmittedCount += webrtcSent;

    // 2. Local Node Companion WebSocket
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'SEND_PACKET',
        packet
      }));
      transmittedCount++;
    }

    if (transmittedCount > 0) {
      await storage.updateMessageStatus(packet.id, 'TRANSMITTED');
    } else {
      // No active transports online - message safely preserved in local outbox
      console.log(`[Transport] All transports offline. Packet [${packet.id}] queued locally.`);
      await storage.updateMessageStatus(packet.id, 'SAVED_LOCALLY');
    }
    this.notify();
  }

  // Connect to a peer via direct WebRTC signaling
  public connectToPeer(peerId: string, peerName: string) {
    this.webrtc.initiateConnection(peerId, peerName, (signal) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: 'SIGNALING',
          targetPeerId: peerId,
          signal
        }));
      }
    });
  }

  // Trigger manual discovery beacon broadcast
  public triggerDiscoveryRefresh() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'REFRESH_DISCOVERY' }));
    }
  }
}

export const transport = new WaylineTransportService();
