import React, { useState, useEffect, useCallback } from 'react';
import { Navigation, ActiveTab } from './components/Navigation';
import { FieldDesk } from './components/FieldDesk';
import { MessagesView } from './components/MessagesView';
import { NearbyView } from './components/NearbyView';
import { IncidentsView } from './components/IncidentsView';
import { SettingsView } from './components/SettingsView';
import { SosModal } from './components/SosModal';
import { 
  LocalIdentity, 
  TransportState, 
  DiscoveredPeer, 
  StoredMessage, 
  EmergencyIncident 
} from './types';
import { storage } from './services/storage';
import { transport } from './services/transport';
import './styles/bento-crayon.css';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('field-desk');
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [transportState, setTransportState] = useState<TransportState>(transport.state);
  const [peers, setPeers] = useState<DiscoveredPeer[]>(transport.peers);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [incidents, setIncidents] = useState<EmergencyIncident[]>([]);
  const [isOfflineReady, setIsOfflineReady] = useState(false);
  const [isSosOpen, setIsSosOpen] = useState(false);

  // Load persistent local data
  const loadData = useCallback(async () => {
    const id = await storage.getOrCreateIdentity();
    setIdentity(id);

    const msgs = await storage.getAllMessages();
    setMessages(msgs);

    const incs = await storage.getAllIncidents();
    setIncidents(incs);

    const savedPeers = await storage.getAllPeers();
    if (transport.peers.length === 0 && savedPeers.length > 0) {
      setPeers(savedPeers);
    }
  }, []);

  // Check Service Worker offline readiness
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        if (reg.active) {
          // Verify cache readiness
          const messageChannel = new MessageChannel();
          messageChannel.port1.onmessage = (event) => {
            if (event.data && event.data.ready) {
              setIsOfflineReady(true);
            }
          };
          reg.active.postMessage({ type: 'CHECK_CACHE_STATUS' }, [messageChannel.port2]);
        }
      }).catch(err => {
        console.warn('SW registration warning:', err);
      });
    }

    loadData();

    // Subscribe to real-time transport updates
    const unsubscribe = transport.subscribe(async () => {
      setTransportState({ ...transport.state });
      setPeers([...transport.peers]);
      const msgs = await storage.getAllMessages();
      setMessages(msgs);
      const incs = await storage.getAllIncidents();
      setIncidents(incs);
    });

    return () => unsubscribe();
  }, [loadData]);

  if (!identity) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100vh', 
        background: 'var(--color-paper)',
        fontFamily: 'var(--font-mono)' 
      }}>
        Initializing WAYLINE Node...
      </div>
    );
  }

  const activeIncidentsCount = incidents.filter(i => i.status === 'ACTIVE').length;

  return (
    <div className="app-container">
      {/* Navigation Shell */}
      <Navigation
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenSos={() => setIsSosOpen(true)}
        transportState={transportState}
        activeIncidentsCount={activeIncidentsCount}
        unreadMessagesCount={messages.length}
      />

      {/* Main Content Viewport */}
      <main className="main-viewport">
        {activeTab === 'field-desk' && (
          <FieldDesk
            identity={identity}
            transportState={transportState}
            peers={peers}
            incidents={incidents}
            messages={messages}
            isOfflineReady={isOfflineReady}
            onOpenSos={() => setIsSosOpen(true)}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onRefreshDiscovery={() => transport.triggerDiscoveryRefresh()}
          />
        )}

        {activeTab === 'messages' && (
          <MessagesView
            identity={identity}
            messages={messages}
            peers={peers}
            onMessageSent={loadData}
          />
        )}

        {activeTab === 'nearby' && (
          <NearbyView
            identity={identity}
            transportState={transportState}
            peers={peers}
            onRefreshDiscovery={() => transport.triggerDiscoveryRefresh()}
          />
        )}

        {activeTab === 'incidents' && (
          <IncidentsView
            identity={identity}
            incidents={incidents}
            onOpenSos={() => setIsSosOpen(true)}
            onIncidentUpdated={loadData}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            identity={identity}
            transportState={transportState}
            isOfflineReady={isOfflineReady}
            onIdentityUpdated={(newId) => setIdentity(newId)}
            onDataCleared={loadData}
          />
        )}
      </main>

      {/* Emergency Distress Modal */}
      <SosModal
        isOpen={isSosOpen}
        onClose={() => setIsSosOpen(false)}
        identity={identity}
        onIncidentCreated={loadData}
      />
    </div>
  );
};
