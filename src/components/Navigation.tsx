import { 
  Radio, 
  MessageSquare, 
  Users, 
  AlertTriangle, 
  Settings, 
  ShieldAlert,
  Wifi,
  WifiOff,
  Volume2
} from 'lucide-react';
import { TransportState } from '../types';

export type ActiveTab = 'field-desk' | 'messages' | 'nearby' | 'incidents' | 'settings' | 'acoustic-lab';

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
              border: '2px solid #292D29', 
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
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-nav">
        <button 
          className={`mobile-nav-item ${activeTab === 'field-desk' ? 'active' : ''}`}
          onClick={() => setActiveTab('field-desk')}
        >
          <Radio size={18} />
          <span>Desk</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'messages' ? 'active' : ''}`}
          onClick={() => setActiveTab('messages')}
          style={{ position: 'relative' }}
        >
          <MessageSquare size={18} />
          <span>Chat</span>
          {unreadMessagesCount > 0 && (
            <span style={{
              position: 'absolute',
              top: 4,
              right: '20%',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#F2D77A',
              border: '1px solid var(--color-ink)'
            }} />
          )}
        </button>

        <button 
          className="mobile-nav-item"
          style={{ color: '#EA644B' }}
          onClick={onOpenSos}
        >
          <ShieldAlert size={22} />
          <span style={{ fontWeight: 900 }}>SOS</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'nearby' ? 'active' : ''}`}
          onClick={() => setActiveTab('nearby')}
        >
          <Users size={18} />
          <span>Nearby</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'incidents' ? 'active' : ''}`}
          onClick={() => setActiveTab('incidents')}
          style={{ position: 'relative' }}
        >
          <AlertTriangle size={18} />
          <span>Alerts</span>
          {activeIncidentsCount > 0 && (
            <span style={{
              position: 'absolute',
              top: 4,
              right: '20%',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#EA644B',
              border: '1px solid var(--color-ink)'
            }} />
          )}
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
      </nav>
    </>
  );
};
