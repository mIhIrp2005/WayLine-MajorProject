// WAYLINE Voice Audio Energy Level Analyzer & Tone Synthesizer
// Uses Web Audio API without saving or recording audio data

export class AudioLevelMonitor {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private animId: number | null = null;
  private pcmData: Uint8Array<ArrayBuffer> | null = null;
  private onLevelCallback: (level: number, isSpeaking: boolean) => void;

  constructor(onLevel: (level: number, isSpeaking: boolean) => void) {
    this.onLevelCallback = onLevel;
  }

  public start(stream: MediaStream) {
    this.stop();

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      this.audioCtx = new AudioContextClass();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.4;

      this.source = this.audioCtx.createMediaStreamSource(stream);
      this.source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      this.pcmData = new Uint8Array(bufferLength);

      const loop = () => {
        if (!this.analyser || !this.pcmData) return;
        this.analyser.getByteFrequencyData(this.pcmData);

        let sum = 0;
        for (let i = 0; i < this.pcmData.length; i++) {
          sum += this.pcmData[i];
        }
        const avg = sum / this.pcmData.length;
        const normalized = Math.min(1, avg / 85);
        const isSpeaking = normalized > 0.12;

        this.onLevelCallback(Number(normalized.toFixed(2)), isSpeaking);
        this.animId = requestAnimationFrame(loop);
      };

      this.animId = requestAnimationFrame(loop);
    } catch (e) {
      console.warn('[VoiceDiagnostics] Audio meter start warning:', e);
    }
  }

  public stop() {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch {}
      this.analyser = null;
    }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch {}
      this.audioCtx = null;
    }
    this.onLevelCallback(0, false);
  }
}

// Tone Synthesizer for Ringtone and Ringback using Web Audio Oscillator
export class VoiceToneSynthesizer {
  private ctx: AudioContext | null = null;
  private timer: any = null;

  public playRingtone() {
    this.stop();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});

      const beep = () => {
        if (!this.ctx || this.ctx.state === 'closed') return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, this.ctx.currentTime); // Concert A
        gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.35);
      };

      beep();
      this.timer = setInterval(beep, 1600);
    } catch {}
  }

  public playRingback() {
    this.stop();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});

      const tone = () => {
        if (!this.ctx || this.ctx.state === 'closed') return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.6);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.6);
      };

      tone();
      this.timer = setInterval(tone, 2500);
    } catch {}
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) {
      try { this.ctx.close(); } catch {}
      this.ctx = null;
    }
  }
}
