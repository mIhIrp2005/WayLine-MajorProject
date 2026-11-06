// WAYLINE Voice Signaling Service
// Dispatches and receives voice messaging over the active WebSocket host transport

import { VoiceSignalingMessage } from './voiceTypes';

type VoiceSignalHandler = (msg: VoiceSignalingMessage) => void;

export class VoiceSignalingService {
  private handlers: Set<VoiceSignalHandler> = new Set();
  private sendFunction: ((msg: any) => void) | null = null;

  public setSender(fn: (msg: any) => void) {
    this.sendFunction = fn;
  }

  public subscribe(handler: VoiceSignalHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public handleInboundMessage(msg: VoiceSignalingMessage) {
    for (const handler of this.handlers) {
      try {
        handler(msg);
      } catch (err) {
        console.error('[VoiceSignaling] Handler error:', err);
      }
    }
  }

  public send(msg: VoiceSignalingMessage) {
    if (!this.sendFunction) {
      console.warn('[VoiceSignaling] Cannot send: WebSocket sender not attached');
      return;
    }
    this.sendFunction(msg);
  }
}

export const voiceSignaling = new VoiceSignalingService();
