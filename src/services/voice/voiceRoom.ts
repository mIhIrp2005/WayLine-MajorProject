// WAYLINE Group Voice Room Manager
// Manages multi-peer mesh audio connections for an active voice room

import { VoicePeer } from './voicePeer';
import { VoiceParticipant, VoiceRoomInfo, RoomState } from './voiceTypes';
import { voiceSignaling } from './voiceSignaling';

export interface VoiceRoomListener {
  onRoomStateChange: (state: RoomState, roomInfo?: VoiceRoomInfo) => void;
  onParticipantsChange: (participants: VoiceParticipant[]) => void;
  onError: (error: string) => void;
}

export class VoiceRoomSession {
  public readonly roomId: string;
  public roomName: string;
  public creatorId: string;
  public state: RoomState = 'CONNECTING';
  private localNodeId: string;
  private localNodeName: string;
  private localStream: MediaStream | null = null;
  private peers: Map<string, VoicePeer> = new Map();
  private participants: Map<string, VoiceParticipant> = new Map();
  private isMuted = false;
  private listener: VoiceRoomListener;

  constructor(
    roomInfo: { id: string; name: string; creatorId: string },
    localNodeId: string,
    localNodeName: string,
    listener: VoiceRoomListener
  ) {
    this.roomId = roomInfo.id;
    this.roomName = roomInfo.name;
    this.creatorId = roomInfo.creatorId;
    this.localNodeId = localNodeId;
    this.localNodeName = localNodeName;
    this.listener = listener;

    // Add local participant record
    this.participants.set(this.localNodeId, {
      peerId: this.localNodeId,
      peerName: this.localNodeName,
      joinedAt: Date.now(),
      isMuted: false,
      isSpeaking: false,
      audioLevel: 0
    });
  }

  public setLocalStream(stream: MediaStream) {
    this.localStream = stream;
    // Apply local stream to all existing peers
    for (const peer of this.peers.values()) {
      peer.setLocalStream(stream);
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }
    const local = this.participants.get(this.localNodeId);
    if (local) {
      local.isMuted = muted;
    }
    this.notifyParticipants();
    voiceSignaling.send({
      type: 'VOICE_ROOM_MUTE_UPDATE',
      roomId: this.roomId,
      isMuted: muted
    });
  }

  // Handle participant list received on join
  public syncParticipants(remoteList: VoiceParticipant[]) {
    this.state = 'JOINED';
    this.listener.onRoomStateChange(this.state, this.getRoomInfo());

    for (const p of remoteList) {
      if (p.peerId !== this.localNodeId) {
        this.participants.set(p.peerId, p);
        // Connect to existing participant if not already connected
        // Lower ID initiates offer to avoid glare
        if (!this.peers.has(p.peerId) && this.localNodeId < p.peerId) {
          this.connectToPeer(p.peerId, p.peerName, true);
        }
      }
    }
    this.notifyParticipants();
  }

  // Called when server informs that a new participant joined
  public handleParticipantJoined(participant: VoiceParticipant) {
    if (participant.peerId === this.localNodeId) return;

    this.participants.set(participant.peerId, participant);
    this.notifyParticipants();

    // The peer with the lexicographically smaller ID initiates the WebRTC offer
    if (this.localNodeId < participant.peerId) {
      this.connectToPeer(participant.peerId, participant.peerName, true);
    }
  }

  // Called when a participant leaves
  public handleParticipantLeft(peerId: string) {
    if (this.peers.has(peerId)) {
      this.peers.get(peerId)!.destroy();
      this.peers.delete(peerId);
    }
    this.participants.delete(peerId);
    this.notifyParticipants();
  }

  // Handle mute update from remote peer
  public handleMuteUpdate(peerId: string, isMuted: boolean) {
    const p = this.participants.get(peerId);
    if (p) {
      p.isMuted = isMuted;
      this.notifyParticipants();
    }
  }

  private connectToPeer(targetPeerId: string, targetPeerName: string, initiateOffer: boolean): VoicePeer {
    if (this.peers.has(targetPeerId)) {
      return this.peers.get(targetPeerId)!;
    }

    const peer = new VoicePeer(targetPeerId, targetPeerName, {
      onSignal: (signal) => {
        voiceSignaling.send({
          type: 'VOICE_SIGNAL',
          targetPeerId,
          signal,
          roomId: this.roomId
        });
      },
      onConnectionStateChange: (state) => {
        const p = this.participants.get(targetPeerId);
        if (p) {
          p.connectionState = state;
          this.notifyParticipants();
        }
      },
      onRemoteAudioLevel: (level, isSpeaking) => {
        const p = this.participants.get(targetPeerId);
        if (p) {
          p.audioLevel = level;
          p.isSpeaking = isSpeaking;
          this.notifyParticipants();
        }
      }
    });

    if (this.localStream) {
      peer.setLocalStream(this.localStream);
    }

    this.peers.set(targetPeerId, peer);

    if (initiateOffer) {
      peer.createOffer().catch(err => {
        console.error(`[VoiceRoom] Failed to create offer for ${targetPeerName}:`, err);
      });
    }

    return peer;
  }

  // Process inbound WebRTC signaling message
  public async handleSignal(fromPeerId: string, fromPeerName: string, signal: any) {
    let peer = this.peers.get(fromPeerId);
    if (!peer) {
      peer = this.connectToPeer(fromPeerId, fromPeerName, false);
    }

    if (signal.type === 'offer') {
      await peer.handleOffer(signal.sdp);
    } else if (signal.type === 'answer') {
      await peer.handleAnswer(signal.sdp);
    } else if (signal.type === 'candidate' && signal.candidate) {
      await peer.handleCandidate(signal.candidate);
    }
  }

  public getRoomInfo(): VoiceRoomInfo {
    return {
      id: this.roomId,
      name: this.roomName,
      creatorId: this.creatorId,
      creatorName: '',
      createdAt: Date.now(),
      participantCount: this.participants.size,
      participants: Array.from(this.participants.values())
    };
  }

  public notifyParticipants() {
    this.listener.onParticipantsChange(Array.from(this.participants.values()));
  }

  public leave() {
    this.state = 'LEFT';
    voiceSignaling.send({
      type: 'VOICE_ROOM_LEAVE',
      roomId: this.roomId
    });
    this.destroy();
  }

  public endForEveryone() {
    this.state = 'TERMINATED';
    voiceSignaling.send({
      type: 'VOICE_ROOM_END',
      roomId: this.roomId
    });
    this.destroy();
  }

  public destroy() {
    for (const peer of this.peers.values()) {
      peer.destroy();
    }
    this.peers.clear();
    this.participants.clear();
  }
}
