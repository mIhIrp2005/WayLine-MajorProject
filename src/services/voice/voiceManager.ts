// WAYLINE Central Voice Manager
// Coordinates 1-on-1 calls, group voice rooms, microphone streams, and audio devices

import { 
  ActiveCallSession, 
  VoiceRoomInfo, 
  VoiceParticipant, 
  VoiceSignalingMessage,
  VoiceDiagnosticsState 
} from './voiceTypes';
import { VoicePermissionsService } from './voicePermissions';
import { AudioLevelMonitor, VoiceToneSynthesizer } from './voiceDiagnostics';
import { VoicePeer } from './voicePeer';
import { VoiceRoomSession } from './voiceRoom';
import { voiceSignaling } from './voiceSignaling';

type VoiceStateListener = () => void;

class VoiceManagerService {
  private listeners: Set<VoiceStateListener> = new Set();
  private localNodeId: string = '';
  private localNodeName: string = '';

  // 1-to-1 Calling State
  public activeCall: ActiveCallSession | null = null;
  private callPeer: VoicePeer | null = null;

  // Group Voice Room State
  public activeRoom: VoiceRoomSession | null = null;
  public roomsList: VoiceRoomInfo[] = [];

  // Hardware & Audio Stream
  private localStream: MediaStream | null = null;
  private localAudioMeter: AudioLevelMonitor | null = null;
  private toneSynth: VoiceToneSynthesizer = new VoiceToneSynthesizer();

  // Diagnostics
  public diagnostics: VoiceDiagnosticsState = {
    isSecureContext: false,
    hasMediaDevices: false,
    microphonePermission: 'unknown',
    activeAudioTracks: 0,
    inputAudioLevel: 0
  };

  constructor() {
    this.updateDiagnostics();
    voiceSignaling.subscribe((msg) => this.handleSignaling(msg));
  }

  public setIdentity(nodeId: string, nodeName: string) {
    this.localNodeId = nodeId;
    this.localNodeName = nodeName;
  }

  public subscribe(listener: VoiceStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(cb => {
      try { cb(); } catch {}
    });
  }

  public updateDiagnostics() {
    const env = VoicePermissionsService.checkEnvironment();
    this.diagnostics.isSecureContext = env.isSecure;
    this.diagnostics.hasMediaDevices = env.hasHardware;
    VoicePermissionsService.queryMicrophoneStatus().then((status) => {
      this.diagnostics.microphonePermission = status;
      this.notify();
    });
  }

  // --- Microphone Management ---
  private async acquireMicrophone(): Promise<MediaStream> {
    if (this.localStream) {
      return this.localStream;
    }

    const stream = await VoicePermissionsService.requestMicrophone();
    this.localStream = stream;
    this.diagnostics.activeAudioTracks = stream.getAudioTracks().length;

    // Start local audio level meter
    this.localAudioMeter = new AudioLevelMonitor((level, isSpeaking) => {
      this.diagnostics.inputAudioLevel = level;
      if (this.activeCall) {
        this.activeCall.audioLevel = level;
        this.activeCall.isSpeaking = isSpeaking;
      }
      this.notify();
    });
    this.localAudioMeter.start(stream);

    return stream;
  }

  private releaseMicrophone() {
    if (this.localAudioMeter) {
      this.localAudioMeter.stop();
      this.localAudioMeter = null;
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }
    this.diagnostics.activeAudioTracks = 0;
    this.diagnostics.inputAudioLevel = 0;
  }

  // --- 1-to-1 Private Voice Calling ---

  public async startCall(peerId: string, peerName: string): Promise<void> {
    if ((this.activeCall && this.activeCall.state !== 'ENDED') || this.activeRoom) {
      throw new Error('Another call or voice room is currently active.');
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.activeCall = {
      callId,
      peerId,
      peerName,
      isIncoming: false,
      state: 'OUTGOING_CALLING',
      startedAt: Date.now(),
      isMuted: false,
      isRemoteMuted: false,
      isSpeaking: false,
      remoteSpeaking: false,
      audioLevel: 0,
      remoteAudioLevel: 0
    };
    this.notify();

    try {
      // 1. Acquire local microphone
      const stream = await this.acquireMicrophone();

      // 2. Start ringback tone
      this.toneSynth.playRingback();

      // 3. Create peer connection
      this.callPeer = new VoicePeer(peerId, peerName, {
        onSignal: (signal) => {
          voiceSignaling.send({
            type: 'VOICE_SIGNAL',
            targetPeerId: peerId,
            signal,
            callId
          });
        },
        onConnectionStateChange: (state) => {
          this.handleCallIceStateChange(state);
        },
        onRemoteAudioLevel: (level, isSpeaking) => {
          if (this.activeCall) {
            this.activeCall.remoteAudioLevel = level;
            this.activeCall.remoteSpeaking = isSpeaking;
            this.notify();
          }
        }
      });

      this.callPeer.setLocalStream(stream);

      // 4. Send call invite to remote peer
      voiceSignaling.send({
        type: 'VOICE_CALL_INVITE',
        targetPeerId: peerId,
        callId
      });

    } catch (err: any) {
      this.toneSynth.stop();
      if (this.activeCall) {
        this.activeCall.state = 'ENDED';
        this.activeCall.errorMessage = err.message || 'Microphone capture failed';
        this.notify();
      }
      this.cleanupCall(false);
      throw err;
    }
  }

  public async acceptCall(): Promise<void> {
    if (!this.activeCall || !this.activeCall.isIncoming || this.activeCall.state !== 'INCOMING_RINGING') {
      return;
    }

    this.toneSynth.stop();
    this.activeCall.state = 'CONNECTING';
    this.notify();

    try {
      const stream = await this.acquireMicrophone();

      this.callPeer = new VoicePeer(this.activeCall.peerId, this.activeCall.peerName, {
        onSignal: (signal) => {
          if (this.activeCall) {
            voiceSignaling.send({
              type: 'VOICE_SIGNAL',
              targetPeerId: this.activeCall.peerId,
              signal,
              callId: this.activeCall.callId
            });
          }
        },
        onConnectionStateChange: (state) => {
          this.handleCallIceStateChange(state);
        },
        onRemoteAudioLevel: (level, isSpeaking) => {
          if (this.activeCall) {
            this.activeCall.remoteAudioLevel = level;
            this.activeCall.remoteSpeaking = isSpeaking;
            this.notify();
          }
        }
      });

      this.callPeer.setLocalStream(stream);

      voiceSignaling.send({
        type: 'VOICE_CALL_ACCEPT',
        targetPeerId: this.activeCall.peerId,
        callId: this.activeCall.callId
      });

      // The callee initiates WebRTC offer on accept
      await this.callPeer.createOffer();

    } catch (err: any) {
      this.rejectCall('Microphone access failed');
      throw err;
    }
  }

  public rejectCall(reason: string = 'declined'): void {
    this.toneSynth.stop();
    if (this.activeCall) {
      voiceSignaling.send({
        type: 'VOICE_CALL_REJECT',
        targetPeerId: this.activeCall.peerId,
        callId: this.activeCall.callId,
        reason
      });
    }
    this.cleanupCall();
  }

  public endCall(errorMessage?: string): void {
    this.toneSynth.stop();
    if (this.activeCall) {
      voiceSignaling.send({
        type: 'VOICE_CALL_END',
        targetPeerId: this.activeCall.peerId,
        callId: this.activeCall.callId
      });
      if (errorMessage) {
        this.activeCall.errorMessage = errorMessage;
      }
    }
    this.cleanupCall(false);
  }

  public dismissCall(): void {
    this.cleanupCall(true);
    this.activeCall = null;
    this.notify();
  }

  public toggleMute(): boolean {
    if (this.activeCall && this.localStream) {
      const nextMuted = !this.activeCall.isMuted;
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !nextMuted;
      }
      this.activeCall.isMuted = nextMuted;
      this.notify();
      return nextMuted;
    } else if (this.activeRoom) {
      // If mic wasn't acquired on join/create, try acquiring it now
      if (!this.localStream) {
        this.acquireMicrophone().then((stream) => {
          if (this.activeRoom) {
            this.activeRoom.setLocalStream(stream);
            this.activeRoom.setMuted(false);
            this.notify();
          }
        }).catch((e: any) => {
          alert(`Microphone unavailable: ${e.message}`);
        });
        return false;
      }
      const isMuted = !this.activeRoom.getRoomInfo().participants.find(p => p.peerId === this.localNodeId)?.isMuted;
      this.activeRoom.setMuted(isMuted);
      this.notify();
      return isMuted;
    }
    return false;
  }

  private handleCallIceStateChange(state: RTCIceConnectionState) {
    if (!this.activeCall) return;

    if (state === 'connected' || state === 'completed') {
      this.toneSynth.stop();
      this.activeCall.state = 'CONNECTED';
      if (!this.activeCall.connectedAt) {
        this.activeCall.connectedAt = Date.now();
      }
    } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
      if (this.activeCall.state === 'CONNECTED') {
        this.endCall('Voice connection lost');
      }
    }
    this.notify();
  }

  private cleanupCall(clearActive = true) {
    this.toneSynth.stop();
    if (this.callPeer) {
      this.callPeer.destroy();
      this.callPeer = null;
    }
    this.releaseMicrophone();
    if (this.activeCall) {
      this.activeCall.state = 'ENDED';
      this.activeCall.endedAt = Date.now();
      this.notify();
      if (clearActive) {
        setTimeout(() => {
          if (this.activeCall?.state === 'ENDED') {
            this.activeCall = null;
            this.notify();
          }
        }, 3500);
      }
    }
  }

  // --- Group Voice Rooms ---

  public async createRoom(name: string): Promise<string> {
    if (this.activeCall && this.activeCall.state !== 'ENDED') {
      throw new Error('Leave current call first.');
    }
    if (this.activeRoom) {
      throw new Error('Leave current room first.');
    }

    const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    
    // Acquire microphone if supported, but do not block room creation if mic is disabled/unsupported!
    let stream: MediaStream | null = null;
    try {
      stream = await this.acquireMicrophone();
    } catch (e: any) {
      console.warn('[VoiceManager] Microphone capture unavailable on room creation (joining muted):', e.message);
    }

    this.activeRoom = new VoiceRoomSession(
      { id: roomId, name, creatorId: this.localNodeId },
      this.localNodeId,
      this.localNodeName,
      {
        onRoomStateChange: () => this.notify(),
        onParticipantsChange: () => this.notify(),
        onError: (err) => console.warn('[VoiceManager] Room error:', err)
      }
    );

    if (stream) {
      this.activeRoom.setLocalStream(stream);
    } else {
      this.activeRoom.setMuted(true);
    }

    voiceSignaling.send({
      type: 'VOICE_ROOM_CREATE',
      roomId,
      name
    });

    this.notify();
    return roomId;
  }

  public async joinRoom(roomId: string): Promise<void> {
    if (this.activeCall && this.activeCall.state !== 'ENDED') {
      throw new Error('Leave current call first.');
    }
    if (this.activeRoom) {
      throw new Error('Leave current room first.');
    }

    let stream: MediaStream | null = null;
    try {
      stream = await this.acquireMicrophone();
    } catch (e: any) {
      console.warn('[VoiceManager] Microphone capture unavailable on room join (joining muted):', e.message);
    }

    const existing = this.roomsList.find(r => r.id === roomId);

    this.activeRoom = new VoiceRoomSession(
      { id: roomId, name: existing?.name || `Room ${roomId.slice(-4)}`, creatorId: existing?.creatorId || '' },
      this.localNodeId,
      this.localNodeName,
      {
        onRoomStateChange: () => this.notify(),
        onParticipantsChange: () => this.notify(),
        onError: (err) => console.warn('[VoiceManager] Room error:', err)
      }
    );

    if (stream) {
      this.activeRoom.setLocalStream(stream);
    } else {
      this.activeRoom.setMuted(true);
    }

    voiceSignaling.send({
      type: 'VOICE_ROOM_JOIN',
      roomId
    });

    this.notify();
  }

  public leaveRoom(): void {
    if (this.activeRoom) {
      this.activeRoom.leave();
      this.activeRoom = null;
    }
    this.releaseMicrophone();
    this.notify();
  }

  public endRoom(): void {
    if (this.activeRoom) {
      this.activeRoom.endForEveryone();
      this.activeRoom = null;
    }
    this.releaseMicrophone();
    this.notify();
  }

  public refreshRoomsList(): void {
    voiceSignaling.send({
      type: 'VOICE_ROOM_LIST'
    });
  }

  // --- Signaling Message Router ---
  private async handleSignaling(msg: VoiceSignalingMessage) {
    switch (msg.type) {
      case 'VOICE_CALL_INVITE': {
        const { callerId, callerName, callId } = msg;
        // If already in a call or room, send busy
        if (this.activeCall || this.activeRoom) {
          voiceSignaling.send({
            type: 'VOICE_CALL_REJECT',
            targetPeerId: callerId,
            callId,
            reason: 'busy'
          });
          return;
        }

        this.activeCall = {
          callId,
          peerId: callerId,
          peerName: callerName,
          isIncoming: true,
          state: 'INCOMING_RINGING',
          startedAt: Date.now(),
          isMuted: false,
          isRemoteMuted: false,
          isSpeaking: false,
          remoteSpeaking: false,
          audioLevel: 0,
          remoteAudioLevel: 0
        };
        this.toneSynth.playRingtone();
        this.notify();
        break;
      }

      case 'VOICE_CALL_ACCEPT': {
        if (this.activeCall && !this.activeCall.isIncoming && this.activeCall.callId === msg.callId) {
          this.activeCall.state = 'CONNECTING';
          this.notify();
        }
        break;
      }

      case 'VOICE_CALL_REJECT': {
        if (this.activeCall && this.activeCall.callId === msg.callId) {
          this.activeCall.state = msg.reason === 'busy' ? 'BUSY' : 'ENDED';
          this.activeCall.errorMessage = msg.reason === 'busy' ? 'User is busy on another call' : 'Call declined';
          this.cleanupCall();
        }
        break;
      }

      case 'VOICE_CALL_END': {
        if (this.activeCall && this.activeCall.callId === msg.callId) {
          this.cleanupCall();
        }
        break;
      }

      case 'VOICE_SIGNAL': {
        const { senderId, senderName, signal, callId, roomId } = msg;

        // If part of active 1-to-1 call
        if (this.activeCall && this.callPeer && this.activeCall.callId === callId) {
          if (signal.type === 'offer') {
            await this.callPeer.handleOffer(signal.sdp);
          } else if (signal.type === 'answer') {
            await this.callPeer.handleAnswer(signal.sdp);
          } else if (signal.type === 'candidate' && signal.candidate) {
            await this.callPeer.handleCandidate(signal.candidate);
          }
        }

        // If part of active group room
        if (this.activeRoom && this.activeRoom.roomId === roomId) {
          await this.activeRoom.handleSignal(senderId, senderName, signal);
        }
        break;
      }

      case 'VOICE_ROOM_LIST': {
        this.roomsList = msg.rooms || [];
        this.notify();
        break;
      }

      case 'VOICE_ROOM_JOINED': {
        if (this.activeRoom && this.activeRoom.roomId === msg.roomId) {
          this.activeRoom.syncParticipants(msg.participants || []);
          this.notify();
        }
        break;
      }

      case 'VOICE_ROOM_PARTICIPANT_JOINED': {
        if (this.activeRoom && this.activeRoom.roomId === msg.roomId) {
          this.activeRoom.handleParticipantJoined(msg.participant);
          this.notify();
        }
        break;
      }

      case 'VOICE_ROOM_PARTICIPANT_LEFT': {
        if (this.activeRoom && this.activeRoom.roomId === msg.roomId) {
          this.activeRoom.handleParticipantLeft(msg.peerId);
          this.notify();
        }
        break;
      }

      case 'VOICE_ROOM_TERMINATED': {
        if (this.activeRoom && this.activeRoom.roomId === msg.roomId) {
          this.leaveRoom();
        }
        break;
      }

      case 'VOICE_ROOM_MUTE_UPDATE': {
        if (this.activeRoom && this.activeRoom.roomId === msg.roomId) {
          this.activeRoom.handleMuteUpdate(msg.peerId, msg.isMuted);
          this.notify();
        }
        break;
      }
    }
  }
}

export const voiceManager = new VoiceManagerService();
