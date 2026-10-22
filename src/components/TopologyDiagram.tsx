import React, { useState } from 'react';
import { 
  Radio, 
  Zap, 
  ArrowRight, 
  ArrowLeft 
} from 'lucide-react';
import { DiscoveredPeer, TransportState, LocalIdentity, StoredMessage } from '../types';

interface TopologyDiagramProps {
  identity: LocalIdentity;
  transportState: TransportState;
  peers: DiscoveredPeer[];
  messages?: StoredMessage[];
  onPairDirect?: (peerId: string, peerName: string) => void;
}

type TopologyMode = 'CHAIN' | 'STAR';

export const TopologyDiagram: React.FC<TopologyDiagramProps> = ({
  identity,
  transportState,
  peers,
  messages = [],
  onPairDirect
}) => {
  const [mode, setMode] = useState<TopologyMode>('CHAIN');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [chainOrder, setChainOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wayline_chain_order');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  // Save chain order when changed
  const saveChainOrder = (newOrder: string[]) => {
    setChainOrder(newOrder);
    try {
      localStorage.setItem('wayline_chain_order', JSON.stringify(newOrder));
    } catch {}
  };

  // Determine if this browser is running on the Anchor host (e.g. Windows PC)
  const isLocalTheAnchor = Boolean(
    typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || 
     window.location.hostname === '127.0.0.1' || 
     (transportState.listeningAddress && transportState.listeningAddress.includes(window.location.hostname)))
  );

  // Auto-order peers: prioritize manual order, then hop count, then discovery
  const getPeerHop = (peerId: string) => {
    const peerMsgs = messages.filter(m => m.senderId === peerId);
    if (peerMsgs.length === 0) return 999;
    return peerMsgs[peerMsgs.length - 1].hopCount;
  };

  const sortedPeers = [...peers].sort((a, b) => {
    const orderA = chainOrder.indexOf(a.id);
    const orderB = chainOrder.indexOf(b.id);
    if (orderA !== -1 && orderB !== -1) return orderA - orderB;
    if (orderA !== -1) return -1;
    if (orderB !== -1) return 1;

    // Next sort by hop count from packets
    const hopA = getPeerHop(a.id);
    const hopB = getPeerHop(b.id);
    if (hopA !== hopB) return hopA - hopB;

    // Fallback sort by name
    return a.name.localeCompare(b.name);
  });

  // Reorder functions for Chain mode
  const movePeerInChain = (peerId: string, direction: 'left' | 'right') => {
    const currentIds = sortedPeers.map(p => p.id);
    const idx = currentIds.indexOf(peerId);
    if (idx === -1) return;
    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= currentIds.length) return;

    const swapped = [...currentIds];
    const temp = swapped[idx];
    swapped[idx] = swapped[targetIdx];
    swapped[targetIdx] = temp;
    saveChainOrder(swapped);
  };

  // Build the Chain nodes list:
  // Node 0: Root / Anchor (PC Host)
  // Node 1: Phone A (Hotspot A)
  // Node 2: Phone B (Hotspot B)
  // Node 3: Phone C
  interface ChainNode {
    id: string;
    name: string;
    role: string;
    hopLabel: string;
    isAnchor: boolean;
    isLocal: boolean;
    transport?: string;
    status?: string;
    address?: string;
    isRelay?: boolean;
  }

  const chainNodes: ChainNode[] = [];

  // Root node: The stationary host / hotspot origin
  if (isLocalTheAnchor) {
    chainNodes.push({
      id: identity.nodeId,
      name: identity.nodeName,
      role: 'Hotspot Gateway',
      hopLabel: 'Hop 0 (Root)',
      isAnchor: true,
      isLocal: true,
      address: transportState.listeningAddress
    });
  } else {
    // We are on a phone client; the root anchor is the host PC
    chainNodes.push({
      id: 'root_anchor_pc',
      name: 'Base Station (PC)',
      role: 'Hotspot Gateway',
      hopLabel: 'Hop 0 (Root)',
      isAnchor: true,
      isLocal: false,
      address: transportState.listeningAddress
    });
  }

  // Add the peers in the chain order
  sortedPeers.forEach((p, idx) => {
    const hopNumber = idx + 1;
    const isTerminal = idx === sortedPeers.length - 1 && sortedPeers.length > 1;
    chainNodes.push({
      id: p.id,
      name: p.name,
      role: isTerminal ? 'Edge Node' : `Hotspot ${String.fromCharCode(65 + idx)} Relay`,
      hopLabel: `Hop ${hopNumber}`,
      isAnchor: false,
      isLocal: p.id === identity.nodeId,
      transport: p.transport,
      status: p.status,
      address: p.address,
      isRelay: p.isRelay
    });
  });

  // Layout calculations
  const nodeWidth = 175;
  const nodeHeight = 56;
  const chainSpacing = 240;
  const chainSvgWidth = Math.max(760, 40 + chainNodes.length * chainSpacing);
  const chainSvgHeight = 220;
  const chainCenterY = 100;

  // Star layout dimensions
  const starWidth = 760;
  const starHeight = Math.max(300, peers.length * 76 + 70);
  const starCenterY = starHeight / 2;

  // Details for selected node
  const selectedChainNode = chainNodes.find(n => n.id === selectedNodeId);
  const selectedPeer = peers.find(p => p.id === selectedNodeId);

  return (
    <div className="bento-card" style={{ marginBottom: 20, padding: 18 }}>
      {/* Topology Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              width: 26, 
              height: 26, 
              borderRadius: 6, 
              background: '#EA644B', 
              color: '#FFF' 
            }}>
              <Radio size={15} />
            </span>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--color-ink)' }}>
              Live Mesh Network Topology
            </h3>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--color-ink-muted)', marginTop: 2 }}>
            {mode === 'CHAIN' ? 'Hotspot Daisy Chain' : 'Access Point Star View'}
          </p>
        </div>

        {/* Mode Switcher */}
        <div style={{ display: 'inline-flex', gap: 6, background: 'var(--color-paper-dark)', padding: 3, borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--color-ink)' }}>
          <button 
            type="button"
            className="btn-tactile"
            style={{ 
              padding: '4px 10px', 
              fontSize: '0.72rem', 
              fontWeight: 800,
              background: mode === 'CHAIN' ? '#EA644B' : 'transparent',
              color: mode === 'CHAIN' ? '#FFF' : 'var(--color-ink)',
              border: mode === 'CHAIN' ? '1px solid #292D29' : 'none',
              boxShadow: mode === 'CHAIN' ? 'var(--shadow-tactile)' : 'none'
            }}
            onClick={() => setMode('CHAIN')}
          >
            ⛓️ Hotspot Chain
          </button>
          <button 
            type="button"
            className="btn-tactile"
            style={{ 
              padding: '4px 10px', 
              fontSize: '0.72rem', 
              fontWeight: 800,
              background: mode === 'STAR' ? '#EA644B' : 'transparent',
              color: mode === 'STAR' ? '#FFF' : 'var(--color-ink)',
              border: mode === 'STAR' ? '1px solid #292D29' : 'none',
              boxShadow: mode === 'STAR' ? 'var(--shadow-tactile)' : 'none'
            }}
            onClick={() => setMode('STAR')}
          >
            🌟 Star / LAN
          </button>
        </div>
      </div>

      {/* SVG Canvas Container */}
      <div style={{ 
        background: 'var(--color-paper)', 
        border: '2px solid var(--color-ink)', 
        borderRadius: 'var(--radius-md)', 
        overflowX: 'auto',
        overflowY: 'hidden',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)'
      }}>
        {mode === 'CHAIN' ? (
          /* ======================================================== */
          /* 1. HOTSPOT DAISY CHAIN TOPOLOGY VIEW (Chain A -> B -> C) */
          /* ======================================================== */
          <svg 
            viewBox={`0 0 ${chainSvgWidth} ${chainSvgHeight}`} 
            style={{ width: '100%', minWidth: Math.min(chainSvgWidth, 640), height: 'auto', display: 'block' }}
          >
            <defs>
              <pattern id="chainGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#D6CEBD" opacity="0.6" />
              </pattern>
            </defs>
            <rect width={chainSvgWidth} height={chainSvgHeight} fill="url(#chainGrid)" />

            {/* Links between consecutive nodes in the chain */}
            {chainNodes.map((node, i) => {
              if (i === chainNodes.length - 1) return null;
              const nextNode = chainNodes[i + 1];
              const x1 = 30 + i * chainSpacing + nodeWidth;
              const x2 = 30 + (i + 1) * chainSpacing;
              const y = chainCenterY;
              const midX = (x1 + x2) / 2;

              const linkLabel = i === 0 
                ? 'Hotspot Wi-Fi' 
                : `Hotspot Relay (Hop ${i})`;

              return (
                <g key={`chain-link-${node.id}-${nextNode.id}`}>
                  {/* Bi-directional forwarding line */}
                  <line 
                    x1={x1} 
                    y1={y} 
                    x2={x2} 
                    y2={y} 
                    stroke="#292D29" 
                    strokeWidth="2.5" 
                  />
                  {/* Direction arrows */}
                  <polygon 
                    points={`${x2 - 4},${y} ${x2 - 12},${y - 4} ${x2 - 12},${y + 4}`} 
                    fill="#292D29" 
                  />
                  <polygon 
                    points={`${x1 + 4},${y} ${x1 + 12},${y - 4} ${x1 + 12},${y + 4}`} 
                    fill="#292D29" 
                  />
                  {/* Tactile badge */}
                  <g transform={`translate(${midX}, ${y})`}>
                    <rect x="-48" y="-10" width="96" height="20" rx="4" fill="#FAF7F0" stroke="#292D29" strokeWidth="1.5" />
                    <text x="0" y="3" textAnchor="middle" fontSize="8.5" fontWeight="800" fontFamily="var(--font-mono)" fill="#292D29">
                      {linkLabel}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Direct WebRTC P2P shortcut overlays (if any) */}
            {chainNodes.map((node, i) => {
              if (node.transport !== 'DIRECT') return null;
              // Direct WebRTC link arched above the chain
              const startX = 30 + nodeWidth / 2;
              const targetX = 30 + i * chainSpacing + nodeWidth / 2;
              if (i === 0) return null;

              return (
                <g key={`webrtc-direct-${node.id}`}>
                  <path 
                    d={`M ${startX} 65 Q ${(startX + targetX) / 2} 18 ${targetX} 65`}
                    stroke="#73966A" 
                    strokeWidth="3.5" 
                    fill="none" 
                  />
                  <g transform={`translate(${(startX + targetX) / 2}, 30)`}>
                    <rect x="-54" y="-9" width="108" height="18" rx="4" fill="#EBF2E9" stroke="#73966A" strokeWidth="1.5" />
                    <text x="0" y="3" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#292D29">
                      ⚡ Direct WebRTC P2P
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Nodes in the Chain */}
            {chainNodes.map((node, i) => {
              const x = 30 + i * chainSpacing;
              const y = chainCenterY - nodeHeight / 2;
              const isSelected = selectedNodeId === node.id;

              let iconEmoji = '📱';
              if (node.isAnchor) iconEmoji = '💻';
              if (node.transport === 'DIRECT') iconEmoji = '⚡';

              let badgeBg = '#FAF7F0';
              if (node.isLocal) badgeBg = '#EA644B';
              else if (node.isAnchor) badgeBg = '#F2D77A';
              else if (node.transport === 'DIRECT') badgeBg = '#73966A';
              else badgeBg = '#A9CDE0';

              return (
                <g 
                  key={node.id} 
                  transform={`translate(${x}, ${y})`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  {/* Tactile Shadow */}
                  <rect x="2.5" y="2.5" width={nodeWidth} height={nodeHeight} rx="8" fill="#292D29" />
                  {/* Card Body */}
                  <rect 
                    x="0" 
                    y="0" 
                    width={nodeWidth} 
                    height={nodeHeight} 
                    rx="8" 
                    fill={isSelected ? '#FBECE8' : (node.isLocal ? '#FAF7F0' : '#FAF7F0')} 
                    stroke={isSelected ? '#EA644B' : '#292D29'} 
                    strokeWidth={isSelected ? '2.5' : '2'} 
                  />
                  {/* Icon Circle */}
                  <rect x="9" y="11" width="32" height="32" rx="6" fill={badgeBg} stroke="#292D29" strokeWidth="1.5" />
                  <text x="25" y="31" textAnchor="middle" fontSize={node.isLocal ? '11' : '14'} fontWeight="900" fill={node.isLocal ? '#FFF' : '#292D29'}>
                    {node.isLocal ? 'YOU' : iconEmoji}
                  </text>
                  {/* Node Name */}
                  <text x="48" y="24" fontSize="11" fontWeight="800" fill="#292D29" fontFamily="var(--font-sans)">
                    {node.name.length > 13 ? node.name.slice(0, 12) + '…' : node.name}
                  </text>
                  {/* Role & Hop */}
                  <text x="48" y="39" fontSize="8.5" fontWeight="700" fill="#5E635C" fontFamily="var(--font-mono)">
                    {node.role}
                  </text>
                  {/* Hop Tag underneath */}
                  <g transform={`translate(${nodeWidth / 2}, ${nodeHeight + 16})`}>
                    <rect x="-42" y="-8" width="84" height="16" rx="4" fill="#EDE7D8" stroke="#292D29" strokeWidth="1" />
                    <text x="0" y="3" textAnchor="middle" fontSize="8" fontWeight="800" fontFamily="var(--font-mono)" fill="#292D29">
                      {node.hopLabel}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Broadcast wave if anchor is alone */}
            {chainNodes.length === 1 && (
              <g transform={`translate(${30 + nodeWidth + 60}, ${chainCenterY})`}>
                <circle cx="0" cy="0" r="16" fill="none" stroke="#F2D77A" strokeWidth="2" strokeDasharray="3 3" opacity="0.8" />
                <circle cx="0" cy="0" r="32" fill="none" stroke="#F2D77A" strokeWidth="1.8" strokeDasharray="4 4" opacity="0.5" />
                <text x="45" y="4" fontSize="10" fontWeight="700" fill="var(--color-ink-muted)" fontFamily="var(--font-mono)">
                  Hotspot active • Awaiting Phone A to join...
                </text>
              </g>
            )}
          </svg>
        ) : (
          /* ======================================================== */
          /* 2. STAR / DIRECT ACCESS POINT VIEW                      */
          /* ======================================================== */
          <svg 
            viewBox={`0 0 ${starWidth} ${starHeight}`} 
            style={{ width: '100%', minWidth: 620, height: 'auto', display: 'block' }}
          >
            <rect width={starWidth} height={starHeight} fill="url(#chainGrid)" />
            {/* Center Anchor */}
            <g transform={`translate(${starWidth / 2 - nodeWidth / 2}, ${starCenterY - nodeHeight / 2})`}>
              <rect x="2.5" y="2.5" width={nodeWidth} height={nodeHeight} rx="8" fill="#292D29" />
              <rect x="0" y="0" width={nodeWidth} height={nodeHeight} rx="8" fill="#FCF9ED" stroke="#292D29" strokeWidth="2" />
              <rect x="10" y="11" width="32" height="32" rx="6" fill="#F2D77A" stroke="#292D29" strokeWidth="1.5" />
              <text x="26" y="31" textAnchor="middle" fontSize="14">⚓</text>
              <text x="50" y="24" fontSize="11" fontWeight="800" fill="#292D29">Main Machine Host</text>
              <text x="50" y="39" fontSize="8.5" fontWeight="600" fill="#5E635C" fontFamily="var(--font-mono)">
                {transportState.listeningAddress}
              </text>
            </g>

            {/* Orbiting Peers */}
            {peers.map((peer, idx) => {
              const total = peers.length;
              const angle = (idx / total) * 2 * Math.PI - Math.PI / 2;
              const radius = 200;
              const px = starWidth / 2 + Math.cos(angle) * radius - nodeWidth / 2;
              const py = starCenterY + Math.sin(angle) * (starHeight * 0.35) - nodeHeight / 2;

              return (
                <g key={`star-peer-${peer.id}`}>
                  <line 
                    x1={starWidth / 2} 
                    y1={starCenterY} 
                    x2={px + nodeWidth / 2} 
                    y2={py + nodeHeight / 2} 
                    stroke="#5E635C" 
                    strokeWidth="1.8" 
                    strokeDasharray="4 4" 
                  />
                  <g transform={`translate(${px}, ${py})`} onClick={() => setSelectedNodeId(peer.id)} style={{ cursor: 'pointer' }}>
                    <rect x="2.5" y="2.5" width={nodeWidth} height={nodeHeight} rx="8" fill="#292D29" />
                    <rect x="0" y="0" width={nodeWidth} height={nodeHeight} rx="8" fill="#FAF7F0" stroke="#292D29" strokeWidth="2" />
                    <rect x="10" y="11" width="32" height="32" rx="6" fill="#A9CDE0" stroke="#292D29" strokeWidth="1.5" />
                    <text x="26" y="31" textAnchor="middle" fontSize="14">📱</text>
                    <text x="50" y="24" fontSize="11" fontWeight="800" fill="#292D29">
                      {peer.name.length > 13 ? peer.name.slice(0, 12) + '…' : peer.name}
                    </text>
                    <text x="50" y="39" fontSize="8.5" fontWeight="600" fill="#5E635C" fontFamily="var(--font-mono)">
                      {peer.transport}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Selected Node Details & Chain Order Controls */}
      {selectedNodeId && selectedChainNode && (
        <div style={{ 
          marginTop: 12, 
          padding: '12px 16px', 
          background: 'var(--color-paper-card)', 
          border: '1.5px solid var(--color-ink)', 
          borderRadius: 'var(--radius-md)', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          flexWrap: 'wrap', 
          gap: 10 
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 900 }}>{selectedChainNode.name}</span>
              {selectedChainNode.isLocal && <span className="pill pill-green">YOU (THIS DEVICE)</span>}
              {selectedChainNode.isAnchor && <span className="pill pill-yellow">GATEWAY ROOT</span>}
              <span className="pill pill-blue">{selectedChainNode.hopLabel}</span>
            </div>
            <div style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', marginTop: 2 }}>
              Role: <strong>{selectedChainNode.role}</strong> • Address: {selectedChainNode.address || 'Direct Hop'} 
              {selectedChainNode.transport ? ` • Transport: ${selectedChainNode.transport}` : ''}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Chain reordering buttons for peers */}
            {mode === 'CHAIN' && !selectedChainNode.isAnchor && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, marginRight: 2 }}>Chain Hop:</span>
                <button 
                  type="button"
                  className="btn-tactile btn-sm"
                  title="Move node earlier in chain (closer to Main Machine)"
                  onClick={() => movePeerInChain(selectedChainNode.id, 'left')}
                >
                  <ArrowLeft size={13} />
                  Move Up
                </button>
                <button 
                  type="button"
                  className="btn-tactile btn-sm"
                  title="Move node later in chain (further downstream)"
                  onClick={() => movePeerInChain(selectedChainNode.id, 'right')}
                >
                  Move Down
                  <ArrowRight size={13} />
                </button>
              </div>
            )}

            {selectedPeer && selectedPeer.transport !== 'DIRECT' && onPairDirect && (
              <button 
                type="button"
                className="btn-tactile btn-sm"
                onClick={() => onPairDirect(selectedPeer.id, selectedPeer.name)}
              >
                <Zap size={13} />
                Direct WebRTC
              </button>
            )}

            <button 
              type="button"
              className="btn-tactile btn-sm" 
              style={{ padding: '3px 8px', fontSize: '0.7rem' }}
              onClick={() => setSelectedNodeId(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
