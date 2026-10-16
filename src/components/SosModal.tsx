import React, { useState } from 'react';
import { 
  ShieldAlert, 
  X, 
  MapPin, 
  HeartPulse, 
  Waves, 
  LifeBuoy, 
  AlertOctagon,
  Flame,
  CheckCircle2,
  Info
} from 'lucide-react';
import { EmergencyCategory, GeoLocationData, LocalIdentity } from '../types';
import { protocol } from '../services/protocol';
import { storage } from '../services/storage';
import { transport } from '../services/transport';

interface SosModalProps {
  isOpen: boolean;
  onClose: () => void;
  identity: LocalIdentity;
  onIncidentCreated: () => void;
}

export const SosModal: React.FC<SosModalProps> = ({
  isOpen,
  onClose,
  identity,
  onIncidentCreated
}) => {
  const [category, setCategory] = useState<EmergencyCategory>('MEDICAL');
  const [description, setDescription] = useState('');
  const [includeLocation, setIncludeLocation] = useState(true);
  const [location, setLocation] = useState<GeoLocationData | undefined>();
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const categories: { key: EmergencyCategory; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'MEDICAL', label: 'Medical Assistance', icon: <HeartPulse size={18} />, color: '#EA644B' },
    { key: 'TRAPPED', label: 'Trapped / Injured', icon: <AlertOctagon size={18} />, color: '#EA644B' },
    { key: 'FLOOD', label: 'Flood / Rising Water', icon: <Waves size={18} />, color: '#A9CDE0' },
    { key: 'RESCUE', label: 'Rescue Request', icon: <LifeBuoy size={18} />, color: '#F2D77A' },
    { key: 'GENERAL', label: 'General Emergency', icon: <Flame size={18} />, color: '#5E635C' }
  ];

  const handleFetchLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported by this browser');
      return;
    }
    setLocationLoading(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracy: Math.round(pos.coords.accuracy),
          timestamp: pos.timestamp
        });
        setLocationLoading(false);
      },
      (err) => {
        setLocationError(`Location unavailable (${err.message}). Proceeding without GPS.`);
        setLocationLoading(false);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  const handleSendSos = async () => {
    if (!confirmed) return;
    setSubmitting(true);

    try {
      const { packet, incident } = protocol.createSosPacket(
        identity,
        category,
        description.trim() || `Urgent ${category} assistance requested.`,
        includeLocation ? location : undefined
      );

      // 1. Save in IndexedDB locally first
      await storage.saveIncident(incident);

      // 2. Transmit to real connected peers
      await transport.sendPacket(packet);

      onIncidentCreated();
      onClose();
    } catch (e: any) {
      console.error('Failed to dispatch SOS:', e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: '#EA644B', padding: 6, borderRadius: 6, border: '2px solid #292D29' }}>
              <ShieldAlert size={24} color="#FFF" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 900 }}>EMERGENCY BROADCAST</h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-muted)' }}>Local network distress beacon</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Warning Banner */}
        <div style={{ 
          background: 'var(--color-yellow-tint)', 
          border: '1.5px solid var(--color-ink)', 
          padding: '10px 12px', 
          borderRadius: 'var(--radius-md)',
          marginBottom: 16,
          display: 'flex',
          gap: 8,
          fontSize: '0.78rem'
        }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong>Offline Local Transmission:</strong> Broadcasts to compatible nearby WAYLINE devices on the local Wi-Fi / hotspot. Does <em>not</em> connect to 911 or emergency services.
          </span>
        </div>

        {/* Category Selection */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
            1. SELECT EMERGENCY CATEGORY
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {categories.map((c) => (
              <button
                key={c.key}
                type="button"
                className="btn-tactile"
                style={{
                  justifyContent: 'flex-start',
                  padding: '8px 12px',
                  fontSize: '0.82rem',
                  background: category === c.key ? 'var(--color-paper-dark)' : 'var(--color-paper-card)',
                  border: category === c.key ? '2px solid var(--color-ink)' : '1px solid var(--color-border)',
                  boxShadow: category === c.key ? 'var(--shadow-tactile)' : 'none'
                }}
                onClick={() => setCategory(c.key)}
              >
                {c.icon}
                <span style={{ fontWeight: category === c.key ? 800 : 600 }}>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Description Input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
            2. DETAILS (PEOPLE COUNT, HAZARDS, INJURIES)
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. 2 adults trapped in attic, rising water, need immediate boat extraction..."
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 'var(--radius-md)',
              border: '2px solid var(--color-ink)',
              background: 'var(--color-paper-card)',
              fontFamily: 'inherit',
              fontSize: '0.9rem',
              resize: 'none'
            }}
          />
        </div>

        {/* Location Attachment */}
        <div style={{ 
          background: 'var(--color-paper-dark)', 
          border: '1.5px solid var(--color-ink)', 
          borderRadius: 'var(--radius-md)', 
          padding: '12px', 
          marginBottom: 20 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 700 }}>
              <MapPin size={16} />
              <span>Attach Device GPS Coordinates</span>
            </div>
            <button
              type="button"
              className="btn-tactile btn-sm"
              onClick={handleFetchLocation}
              disabled={locationLoading}
            >
              {locationLoading ? 'Acquiring...' : location ? 'Re-acquire' : 'Acquire GPS'}
            </button>
          </div>

          {location && (
            <div style={{ marginTop: 8, fontSize: '0.78rem', fontFamily: 'var(--font-mono)' }}>
              Lat: {location.latitude}, Lng: {location.longitude} (±{location.accuracy}m)
            </div>
          )}

          {locationError && (
            <div style={{ marginTop: 6, fontSize: '0.75rem', color: '#EA644B' }}>
              {locationError}
            </div>
          )}
        </div>

        {/* Deliberate Confirmation Checkbox */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          marginBottom: 20, 
          padding: '8px 12px', 
          background: 'var(--color-coral-tint)', 
          borderRadius: 'var(--radius-md)',
          border: '1.5px dashed var(--color-coral)'
        }}>
          <input
            type="checkbox"
            id="sos-confirm"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ width: 18, height: 18, cursor: 'pointer' }}
          />
          <label htmlFor="sos-confirm" style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--color-ink)', cursor: 'pointer' }}>
            I confirm this is an active emergency requiring immediate peer alert.
          </label>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            className="btn-tactile"
            style={{ flex: 1 }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-tactile btn-coral"
            style={{ flex: 2 }}
            disabled={!confirmed || submitting}
            onClick={handleSendSos}
          >
            <ShieldAlert size={18} />
            {submitting ? 'Broadcasting...' : 'TRANSMIT SOS NOW'}
          </button>
        </div>
      </div>
    </div>
  );
};
