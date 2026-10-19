import { WaylinePacket, MessageType, StoredMessage, EmergencyIncident, LocalIdentity } from '../types';
import { storage } from './storage';

const PROTOCOL_VERSION = 1;
const DEFAULT_TTL = 3;
const MAX_SEEN_PACKETS = 2000;

// Standard CRC-16-CCITT implementation for packet & frame integrity
export function crc16Ccitt(data: string | Uint8Array): number {
  let crc = 0xFFFF;
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] << 8);
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

class WaylineProtocol {
  private seenPacketIds: Set<string> = new Set();
  private seenPacketOrder: string[] = [];
  private isHydrated = false;

  constructor() {
    this.hydrateFromStorage();
  }

  // Hydrate seen packet IDs from persistent IndexedDB store
  public async hydrateFromStorage(): Promise<void> {
    if (this.isHydrated) return;
    try {
      const persistedIds = await storage.getRecentSeenPackets(MAX_SEEN_PACKETS);
      for (const id of persistedIds) {
        this.seenPacketIds.add(id);
        this.seenPacketOrder.push(id);
      }
      this.isHydrated = true;
    } catch {
      // Memory fallback if storage not yet ready
    }
  }

  // Generate a random unique ID
  generateId(prefix: string = 'msg'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // Calculate CRC-16 checksum for packet payload & metadata integrity
  calculateChecksum(packet: Partial<WaylinePacket>): string {
    const raw = `${packet.version}:${packet.id}:${packet.senderId}:${packet.type}:${packet.timestamp}`;
    const crc = crc16Ccitt(raw);
    return crc.toString(16).padStart(4, '0');
  }

  // Create a chat packet
  createChatPacket(
    identity: LocalIdentity,
    content: string,
    recipientId: string = '*'
  ): { packet: WaylinePacket; storedMessage: StoredMessage } {
    const id = this.generateId('msg');
    const timestamp = Date.now();

    const packet: WaylinePacket = {
      version: PROTOCOL_VERSION,
      id,
      type: 'CHAT',
      senderId: identity.nodeId,
      senderName: identity.nodeName,
      recipientId,
      timestamp,
      ttl: DEFAULT_TTL,
      hopCount: 0,
      payload: { content }
    };
    packet.signature = this.calculateChecksum(packet);

    const storedMessage: StoredMessage = {
      id,
      senderId: identity.nodeId,
      senderName: identity.nodeName,
      recipientId,
      type: 'CHAT',
      content,
      timestamp,
      status: 'SAVED_LOCALLY',
      hopCount: 0,
      ttl: DEFAULT_TTL
    };

    this.markSeen(id);
    return { packet, storedMessage };
  }

  // Create an SOS packet
  createSosPacket(
    identity: LocalIdentity,
    category: EmergencyIncident['category'],
    description: string,
    location?: EmergencyIncident['location']
  ): { packet: WaylinePacket; incident: EmergencyIncident } {
    const id = this.generateId('sos');
    const timestamp = Date.now();

    const packet: WaylinePacket = {
      version: PROTOCOL_VERSION,
      id,
      type: 'SOS',
      senderId: identity.nodeId,
      senderName: identity.nodeName,
      recipientId: '*', // Always broadcast SOS
      timestamp,
      ttl: DEFAULT_TTL + 1, // Higher TTL for emergency
      hopCount: 0,
      payload: {
        category,
        description,
        location
      }
    };
    packet.signature = this.calculateChecksum(packet);

    const incident: EmergencyIncident = {
      id,
      senderId: identity.nodeId,
      senderName: identity.nodeName,
      category,
      description,
      location,
      timestamp,
      status: 'ACTIVE',
      isLocal: true,
      deliveryStatus: 'SAVED_LOCALLY'
    };

    this.markSeen(id);
    return { packet, incident };
  }

  // Create an ACK packet for a received message
  createAckPacket(
    identity: LocalIdentity,
    targetPacket: WaylinePacket
  ): WaylinePacket {
    const id = this.generateId('ack');
    const timestamp = Date.now();

    const packet: WaylinePacket = {
      version: PROTOCOL_VERSION,
      id,
      type: 'ACK',
      senderId: identity.nodeId,
      senderName: identity.nodeName,
      recipientId: targetPacket.senderId,
      timestamp,
      ttl: DEFAULT_TTL,
      hopCount: 0,
      payload: {
        ackMessageId: targetPacket.id,
        targetType: targetPacket.type
      }
    };
    packet.signature = this.calculateChecksum(packet);
    this.markSeen(id);
    return packet;
  }

  // Create status update (e.g. Incident resolved / Safe)
  createStatusUpdatePacket(
    identity: LocalIdentity,
    incidentId: string,
    status: EmergencyIncident['status']
  ): WaylinePacket {
    const id = this.generateId('stat');
    const timestamp = Date.now();

    const packet: WaylinePacket = {
      version: PROTOCOL_VERSION,
      id,
      type: 'STATUS_UPDATE',
      senderId: identity.nodeId,
      senderName: identity.nodeName,
      recipientId: '*',
      timestamp,
      ttl: DEFAULT_TTL,
      hopCount: 0,
      payload: {
        incidentId,
        status
      }
    };
    packet.signature = this.calculateChecksum(packet);
    this.markSeen(id);
    return packet;
  }

  // Duplicate detection & suppression
  isDuplicate(packetId: string): boolean {
    return this.seenPacketIds.has(packetId);
  }

  markSeen(packetId: string): void {
    if (this.seenPacketIds.has(packetId)) return;
    this.seenPacketIds.add(packetId);
    this.seenPacketOrder.push(packetId);

    // Persist to durable storage
    storage.saveSeenPacket(packetId).catch(() => {});

    if (this.seenPacketOrder.length > MAX_SEEN_PACKETS) {
      const oldest = this.seenPacketOrder.shift();
      if (oldest) this.seenPacketIds.delete(oldest);
    }
  }

  // Validate incoming packet integrity and bounds
  validatePacket(packet: any): packet is WaylinePacket {
    if (!packet || typeof packet !== 'object') return false;
    if (packet.version !== PROTOCOL_VERSION) return false;
    if (typeof packet.id !== 'string' || !packet.id) return false;
    if (typeof packet.senderId !== 'string' || !packet.senderId) return false;
    if (typeof packet.recipientId !== 'string') return false;
    if (typeof packet.timestamp !== 'number') return false;
    if (typeof packet.ttl !== 'number' || typeof packet.hopCount !== 'number') return false;
    if (packet.hopCount < 0 || packet.ttl <= 0) return false;
    return true;
  }

  // Prepare a packet for relay forwarding
  prepareRelayPacket(packet: WaylinePacket): WaylinePacket | null {
    if (packet.hopCount + 1 >= packet.ttl) {
      // TTL expired, drop relay
      return null;
    }

    return {
      ...packet,
      hopCount: packet.hopCount + 1
    };
  }
}

export const protocol = new WaylineProtocol();
