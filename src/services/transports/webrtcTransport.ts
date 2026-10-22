// WAYLINE Direct Browser-to-Browser WebRTC Peer Transport
// Supports RTCDataChannel multi-peer links with local host signaling and offline manual/QR signaling
import { WaylinePacket, DiscoveredPeer } from '../../types';

export interface WebRTCPeerConnection {
  peerId: string;
  peerName: string;
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
}

export class WebRTCTransportManager {
  private peers: Map<string, WebRTCPeerConnection> = new Map();
  private onPacketCallback: (packet: WaylinePacket) => void;
  private onPeerStateCallback: () => void;
  private localNodeId: string = '';
  private localNodeName: string = '';

  constructor(
    onPacket: (packet: WaylinePacket) => void,
    onPeerState: () => void
  ) {
    this.onPacketCallback = onPacket;
    this.onPeerStateCallback = onPeerState;
  }

  public setIdentity(nodeId: string, nodeName: string) {
    this.localNodeId = nodeId;
    this.localNodeName = nodeName;
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.RTCPeerConnection !== 'undefined';
  }

  // Create or return existing peer connection
  private getOrCreatePeer(peerId: string, peerName: string): WebRTCPeerConnection {
    if (this.peers.has(peerId)) {
      return this.peers.get(peerId)!;
    }

    const pc = new RTCPeerConnection({
      iceServers: [] // Zero-internet local ICE candidates (host candidates)
    });

    const peerConn: WebRTCPeerConnection = {
      peerId,
      peerName,
      pc,
      status: 'CONNECTING'
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(peerConn, event.channel);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        peerConn.status = 'CONNECTED';
      } else if (state === 'failed' || state === 'closed') {
        peerConn.status = 'DISCONNECTED';
      }
      this.onPeerStateCallback();
    };

    this.peers.set(peerId, peerConn);
    return peerConn;
  }

  private setupDataChannel(peer: WebRTCPeerConnection, dc: RTCDataChannel) {
    peer.dc = dc;

    dc.onopen = () => {
      peer.status = 'CONNECTED';
      console.log(`[WebRTC] DataChannel OPEN with peer: ${peer.peerName} (${peer.peerId})`);
      this.onPeerStateCallback();
    };

    dc.onclose = () => {
      peer.status = 'DISCONNECTED';
      console.log(`[WebRTC] DataChannel CLOSED with peer: ${peer.peerName}`);
      this.onPeerStateCallback();
    };

    dc.onerror = (err) => {
      console.warn(`[WebRTC] DataChannel error with ${peer.peerName}:`, err);
    };

    dc.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet && packet.id && packet.type) {
          this.onPacketCallback(packet as WaylinePacket);
        }
      } catch (err: any) {
        console.error('[WebRTC] Corrupt packet on datachannel:', err.message);
      }
    };
  }

  // Initiate direct WebRTC connection to peer using signaling
  public async initiateConnection(
    peerId: string, 
    peerName: string, 
    sendSignal: (signal: any) => void
  ): Promise<void> {
    if (!this.isSupported()) return;

    const peer = this.getOrCreatePeer(peerId, peerName);
    const dc = peer.pc.createDataChannel('wayline-mesh', { ordered: true });
    this.setupDataChannel(peer, dc);

    peer.pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ type: 'candidate', candidate: event.candidate });
      }
    };

    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    sendSignal({ type: 'offer', sdp: offer.sdp });
  }

  // Handle incoming signaling message (Offer, Answer, ICE candidate)
  public async handleSignal(
    fromPeerId: string, 
    fromPeerName: string, 
    signal: any, 
    sendSignal: (signal: any) => void
  ): Promise<void> {
    if (!this.isSupported()) return;

    const peer = this.getOrCreatePeer(fromPeerId, fromPeerName);

    if (signal.type === 'offer') {
      await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
      
      peer.pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({ type: 'candidate', candidate: event.candidate });
        }
      };

      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      sendSignal({ type: 'answer', sdp: answer.sdp });

    } else if (signal.type === 'answer') {
      await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));

    } else if (signal.type === 'candidate' && signal.candidate) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (e) {
        // Safe candidate drop if connection closed
      }
    }
  }

  // Send packet across all open direct data channels
  public broadcastPacket(packet: WaylinePacket): number {
    let sentCount = 0;
    const serialized = JSON.stringify(packet);

    for (const peer of this.peers.values()) {
      if (peer.dc && peer.dc.readyState === 'open') {
        try {
          peer.dc.send(serialized);
          sentCount++;
        } catch (e) {
          console.warn(`[WebRTC] Failed to send packet to ${peer.peerName}`);
        }
      }
    }
    return sentCount;
  }

  public getConnectedPeers(): DiscoveredPeer[] {
    const list: DiscoveredPeer[] = [];
    for (const peer of this.peers.values()) {
      if (peer.status === 'CONNECTED' && peer.dc && peer.dc.readyState === 'open') {
        list.push({
          id: peer.peerId,
          name: peer.peerName,
          address: 'WebRTC P2P Direct',
          transport: 'DIRECT',
          status: 'CONNECTED',
          lastSeen: Date.now(),
          isRelay: true
        });
      }
    }
    return list;
  }

  // 1. Offline Air-Gapped Invitation (Offer)
  public async createOfflineOffer(targetPeerName: string = 'Air-Gapped Peer'): Promise<{ offerToken: string; peerId: string }> {
    const peerId = `offline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const peer = this.getOrCreatePeer(peerId, targetPeerName);
    const dc = peer.pc.createDataChannel('wayline-mesh', { ordered: true });
    this.setupDataChannel(peer, dc);

    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);

    // Wait for local ICE gathering to complete so all host candidates are in the SDP
    await new Promise<void>((resolve) => {
      if (peer.pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (peer.pc.iceGatheringState === 'complete') {
            peer.pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        peer.pc.addEventListener('icegatheringstatechange', checkState);
        setTimeout(resolve, 1500);
      }
    });

    const payload = {
      type: 'OFFER',
      peerId: this.localNodeId || 'node-a',
      peerName: this.localNodeName || 'Nearby Node',
      sdp: peer.pc.localDescription?.sdp
    };

    const offerToken = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return { offerToken, peerId };
  }

  // 2. Offline Air-Gapped Acceptance (Answer)
  public async acceptOfflineOffer(offerToken: string): Promise<{ answerToken: string; peerId: string }> {
    const raw = decodeURIComponent(escape(atob(offerToken.trim())));
    const payload = JSON.parse(raw);
    const peer = this.getOrCreatePeer(payload.peerId, payload.peerName || 'Remote Peer');

    await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: payload.sdp }));
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);

    await new Promise<void>((resolve) => {
      if (peer.pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (peer.pc.iceGatheringState === 'complete') {
            peer.pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        peer.pc.addEventListener('icegatheringstatechange', checkState);
        setTimeout(resolve, 1500);
      }
    });

    const answerPayload = {
      type: 'ANSWER',
      peerId: this.localNodeId || 'node-b',
      peerName: this.localNodeName || 'Nearby Node',
      sdp: peer.pc.localDescription?.sdp
    };

    const answerToken = btoa(unescape(encodeURIComponent(JSON.stringify(answerPayload))));
    return { answerToken, peerId: payload.peerId };
  }

  // 3. Finalize Offline Pairing with Answer
  public async finalizeOfflineAnswer(answerToken: string, peerId?: string): Promise<void> {
    const raw = decodeURIComponent(escape(atob(answerToken.trim())));
    const payload = JSON.parse(raw);
    const targetId = peerId || payload.peerId;
    const peer = this.peers.get(targetId);
    if (!peer) {
      // If peerId was ephemeral on Node A, find by connection state
      const firstConnecting = Array.from(this.peers.values()).find(p => p.status === 'CONNECTING');
      if (firstConnecting) {
        await firstConnecting.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }));
        return;
      }
      throw new Error(`Peer connection ${targetId} not found`);
    }

    await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }));
  }
}
