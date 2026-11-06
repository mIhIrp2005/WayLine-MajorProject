// WAYLINE Voice Peer Connection Handler
// Manages individual WebRTC RTCPeerConnection for real audio streams

import { AudioLevelMonitor } from './voiceDiagnostics';

export interface VoicePeerCallbacks {
  onSignal: (signal: any) => void;
  onConnectionStateChange: (state: RTCIceConnectionState) => void;
  onRemoteAudioLevel?: (level: number, isSpeaking: boolean) => void;
}

export class VoicePeer {
  public readonly peerId: string;
  public readonly peerName: string;
  public pc: RTCPeerConnection;
  private audioElement: HTMLAudioElement | null = null;
  private remoteStream: MediaStream | null = null;
  private audioMeter: AudioLevelMonitor | null = null;
  private callbacks: VoicePeerCallbacks;
  private isDestroyed = false;

  constructor(peerId: string, peerName: string, callbacks: VoicePeerCallbacks) {
    this.peerId = peerId;
    this.peerName = peerName;
    this.callbacks = callbacks;

    this.pc = new RTCPeerConnection({
      iceServers: [] // Zero-cloud offline LAN ICE (host candidates)
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.pc.onicecandidate = (event) => {
      if (event.candidate && !this.isDestroyed) {
        this.callbacks.onSignal({ type: 'candidate', candidate: event.candidate });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (this.isDestroyed) return;
      console.log(`[VoicePeer] ICE state with ${this.peerName} (${this.peerId}): ${this.pc.iceConnectionState}`);
      this.callbacks.onConnectionStateChange(this.pc.iceConnectionState);
    };

    this.pc.ontrack = (event) => {
      if (this.isDestroyed) return;
      console.log(`[VoicePeer] Received remote audio track from ${this.peerName}`);
      
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        this.remoteStream = new MediaStream([event.track]);
      }

      this.playRemoteStream(this.remoteStream);

      // Start remote audio level meter if callback provided
      if (this.callbacks.onRemoteAudioLevel) {
        this.audioMeter = new AudioLevelMonitor((level, isSpeaking) => {
          if (!this.isDestroyed && this.callbacks.onRemoteAudioLevel) {
            this.callbacks.onRemoteAudioLevel(level, isSpeaking);
          }
        });
        this.audioMeter.start(this.remoteStream);
      }
    };
  }

  private playRemoteStream(stream: MediaStream) {
    if (typeof document === 'undefined') return;

    if (!this.audioElement) {
      this.audioElement = document.createElement('audio');
      this.audioElement.autoplay = true;
      this.audioElement.setAttribute('playsinline', 'true');
      this.audioElement.style.display = 'none';
      document.body.appendChild(this.audioElement);
    }

    this.audioElement.srcObject = stream;
    this.audioElement.play().catch((err) => {
      console.warn(`[VoicePeer] Autoplay blocked for ${this.peerName}:`, err.message);
    });
  }

  public setLocalStream(stream: MediaStream) {
    const senders = this.pc.getSenders();
    for (const track of stream.getAudioTracks()) {
      const existing = senders.find(s => s.track?.id === track.id);
      if (!existing) {
        this.pc.addTrack(track, stream);
      }
    }
  }

  public async createOffer(): Promise<void> {
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false
    });
    await this.pc.setLocalDescription(offer);
    this.callbacks.onSignal({ type: 'offer', sdp: offer.sdp });
  }

  public async handleOffer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.callbacks.onSignal({ type: 'answer', sdp: answer.sdp });
  }

  public async handleAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
  }

  public async handleCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      // Safe drop if candidate arrives after close
    }
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.audioMeter) {
      this.audioMeter.stop();
      this.audioMeter = null;
    }
    if (this.audioElement) {
      try {
        this.audioElement.srcObject = null;
        this.audioElement.remove();
      } catch {}
      this.audioElement = null;
    }
    try {
      this.pc.close();
    } catch {}
  }
}
