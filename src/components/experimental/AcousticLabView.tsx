import React, { useState, useEffect, useRef } from 'react';
import { 
  Radio, 
  Volume2, 
  Mic, 
  MicOff, 
  Play, 
  Square, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Activity, 
  ShieldAlert, 
  RefreshCw, 
  ArrowRight,
  Database,
  Info,
  Sliders,
  Send,
  Zap,
  RotateCcw
} from 'lucide-react';
import { AcousticModem, AcousticFrame } from '../../services/experimental/acousticModem';
import { acousticStorage, AcousticTestLog, AcousticEndpoint } from '../../services/experimental/acousticStorage';

interface AcousticLabViewProps {
  localNodeName: string;
}

export const AcousticLabView: React.FC<AcousticLabViewProps> = ({ localNodeName }) => {
  const modemRef = useRef<AcousticModem | null>(null);

  // Status & Permission states
  const [isSecureContext, setIsSecureContext] = useState(typeof window !== 'undefined' ? window.isSecureContext : false);
  const [micPermissionState, setMicPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'unknown'>('unknown');
  const [audioCtxState, setAudioCtxState] = useState<string>('suspended');
  const [isListening, setIsListening] = useState(false);
  const [modemState, setModemState] = useState<string>('IDLE');

  // Transmitter state
  const [testPayload, setTestPayload] = useState('WAYLINE_SOUND_TEST_01');
  const [symbolDuration, setSymbolDuration] = useState(45);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [lastTxDurationMs, setLastTxDurationMs] = useState<number | null>(null);

  // Receiver state
  const [lastDecodedPacket, setLastDecodedPacket] = useState<{ frame: AcousticFrame; text: string; time: number } | null>(null);
  const [autoAckEnabled, setAutoAckEnabled] = useState(true);

  // Round-trip test state
  const [roundTripState, setRoundTripState] = useState<'IDLE' | 'TRANSMITTING' | 'WAITING_ACK' | 'ACKNOWLEDGED' | 'TIMEOUT'>('IDLE');
  const [roundTripLatencyMs, setRoundTripLatencyMs] = useState<number | null>(null);

  // Discovery state
  const [detectedEndpoints, setDetectedEndpoints] = useState<AcousticEndpoint[]>([]);
  const [isBeaconing, setIsBeaconing] = useState(false);

  // Multi-Device Relay state
  const [relayHopLog, setRelayHopLog] = useState<{ hop: number; sender: string; time: number; text: string }[]>([]);

  // Logs & Diagnostics
  const [testLogs, setTestLogs] = useState<AcousticTestLog[]>([]);
  const [diagnostics, setDiagnostics] = useState({
    txPackets: 0,
    rxPackets: 0,
    corruptedFrames: 0,
    ackSuccessCount: 0,
    ackFailureCount: 0,
    lastRoundTripMs: null as number | null,
    ambientNoiseDb: -90,
    peakSignalDb: -90,
    currentCarrierFreq: null as number | null
  });

  // Initialize Modem
  useEffect(() => {
    const modem = new AcousticModem();
    modemRef.current = modem;

    // Check mic permission status
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' as any }).then(status => {
        setMicPermissionState(status.state);
        status.onchange = () => setMicPermissionState(status.state);
      }).catch(() => {});
    }

    // Load initial isolated lab logs & endpoints
    acousticStorage.getRecentLogs().then(logs => setTestLogs(logs));
    acousticStorage.getAllEndpoints().then(eps => setDetectedEndpoints(eps));

    // Subscribe to modem events
    const unsubFrame = modem.onFrame(async (frame, rawText) => {
      const now = Date.now();
      setLastDecodedPacket({ frame, text: rawText, time: now });

      const log: AcousticTestLog = {
        id: `rx_${now}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: now,
        direction: 'RX',
        frameType: frame.frameType,
        packetId: String(frame.packetId),
        senderId: String(frame.senderId),
        payload: rawText,
        status: 'SUCCESS'
      };
      await acousticStorage.saveLog(log);
      setTestLogs(prev => [log, ...prev.slice(0, 49)]);

      // If Relay packet, record relay hop
      if (frame.frameType === 'RELAY') {
        setRelayHopLog(prev => [{
          hop: prev.length + 1,
          sender: `Node #${frame.senderId}`,
          time: now,
          text: rawText
        }, ...prev]);
      }
    });

    const unsubAck = async (packetId: number, latency: number) => {
      setRoundTripState('ACKNOWLEDGED');
      setRoundTripLatencyMs(latency);

      const log: AcousticTestLog = {
        id: `ack_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        direction: 'RX',
        frameType: 'ACK',
        packetId: String(packetId),
        senderId: 'PEER',
        payload: `ACK received (${latency}ms round-trip)`,
        status: 'SUCCESS',
        durationMs: latency
      };
      await acousticStorage.saveLog(log);
      setTestLogs(prev => [log, ...prev.slice(0, 49)]);
    };
    const unsubAckRef = modem.onAck(unsubAck);

    const unsubBeacon = async (senderId: number) => {
      const ep: AcousticEndpoint = {
        nodeId: `Acoustic_Node_${senderId}`,
        lastSeen: Date.now(),
        lastSequence: 1
      };
      await acousticStorage.saveEndpoint(ep);
      const all = await acousticStorage.getAllEndpoints();
      setDetectedEndpoints(all);
    };
    const unsubBeaconRef = modem.onBeacon(unsubBeacon);

    const unsubDiag = modem.onDiagnostics(() => {
      setDiagnostics({ ...modem.diagnostics });
      setModemState(modem.state);
      setIsListening(modem.isListening);
    });

    return () => {
      unsubFrame();
      unsubAckRef();
      unsubBeaconRef();
      unsubDiag();
      modem.destroy();
    };
  }, []);

  // --- Controls ---
  const handleToggleListening = async () => {
    const modem = modemRef.current;
    if (!modem) return;

    if (modem.isListening) {
      modem.stopListening();
      setIsListening(false);
      setModemState('IDLE');
    } else {
      const ok = await modem.startListening();
      if (ok) {
        setIsListening(true);
        setMicPermissionState('granted');
        setModemState('LISTENING');
      } else {
        setMicPermissionState('denied');
      }
    }
  };

  const handleTransmitTestPacket = async () => {
    const modem = modemRef.current;
    if (!modem || isTransmitting) return;

    setIsTransmitting(true);
    setModemState('TRANSMITTING');
    const start = Date.now();

    try {
      modem.symbolDurationMs = symbolDuration;
      const packetId = await modem.transmitPacket(testPayload, 'DATA');
      const duration = Date.now() - start;
      setLastTxDurationMs(duration);

      const log: AcousticTestLog = {
        id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        direction: 'TX',
        frameType: 'DATA',
        packetId: String(packetId),
        senderId: String(modem.localNodeIdNum),
        payload: testPayload,
        status: 'SUCCESS',
        durationMs: duration
      };
      await acousticStorage.saveLog(log);
      setTestLogs(prev => [log, ...prev.slice(0, 49)]);
    } catch (e) {
      console.error(e);
    } finally {
      setIsTransmitting(false);
      setModemState(modem.isListening ? 'LISTENING' : 'IDLE');
    }
  };

  const handleRunRoundTripTest = async () => {
    const modem = modemRef.current;
    if (!modem || isTransmitting) return;

    setRoundTripState('TRANSMITTING');
    setRoundTripLatencyMs(null);
    setIsTransmitting(true);

    try {
      modem.symbolDurationMs = symbolDuration;
      const testMsg = `RTT_PING_${Date.now() % 10000}`;
      await modem.transmitPacket(testMsg, 'DATA');
      setRoundTripState('WAITING_ACK');

      // 4.5s ACK timeout
      setTimeout(() => {
        setRoundTripState((current) => current === 'WAITING_ACK' ? 'TIMEOUT' : current);
      }, 4500);
    } catch (e) {
      setRoundTripState('TIMEOUT');
    } finally {
      setIsTransmitting(false);
    }
  };

  const handleEmitDiscoveryBeacon = async () => {
    const modem = modemRef.current;
    if (!modem || isBeaconing) return;
    setIsBeaconing(true);
    try {
      await modem.transmitBeacon();
    } finally {
      setIsBeaconing(false);
    }
  };

  const handleClearTestLogs = async () => {
    if (window.confirm('Clear all experimental acoustic test logs and discovered endpoints? (Does not affect production chat or incidents)')) {
      await acousticStorage.clearLabData();
      setTestLogs([]);
      setDetectedEndpoints([]);
      setRelayHopLog([]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div className="page-header">
        <div className="page-title-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>ACOUSTIC LAB — EXPERIMENTAL</h1>
            <span className="pill pill-coral" style={{ fontWeight: 800 }}>SANDBOXED</span>
          </div>
          <p>Audible 2-FSK acoustic modem testing facility for zero-network speaker-to-microphone data exchange</p>
        </div>
      </div>

      {/* Mandatory Safety Warning Banner */}
      <div style={{
        background: 'var(--color-yellow-tint)',
        border: '2px solid var(--color-ink)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: 'var(--shadow-tactile)'
      }}>
        <AlertTriangle size={24} color="#EA644B" style={{ flexShrink: 0 }} />
        <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
          <strong>Experimental acoustic transport. Not validated for emergency or life-safety communication.</strong>
          <div style={{ color: 'var(--color-ink-muted)', marginTop: 2 }}>
            This laboratory operates on an independent test namespace (<code>wayline_acoustic_lab_db</code>). Transmissions and tests here cannot alter production messages, incidents, or delivery states.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        
        {/* Card A: Device, Secure Context & Hardware Status */}
        <div className="bento-card blue-tint">
          <div className="card-header">
            <span className="card-title">
              <Activity size={16} />
              A. DEVICE & PERMISSION STATUS
            </span>
            <span className={`pill ${isListening ? 'pill-green' : 'pill-muted'}`}>
              {modemState}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--color-border)', paddingBottom: 6 }}>
              <span>Secure Context (HTTPS / localhost):</span>
              <strong>{isSecureContext ? '✓ Enabled' : '⚠ Insecure (Chrome blocks mic)'}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--color-border)', paddingBottom: 6 }}>
              <span>Microphone Permission:</span>
              <strong style={{ textTransform: 'uppercase' }}>{micPermissionState}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--color-border)', paddingBottom: 6 }}>
              <span>Receiver State:</span>
              <strong>{isListening ? 'Capturing Audio Samples' : 'Microphone Inactive'}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--color-border)', paddingBottom: 6 }}>
              <span>Modulation Profile:</span>
              <span>2-FSK (2000Hz Mark / 1500Hz Space)</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 2 }}>
              <span>Symbol Duration:</span>
              <span>{symbolDuration} ms (~{Math.round(1000 / symbolDuration)} baud)</span>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <button
              className={`btn-tactile ${isListening ? 'btn-coral' : 'btn-green'}`}
              style={{ width: '100%' }}
              onClick={handleToggleListening}
            >
              {isListening ? <Square size={16} /> : <Mic size={16} />}
              {isListening ? 'Stop Microphone Listener' : 'Start Microphone Listener'}
            </button>
          </div>
        </div>

        {/* Card B: Acoustic Transmitter */}
        <div className="bento-card">
          <div className="card-header">
            <span className="card-title">
              <Volume2 size={16} color="#EA644B" />
              B. TRANSMITTER CONTROLS
            </span>
            {isTransmitting && <span className="pill pill-coral">PLAYING TONES</span>}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
              TEST PAYLOAD (MAX 48 CHARS):
            </label>
            <input
              type="text"
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
              maxLength={48}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '2px solid var(--color-ink)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-paper)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.88rem'
              }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
              <span>SYMBOL TIMING (SPEED VS ROBUSTNESS):</span>
              <span>{symbolDuration} ms</span>
            </label>
            <input
              type="range"
              min={30}
              max={80}
              step={5}
              value={symbolDuration}
              onChange={(e) => setSymbolDuration(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, fontSize: '0.78rem', fontFamily: 'var(--font-mono)' }}>
            <span>Last Tx Time: {lastTxDurationMs ? `${lastTxDurationMs}ms` : 'None'}</span>
            <span>Est. Rate: ~{Math.round(1000 / (symbolDuration * 8))} B/s</span>
          </div>

          <button
            className="btn-tactile btn-coral"
            style={{ width: '100%' }}
            disabled={isTransmitting || !testPayload.trim()}
            onClick={handleTransmitTestPacket}
          >
            <Play size={16} />
            {isTransmitting ? 'Emitting Audio Frequencies...' : 'Transmit Test Packet (Speaker)'}
          </button>
        </div>

        {/* Card C: Receiver & Signal Analysis */}
        <div className="bento-card">
          <div className="card-header">
            <span className="card-title">
              <Mic size={16} color="#73966A" />
              C. RECEIVER & DECODER
            </span>
            <span className={`pill ${isListening ? 'pill-green' : 'pill-yellow'}`}>
              {isListening ? 'LISTENING' : 'OFF'}
            </span>
          </div>

          {/* Signal Level / Noise Spectrum Indicator */}
          <div style={{ 
            background: 'var(--color-paper-dark)', 
            border: '1.5px solid var(--color-ink)', 
            borderRadius: 'var(--radius-sm)', 
            padding: 10, 
            marginBottom: 14 
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
              <span>Ambient Noise: {diagnostics.ambientNoiseDb} dB</span>
              <span>Peak Carrier: {diagnostics.currentCarrierFreq ? `${diagnostics.currentCarrierFreq} Hz` : 'Quiet'}</span>
            </div>
            <div style={{ 
              height: 12, 
              background: '#FFFFFF', 
              border: '1px solid var(--color-ink)', 
              borderRadius: 4, 
              overflow: 'hidden' 
            }}>
              <div style={{ 
                height: '100%', 
                width: `${Math.min(100, Math.max(5, (diagnostics.ambientNoiseDb + 100) * 2))}%`, 
                background: diagnostics.currentCarrierFreq ? '#73966A' : '#5E635C',
                transition: 'width 0.1s linear'
              }} />
            </div>
          </div>

          {/* Last Decoded Packet Details */}
          <div style={{ minHeight: 90 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
              LAST DECODED ACOUSTIC PACKET:
            </div>
            {lastDecodedPacket ? (
              <div style={{ 
                background: '#FFFFFF', 
                border: '1.5px solid var(--color-ink)', 
                borderRadius: 'var(--radius-sm)', 
                padding: '8px 10px', 
                fontSize: '0.82rem',
                fontFamily: 'var(--font-mono)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#73966A', fontWeight: 800 }}>
                  <span>[{lastDecodedPacket.frame.frameType}] ID: {lastDecodedPacket.frame.packetId}</span>
                  <span>CRC: 0x{lastDecodedPacket.frame.crc16.toString(16)} (OK)</span>
                </div>
                <div style={{ fontWeight: 900, marginTop: 4, color: 'var(--color-ink)' }}>
                  "{lastDecodedPacket.text}"
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-ink-muted)', marginTop: 4 }}>
                  From: Node #{lastDecodedPacket.frame.senderId} • Received at {new Date(lastDecodedPacket.time).toLocaleTimeString()}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '0.8rem', color: 'var(--color-ink-muted)' }}>
                {isListening ? 'Awaiting acoustic carrier lock (start transmitter on other phone)...' : 'Start listener to decode incoming sound waves.'}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <input
              type="checkbox"
              id="auto-ack-toggle"
              checked={autoAckEnabled}
              onChange={(e) => {
                setAutoAckEnabled(e.target.checked);
                if (modemRef.current) modemRef.current.autoAck = e.target.checked;
              }}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="auto-ack-toggle" style={{ fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
              Automatic Acoustic ACK (Respond with confirmation tone)
            </label>
          </div>
        </div>

        {/* Card D: Genuine Round-Trip Acknowledgment Test */}
        <div className="bento-card yellow-tint">
          <div className="card-header">
            <span className="card-title">
              <RotateCcw size={16} />
              D. ROUND-TRIP ACK TEST
            </span>
            <span className={`pill ${roundTripState === 'ACKNOWLEDGED' ? 'pill-green' : roundTripState === 'TIMEOUT' ? 'pill-coral' : 'pill-muted'}`}>
              {roundTripState}
            </span>
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--color-ink)', lineHeight: 1.4, marginBottom: 12 }}>
            Executes a full two-way verification: Phone A emits test packet → Phone B decodes &amp; returns acoustic ACK → Phone A validates ACK.
          </p>

          <div style={{ 
            background: 'var(--color-paper-card)', 
            border: '1.5px solid var(--color-ink)', 
            borderRadius: 'var(--radius-sm)', 
            padding: '10px 12px', 
            marginBottom: 16,
            fontSize: '0.8rem',
            fontFamily: 'var(--font-mono)'
          }}>
            <div>Status: <strong>{roundTripState}</strong></div>
            <div>Round-Trip Latency: <strong>{roundTripLatencyMs ? `${roundTripLatencyMs} ms` : 'N/A'}</strong></div>
            <div>ACK Confirmed Count: <strong>{diagnostics.ackSuccessCount}</strong></div>
          </div>

          <button
            className="btn-tactile btn-yellow"
            style={{ width: '100%' }}
            disabled={isTransmitting || roundTripState === 'TRANSMITTING' || roundTripState === 'WAITING_ACK'}
            onClick={handleRunRoundTripTest}
          >
            <Zap size={16} />
            {roundTripState === 'WAITING_ACK' ? 'Listening for Acoustic ACK...' : 'Execute Full Round-Trip Test'}
          </button>
        </div>

        {/* Card E: Discovery Beaconing */}
        <div className="bento-card">
          <div className="card-header">
            <span className="card-title">
              <Radio size={16} color="#73966A" />
              E. ACOUSTIC DISCOVERY EXPERIMENT
            </span>
            <span className="pill pill-muted">{detectedEndpoints.length} DETECTED</span>
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--color-ink-muted)', marginBottom: 12 }}>
            Emits a short acoustic beacon frame. Nearby phones listening will register this test node.
          </p>

          <button
            className="btn-tactile btn-sm"
            style={{ width: '100%', marginBottom: 14 }}
            disabled={isBeaconing || isTransmitting}
            onClick={handleEmitDiscoveryBeacon}
          >
            <Radio size={14} />
            {isBeaconing ? 'Broadcasting Beacon...' : 'Emit Discovery Beacon Tone'}
          </button>

          <div style={{ fontSize: '0.78rem', fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
            ACOUSTICALLY DETECTED ENDPOINTS:
          </div>

          {detectedEndpoints.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--color-ink-muted)', padding: '8px 0', textAlign: 'center' }}>
              No endpoints heard yet. Start receiver and emit beacon from another phone.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {detectedEndpoints.map(ep => (
                <div key={ep.nodeId} style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  padding: '6px 8px', 
                  background: 'var(--color-paper)', 
                  border: '1px solid var(--color-ink)', 
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.78rem',
                  fontFamily: 'var(--font-mono)'
                }}>
                  <span>{ep.nodeId}</span>
                  <span style={{ color: 'var(--color-ink-muted)' }}>Heard {Math.round((Date.now() - ep.lastSeen) / 1000)}s ago</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Card F: Diagnostics & Metrics */}
        <div className="bento-card">
          <div className="card-header">
            <span className="card-title">
              <Sliders size={16} />
              F. SCIENTIFIC DIAGNOSTICS
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
            <div style={{ background: 'var(--color-paper-card)', border: '1px solid var(--color-ink)', padding: 8, borderRadius: 4 }}>
              <div style={{ color: 'var(--color-ink-muted)', fontSize: '0.7rem' }}>PACKETS SENT (TX)</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 900 }}>{diagnostics.txPackets}</div>
            </div>

            <div style={{ background: 'var(--color-paper-card)', border: '1px solid var(--color-ink)', padding: 8, borderRadius: 4 }}>
              <div style={{ color: 'var(--color-ink-muted)', fontSize: '0.7rem' }}>PACKETS DECODED (RX)</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#73966A' }}>{diagnostics.rxPackets}</div>
            </div>

            <div style={{ background: 'var(--color-paper-card)', border: '1px solid var(--color-ink)', padding: 8, borderRadius: 4 }}>
              <div style={{ color: 'var(--color-ink-muted)', fontSize: '0.7rem' }}>CRC FAILURES</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 900, color: diagnostics.corruptedFrames > 0 ? '#EA644B' : 'inherit' }}>
                {diagnostics.corruptedFrames}
              </div>
            </div>

            <div style={{ background: 'var(--color-paper-card)', border: '1px solid var(--color-ink)', padding: 8, borderRadius: 4 }}>
              <div style={{ color: 'var(--color-ink-muted)', fontSize: '0.7rem' }}>ACK SUCCESS / FAIL</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 900 }}>
                {diagnostics.ackSuccessCount} / {diagnostics.ackFailureCount}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-ink-muted)' }}>
              Isolated DB: wayline_acoustic_lab_db
            </span>
            <button className="btn-tactile btn-sm" onClick={handleClearTestLogs}>
              Reset Lab Data
            </button>
          </div>
        </div>

      </div>

      {/* Card G: Experimental Multi-Device Relay Hop Stream */}
      <div className="bento-card col-span-12">
        <div className="card-header">
          <span className="card-title">
            <Radio size={16} color="#A9CDE0" />
            G. MULTI-DEVICE ACOUSTIC RELAY EXPERIMENT (3-PHONE TOPOLOGY)
          </span>
          <span className="pill pill-muted">{relayHopLog.length} RELAY HOPS</span>
        </div>

        <p style={{ fontSize: '0.82rem', color: 'var(--color-ink-muted)', marginBottom: 12 }}>
          Demonstrates packet hop progression across acoustic links (Phone A → Phone B → Phone C) with bounded duplicate caching.
        </p>

        {relayHopLog.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '0.82rem', color: 'var(--color-ink-muted)' }}>
            No relay packets logged. Transmit with RELAY frame type on Phone A to test multi-hop acoustic forwarding.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {relayHopLog.map((hop, idx) => (
              <div key={idx} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '8px 12px', 
                background: 'var(--color-paper-card)', 
                border: '1px solid var(--color-ink)', 
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                fontFamily: 'var(--font-mono)'
              }}>
                <span><strong>Hop {hop.hop}:</strong> {hop.sender} forwarded "{hop.text}"</span>
                <span style={{ color: 'var(--color-ink-muted)' }}>{new Date(hop.time).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Experimental Audit Log */}
      <div className="bento-card col-span-12">
        <div className="card-header">
          <span className="card-title">
            <Database size={16} />
            ACOUSTIC LAB TRANSMISSION & RECEPTION LOG ({testLogs.length})
          </span>
        </div>

        {testLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-ink-muted)', fontSize: '0.85rem' }}>
            No test events recorded yet in this session.
          </div>
        ) : (
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {testLogs.map(log => (
              <div key={log.id} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '6px 10px', 
                background: 'var(--color-paper)', 
                border: '1px solid var(--color-border)', 
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.78rem',
                fontFamily: 'var(--font-mono)'
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className={`pill ${log.direction === 'TX' ? 'pill-coral' : 'pill-green'}`} style={{ padding: '1px 6px', fontSize: '0.68rem' }}>
                    {log.direction} {log.frameType}
                  </span>
                  <span><strong>[{log.packetId}]</strong> {log.payload}</span>
                </div>
                <div style={{ color: 'var(--color-ink-muted)', fontSize: '0.72rem' }}>
                  {new Date(log.timestamp).toLocaleTimeString()} {log.durationMs ? `(${log.durationMs}ms)` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
