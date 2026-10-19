import React, { useState } from 'react';
import { 
  Users, 
  Wifi, 
  WifiOff, 
  Radio, 
  RefreshCw, 
  ShieldCheck, 
  Clock, 
  Network,
  Zap,
  Info
} from 'lucide-react';
import { DiscoveredPeer, TransportState, LocalIdentity } from '../types';
import { transport } from '../services/transport';

interface NearbyViewProps {
  identity: LocalIdentity;
  transportState: TransportState;
  peers: DiscoveredPeer[];
  onRefreshDiscovery: () => void;
}

export const NearbyView: React.FC<NearbyViewProps> = ({
  identity,
  transportState,
  peers,
  onRefreshDiscovery
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    onRefreshDiscovery();
    setTimeout(() => setIsRefreshing(false), 1500);
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-title-group">
          <h1>Nearby Discovery</h1>
          <p>Real-time UDP beaconing and LAN mesh node directory</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button 
            className="btn-tactile"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw size={16} className={isRefreshing ? 'spin' : ''} />
            {isRefreshing ? 'Broadcasting...' : 'Broadcast Beacon'}
          </button>
        </div>
      </div>

      {/* Network Architecture Card */}
      <div className="bento-card" style={{ marginBottom: 20, background: 'var(--color-blue-tint)' }}>
        <div className="card-header">
          <span className="card-title">
            <Network size={16} color="#292D29" />
            GENUINE TRANSPORT ENGINE STATUS
          </span>
          <span className={`pill ${transportState.isCompanionConnected ? 'pill-green' : 'pill-yellow'}`}>
            {transportState.isCompanionConnected ? 'UDP LAN ADAPTER ACTIVE' : 'LOCAL ONLY'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
              LOCAL NODE
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 900, marginTop: 2 }}>{identity.nodeName}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
              ID: {identity.nodeId}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
              NETWORK INTERFACE
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 900, marginTop: 2 }}>
              {transportState.isCompanionConnected ? transportState.listeningAddress : 'Offline / Standalone'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
              UDP Broadcast: 255.255.255.255:8766
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
              HOP / MESH FORWARDING
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 900, marginTop: 2 }}>TTL 3 Hops</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
              Auto-Relay Enabled
            </div>
          </div>
        </div>

        {transportState.lastError && (
          <div style={{ 
            marginTop: 14, 
            padding: '8px 12px', 
            background: 'var(--color-yellow-tint)', 
            border: '1px solid var(--color-ink)', 
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <Info size={14} />
            <span>Note: {transportState.lastError}</span>
          </div>
        )}
      </div>

      {/* Discovered Peers List */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 900 }}>
            Active Peers in Subnet ({peers.length})
          </h2>
          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
            No simulated peers • 100% genuine discovered nodes
          </span>
        </div>

        {peers.length === 0 ? (
          <div className="bento-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ 
              width: 64, 
              height: 64, 
              borderRadius: '50%', 
              background: 'var(--color-paper-dark)', 
              border: '2px dashed var(--color-ink)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <Users size={32} color="#5E635C" />
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 900 }}>No Compatible Peers Discovered</h3>
            <p style={{ maxWidth: 440, margin: '8px auto 20px', fontSize: '0.85rem', color: 'var(--color-ink-muted)', lineHeight: 1.5 }}>
              The local network is currently quiet. Connect an Android phone or another PC to the same Wi-Fi router or portable mobile hotspot to establish automatic P2P links.
            </p>
            <div style={{ display: 'inline-flex', gap: 10 }}>
              <button className="btn-tactile btn-sm" onClick={handleRefresh}>
                <RefreshCw size={14} />
                Retrigger Subnet Beacon
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {peers.map((peer) => {
              const secondsAgo = Math.round((Date.now() - peer.lastSeen) / 1000);
              return (
                <div key={peer.id} className="bento-card">
                  <div className="card-header">
                    <span style={{ fontWeight: 900, fontSize: '1rem' }}>{peer.name}</span>
                    <span className={`pill ${peer.status === 'CONNECTED' ? 'pill-green' : 'pill-yellow'}`}>
                      {peer.status}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                    <div>Address: <strong>{peer.address}</strong></div>
                    <div>Transport: {peer.transport}</div>
                    <div>Relay Node: {peer.isRelay ? 'Active' : 'Direct Only'}</div>
                  </div>

                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    marginTop: 'auto', 
                    paddingTop: 10, 
                    borderTop: '1px solid var(--color-border)',
                    fontSize: '0.72rem',
                    color: 'var(--color-ink-muted)'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={12} />
                      Heard {secondsAgo}s ago
                    </span>
                    {peer.transport !== 'DIRECT' ? (
                      <button
                        className="btn-tactile btn-sm"
                        style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                        onClick={() => transport.connectToPeer(peer.id, peer.name)}
                      >
                        Pair Direct Link
                      </button>
                    ) : (
                      <span style={{ fontWeight: 700, color: '#73966A' }}>
                        Direct P2P Link Active
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
