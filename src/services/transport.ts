// WAYLINE Client Transport Service
// Bridges React UI with the local WAYLINE Node Companion & IndexedDB persistence
import { WaylinePacket, DiscoveredPeer, TransportState, LocalIdentity, StoredMessage, EmergencyIncident } from '../types';
import { storage } from './storage';
import { protocol } from './protocol';

type Listener = () => void;

class WaylineTransportService {
  private socket: WebSocket | null = null;
  private listeners: Set<Listener> = new Set();
  private reconnectTimer: any = null;
  private identity: LocalIdentity | null = null;

  public state: TransportState = {
    isCompanionConnected: false,
    activeTransport: 'Initializing...',
    listeningAddress: 'Checking local interface...',
    peerCount: 0,
    isScanning: false,
    packetsSent: 0,
    packetsReceived: 0,
    lastError: null
  };

  public peers: DiscoveredPeer[] = [];

  constructor() {
    this.init();
  }

  private async init() {
    this.identity = await storage.getOrCreateIdentity();
    this.connectCompanion();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(cb => cb());
  }

  // Attempt connection to the local Node companion
  private connectCompanion() {
    if (this.socket) {
      try { this.socket.close(); } catch (e) {}
    }

    const host = window.location.hostname || 'localhost';
    // Use the port the page was loaded from, or default to 8765
    const port = window.location.port && window.location.port !== '5173' ? window.location.port : '8765';
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
        console.log('[Transport] Connected to WAYLINE local companion');
        
        if (this.identity) {
          this.socket?.send(JSON.stringify({
            type: 'CLIENT_REGISTER',
            nodeId: this.identity.nodeId,
            nodeName: this.identity.nodeName
          }));
        }
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
        this.state.lastError = 'Local node daemon not running on port 8765';
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
      this.peers = data.peers || [];
      this.state.peerCount = this.peers.filter(p => p.status === 'CONNECTED').length;
      this.notify();
    } else if (data.type === 'PEERS_UPDATED') {
      this.peers = data.peers || [];
      this.state.peerCount = this.peers.filter(p => p.status === 'CONNECTED').length;
      // Persist peers to IndexedDB
      for (const peer of this.peers) {
        await storage.savePeer(peer);
      }
      this.notify();
    } else if (data.type === 'PACKET_RECEIVED') {
      await this.processReceivedPacket(data.packet);
    } else if (data.type === 'SEND_RESULT') {
      const { packetId, transmittedCount } = data;
      const status: StoredMessage['status'] = transmittedCount > 0 ? 'TRANSMITTED' : 'SAVED_LOCALLY';
      await storage.updateMessageStatus(packetId, status);
      this.notify();
    }
  }

  // Handle packet received from a peer
  private async processReceivedPacket(packet: WaylinePacket) {
    if (!protocol.validatePacket(packet)) return;
    if (this.identity && packet.senderId === this.identity.nodeId) return; // Ignore own echoes

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
  }

  // Send a packet via the companion or save locally
  public async sendPacket(packet: WaylinePacket): Promise<void> {
    this.state.packetsSent++;

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'SEND_PACKET',
        packet
      }));
    } else {
      // Companion offline - message remains stored locally
      console.log(`[Transport] Companion offline. Packet [${packet.id}] preserved locally.`);
      await storage.updateMessageStatus(packet.id, 'SAVED_LOCALLY');
      this.notify();
    }
  }

  // Trigger manual discovery beacon broadcast
  public triggerDiscoveryRefresh() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'REFRESH_DISCOVERY' }));
    }
  }
}

export const transport = new WaylineTransportService();
