import React, { useState, useEffect, useRef } from 'react';
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
  Info,
  Clock,
  XCircle
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
  const [manualLocation, setManualLocation] = useState('');
  const [includeLocation, setIncludeLocation] = useState(true);
  const [location, setLocation] = useState<GeoLocationData | undefined>();
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(true); // default true for emergency auto-submit
  const [submitting, setSubmitting] = useState(false);

  // 10-second emergency auto-submit countdown
  const [countdown, setCountdown] = useState<number>(10);
  const [autoSubmitActive, setAutoSubmitActive] = useState<boolean>(true);
  const autoSubmitTimerRef = useRef<any>(null);

  // Reset or run countdown on modal open
  useEffect(() => {
    if (!isOpen) {
      if (autoSubmitTimerRef.current) clearInterval(autoSubmitTimerRef.current);
      setCountdown(10);
      setAutoSubmitActive(true);
      return;
    }

    // Auto-fetch location immediately when modal opens
    handleFetchLocation();

    setCountdown(10);
    setAutoSubmitActive(true);

    autoSubmitTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(autoSubmitTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (autoSubmitTimerRef.current) clearInterval(autoSubmitTimerRef.current);
    };
  }, [isOpen]);

  // When countdown reaches 0 and auto-submit is still active, trigger SOS dispatch
  useEffect(() => {
    if (isOpen && autoSubmitActive && countdown === 0 && !submitting) {
      triggerSosDispatch();
    }
  }, [countdown, autoSubmitActive, isOpen]);

  if (!isOpen) return null;

  const cancelAutoSubmit = () => {
    if (autoSubmitTimerRef.current) clearInterval(autoSubmitTimerRef.current);
    setAutoSubmitActive(false);
  };

  const categories: { key: EmergencyCategory; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'MEDICAL', label: 'Medical Assistance', icon: <HeartPulse size={18} />, color: '#EA644B' },
    { key: 'TRAPPED', label: 'Trapped / Injured', icon: <AlertOctagon size={18} />, color: '#EA644B' },
    { key: 'FLOOD', label: 'Flood / Rising Water', icon: <Waves size={18} />, color: '#A9CDE0' },
    { key: 'RESCUE', label: 'Rescue Request', icon: <LifeBuoy size={18} />, color: '#F2D77A' },
    { key: 'GENERAL', label: 'General Emergency', icon: <Flame size={18} />, color: '#5E635C' }
  ];

  const handleFetchLocation = () => {
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setLocationLoading(false);
      setLocationError('Mobile browsers block hardware GPS over plain LAN HTTP. Type your location/landmark below, or enable chrome://flags/#unsafely-treat-insecure-origin-as-secure.');
      return;
    }

    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser.');
      return;
    }

    setLocationLoading(true);
    setLocationError(null);

    // Fast-fallback geolocation:
    // Attempt high accuracy first (quick 4s timeout). If mobile GPS times out or throws,
    // fallback immediately to standard cell/Wi-Fi/cached location (10s timeout).
    const onLocationSuccess = (pos: GeolocationPosition) => {
      setLocation({
        latitude: Number(pos.coords.latitude.toFixed(6)),
        longitude: Number(pos.coords.longitude.toFixed(6)),
        accuracy: Math.round(pos.coords.accuracy),
        timestamp: pos.timestamp
      });
      setLocationLoading(false);
      setLocationError(null);
    };

    const tryLowAccuracyFallback = () => {
      navigator.geolocation.getCurrentPosition(
        onLocationSuccess,
        (fallbackErr) => {
          setLocationError(`GPS unavailable (${fallbackErr.message}). Enter your location or landmark below.`);
          setLocationLoading(false);
        },
        { timeout: 10000, enableHighAccuracy: false, maximumAge: 120000 }
      );
    };

    navigator.geolocation.getCurrentPosition(
      onLocationSuccess,
      () => {
        // High accuracy failed or timed out; try low accuracy/cached
        tryLowAccuracyFallback();
      },
      { timeout: 4000, enableHighAccuracy: true, maximumAge: 30000 }
    );
  };

  const triggerSosDispatch = async () => {
    setSubmitting(true);
    try {
      const fullDescription = [
        description.trim() || `Urgent ${category} assistance requested.`,
        manualLocation.trim() ? `[Location Note: ${manualLocation.trim()}]` : ''
      ].filter(Boolean).join(' ');

      const { packet, incident } = protocol.createSosPacket(
        identity,
        category,
        fullDescription,
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

  const handleSendSos = async () => {
    if (!confirmed) return;
    cancelAutoSubmit();
    await triggerSosDispatch();
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

        {/* 10-Second Auto-Submit Emergency Banner */}
        {autoSubmitActive ? (
          <div style={{
            background: '#EA644B',
            color: '#FFFFFF',
            border: '2px solid #292D29',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            boxShadow: 'var(--shadow-tactile)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={20} className="pulse" />
              <div>
                <div style={{ fontWeight: 900, fontSize: '0.88rem', letterSpacing: '0.04em' }}>
                  AUTO-TRANSMITTING IN {countdown}s
                </div>
                <div style={{ fontSize: '0.72rem', opacity: 0.9 }}>
                  Emergency broadcast will fire automatically
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={cancelAutoSubmit}
              className="btn-tactile"
              style={{
                background: '#FFFFFF',
                color: '#EA644B',
                border: '2px solid #292D29',
                padding: '6px 12px',
                fontSize: '0.78rem',
                fontWeight: 800
              }}
            >
              Cancel / Stop
            </button>
          </div>
        ) : (
          <div style={{ 
            background: 'var(--color-yellow-tint)', 
            border: '1.5px solid var(--color-ink)', 
            padding: '8px 12px', 
            borderRadius: 'var(--radius-md)',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.78rem'
          }}>
            <span>Auto-dispatch paused. Fill out details and click Transmit.</span>
            <button
              type="button"
              onClick={() => { setAutoSubmitActive(true); setCountdown(10); }}
              style={{ background: 'none', border: 'underline', color: 'var(--color-ink)', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}
            >
              Restart Timer
            </button>
          </div>
        )}

        {/* Warning Banner */}
        <div style={{ 
          background: 'var(--color-paper-card)', 
          border: '1px solid var(--color-border)', 
          padding: '8px 12px', 
          borderRadius: 'var(--radius-md)',
          marginBottom: 16,
          display: 'flex',
          gap: 8,
          fontSize: '0.75rem',
          color: 'var(--color-ink-muted)'
        }}>
          <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Offline Local Transmission: Broadcasts to nearby WAYLINE devices on local Wi-Fi / hotspot. Does not call 911.
          </span>
        </div>

        {/* Category Selection */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
            1. SELECT EMERGENCY CATEGORY
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
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
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. 2 adults trapped in attic, rising water, need extraction..."
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

        {/* Location Attachment & Manual Landmark Fallback */}
        <div style={{ 
          background: 'var(--color-paper-dark)', 
          border: '1.5px solid var(--color-ink)', 
          borderRadius: 'var(--radius-md)', 
          padding: '12px', 
          marginBottom: 16 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 700 }}>
              <MapPin size={16} />
              <span>Location / Coordinates</span>
            </div>
            <button
              type="button"
              className="btn-tactile btn-sm"
              onClick={handleFetchLocation}
              disabled={locationLoading}
            >
              {locationLoading ? 'Acquiring...' : location ? 'Re-acquire GPS' : 'Acquire GPS'}
            </button>
          </div>

          {location && (
            <div style={{ marginTop: 8, fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: '#73966A', fontWeight: 700 }}>
              ✓ Lat: {location.latitude}, Lng: {location.longitude} (±{location.accuracy}m)
            </div>
          )}

          {locationError && (
            <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#EA644B', lineHeight: 1.3 }}>
              {locationError}
            </div>
          )}

          {/* Manual Landmark input when GPS is blocked or phone is indoors */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--color-border)' }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, marginBottom: 4, color: 'var(--color-ink-muted)' }}>
              MANUAL LANDMARK / FLOOR / ROOM (RECOMMENDED IF GPS FAILS):
            </label>
            <input
              type="text"
              value={manualLocation}
              onChange={(e) => setManualLocation(e.target.value)}
              placeholder="e.g. 2nd floor front room, next to red water tank..."
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: '0.82rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-ink)',
                background: 'var(--color-paper-card)'
              }}
            />
          </div>
        </div>

        {/* Deliberate Confirmation Checkbox */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          marginBottom: 16, 
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-tactile"
            style={{ flex: '1 1 100px' }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-tactile btn-coral"
            style={{ flex: '2 1 180px' }}
            disabled={!confirmed || submitting}
            onClick={handleSendSos}
          >
            <ShieldAlert size={18} />
            {submitting ? 'Broadcasting...' : autoSubmitActive ? `SEND NOW (${countdown}s)` : 'TRANSMIT SOS NOW'}
          </button>
        </div>
      </div>
    </div>
  );
};
