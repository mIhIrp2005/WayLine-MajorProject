import React, { useState, useEffect } from 'react';
import { PhoneOff, Mic, MicOff, Radio, Volume2, LogOut } from 'lucide-react';
import { voiceManager } from '../../services/voice/voiceManager';
import { ActiveCallSession, VoiceRoomInfo } from '../../services/voice/voiceTypes';

export const FloatingCallBar: React.FC = () => {
  const [activeCall, setActiveCall] = useState<ActiveCallSession | null>(voiceManager.activeCall);
  const [activeRoomInfo, setActiveRoomInfo] = useState<VoiceRoomInfo | null>(
    voiceManager.activeRoom ? voiceManager.activeRoom.getRoomInfo() : null
  );
  const [callDuration, setCallDuration] = useState(0);

  useEffect(() => {
    const unsub = voiceManager.subscribe(() => {
      setActiveCall(voiceManager.activeCall ? { ...voiceManager.activeCall } : null);
      setActiveRoomInfo(voiceManager.activeRoom ? voiceManager.activeRoom.getRoomInfo() : null);
    });

    return () => unsub();
  }, []);

  // Timer for active 1-on-1 call
  useEffect(() => {
    let interval: any = null;
    if (activeCall?.state === 'CONNECTED' && activeCall.connectedAt) {
      interval = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - (activeCall.connectedAt || Date.now())) / 1000));
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeCall?.state, activeCall?.connectedAt]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const isInCall = activeCall && (activeCall.state === 'CONNECTED' || activeCall.state === 'CONNECTING');
  const isInRoom = !!activeRoomInfo;

  if (!isInCall && !isInRoom) {
    return null;
  }

  // Active 1-to-1 Call bar
  if (isInCall && activeCall) {
    const isMuted = activeCall.isMuted;
    return (
      <div style={{
        position: 'fixed',
        bottom: 'calc(68px + env(safe-area-inset-bottom, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 20px)',
        maxWidth: 520,
        boxSizing: 'border-box',
        backgroundColor: '#292D29',
        color: '#FFFDF7',
        border: '2px solid #000',
        borderRadius: 12,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        boxShadow: '3px 3px 0px rgba(0,0,0,0.3)',
        zIndex: 9000
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{
            position: 'relative',
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: activeCall.state === 'CONNECTED' ? '#4CAF50' : '#F59E0B',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: activeCall.audioLevel > 0.15 ? '0 0 10px #4CAF50' : 'none'
          }}>
            <Volume2 size={18} color="#fff" />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{
              fontWeight: 700,
              fontSize: 14,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {activeCall.peerName || 'Private Call'}
            </div>
            <div style={{ fontSize: 11, color: '#A0AEC0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{activeCall.state === 'CONNECTED' ? formatDuration(callDuration) : 'Connecting...'}</span>
              <span>•</span>
              <span style={{ color: isMuted ? '#FF4D4D' : '#4CAF50' }}>
                {isMuted ? 'Muted' : 'Mic Active'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => voiceManager.toggleMute()}
            style={{
              background: isMuted ? '#FF4D4D' : '#4A5568',
              color: '#fff',
              border: '1px solid #718096',
              borderRadius: '50%',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          <button
            onClick={() => voiceManager.endCall()}
            style={{
              background: '#E53E3E',
              color: '#fff',
              border: '1px solid #9B2C2C',
              borderRadius: 8,
              padding: '6px 14px',
              fontWeight: 700,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer'
            }}
          >
            <PhoneOff size={15} />
            End
          </button>
        </div>
      </div>
    );
  }

  // Active Voice Room Bar
  if (isInRoom && activeRoomInfo) {
    const isMuted = voiceManager.diagnostics.activeAudioTracks === 0;
    const participantCount = activeRoomInfo.participants.length;

    return (
      <div style={{
        position: 'fixed',
        bottom: 'calc(68px + env(safe-area-inset-bottom, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 20px)',
        maxWidth: 520,
        boxSizing: 'border-box',
        backgroundColor: '#1E293B',
        color: '#FFFDF7',
        border: '2px solid #000',
        borderRadius: 12,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        boxShadow: '3px 3px 0px rgba(0,0,0,0.3)',
        zIndex: 9000
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#3B82F6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Radio size={18} color="#fff" />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{
              fontWeight: 700,
              fontSize: 14,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {activeRoomInfo.name}
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{participantCount} in room</span>
              <span>•</span>
              <span style={{ color: '#34D399' }}>Mesh Active</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => voiceManager.toggleMute()}
            style={{
              background: isMuted ? '#EF4444' : '#334155',
              color: '#fff',
              border: '1px solid #475569',
              borderRadius: '50%',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          <button
            onClick={() => voiceManager.leaveRoom()}
            style={{
              background: '#DC2626',
              color: '#fff',
              border: '1px solid #991B1B',
              borderRadius: 8,
              padding: '6px 12px',
              fontWeight: 700,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer'
            }}
          >
            <LogOut size={15} />
            Leave
          </button>
        </div>
      </div>
    );
  }

  return null;
};
