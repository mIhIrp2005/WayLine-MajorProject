// WAYLINE Voice Communication System Types
// Supports one-to-one calls, group voice rooms, WebRTC audio state, and diagnostics.

export type CallState = 
  | 'IDLE'
  | 'OUTGOING_CALLING'
  | 'INCOMING_RINGING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'BUSY'
  | 'ENDED';

export type RoomState = 
  | 'IDLE'
  | 'CONNECTING'
  | 'JOINED'
  | 'LEFT'
  | 'TERMINATED';

export interface VoiceParticipant {
  peerId: string;
  peerName: string;
  joinedAt: number;
  isMuted: boolean;
  isSpeaking?: boolean;
  audioLevel?: number; // 0 to 1
  connectionState?: RTCIceConnectionState;
}

export interface VoiceRoomInfo {
  id: string;
  name: string;
  creatorId: string;
  creatorName: string;
  createdAt: number;
  participantCount: number;
  participants: VoiceParticipant[];
}

export interface ActiveCallSession {
  callId: string;
  peerId: string;
  peerName: string;
  isIncoming: boolean;
  state: CallState;
  startedAt?: number;
  connectedAt?: number;
  endedAt?: number;
  isMuted: boolean;
  isRemoteMuted: boolean;
  isSpeaking: boolean;
  remoteSpeaking: boolean;
  audioLevel: number;
  remoteAudioLevel: number;
  errorMessage?: string;
}

export interface VoiceSignalingMessage {
  type: 
    | 'VOICE_CALL_INVITE'
    | 'VOICE_CALL_ACCEPT'
    | 'VOICE_CALL_REJECT'
    | 'VOICE_CALL_END'
    | 'VOICE_SIGNAL'
    | 'VOICE_ROOM_CREATE'
    | 'VOICE_ROOM_JOIN'
    | 'VOICE_ROOM_JOINED'
    | 'VOICE_ROOM_LEAVE'
    | 'VOICE_ROOM_END'
    | 'VOICE_ROOM_LIST'
    | 'VOICE_ROOM_PARTICIPANT_JOINED'
    | 'VOICE_ROOM_PARTICIPANT_LEFT'
    | 'VOICE_ROOM_TERMINATED'
    | 'VOICE_ROOM_MUTE_UPDATE';
  [key: string]: any;
}

export interface VoiceDiagnosticsState {
  isSecureContext: boolean;
  hasMediaDevices: boolean;
  microphonePermission: 'prompt' | 'granted' | 'denied' | 'unknown';
  activeAudioTracks: number;
  inputAudioLevel: number;
  selectedAudioDeviceId?: string;
}
