import React, { useState } from 'react';
import { 
  Radio, 
  MessageSquare, 
  Users, 
  AlertTriangle, 
  Settings, 
  ShieldAlert,
  Wifi,
  WifiOff,
  Volume2,
  PhoneCall,
  MoreHorizontal,
  X
} from 'lucide-react';
import { TransportState } from '../types';

export type ActiveTab = 'field-desk' | 'messages' | 'nearby' | 'voice' | 'incidents' | 'settings' | 'acoustic-lab';

interface NavigationProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onOpenSos: () => void;
  transportState: TransportState;
  activeIncidentsCount: number;
  unreadMessagesCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  onOpenSos,
  transportState,
  activeIncidentsCount,
  unreadMessagesCount
}) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const isMoreActive = ['nearby', 'voice', 'settings', 'acoustic-lab'].includes(activeTab);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="desktop-nav">
        <div>
          <div className="brand-badge">
            <div style={{
              width: 36, 
              height: 36, 
              borderRadius: 8, 
              background: '#EA644B', 
              border: '2px solid var(--color-card-border)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center'
            }}>
              <Radio size={20} color="#FFFFFF" />
            </div>
            <div>
              <div className="brand-title">WAYLINE</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                <span className="brand-tag">v1.0 OFFLINE</span>
              </div>
            </div>
          </div>

          {/* Quick SOS Trigger in Sidebar */}
          <div style={{ marginTop: 20 }}>
            <button 
              className="btn-tactile btn-coral" 
              style={{ width: '100%', padding: '12px' }}
              onClick={onOpenSos}
            >
              <ShieldAlert size={18} />
              TRANSMIT SOS
            </button>
          </div>

          {/* Nav List */}
          <nav className="nav-links">
            <button 
              className={`nav-item ${activeTab === 'field-desk' ? 'active' : ''}`}
              onClick={() => setActiveTab('field-desk')}
            >
              <Radio size={18} />
              Field Desk
            </button>

            <button 
              className={`nav-item ${activeTab === 'messages' ? 'active' : ''}`}
              onClick={() => setActiveTab('messages')}
            >
              <MessageSquare size={18} />
              Messages
              {unreadMessagesCount > 0 && (
                <span className="pill pill-yellow" style={{ marginLeft: 'auto', padding: '1px 6px', fontSize: '0.7rem' }}>
                  {unreadMessagesCount}
                </span>
              )}
            </button>

            <button 
              className={`nav-item ${activeTab === 'nearby' ? 'active' : ''}`}
              onClick={() => setActiveTab('nearby')}
            >
              <Users size={18} />
              Nearby Peers
              {transportState.peerCount > 0 && (
                <span className="pill pill-green" style={{ marginLeft: 'auto', padding: '1px 6px', fontSize: '0.7rem' }}>
                  {transportState.peerCount}
                </span>
              )}
            </button>

            <button 
              className={`nav-item ${activeTab === 'voice' ? 'active' : ''}`}
              onClick={() => setActiveTab('voice')}
            >
              <PhoneCall size={18} />
              Voice Mesh
            </button>

            <button 
              className={`nav-item ${activeTab === 'incidents' ? 'active' : ''}`}
              onClick={() => setActiveTab('incidents')}
            >
              <AlertTriangle size={18} />
              Incidents
              {activeIncidentsCount > 0 && (
                <span className="pill pill-coral" style={{ marginLeft: 'auto', padding: '1px 6px', fontSize: '0.7rem' }}>
                  {activeIncidentsCount}
                </span>
              )}
            </button>

            <button 
              className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <Settings size={18} />
              Settings
            </button>

            <button 
              className={`nav-item ${activeTab === 'acoustic-lab' ? 'active' : ''}`}
              onClick={() => setActiveTab('acoustic-lab')}
              style={{ marginTop: 8, borderTop: '1px dashed var(--color-border)', paddingTop: 10 }}
            >
              <Volume2 size={18} color="#EA644B" />
              <span>Acoustic Lab</span>
              <span className="pill pill-yellow" style={{ marginLeft: 'auto', padding: '1px 5px', fontSize: '0.65rem' }}>
                EXP
              </span>
            </button>
          </nav>
        </div>

        {/* Node Live Indicator */}
        <div style={{ marginTop: 'auto' }}>
          <div style={{ 
            background: 'var(--color-paper)', 
            border: '1.5px solid var(--color-ink)', 
            padding: '8px 12px', 
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.72rem',
            fontFamily: 'var(--font-mono)'
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700 }}>
              {transportState.isCompanionConnected ? (
                <Wifi size={13} color="#73966A" />
              ) : (
                <WifiOff size={13} color="#5E635C" />
              )}
              {transportState.isCompanionConnected ? 'Mesh Active' : 'Standalone'}
            </span>
            <span style={{ color: 'var(--color-ink-muted)' }}>
              {transportState.peerCount} peer{transportState.peerCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </aside>

      {/* Mobile More Sheet / Popover */}
      {showMoreMenu && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(41, 45, 41, 0.45)',
            zIndex: 90,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: '12px 12px calc(76px + env(safe-area-inset-bottom, 8px))'
          }}
          onClick={() => setShowMoreMenu(false)}
        >
          <div 
            className="bento-card" 
            style={{ 
              background: 'var(--color-paper-card)', 
              padding: '14px', 
              boxShadow: 'var(--shadow-tactile-lg)', 
              gap: 8,
              border: '2px solid var(--color-ink)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, paddingBottom: 6, borderBottom: '1px dashed var(--color-border)' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>MORE STATIONS & TOOLS</span>
              <button 
                onClick={() => setShowMoreMenu(false)} 
                aria-label="Close tools menu"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <button 
              className={`nav-item ${activeTab === 'nearby' ? 'active' : ''}`}
              style={{ width: '100%', padding: '10px 12px' }}
              onClick={() => { setActiveTab('nearby'); setShowMoreMenu(false); }}
            >
              <Users size={18} />
              <span>Nearby Peers</span>
              {transportState.peerCount > 0 && (
                <span className="pill pill-green" style={{ marginLeft: 'auto', padding: '1px 6px', fontSize: '0.7rem' }}>
                  {transportState.peerCount}
                </span>
              )}
            </button>

            <button 
              className={`nav-item ${activeTab === 'voice' ? 'active' : ''}`}
              style={{ width: '100%', padding: '10px 12px' }}
              onClick={() => { setActiveTab('voice'); setShowMoreMenu(false); }}
            >
              <PhoneCall size={18} />
              <span>Voice Mesh</span>
            </button>

            <button 
              className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
              style={{ width: '100%', padding: '10px 12px' }}
              onClick={() => { setActiveTab('settings'); setShowMoreMenu(false); }}
            >
              <Settings size={18} />
              <span>Settings</span>
            </button>

            <button 
              className={`nav-item ${activeTab === 'acoustic-lab' ? 'active' : ''}`}
              style={{ width: '100%', padding: '10px 12px', borderTop: '1px dashed var(--color-border)' }}
              onClick={() => { setActiveTab('acoustic-lab'); setShowMoreMenu(false); }}
            >
              <Volume2 size={18} color="var(--color-coral)" />
              <span>Acoustic Lab</span>
              <span className="pill pill-yellow" style={{ marginLeft: 'auto', padding: '1px 5px', fontSize: '0.65rem' }}>
                EXP
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation (Consolidated 4-Tabs + Center SOS) */}
      <nav className="mobile-nav">
        <button 
          className={`mobile-nav-item ${activeTab === 'field-desk' ? 'active' : ''}`}
          onClick={() => { setActiveTab('field-desk'); setShowMoreMenu(false); }}
        >
          <Radio size={18} />
          <span>Desk</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'messages' ? 'active' : ''}`}
          onClick={() => { setActiveTab('messages'); setShowMoreMenu(false); }}
          style={{ position: 'relative' }}
        >
          <MessageSquare size={18} />
          <span>Chat</span>
          {unreadMessagesCount > 0 && (
            <span style={{
              position: 'absolute',
              top: 4,
              right: '25%',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#F2D77A',
              border: '1px solid var(--color-ink)'
            }} />
          )}
        </button>

        {/* Elevated Tactile SOS Center Button */}
        <button 
          className="mobile-nav-item"
          style={{ 
            color: '#FFFFFF',
            background: 'var(--color-coral)',
            borderRadius: 'var(--radius-md)',
            border: '2px solid var(--color-card-border)',
            boxShadow: 'var(--shadow-tactile)',
            transform: 'translateY(-6px)',
            minHeight: 48,
            padding: '2px 10px'
          }}
          onClick={onOpenSos}
          aria-label="Transmit Emergency SOS Broadcast"
        >
          <ShieldAlert size={22} color="#FFFFFF" />
          <span style={{ fontWeight: 900, color: '#FFFFFF', fontSize: '0.72rem' }}>SOS</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'incidents' ? 'active' : ''}`}
          onClick={() => { setActiveTab('incidents'); setShowMoreMenu(false); }}
          style={{ position: 'relative' }}
        >
          <AlertTriangle size={18} />
          <span>Alerts</span>
          {activeIncidentsCount > 0 && (
            <span style={{
              position: 'absolute',
              top: 4,
              right: '25%',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--color-coral)',
              border: '1px solid var(--color-ink)'
            }} />
          )}
        </button>

        <button 
          className={`mobile-nav-item ${isMoreActive || showMoreMenu ? 'active' : ''}`}
          onClick={() => setShowMoreMenu(!showMoreMenu)}
          aria-label="More stations and tools"
        >
          <MoreHorizontal size={18} />
          <span>More</span>
        </button>
      </nav>
    </>
  );
};
