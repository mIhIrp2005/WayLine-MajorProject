import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  ShieldAlert, 
  Users, 
  MessageSquare, 
  Wifi, 
  WifiOff, 
  CheckCircle2, 
  ArrowRight, 
  RefreshCw, 
  QrCode, 
  X 
} from 'lucide-react';
import QRCode from 'qrcode';
import { 
  TransportState, 
  DiscoveredPeer, 
  EmergencyIncident, 
  StoredMessage, 
  LocalIdentity 
} from '../types';
import { getCanonicalAppUrl } from '../services/config';
import { transport } from '../services/transport';

interface FieldDeskProps {
  identity: LocalIdentity;
  transportState: TransportState;
  peers: DiscoveredPeer[];
  incidents: EmergencyIncident[];
  messages: StoredMessage[];
  isOfflineReady: boolean;
  onOpenSos: () => void;
  onNavigateTab: (tab: any) => void;
  onRefreshDiscovery: () => void;
}

export const FieldDesk: React.FC<FieldDeskProps> = ({
  identity,
  transportState,
  peers,
  incidents,
  messages,
  isOfflineReady,
  onOpenSos,
  onNavigateTab,
  onRefreshDiscovery
}) => {
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [selectedUrlOverride, setSelectedUrlOverride] = useState('');
  const [showHotspotPrompt, setShowHotspotPrompt] = useState<boolean>(() => {
    try {
      return !sessionStorage.getItem('wayline_hotspot_prompt_dismissed');
    } catch {
      return true;
    }
  });

  const activeIncidents = incidents.filter(i => i.status === 'ACTIVE');
  const connectedPeers = peers.filter(p => p.status === 'CONNECTED');
  const recentMessages = messages.slice(-4).reverse();

  // Dynamic application URL: adapts to actual host IP, Wi-Fi hotspot, or manual selection
  const defaultAppUrl = getCanonicalAppUrl(transportState.listeningAddress);
  const canonicalAppUrl = selectedUrlOverride || defaultAppUrl;

  const isListeningValid = Boolean(
    transportState.listeningAddress && 
    !transportState.listeningAddress.includes('Awaiting') && 
    !transportState.listeningAddress.includes('unreachable') &&
    !transportState.listeningAddress.includes('Checking')
  );

  const localNodeUrl = isListeningValid ? `http://${transportState.listeningAddress}` : '';

  useEffect(() => {
    QRCode.toDataURL(canonicalAppUrl, { width: 220, margin: 1, color: { dark: '#292D29', light: '#F7F3E8' } })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error(err));
  }, [canonicalAppUrl]);

  return (
    <div>
      {/* Header Info */}
      <div className="page-header">
        <div className="page-title-group">
          <h1>Field Desk</h1>
          <p>
            Local emergency mesh status for{' '}
            <button
              type="button"
              onClick={() => onNavigateTab('settings')}
              title="Click to change your callsign / name"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontWeight: 800,
                color: 'var(--color-ink)',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 'inherit'
              }}
            >
              {identity.nodeName} ✎
            </button>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button 
            className="btn-tactile btn-sm"
            onClick={onRefreshDiscovery}
            title="Scan local subnet"
          >
            <RefreshCw size={14} />
            Scan Subnet
          </button>
          <button 
            className="btn-tactile btn-coral"
            onClick={onOpenSos}
          >
            <ShieldAlert size={18} />
            TRANSMIT SOS
          </button>
        </div>
      </div>

      {/* Extend Mesh Range Hotspot Prompt for Connecting Peers */}
      {showHotspotPrompt && (
        <div className="bento-card" style={{ marginBottom: 18, background: 'var(--color-yellow-tint)', padding: '12px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.4rem' }}>📶</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.88rem' }}>Extend Mesh Range</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--color-ink-muted)' }}>
                  Turn on your phone's Portable Hotspot so other devices can chain through you.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <a 
                href="intent:#Intent;action=android.settings.TETHER_SETTINGS;end" 
                className="btn-tactile btn-sm"
                style={{ background: 'var(--color-yellow)', textDecoration: 'none' }}
              >
                Open Hotspot Settings
              </a>
              <button 
                type="button"
                className="btn-tactile btn-sm"
                onClick={() => {
                  setShowHotspotPrompt(false);
                  try { sessionStorage.setItem('wayline_hotspot_prompt_dismissed', '1'); } catch {}
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bento Grid */}
      <div className="bento-grid">
        
        {/* Large Tile 1: Local Network Status (Span 7) */}
        <div className="bento-card col-span-7" style={{ minHeight: 240 }}>
          <div className="card-header">
            <span className="card-title">
              <Radio size={16} color="#EA644B" />
              LOCAL PEER TRANSPORT
            </span>
            <span className={`pill ${transportState.isCompanionConnected ? 'pill-green' : 'pill-yellow'}`}>
              {transportState.isCompanionConnected ? 'DAEMON ONLINE' : 'STANDALONE STORAGE'}
            </span>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div style={{ 
                width: 52, 
                height: 52, 
                borderRadius: 'var(--radius-md)', 
                background: transportState.peerCount > 0 ? 'var(--color-green-tint)' : 'var(--color-yellow-tint)',
                border: '2px solid var(--color-ink)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {transportState.peerCount > 0 ? (
                  <Wifi size={28} color="#73966A" />
                ) : (
                  <WifiOff size={28} color="#292D29" />
                )}
              </div>
              <div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900 }}>
                  {transportState.peerCount > 0 
                    ? `${transportState.peerCount} Active Peer${transportState.peerCount > 1 ? 's' : ''} Connected`
                    : 'No Nearby Peers in Range'}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--color-ink-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                  Transport: {transportState.activeTransport}
                </div>
              </div>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--color-ink-muted)' }}>
              {transportState.isCompanionConnected
                ? `Mesh active on ${transportState.listeningAddress}`
                : 'Offline standalone mode • Messages saved in IndexedDB'}
            </p>

            {transportState.isCompanionConnected ? (
              <div style={{ 
                marginTop: 10, 
                padding: '10px 14px', 
                background: '#FFFFFF', 
                border: '2px solid var(--color-ink)', 
                borderRadius: 'var(--radius-sm)',
                boxShadow: '1px 1px 0px var(--color-ink)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
                      SHARE / JOIN LINK:
                    </div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#EA644B', fontFamily: 'var(--font-mono)', marginTop: 2, wordBreak: 'break-all' }}>
                      {canonicalAppUrl}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn-tactile btn-sm"
                    onClick={() => setShowQrModal(true)}
                    style={{ background: 'var(--color-yellow)' }}
                  >
                    <QrCode size={15} />
                    Scan QR
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ 
                marginTop: 10, 
                padding: '10px 14px', 
                background: '#FFF9E6', 
                border: '2px solid var(--color-ink)', 
                borderRadius: 'var(--radius-sm)',
                boxShadow: '1px 1px 0px var(--color-ink)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-ink)' }}>
                      STANDALONE MODE (No host connected)
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-ink-muted)', marginTop: 2 }}>
                      {transportState.customHost ? `Target: ${transportState.customHost}` : 'Host not responding at browser origin.'}
                      {transportState.lastError ? ` (${transportState.lastError})` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-tactile btn-sm"
                      onClick={() => transport.autoDiscoverHost()}
                      disabled={transportState.isScanning}
                      style={{ background: 'var(--color-yellow)' }}
                      title="Probes common gateways and subnet for running node"
                    >
                      <RefreshCw size={13} className={transportState.isScanning ? 'spin' : ''} />
                      {transportState.isScanning ? 'Probing...' : 'Auto-Detect Host'}
                    </button>
                    <button
                      type="button"
                      className="btn-tactile btn-sm"
                      onClick={() => {
                        const input = prompt('Enter WAYLINE Host IP (e.g. 192.168.43.50):', transportState.customHost || '');
                        if (input !== null) transport.setHostOverride(input);
                      }}
                    >
                      Set Host IP
                    </button>
                    {transportState.customHost && (
                      <button
                        type="button"
                        className="btn-tactile btn-sm"
                        onClick={() => transport.setHostOverride(null)}
                        style={{ background: '#FFF' }}
                        title="Reset to browser default origin"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)' }}>
              Node ID: <code>{identity.nodeId}</code>
            </span>
            <button 
              className="btn-tactile btn-sm"
              onClick={() => onNavigateTab('nearby')}
            >
              Inspect Peers <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* Large Tile 2: SOS & Active Incident Hub (Span 5) */}
        <div className={`bento-card col-span-5 ${activeIncidents.length > 0 ? 'coral-tint' : ''}`} style={{ minHeight: 240 }}>
          <div className="card-header">
            <span className="card-title">
              <ShieldAlert size={16} color="#EA644B" />
              EMERGENCY BEACONS
            </span>
            {activeIncidents.length > 0 ? (
              <span className="pill pill-coral">{activeIncidents.length} ACTIVE</span>
            ) : (
              <span className="pill pill-green">ALL CLEAR</span>
            )}
          </div>

          <div style={{ flex: 1 }}>
            {activeIncidents.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {activeIncidents.slice(0, 2).map((inc) => (
                  <div key={inc.id} style={{ 
                    background: '#FFFFFF', 
                    padding: '10px 12px', 
                    borderRadius: 'var(--radius-md)', 
                    border: '1.5px solid var(--color-ink)' 
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 800 }}>
                      <span style={{ color: '#EA644B' }}>[{inc.category}]</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                        {new Date(inc.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inc.description}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, fontSize: '0.72rem', color: 'var(--color-ink-muted)' }}>
                      <span>From: {inc.senderName}</span>
                      <span className="pill pill-muted" style={{ padding: '1px 6px' }}>{inc.deliveryStatus}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: '16px 0' }}>
                <CheckCircle2 size={36} color="#73966A" style={{ marginBottom: 8 }} />
                <div style={{ fontWeight: 800, fontSize: '1rem' }}>No Active Local Distress Calls</div>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-ink-muted)', marginTop: 4 }}>
                  In an emergency, tap below to broadcast your situation to nearby peers.
                </p>
              </div>
            )}
          </div>

          <button 
            className="btn-tactile btn-coral"
            style={{ width: '100%', marginTop: 14 }}
            onClick={onOpenSos}
          >
            <ShieldAlert size={16} />
            ACTIVATE DISTRESS BEACON
          </button>
        </div>

        {/* Medium Tile 1: Messages Preview (Span 6) */}
        <div className="bento-card col-span-6" style={{ minHeight: 220 }}>
          <div className="card-header">
            <span className="card-title">
              <MessageSquare size={16} color="#A9CDE0" />
              RECENT LOCAL MESSAGES
            </span>
            <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
              {messages.length} Total
            </span>
          </div>

          <div style={{ flex: 1 }}>
            {recentMessages.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentMessages.map((m) => (
                  <div key={m.id} style={{ 
                    padding: '8px 10px', 
                    background: 'var(--color-paper)', 
                    border: '1px solid var(--color-border)', 
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontWeight: 800, color: 'var(--color-ink)' }}>{m.senderName}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
                        {m.status}
                      </span>
                    </div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-ink-muted)', fontSize: '0.85rem' }}>
                No messages yet. Send a local broadcast or direct dispatch.
              </div>
            )}
          </div>

          <button 
            className="btn-tactile btn-sm"
            style={{ alignSelf: 'flex-start', marginTop: 12 }}
            onClick={() => onNavigateTab('messages')}
          >
            Open Message Stream <ArrowRight size={14} />
          </button>
        </div>

        {/* Medium Tile 2: Nearby Peers (Span 6) */}
        <div className="bento-card col-span-6" style={{ minHeight: 220 }}>
          <div className="card-header">
            <span className="card-title">
              <Users size={16} color="#73966A" />
              NEARBY PEERS IN RANGE
            </span>
            <span className="pill pill-muted">
              {peers.length} Discovered
            </span>
          </div>

          <div style={{ flex: 1 }}>
            {peers.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {peers.map((p) => (
                  <div key={p.id} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    padding: '8px 10px', 
                    background: 'var(--color-paper)', 
                    border: '1px solid var(--color-ink)', 
                    borderRadius: 'var(--radius-sm)'
                  }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.85rem' }}>{p.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
                        {p.address} • {p.transport}
                      </div>
                    </div>
                    <span className={`pill ${p.status === 'CONNECTED' ? 'pill-green' : 'pill-yellow'}`} style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--color-ink-muted)', fontSize: '0.85rem' }}>
                <Users size={28} style={{ opacity: 0.4, marginBottom: 6 }} />
                <div>No devices currently discovered.</div>
                <div style={{ fontSize: '0.75rem', marginTop: 4 }}>
                  Ensure peer devices are on the same Wi-Fi or mobile hotspot.
                </div>
              </div>
            )}
          </div>

          <button 
            className="btn-tactile btn-sm"
            style={{ alignSelf: 'flex-start', marginTop: 12 }}
            onClick={() => onNavigateTab('nearby')}
          >
            View Network Topology <ArrowRight size={14} />
          </button>
        </div>

      </div>

      {/* QR Code Phone Scanner Modal */}
      {showQrModal && (
        <div className="modal-overlay" onClick={() => setShowQrModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', maxWidth: 380 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 900 }}>Scan Dynamic Mesh Link</h3>
              <button onClick={() => setShowQrModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-ink-muted)', marginBottom: 14 }}>
              Scan with your phone's camera on the shared Wi-Fi / hotspot to join and cache WAYLINE.
            </p>
            {qrDataUrl && (
              <div style={{ 
                background: '#F7F3E8', 
                padding: 12, 
                borderRadius: 8, 
                border: '2px solid #292D29', 
                display: 'inline-block',
                boxShadow: 'var(--shadow-tactile)'
              }}>
                <img src={qrDataUrl} alt="Application QR Code" style={{ width: 220, height: 220, display: 'block' }} />
              </div>
            )}
            <div style={{ marginTop: 14, fontSize: '0.95rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#EA644B', wordBreak: 'break-all' }}>
              {canonicalAppUrl}
            </div>

            {transportState.availableInterfaces && transportState.availableInterfaces.length > 1 && (
              <div style={{ marginTop: 12, textAlign: 'left' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-ink-muted)', marginBottom: 4 }}>
                  DETECTED ADAPTERS (click to switch):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {transportState.availableInterfaces.map(iface => (
                    <button
                      key={iface.ip}
                      type="button"
                      onClick={() => setSelectedUrlOverride(iface.url)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        fontFamily: 'var(--font-mono)',
                        border: '1.5px solid var(--color-ink)',
                        borderRadius: 4,
                        background: canonicalAppUrl === iface.url ? 'var(--color-yellow)' : '#FFF',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <strong>{iface.name}:</strong> {iface.url}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
