// WAYLINE Experimental Acoustic Modem Engine
// Implements audible 2-FSK acoustic transceiver over standard Web Audio API
import { transport } from '../transport';
import { WaylinePacket } from '../../types';

export interface AcousticFrame {
  version: number;
  sessionId: number;
  frameType: 'DATA' | 'ACK' | 'BEACON' | 'RELAY';
  packetId: number;
  senderId: number;
  seq: number;
  totalSeqs: number;
  payload: Uint8Array;
  crc16: number;
}

export interface ModemDiagnostics {
  txPackets: number;
  rxPackets: number;
  corruptedFrames: number;
  ackSuccessCount: number;
  ackFailureCount: number;
  lastRoundTripMs: number | null;
  ambientNoiseDb: number;
  peakSignalDb: number;
  currentCarrierFreq: number | null;
}

export type ModemState = 'IDLE' | 'TRANSMITTING' | 'LISTENING' | 'RECEIVING_FRAME' | 'WAITING_ACK';

export class AcousticModem {
  // Configurable Modulation Frequencies (Audible band chosen for ordinary phone transducers)
  public markFreq = 2000;    // Bit 1 (Hz)
  public spaceFreq = 1500;   // Bit 0 (Hz)
  public syncPilotFreq = 1750; // Pilot / Carrier detection (Hz)
  public sfdFreq = 2300;     // Start Frame Delimiter (Hz)
  public efdFreq = 2500;     // End Frame Delimiter (Hz)
  public symbolDurationMs = 45; // 45ms per bit symbol (~22.2 baud)

  public state: ModemState = 'IDLE';
  public isListening = false;
  public autoAck = true;

  public diagnostics: ModemDiagnostics = {
    txPackets: 0,
    rxPackets: 0,
    corruptedFrames: 0,
    ackSuccessCount: 0,
    ackFailureCount: 0,
    lastRoundTripMs: null,
    ambientNoiseDb: -90,
    peakSignalDb: -90,
    currentCarrierFreq: null
  };

  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private pollTimer: any = null;

  // Receiver state machine
  private rxBuffer: number[] = [];
  private rxState: 'SEARCHING_PREAMBLE' | 'SYNC_LOCKED' | 'READING_BITS' = 'SEARCHING_PREAMBLE';
  private preambleStreak = 0;
  private lastDetectedBit: number | null = null;
  private consecutiveSameBit = 0;

  // Acknowledgment wait registry
  private pendingAckPacketId: number | null = null;
  private ackTimer: any = null;
  private txStartTime = 0;

  // Event Listeners
  private onFrameCallbacks: Set<(frame: AcousticFrame, rawText: string) => void> = new Set();
  private onAckCallbacks: Set<(packetId: number, latencyMs: number) => void> = new Set();
  private onBeaconCallbacks: Set<(senderId: number) => void> = new Set();
  private onDiagnosticCallbacks: Set<() => void> = new Set();
  private onErrorCallbacks: Set<(msg: string) => void> = new Set();

  constructor(public localNodeIdNum: number = Math.floor(100000 + Math.random() * 899999)) {}

  // --- Subscriptions ---
  public onFrame(cb: (frame: AcousticFrame, rawText: string) => void): () => void {
    this.onFrameCallbacks.add(cb);
    return () => this.onFrameCallbacks.delete(cb);
  }

  public onAck(cb: (packetId: number, latencyMs: number) => void): () => void {
    this.onAckCallbacks.add(cb);
    return () => this.onAckCallbacks.delete(cb);
  }

  public onBeacon(cb: (senderId: number) => void): () => void {
    this.onBeaconCallbacks.add(cb);
    return () => this.onBeaconCallbacks.delete(cb);
  }

  public onDiagnostics(cb: () => void): () => void {
    this.onDiagnosticCallbacks.add(cb);
    return () => this.onDiagnosticCallbacks.delete(cb);
  }

  public onError(cb: (msg: string) => void): () => void {
    this.onErrorCallbacks.add(cb);
    return () => this.onErrorCallbacks.delete(cb);
  }

  private notifyDiagnostics() {
    this.onDiagnosticCallbacks.forEach(cb => cb());
  }

  // --- CRC-16 CCITT Calculation ---
  public static calculateCrc16(data: Uint8Array): number {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= (data[i] << 8);
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

  // --- Binary Serialization & Framing ---
  public encodeFrame(
    frameType: AcousticFrame['frameType'],
    packetId: number,
    payloadText: string,
    sessionId = 42
  ): Uint8Array {
    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(payloadText).slice(0, 48); // Bound test packet length

    const typeCode = frameType === 'DATA' ? 1 : frameType === 'ACK' ? 2 : frameType === 'BEACON' ? 3 : 4;
    const buffer = new Uint8Array(15 + payloadBytes.length + 2);

    // Byte 0: Version
    buffer[0] = 1;
    // Bytes 1-2: Session ID
    buffer[1] = (sessionId >> 8) & 0xFF;
    buffer[2] = sessionId & 0xFF;
    // Byte 3: Frame Type
    buffer[3] = typeCode;
    // Bytes 4-7: Packet ID (uint32)
    buffer[4] = (packetId >> 24) & 0xFF;
    buffer[5] = (packetId >> 16) & 0xFF;
    buffer[6] = (packetId >> 8) & 0xFF;
    buffer[7] = packetId & 0xFF;
    // Bytes 8-11: Sender ID (uint32)
    buffer[8] = (this.localNodeIdNum >> 24) & 0xFF;
    buffer[9] = (this.localNodeIdNum >> 16) & 0xFF;
    buffer[10] = (this.localNodeIdNum >> 8) & 0xFF;
    buffer[11] = this.localNodeIdNum & 0xFF;
    // Byte 12: Seq (0)
    buffer[12] = 0;
    // Byte 13: Total Seqs (1)
    buffer[13] = 1;
    // Byte 14: Payload Length
    buffer[14] = payloadBytes.length;
    // Bytes 15..15+N: Payload
    buffer.set(payloadBytes, 15);

    // Calculate CRC16 over preceding bytes
    const crc = AcousticModem.calculateCrc16(buffer.subarray(0, 15 + payloadBytes.length));
    buffer[15 + payloadBytes.length] = (crc >> 8) & 0xFF;
    buffer[16 + payloadBytes.length] = crc & 0xFF;

    return buffer;
  }

  public decodeFrame(buffer: Uint8Array): AcousticFrame | null {
    if (buffer.length < 17) return null;
    const version = buffer[0];
    if (version !== 1) return null;

    const sessionId = (buffer[1] << 8) | buffer[2];
    const typeCode = buffer[3];
    const frameType: AcousticFrame['frameType'] = 
      typeCode === 1 ? 'DATA' : typeCode === 2 ? 'ACK' : typeCode === 3 ? 'BEACON' : 'RELAY';

    const packetId = ((buffer[4] << 24) | (buffer[5] << 16) | (buffer[6] << 8) | buffer[7]) >>> 0;
    const senderId = ((buffer[8] << 24) | (buffer[9] << 16) | (buffer[10] << 8) | buffer[11]) >>> 0;
    const seq = buffer[12];
    const totalSeqs = buffer[13];
    const payloadLen = buffer[14];

    if (buffer.length !== 15 + payloadLen + 2) return null;

    // Check CRC16
    const payload = buffer.slice(15, 15 + payloadLen);
    const expectedCrc = (buffer[15 + payloadLen] << 8) | buffer[16 + payloadLen];
    const actualCrc = AcousticModem.calculateCrc16(buffer.subarray(0, 15 + payloadLen));

    if (expectedCrc !== actualCrc) {
      this.diagnostics.corruptedFrames++;
      this.notifyDiagnostics();
      return null;
    }

    return {
      version,
      sessionId,
      frameType,
      packetId,
      senderId,
      seq,
      totalSeqs,
      payload,
      crc16: actualCrc
    };
  }

  // --- AudioContext Initialization ---
  private getOrCreateAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  // --- Transmitter: Audible 2-FSK Audio Synthesis ---
  public async transmitPacket(
    payloadText: string,
    frameType: AcousticFrame['frameType'] = 'DATA',
    packetId?: number
  ): Promise<number> {
    const pId = packetId || Math.floor(100000 + Math.random() * 899999);
    const frameBytes = this.encodeFrame(frameType, pId, payloadText);

    // Convert bytes to bit array
    const bits: number[] = [];
    for (let i = 0; i < frameBytes.length; i++) {
      for (let b = 7; b >= 0; b--) {
        bits.push((frameBytes[i] >> b) & 1);
      }
    }

    const ctx = this.getOrCreateAudioContext();
    this.state = 'TRANSMITTING';
    this.txStartTime = Date.now();

    // Sequence:
    // 1. Pilot tone (150ms at 1750 Hz)
    // 2. Alternating sync preamble (4 symbols: 1, 0, 1, 0)
    // 3. Start Frame Delimiter (100ms at 2300 Hz)
    // 4. Data Bits (symbolDurationMs per bit: 1 -> 2000 Hz, 0 -> 1500 Hz)
    // 5. End Frame Delimiter (80ms at 2500 Hz)

    const now = ctx.currentTime + 0.05;
    let scheduledTime = now;

    // Helper to schedule smooth tone
    const scheduleTone = (freq: number, durationSec: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.frequency.setValueAtTime(freq, scheduledTime);
      gain.gain.setValueAtTime(0.001, scheduledTime);
      // Gentle attack and decay to prevent speaker pop
      gain.gain.linearRampToValueAtTime(0.35, scheduledTime + 0.005);
      gain.gain.linearRampToValueAtTime(0.001, scheduledTime + durationSec - 0.002);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(scheduledTime);
      osc.stop(scheduledTime + durationSec);
      scheduledTime += durationSec;
    };

    // 1. Pilot
    scheduleTone(this.syncPilotFreq, 0.15);

    // 2. Alternating sync preamble
    const symSec = this.symbolDurationMs / 1000;
    scheduleTone(this.markFreq, symSec);
    scheduleTone(this.spaceFreq, symSec);
    scheduleTone(this.markFreq, symSec);
    scheduleTone(this.spaceFreq, symSec);

    // 3. SFD
    scheduleTone(this.sfdFreq, 0.09);

    // 4. Data bits
    for (const bit of bits) {
      const freq = bit === 1 ? this.markFreq : this.spaceFreq;
      scheduleTone(freq, symSec);
    }

    // 5. EFD
    scheduleTone(this.efdFreq, 0.08);

    const totalDurationMs = Math.round((scheduledTime - now) * 1000);
    this.diagnostics.txPackets++;
    this.notifyDiagnostics();

    // Await playback completion
    await new Promise(r => setTimeout(r, totalDurationMs + 50));

    if (frameType === 'DATA') {
      this.state = 'WAITING_ACK';
      this.pendingAckPacketId = pId;
      // Set timeout for ACK receipt
      clearTimeout(this.ackTimer);
      this.ackTimer = setTimeout(() => {
        if (this.pendingAckPacketId === pId) {
          this.diagnostics.ackFailureCount++;
          this.pendingAckPacketId = null;
          this.state = this.isListening ? 'LISTENING' : 'IDLE';
          this.notifyDiagnostics();
        }
      }, 4500);
    } else {
      this.state = this.isListening ? 'LISTENING' : 'IDLE';
    }

    return pId;
  }

  // --- Transmit Acoustic ACK ---
  public async transmitAck(targetPacketId: number): Promise<void> {
    await this.transmitPacket(`ACK:${targetPacketId}`, 'ACK', targetPacketId);
  }

  // --- Transmit Discovery Beacon ---
  public async transmitBeacon(): Promise<void> {
    await this.transmitPacket(`BEACON:${this.localNodeIdNum}`, 'BEACON');
  }

  // --- Receiver: Real-Time Microphone Capture & Tone Discriminator ---
  public async startListening(): Promise<boolean> {
    if (this.isListening) return true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      this.mediaStream = stream;
      const ctx = this.getOrCreateAudioContext();
      const source = ctx.createMediaStreamSource(stream);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048; // High bin resolution (~21.5 Hz per bin at 44.1kHz)
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);

      this.analyser = analyser;
      this.isListening = true;
      this.state = 'LISTENING';
      this.rxBuffer = [];
      this.rxState = 'SEARCHING_PREAMBLE';

      // Start continuous sampling loop
      this.startReceiverLoop();
      return true;
    } catch (err: any) {
      this.onErrorCallbacks.forEach(cb => cb(`Microphone error: ${err.message}`));
      return false;
    }
  }

  public stopListening(): void {
    this.isListening = false;
    this.state = 'IDLE';
    clearInterval(this.pollTimer);
    this.pollTimer = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }

    if (this.audioCtx && this.audioCtx.state === 'running') {
      try { this.audioCtx.suspend(); } catch {}
    }
  }

  // Frequency-to-FFT bin index
  private freqToBin(freq: number, sampleRate: number, fftSize: number): number {
    return Math.round((freq * fftSize) / sampleRate);
  }

  private startReceiverLoop() {
    if (!this.analyser || !this.audioCtx) return;

    const analyser = this.analyser;
    const sampleRate = this.audioCtx.sampleRate;
    const fftSize = analyser.fftSize;
    const freqData = new Float32Array(analyser.frequencyBinCount);

    const markBin = this.freqToBin(this.markFreq, sampleRate, fftSize);
    const spaceBin = this.freqToBin(this.spaceFreq, sampleRate, fftSize);
    const sfdBin = this.freqToBin(this.sfdFreq, sampleRate, fftSize);
    const efdBin = this.freqToBin(this.efdFreq, sampleRate, fftSize);
    const pilotBin = this.freqToBin(this.syncPilotFreq, sampleRate, fftSize);

    // Sample interval roughly half of symbol duration
    const pollInterval = Math.max(15, Math.floor(this.symbolDurationMs / 2));

    this.pollTimer = setInterval(() => {
      if (!this.isListening) return;

      analyser.getFloatFrequencyData(freqData);

      // Measure local peak energies in dB
      const markDb = freqData[markBin];
      const spaceDb = freqData[spaceBin];
      const sfdDb = freqData[sfdBin];
      const efdDb = freqData[efdBin];
      const pilotDb = freqData[pilotBin];

      // Measure baseline noise floor across wide band
      let sumNoise = 0;
      let noiseSamples = 0;
      for (let i = 20; i < 150; i += 10) {
        sumNoise += freqData[i];
        noiseSamples++;
      }
      const avgNoise = noiseSamples > 0 ? sumNoise / noiseSamples : -80;
      this.diagnostics.ambientNoiseDb = Math.round(avgNoise);

      const THRESHOLD_SNR = 12; // dB above ambient noise

      // Demodulation State Machine
      if (this.rxState === 'SEARCHING_PREAMBLE') {
        if (sfdDb - avgNoise > THRESHOLD_SNR && sfdDb > markDb + 3 && sfdDb > spaceDb + 3) {
          this.rxState = 'READING_BITS';
          this.rxBuffer = [];
          this.state = 'RECEIVING_FRAME';
          this.diagnostics.peakSignalDb = Math.round(sfdDb);
          this.diagnostics.currentCarrierFreq = this.sfdFreq;
          this.notifyDiagnostics();
        } else if (pilotDb - avgNoise > THRESHOLD_SNR) {
          this.diagnostics.currentCarrierFreq = this.syncPilotFreq;
        } else {
          this.diagnostics.currentCarrierFreq = null;
        }
      } else if (this.rxState === 'READING_BITS') {
        // Check for End Frame Delimiter
        if (efdDb - avgNoise > THRESHOLD_SNR && efdDb > markDb + 4 && efdDb > spaceDb + 4) {
          this.finishFrameReception();
          return;
        }

        // Compare Mark (2000Hz) vs Space (1500Hz)
        let detectedBit: number | null = null;
        if (markDb > spaceDb + 4 && markDb - avgNoise > THRESHOLD_SNR) {
          detectedBit = 1;
        } else if (spaceDb > markDb + 4 && spaceDb - avgNoise > THRESHOLD_SNR) {
          detectedBit = 0;
        }

        if (detectedBit !== null) {
          if (detectedBit === this.lastDetectedBit) {
            this.consecutiveSameBit++;
            // Oversampling protection: record bit once per symbol duration
            if (this.consecutiveSameBit === 2) {
              this.rxBuffer.push(detectedBit);
            }
          } else {
            this.lastDetectedBit = detectedBit;
            this.consecutiveSameBit = 1;
            this.rxBuffer.push(detectedBit);
          }
        }
      }
    }, pollInterval);
  }

  private finishFrameReception() {
    this.rxState = 'SEARCHING_PREAMBLE';
    this.state = 'LISTENING';

    // Convert raw bit buffer to byte array
    const byteCount = Math.floor(this.rxBuffer.length / 8);
    if (byteCount < 17) {
      // Incomplete or noisy frame
      this.rxBuffer = [];
      return;
    }

    const frameBytes = new Uint8Array(byteCount);
    for (let i = 0; i < byteCount; i++) {
      let byteVal = 0;
      for (let b = 0; b < 8; b++) {
        byteVal = (byteVal << 1) | this.rxBuffer[i * 8 + b];
      }
      frameBytes[i] = byteVal;
    }
    this.rxBuffer = [];

    const frame = this.decodeFrame(frameBytes);
    if (!frame) return;

    this.diagnostics.rxPackets++;
    const decoder = new TextDecoder();
    const rawText = decoder.decode(frame.payload);

    // Ignore self-transmissions if audio feedback occurred
    if (frame.senderId === this.localNodeIdNum) return;

    if (frame.frameType === 'ACK') {
      const ackTargetId = frame.packetId;
      if (this.pendingAckPacketId === ackTargetId) {
        clearTimeout(this.ackTimer);
        const latency = Date.now() - this.txStartTime;
        this.diagnostics.ackSuccessCount++;
        this.diagnostics.lastRoundTripMs = latency;
        this.pendingAckPacketId = null;
        this.onAckCallbacks.forEach(cb => cb(ackTargetId, latency));
        this.notifyDiagnostics();
      }
    } else if (frame.frameType === 'BEACON') {
      this.onBeaconCallbacks.forEach(cb => cb(frame.senderId));
    } else {
      // Normal DATA frame received
      this.onFrameCallbacks.forEach(cb => cb(frame, rawText));

      // Ingest into unified transport pipeline if the payload contains a WaylinePacket or emergency message
      try {
        if (rawText.trim().startsWith('{') && rawText.includes('"type"')) {
          const parsed = JSON.parse(rawText);
          if (parsed && parsed.id && parsed.type) {
            transport.processReceivedPacket(parsed as WaylinePacket);
          }
        }
      } catch {
        // Not a structured JSON packet; remains in acoustic lab frame log
      }

      // Automatic acoustic ACK response if enabled
      if (this.autoAck) {
        setTimeout(() => {
          this.transmitAck(frame.packetId);
        }, 150);
      }
    }
    this.notifyDiagnostics();
  }

  public destroy(): void {
    this.stopListening();
    clearTimeout(this.ackTimer);
    this.onFrameCallbacks.clear();
    this.onAckCallbacks.clear();
    this.onBeaconCallbacks.clear();
    this.onDiagnosticCallbacks.clear();
    this.onErrorCallbacks.clear();
  }
}
