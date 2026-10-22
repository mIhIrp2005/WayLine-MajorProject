import React, { useState } from 'react';
import { 
  Users, 
  RefreshCw, 
  Clock 
} from 'lucide-react';
import { DiscoveredPeer, TransportState, LocalIdentity, StoredMessage } from '../types';
import { transport } from '../services/transport';
import { TopologyDiagram } from './TopologyDiagram';

interface NearbyViewProps {
  identity: LocalIdentity;
  transportState: TransportState;
  peers: DiscoveredPeer[];
  messages?: StoredMessage[];
  onRefreshDiscovery: () => void;
}

export const NearbyView: React.FC<NearbyViewProps> = ({
  identity,
  transportState,
  peers,
  messages = [],
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
          <p>Local mesh node directory and peer connections</p>
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

      {/* Interactive Topology Graph */}
      <TopologyDiagram 
        identity={identity} 
        transportState={transportState} 
        peers={peers} 
        messages={messages}
        onPairDirect={(peerId, peerName) => transport.connectToPeer(peerId, peerName)}
      />

      {/* Discovered Peers List */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 900 }}>
            Connected Peers ({peers.length})
          </h2>
        </div>

        {peers.length === 0 ? (
          <div className="bento-card" style={{ textAlign: 'center', padding: '36px 20px' }}>
            <div style={{ 
              width: 52, 
              height: 52, 
              borderRadius: '50%', 
              background: 'var(--color-paper-dark)', 
              border: '2px dashed var(--color-ink)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              margin: '0 auto 12px'
            }}>
              <Users size={26} color="#5E635C" />
            </div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>No Peers in Range</h3>
            <p style={{ maxWidth: 380, margin: '6px auto 16px', fontSize: '0.82rem', color: 'var(--color-ink-muted)', lineHeight: 1.4 }}>
              Connect another device to the same Wi-Fi or mobile hotspot to establish peer links.
            </p>
            <button className="btn-tactile btn-sm" onClick={handleRefresh}>
              <RefreshCw size={13} />
              Scan Now
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 14 }}>
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
