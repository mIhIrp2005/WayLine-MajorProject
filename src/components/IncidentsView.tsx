import React, { useState } from 'react';
import { 
  ShieldAlert, 
  MapPin, 
  Clock, 
  CheckCircle2, 
  Filter, 
  Radio, 
  Plus, 
  Navigation2,
  AlertTriangle
} from 'lucide-react';
import { EmergencyIncident, EmergencyCategory, LocalIdentity } from '../types';
import { storage } from '../services/storage';
import { protocol } from '../services/protocol';
import { transport } from '../services/transport';

interface IncidentsViewProps {
  identity: LocalIdentity;
  incidents: EmergencyIncident[];
  onOpenSos: () => void;
  onIncidentUpdated: () => void;
}

export const IncidentsView: React.FC<IncidentsViewProps> = ({
  identity,
  incidents,
  onOpenSos,
  onIncidentUpdated
}) => {
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const filteredIncidents = incidents.filter(i => {
    if (filterCategory !== 'ALL' && i.category !== filterCategory) return false;
    if (filterStatus !== 'ALL' && i.status !== filterStatus) return false;
    return true;
  });

  const handleResolveIncident = async (incident: EmergencyIncident) => {
    const newStatus = incident.status === 'ACTIVE' ? 'RESOLVED' : 'ACTIVE';
    // 1. Update local storage
    await storage.updateIncidentStatus(incident.id, newStatus);

    // 2. Broadcast status update packet across mesh
    const statusPacket = protocol.createStatusUpdatePacket(identity, incident.id, newStatus);
    await transport.sendPacket(statusPacket);

    onIncidentUpdated();
  };

  const getCategoryBadgeClass = (category: EmergencyCategory) => {
    switch (category) {
      case 'MEDICAL': return 'pill-coral';
      case 'TRAPPED': return 'pill-coral';
      case 'FLOOD': return 'pill-blue';
      case 'RESCUE': return 'pill-yellow';
      default: return 'pill-muted';
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-title-group">
          <h1>Emergency Incident Log</h1>
          <p>Triage registry of distress alerts on this local network</p>
        </div>
        <button 
          className="btn-tactile btn-coral"
          onClick={onOpenSos}
        >
          <Plus size={16} />
          Report Emergency
        </button>
      </div>

      {/* Filter Toolbar */}
      <div style={{ 
        display: 'flex', 
        gap: 12, 
        flexWrap: 'wrap', 
        alignItems: 'center', 
        marginBottom: 20, 
        padding: '12px 16px', 
        background: 'var(--color-paper-card)', 
        border: '2px solid var(--color-ink)', 
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-tactile)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 800 }}>
          <Filter size={14} />
          <span>FILTER:</span>
        </div>

        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          style={{
            padding: '6px 10px',
            border: '1.5px solid var(--color-ink)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-paper)',
            fontSize: '0.82rem',
            fontWeight: 700
          }}
        >
          <option value="ALL">All Categories</option>
          <option value="MEDICAL">Medical</option>
          <option value="TRAPPED">Trapped / Injured</option>
          <option value="FLOOD">Flood / Rising Water</option>
          <option value="RESCUE">Rescue Request</option>
          <option value="GENERAL">General</option>
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{
            padding: '6px 10px',
            border: '1.5px solid var(--color-ink)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-paper)',
            fontSize: '0.82rem',
            fontWeight: 700
          }}
        >
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active Incidents</option>
          <option value="RESOLVED">Resolved</option>
        </select>

        <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
          Showing {filteredIncidents.length} of {incidents.length} Records
        </span>
      </div>

      {/* Incident Cards */}
      {filteredIncidents.length === 0 ? (
        <div className="bento-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <CheckCircle2 size={40} color="#73966A" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: '1.2rem', fontWeight: 900 }}>No Incidents In Selected Filter</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-ink-muted)', marginTop: 4 }}>
            All clear. Emergency broadcasts from yourself or nearby nodes appear here in real time.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filteredIncidents.map((incident) => {
            const isSelf = incident.senderId === identity.nodeId;
            return (
              <div 
                key={incident.id} 
                className={`bento-card ${incident.status === 'ACTIVE' ? 'coral-tint' : ''}`}
                style={{ padding: '20px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`pill ${getCategoryBadgeClass(incident.category)}`}>
                      {incident.category}
                    </span>
                    <span className={`pill ${incident.status === 'ACTIVE' ? 'pill-coral' : 'pill-green'}`}>
                      {incident.status}
                    </span>
                    {isSelf && (
                      <span className="pill pill-muted">
                        ORIGINATED ON THIS DEVICE
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: '0.75rem', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
                    Reported {new Date(incident.timestamp).toLocaleString()}
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <p style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1.4 }}>
                    {incident.description}
                  </p>
                </div>

                {/* Location Box */}
                {incident.location ? (
                  <div style={{ 
                    marginTop: 12, 
                    padding: '8px 12px', 
                    background: '#FFFFFF', 
                    border: '1.5px solid var(--color-ink)', 
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    <MapPin size={15} color="#EA644B" />
                    <span>Coordinates: {incident.location.latitude}, {incident.location.longitude}</span>
                    <span style={{ color: 'var(--color-ink-muted)' }}>(±{incident.location.accuracy}m accuracy)</span>
                  </div>
                ) : (
                  <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--color-ink-muted)' }}>
                    No GPS coordinates attached.
                  </div>
                )}

                {/* Footer Actions */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  marginTop: 16, 
                  paddingTop: 12, 
                  borderTop: '1px solid var(--color-border)',
                  flexWrap: 'wrap',
                  gap: 10
                }}>
                  <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                    Sender: <strong>{incident.senderName}</strong> ({incident.senderId}) • {incident.deliveryStatus}
                  </div>

                  <button
                    className={`btn-tactile btn-sm ${incident.status === 'ACTIVE' ? 'btn-green' : ''}`}
                    onClick={() => handleResolveIncident(incident)}
                  >
                    <CheckCircle2 size={14} />
                    {incident.status === 'ACTIVE' ? 'Mark Incident Resolved / Safe' : 'Reopen Incident'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
