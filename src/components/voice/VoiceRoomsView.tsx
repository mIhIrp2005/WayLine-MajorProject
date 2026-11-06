import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  Users, 
  Plus, 
  Mic, 
  MicOff, 
  LogOut, 
  ShieldAlert, 
  PhoneCall, 
  Download,
  X
} from 'lucide-react';
import { voiceManager } from '../../services/voice/voiceManager';
import { VoiceRoomInfo, VoiceParticipant } from '../../services/voice/voiceTypes';
import { VoicePermissionsService } from '../../services/voice/voicePermissions';

export const VoiceRoomsView: React.FC = () => {
  const [roomsList, setRoomsList] = useState<VoiceRoomInfo[]>(voiceManager.roomsList);
  const [activeRoomInfo, setActiveRoomInfo] = useState<VoiceRoomInfo | null>(
    voiceManager.activeRoom ? voiceManager.activeRoom.getRoomInfo() : null
  );
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const env = VoicePermissionsService.checkEnvironment();
  const secContext = env.isSecure;
  const isInsideActiveRoom = !!activeRoomInfo;

  useEffect(() => {
    const unsub = voiceManager.subscribe(() => {
      setRoomsList([...voiceManager.roomsList]);
      setActiveRoomInfo(voiceManager.activeRoom ? voiceManager.activeRoom.getRoomInfo() : null);
    });

    voiceManager.refreshRoomsList();

    return () => unsub();
  }, []);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomTitle.trim()) return;
    const title = newRoomTitle.trim();
    setNewRoomTitle('');
    setIsCreating(false);
    try {
      await voiceManager.createRoom(title);
    } catch (err: any) {
      alert(`Could not create voice room: ${err.message}`);
    }
  };

  return (
    <div className="view-container" style={{ paddingBottom: 100 }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Radio size={24} color="var(--color-coral)" />
            Voice Communications
          </h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-ink-muted)' }}>
            Zero-internet browser audio mesh & group rooms
          </span>
        </div>

        {!isInsideActiveRoom && (
          <button
            className="btn-tactile btn-sm btn-coral"
            onClick={() => setIsCreating(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
          >
            <Plus size={16} />
            New Room
          </button>
        )}
      </div>

      {/* HTTPS Security Banner */}
      {!secContext && (
        <div className="bento-card" style={{ background: '#FFF3CD', borderColor: '#FFEBAA', marginBottom: 20, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <ShieldAlert size={22} color="#D97706" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
              <strong>Direct HTTPS Recommended for Mobile Voice:</strong>
              <p style={{ margin: '4px 0 8px 0', color: '#555' }}>
                Mobile browsers require HTTPS to allow microphone capture. You can open directly via HTTPS—no certificate file download or install is required:
              </p>
              {(() => {
                const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
                const curPort = typeof window !== 'undefined' ? window.location.port : '5173';
                const httpsPort = curPort === '5173' ? '5173' : (curPort === '4173' ? '4173' : '8767');
                const directHttpsUrl = `https://${host}:${httpsPort}`;
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <a
                      href={directHttpsUrl}
                      className="btn-tactile btn-sm"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'var(--color-blue)',
                        color: '#fff',
                        textDecoration: 'none'
                      }}
                    >
                      <Radio size={14} />
                      Open via Direct HTTPS ({directHttpsUrl})
                    </a>
                    <span style={{ fontSize: 11, color: '#777' }}>
                      (Tap <strong>Advanced → Proceed</strong> when Chrome shows the warning)
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Create Voice Channel Modal Popup */}
      {isCreating && (
        <div 
          className="modal-overlay" 
          onClick={(e) => { if (e.target === e.currentTarget) setIsCreating(false); }}
          style={{ zIndex: 9999 }}
        >
          <div 
            className="modal-dialog" 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="voice-channel-modal-title"
            style={{ maxWidth: 440, width: '100%', padding: '20px 18px', boxSizing: 'border-box' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ background: 'var(--color-yellow)', padding: 6, borderRadius: 6, border: '1.5px solid var(--color-ink)', display: 'inline-flex' }}>
                  <Radio size={20} color="var(--color-ink)" />
                </div>
                <h3 id="voice-channel-modal-title" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900 }}>New Voice Channel</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                aria-label="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={20} />
              </button>
            </div>
            
            <p style={{ fontSize: '0.82rem', color: 'var(--color-ink-muted)', marginBottom: 16, lineHeight: 1.4 }}>
              Create an open voice channel for connected peers on this Wi-Fi / hotspot mesh.
            </p>

            <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Channel Name
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Field Ops Alpha, Medical Triage, Command"
                  value={newRoomTitle}
                  onChange={(e) => setNewRoomTitle(e.target.value)}
                  autoFocus
                  maxLength={40}
                  style={{ width: '100%', padding: '10px 12px', fontSize: '0.95rem', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn-tactile btn-sm"
                  onClick={() => setIsCreating(false)}
                  style={{ minHeight: 40 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-tactile btn-sm btn-green"
                  disabled={!newRoomTitle.trim()}
                  style={{ minHeight: 40, fontWeight: 700 }}
                >
                  Create Channel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ACTIVE ROOM DISPLAY */}
      {isInsideActiveRoom && activeRoomInfo && (
        <div className="bento-card" style={{ background: 'var(--color-paper-card)', borderColor: 'var(--color-card-border)', borderWidth: 2, marginBottom: 24, padding: '16px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  background: 'var(--color-green)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 4
                }}>
                  ACTIVE ROOM
                </span>
                <span style={{ fontSize: 12, color: 'var(--color-ink-muted)' }}>
                  {activeRoomInfo.participants.length} / 4 Mesh Limit
                </span>
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 900, margin: '6px 0 0 0' }}>{activeRoomInfo.name}</h3>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn-tactile btn-sm btn-green"
                onClick={() => voiceManager.toggleMute()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 700
                }}
              >
                <Mic size={15} />
                Toggle Mic
              </button>

              <button
                className="btn-tactile btn-sm btn-coral"
                onClick={() => voiceManager.leaveRoom()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 700
                }}
              >
                <LogOut size={15} />
                Leave
              </button>
            </div>
          </div>

          {/* Participant Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
            gap: 10,
            marginTop: 14
          }}>
            {activeRoomInfo.participants.map((p: VoiceParticipant) => {
              const isSpeaking = p.isSpeaking;
              const isMuted = p.isMuted;

              return (
                <div
                  key={p.peerId}
                  style={{
                    background: 'var(--color-paper)',
                    border: '1.5px solid var(--color-card-border)',
                    borderRadius: 8,
                    padding: '10px 8px',
                    textAlign: 'center',
                    boxShadow: isSpeaking ? '0 0 0 2px var(--color-green)' : '1px 1px 0px var(--shadow-tactile)',
                    transition: 'box-shadow 0.15s ease'
                  }}
                >
                  <div style={{
                    position: 'relative',
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: 'var(--color-blue)',
                    color: '#FFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 8px auto',
                    fontWeight: 800,
                    fontSize: 16,
                    boxShadow: isSpeaking ? '0 0 10px var(--color-green)' : 'none'
                  }}>
                    {p.peerName ? p.peerName.charAt(0).toUpperCase() : '?'}
                    {isMuted && (
                      <div style={{
                        position: 'absolute',
                        bottom: -2,
                        right: -2,
                        background: 'var(--color-coral)',
                        borderRadius: '50%',
                        padding: 3,
                        color: '#FFF'
                      }}>
                        <MicOff size={10} />
                      </div>
                    )}
                  </div>

                  <div style={{
                    fontWeight: 700,
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {p.peerName}
                  </div>

                  <div style={{ fontSize: 10, color: isSpeaking ? 'var(--color-green)' : 'var(--color-ink-muted)', fontWeight: isSpeaking ? 700 : 400, marginTop: 2 }}>
                    {isSpeaking ? 'Speaking...' : (isMuted ? 'Muted' : 'Listening')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AVAILABLE ROOMS LIST */}
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={18} />
          Active Mesh Rooms ({roomsList.length})
        </h3>

        {roomsList.length === 0 ? (
          <div className="bento-card" style={{ background: 'var(--color-paper-card)', border: '2px solid var(--color-card-border)', textAlign: 'center', padding: '32px 16px', color: 'var(--color-ink-muted)' }}>
            <Radio size={36} color="var(--color-ink-muted)" style={{ margin: '0 auto 12px auto' }} />
            <h4 style={{ margin: '0 0 6px 0', fontSize: 15, fontWeight: 700, color: 'var(--color-ink)' }}>No Active Voice Rooms</h4>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4 }}>
              Open a new room above to start group communication with connected peers on this Wi-Fi.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {roomsList.map((room: VoiceRoomInfo) => {
              const isJoined = activeRoomInfo?.id === room.id;
              const isFull = room.participants.length >= 4;

              return (
                <div
                  key={room.id}
                  className="bento-card"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                    background: 'var(--color-paper-card)',
                    padding: '12px 16px',
                    borderColor: isJoined ? 'var(--color-green)' : 'var(--color-card-border)'
                  }}
                >
                  <div style={{ minWidth: 160 }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: 15, fontWeight: 800 }}>{room.name}</h4>
                    <div style={{ fontSize: 12, color: 'var(--color-ink-muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>Host: {room.creatorName || 'Peer'}</span>
                      <span>•</span>
                      <span>{room.participants.length} / 4 participants</span>
                    </div>
                  </div>

                  <div>
                    {isJoined ? (
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-green)' }}>Current Room</span>
                    ) : (
                      <button
                        className="btn-tactile btn-sm btn-green"
                        disabled={isFull || isInsideActiveRoom}
                        onClick={() => voiceManager.joinRoom(room.id)}
                        style={{ padding: '6px 14px', fontSize: 12, minHeight: 36 }}
                      >
                        {isFull ? 'Room Full' : 'Join Voice'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Private 1-on-1 Call Hint */}
      <div style={{
        marginTop: 24,
        background: '#EFF6FF',
        border: '1px solid #BFDBFE',
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
        color: '#1E40AF'
      }}>
        <PhoneCall size={18} style={{ flexShrink: 0 }} />
        <span>
          <strong>Direct 1-on-1 Calling:</strong> Switch to the <strong>Nearby</strong> tab to place a private, direct call to any individual connected peer.
        </span>
      </div>
    </div>
  );
};
