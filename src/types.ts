// WAYLINE Protocol & Application Data Types

export type MessageType = 'CHAT' | 'SOS' | 'ACK' | 'HEARTBEAT' | 'STATUS_UPDATE';

export type DeliveryStatus = 
  | 'SAVED_LOCALLY'     // Saved in IndexedDB, not yet sent to any peer
  | 'QUEUED'            // Waiting for an active transport
  | 'TRANSMITTED'       // Successfully sent over transport to at least 1 peer
  | 'ACKNOWLEDGED'      // Confirmed processed by receiving peer
  | 'FAILED'            // Transmission failed
  | 'EXPIRED';          // TTL reached without delivery

export type EmergencyCategory = 
  | 'MEDICAL'
  | 'TRAPPED'
  | 'FLOOD'
  | 'RESCUE'
  | 'GENERAL';

export interface GeoLocationData {
  latitude: number;
  longitude: number;
  accuracy: number; // in meters
  timestamp: number;
}

export interface WaylinePacket {
  version: number;
  id: string;                    // Unique packet UUID
  type: MessageType;
  senderId: string;              // Node ID
  senderName: string;            // User display name
  recipientId: string;           // '*' for broadcast or specific Node ID
  timestamp: number;
  ttl: number;                   // Maximum hops (default 3)
  hopCount: number;              // Current hop count (starts at 0)
  payload: any;                  // Message text, SOS details, or ACK info
  signature?: string;            // Checksum / integrity hash
}

export interface StoredMessage {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  type: MessageType;
  content: string;
  timestamp: number;
  status: DeliveryStatus;
  hopCount: number;
  ttl: number;
  acknowledgedBy?: string[];
  acknowledgedAt?: number;
}

export interface EmergencyIncident {
  id: string;
  senderId: string;
  senderName: string;
  category: EmergencyCategory;
  description: string;
  location?: GeoLocationData;
  timestamp: number;
  status: 'ACTIVE' | 'RESOLVED' | 'SAFE';
  isLocal: boolean;              // Created on this device vs received from peer
  deliveryStatus: DeliveryStatus;
  acknowledgedBy?: string[];
}

export interface DiscoveredPeer {
  id: string;
  name: string;
  address: string;               // e.g. "192.168.1.105:8765" or "direct"
  transport: 'UDP_LAN' | 'WEBSOCKET' | 'DIRECT';
  status: 'CONNECTED' | 'DISCOVERED' | 'DISCONNECTED';
  lastSeen: number;
  isRelay: boolean;
  latencyMs?: number;
}

export interface LocalIdentity {
  nodeId: string;
  nodeName: string;
  created: number;
}

export interface NetworkInterfaceInfo {
  name: string;
  ip: string;
  url: string;
}

export interface TransportState {
  isCompanionConnected: boolean;
  activeTransport: string;
  listeningAddress: string;
  peerCount: number;
  isScanning: boolean;
  packetsSent: number;
  packetsReceived: number;
  lastError: string | null;
  availableInterfaces?: NetworkInterfaceInfo[];
  customHost?: string;
}
