import React, { useState, useEffect } from 'react';
import { Phone, PhoneOff, AlertCircle, ShieldAlert, Volume2 } from 'lucide-react';
import { voiceManager } from '../../services/voice/voiceManager';
import { ActiveCallSession } from '../../services/voice/voiceTypes';

export const CallModal: React.FC = () => {
  const [activeCall, setActiveCall] = useState<ActiveCallSession | null>(voiceManager.activeCall);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const unsub = voiceManager.subscribe(() => {
      setActiveCall(voiceManager.activeCall ? { ...voiceManager.activeCall } : null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let interval: any = null;
    if (activeCall?.state === 'CONNECTED' && activeCall.connectedAt) {
      interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - (activeCall.connectedAt || Date.now())) / 1000));
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeCall?.state, activeCall?.connectedAt]);

  if (!activeCall) {
    return null;
  }

  // Incoming Call Ringing
  if (activeCall.state === 'INCOMING_RINGING') {
    return (
      <div className="modal-overlay" style={{ zIndex: 9999 }}>
        <div 
          className="modal-dialog" 
          role="dialog"
          aria-modal="true"
          aria-label="Incoming voice call"
          style={{ 
            maxWidth: 380, 
            width: '100%', 
            textAlign: 'center', 
            padding: '24px 20px', 
            boxSizing: 'border-box'
          }}
        >
          <div style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: 'var(--color-green)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto',
            animation: 'pulse 1.5s infinite',
            boxShadow: '0 0 0 8px rgba(115, 150, 106, 0.25)'
          }}>
            <Phone size={36} />
          </div>

          <h3 style={{ margin: '0 0 4px 0', fontSize: '1.25rem', fontWeight: 900 }}>Incoming Voice Call</h3>
          <p style={{ margin: '0 0 20px 0', fontSize: '0.95rem', color: 'var(--color-ink-muted)' }}>
            <strong>{activeCall.peerName || 'Unknown Peer'}</strong> is calling...
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn-tactile btn-coral"
              style={{
                flex: 1,
                minWidth: 120,
                minHeight: 44,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontWeight: 700
              }}
              onClick={() => voiceManager.rejectCall('declined')}
            >
              <PhoneOff size={18} />
              Decline
            </button>

            <button
              className="btn-tactile btn-green"
              style={{
                flex: 1,
                minWidth: 120,
                minHeight: 44,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontWeight: 700
              }}
              onClick={() => voiceManager.acceptCall()}
            >
              <Phone size={18} />
              Accept
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Outgoing Call Ringing
  if (activeCall.state === 'OUTGOING_CALLING') {
    return (
      <div className="modal-overlay" style={{ zIndex: 9999 }}>
        <div 
          className="modal-dialog" 
          role="dialog"
          aria-modal="true"
          aria-label="Outgoing voice call"
          style={{ 
            maxWidth: 360, 
            width: '100%', 
            textAlign: 'center', 
            padding: '24px 20px',
            boxSizing: 'border-box'
          }}
        >
          <div style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: 'var(--color-blue)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto',
            animation: 'pulse 1.5s infinite',
            boxShadow: '0 0 0 8px rgba(78, 142, 184, 0.25)'
          }}>
            <Phone size={36} />
          </div>

          <h3 style={{ margin: '0 0 4px 0', fontSize: '1.2rem', fontWeight: 900 }}>Calling...</h3>
          <p style={{ margin: '0 0 20px 0', fontSize: '0.95rem', color: 'var(--color-ink-muted)' }}>
            Ringing <strong>{activeCall.peerName || 'Peer'}</strong>
          </p>

          <button
            className="btn-tactile btn-coral"
            style={{
              width: '100%',
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontWeight: 700
            }}
            onClick={() => voiceManager.endCall()}
          >
            <PhoneOff size={18} />
            Cancel Call
          </button>
        </div>
      </div>
    );
  }

  // Connecting State
  if (activeCall.state === 'CONNECTING') {
    return (
      <div className="modal-overlay" style={{ zIndex: 9999 }}>
        <div 
          className="modal-dialog" 
          role="dialog"
          aria-modal="true"
          style={{ 
            maxWidth: 360, 
            width: '100%', 
            textAlign: 'center', 
            padding: '24px 20px',
            boxSizing: 'border-box'
          }}
        >
          <div style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'var(--color-yellow)',
            color: 'var(--color-ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto'
          }}>
            <Volume2 size={32} />
          </div>

          <h3 style={{ margin: '0 0 4px 0', fontSize: '1.15rem', fontWeight: 900 }}>Connecting Audio...</h3>
          <p style={{ margin: '0 0 20px 0', fontSize: '0.88rem', color: 'var(--color-ink-muted)' }}>
            Negotiating WebRTC audio mesh with {activeCall.peerName}
          </p>

          <button
            className="btn-tactile btn-coral"
            style={{
              width: '100%',
              minHeight: 42,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontWeight: 700
            }}
            onClick={() => voiceManager.endCall()}
          >
            <PhoneOff size={16} />
            End
          </button>
        </div>
      </div>
    );
  }

  // Busy state
  if (activeCall.state === 'BUSY') {
    return (
      <div className="modal-overlay" style={{ zIndex: 9999 }}>
        <div 
          className="modal-dialog" 
          role="dialog"
          aria-modal="true"
          style={{ 
            maxWidth: 360, 
            width: '100%', 
            textAlign: 'center', 
            padding: '24px 20px',
            boxSizing: 'border-box'
          }}
        >
          <div style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'var(--color-ink-muted)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto'
          }}>
            <AlertCircle size={30} />
          </div>

          <h3 style={{ margin: '0 0 4px 0', fontSize: '1.15rem', fontWeight: 900 }}>Unavailable</h3>
          <p style={{ margin: '0 0 20px 0', fontSize: '0.88rem', color: 'var(--color-ink-muted)' }}>
            {activeCall.errorMessage || `${activeCall.peerName || 'Peer'} is unavailable.`}
          </p>

          <button
            className="btn-tactile"
            style={{ width: '100%', minHeight: 42, justifyContent: 'center', fontWeight: 700 }}
            onClick={() => voiceManager.dismissCall()}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // Ended or Failed state
  if (activeCall.state === 'ENDED' && activeCall.errorMessage) {
    return (
      <div className="modal-overlay" style={{ zIndex: 9999 }}>
        <div 
          className="modal-dialog" 
          role="dialog"
          aria-modal="true"
          style={{ 
            maxWidth: 380, 
            width: '100%', 
            textAlign: 'center', 
            padding: '24px 20px',
            boxSizing: 'border-box'
          }}
        >
          <div style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'var(--color-coral)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto'
          }}>
            <ShieldAlert size={30} />
          </div>

          <h3 style={{ margin: '0 0 6px 0', fontSize: '1.15rem', fontWeight: 900 }}>Call Failed</h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: 'var(--color-ink-muted)', lineHeight: 1.4 }}>
            {activeCall.errorMessage}
          </p>

          {activeCall.errorMessage?.includes('HTTPS') && typeof window !== 'undefined' && window.location.protocol !== 'https:' && (
            <div style={{ marginBottom: 14 }}>
              <a
                href={`https://${window.location.hostname}:${window.location.port === '5173' ? '5173' : (window.location.port === '4173' ? '4173' : '8767')}`}
                className="btn-tactile btn-sm"
                style={{
                  display: 'inline-flex',
                  justifyContent: 'center',
                  background: 'var(--color-blue)',
                  color: '#fff',
                  textDecoration: 'none'
                }}
              >
                Switch to Direct HTTPS
              </a>
            </div>
          )}

          <button
            className="btn-tactile"
            style={{ width: '100%', minHeight: 42, justifyContent: 'center', fontWeight: 700 }}
            onClick={() => voiceManager.dismissCall()}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return null;
};
