import React, { useState } from 'react';
import { 
  Settings, 
  HardDrive, 
  CheckCircle2, 
  Trash2, 
  User, 
  Radio, 
  ShieldCheck, 
  AlertTriangle,
  Info,
  Volume2
} from 'lucide-react';
import { LocalIdentity, TransportState } from '../types';
import { storage } from '../services/storage';

interface SettingsViewProps {
  identity: LocalIdentity;
  transportState: TransportState;
  isOfflineReady: boolean;
  onIdentityUpdated: (newIdentity: LocalIdentity) => void;
  onDataCleared: () => void;
  onOpenAcousticLab?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  identity,
  transportState,
  isOfflineReady,
  onIdentityUpdated,
  onDataCleared,
  onOpenAcousticLab
}) => {
  const [nodeName, setNodeName] = useState(identity.nodeName);
  const [isSavingName, setIsSavingName] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nodeName.trim()) return;
    setIsSavingName(true);
    try {
      const updated = await storage.updateIdentityName(nodeName.trim());
      onIdentityUpdated(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleClearData = async () => {
    if (window.confirm('Wipe all local IndexedDB messages, incidents, and peers from this device?')) {
      await storage.clearAllData();
      onDataCleared();
      alert('Local storage cleared successfully.');
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-title-group">
          <h1>Node Diagnostics & Settings</h1>
          <p>Local identity, offline cache status, and disaster network limitations</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        
        {/* Node Identity Card */}
        <div className="bento-card">
          <div className="card-header">
            <span className="card-title">
              <User size={16} />
              NODE IDENTITY
            </span>
          </div>

          <form onSubmit={handleSaveName}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                DISPLAY CALLSIGN / DEVICE NAME
              </label>
              <input
                type="text"
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '2px solid var(--color-ink)',
                  background: 'var(--color-paper)',
                  fontSize: '0.95rem',
                  fontWeight: 700
                }}
              />
            </div>

            <div style={{ marginBottom: 16, fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
              Unique Node Hash: <code>{identity.nodeId}</code>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="submit"
                className="btn-tactile btn-sm"
                disabled={isSavingName}
              >
                {isSavingName ? 'Saving...' : 'Update Callsign'}
              </button>
              {saveSuccess && (
                <span style={{ fontSize: '0.78rem', color: '#73966A', fontWeight: 700 }}>
                  Saved!
                </span>
              )}
            </div>
          </form>
        </div>

        {/* PWA & Cache Status */}
        <div className="bento-card blue-tint">
          <div className="card-header">
            <span className="card-title">
              <HardDrive size={16} />
              OFFLINE CACHE INSPECTION
            </span>
            <span className={`pill ${isOfflineReady ? 'pill-green' : 'pill-yellow'}`}>
              {isOfflineReady ? 'CACHE VERIFIED' : 'UNVERIFIED'}
            </span>
          </div>

          <p style={{ fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--color-ink)' }}>
            Service Worker precaches HTML, JS, CSS, and application manifests. Once loaded, WAYLINE reopens completely offline without reaching an internet server.
          </p>

          <div style={{ 
            marginTop: 14, 
            padding: '10px 12px', 
            background: 'var(--color-paper-card)', 
            border: '1.5px solid var(--color-ink)', 
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.78rem',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            <div>Status: {isOfflineReady ? '100% Precached & Ready' : 'Service worker registering...'}</div>
            <div>Canonical PWA URL: <code>{((import.meta as any).env?.VITE_PUBLIC_APP_URL as string) || (typeof window !== 'undefined' ? window.location.origin : 'N/A')}</code></div>
            <div>Secure Context: {typeof window !== 'undefined' && window.isSecureContext ? '✓ Enabled (HTTPS / localhost)' : '⚠ Insecure origin (Microphone blocked by Chrome)'}</div>
            <div>Local Node Adapter: {transportState.isCompanionConnected ? transportState.listeningAddress : 'Offline / Standalone'}</div>
            <div>Storage Engine: HTML5 IndexedDB (wayline_offline_db)</div>
            <div>Cache Name: wayline-cache-v1</div>
          </div>
        </div>

        {/* Transparent System Limitations Card */}
        <div className="bento-card col-span-12 yellow-tint">
          <div className="card-header">
            <span className="card-title">
              <AlertTriangle size={16} color="#292D29" />
              DISASTER RESILIENCE TRANSPARENCY & LIMITATIONS
            </span>
            <span className="pill pill-muted">ENGINEERING AUDIT</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, fontSize: '0.85rem', lineHeight: 1.5 }}>
            <div>
              <strong style={{ display: 'block', marginBottom: 4 }}>No Central Gateway Guarantee</strong>
              WAYLINE operates over direct local Wi-Fi / hotspot subnet broadcasts (UDP:8766 + WS:8765). Messages reach only devices within local radio/LAN range unless an internet gateway is present.
            </div>

            <div>
              <strong style={{ display: 'block', marginBottom: 4 }}>Emergency Services Notice</strong>
              Broadcasting SOS notifies nearby WAYLINE peers only. It does <em>not</em> place automated calls to 911 or dispatch official emergency teams without an authorized local responder.
            </div>

            <div>
              <strong style={{ display: 'block', marginBottom: 4 }}>Multi-Hop Relay Rules</strong>
              Packets have a TTL of 3 hops. Duplicate detection prevents network loops. Malformed or oversized payloads are rejected at the protocol layer.
            </div>
          </div>
        </div>

        {/* Experimental Acoustic Lab Navigation Card */}
        {onOpenAcousticLab && (
          <div className="bento-card col-span-12">
            <div className="card-header">
              <span className="card-title">
                <Volume2 size={16} color="#EA644B" />
                ACOUSTIC COMMUNICATION TESTING FACILITY
              </span>
              <span className="pill pill-yellow">EXPERIMENTAL</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-ink-muted)', maxWidth: 540 }}>
                Test speaker-to-microphone data transfers, audible 2-FSK modulation, round-trip acoustic ACKs, and discovery beacons across two physical devices without network connectivity.
              </p>
              <button
                className="btn-tactile btn-sm"
                onClick={onOpenAcousticLab}
              >
                <Volume2 size={14} />
                Open Acoustic Lab
              </button>
            </div>
          </div>
        )}

        {/* Danger Zone: Clear Local Data */}
        <div className="bento-card col-span-12" style={{ borderStyle: 'dashed' }}>
          <div className="card-header">
            <span className="card-title" style={{ color: '#EA644B' }}>
              <Trash2 size={16} color="#EA644B" />
              LOCAL DATA MANAGEMENT
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-ink-muted)', maxWidth: 500 }}>
              Wipe locally stored emergency records, messages, and peer history from this browser's IndexedDB.
            </p>

            <button
              className="btn-tactile btn-sm"
              style={{ color: '#EA644B' }}
              onClick={handleClearData}
            >
              <Trash2 size={14} />
              Wipe Local Storage
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
