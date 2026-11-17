import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Check, 
  CheckCheck, 
  Clock, 
  AlertCircle, 
  Radio, 
  Users, 
  ShieldAlert,
  HardDrive
} from 'lucide-react';
import { StoredMessage, DiscoveredPeer, LocalIdentity, DeliveryStatus } from '../types';
import { protocol } from '../services/protocol';
import { storage } from '../services/storage';
import { transport } from '../services/transport';
import { encryptAes, encryptEcdh, decryptMessage, blindRecipientId } from '../services/crypto';
import { Lock, Unlock, Key, ShieldCheck } from 'lucide-react';

interface MessagesViewProps {
  identity: LocalIdentity;
  messages: StoredMessage[];
  peers: DiscoveredPeer[];
  onMessageSent: () => void;
  onTriggerSos?: () => void;
}

export const MessagesView: React.FC<MessagesViewProps> = ({
  identity,
  messages,
  peers,
  onMessageSent,
  onTriggerSos
}) => {
  const [inputText, setInputText] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState<string>('*');
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [encryptionKey, setEncryptionKey] = useState<string>('');
  const [showKeyInput, setShowKeyInput] = useState<boolean>(false);
  const [decryptedTexts, setDecryptedTexts] = useState<Record<string, string>>({});
  const lastSendTimesRef = useRef<number[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const connectedPeers = peers.filter(p => p.status === 'CONNECTED');
  const targetPeer = peers.find(p => p.id === selectedRecipient);
  const hasPfs = Boolean(selectedRecipient !== '*' && targetPeer?.ecdhPublicKey);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Decrypt encrypted messages dynamically (AES shared passphrase or ECDH PFS)
  useEffect(() => {
    let isCancelled = false;
    const decryptAll = async () => {
      try {
        const keys = await storage.getCryptoKeys();
        const myEcdhPriv = keys?.ecdhPair?.privateKey;
        const results: Record<string, string> = {};
        for (const m of messages) {
          if (m.content && (m.content.startsWith('aes:') || m.content.startsWith('ecdh:'))) {
            results[m.id] = await decryptMessage(m.content, encryptionKey, myEcdhPriv);
          }
        }
        if (!isCancelled) {
          setDecryptedTexts(results);
        }
      } catch (err) {
        console.warn('Decryption batch error:', err);
      }
    };
    decryptAll();
    return () => { isCancelled = true; };
  }, [messages, encryptionKey]);

  // Anti-spam cooldown timer countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || sending || cooldown > 0) return;

    // Spam check: check rapid sends within the last 5 seconds
    const now = Date.now();
    const recentSends = lastSendTimesRef.current.filter(t => now - t < 5000);

    // If 4 rapid messages were already sent in 5s, block and auto-trigger SOS
    if (recentSends.length >= 4) {
      setCooldown(10); // 10-second penalty cooldown
      lastSendTimesRef.current = [];
      if (onTriggerSos) onTriggerSos();
      return;
    }

    setSending(true);
    try {
      // 1. Encryption: Pairwise ECDH PFS if recipient public key is known, otherwise AES passphrase
      let outboundContent = text;
      if (selectedRecipient !== '*' && targetPeer?.ecdhPublicKey) {
        outboundContent = await encryptEcdh(text, targetPeer.ecdhPublicKey);
      } else if (encryptionKey.trim()) {
        outboundContent = await encryptAes(text, encryptionKey.trim());
      }

      // 2. Create packet and stored representation
      const { packet, storedMessage } = protocol.createChatPacket(
        identity,
        outboundContent,
        selectedRecipient
      );

      // 3. Metadata Blinding: Mask recipient ID on wire to prevent passive hop eavesdropping
      if (selectedRecipient !== '*') {
        packet.recipientId = await blindRecipientId(selectedRecipient);
        packet.isBlinded = true;
      }

      // 4. Save in IndexedDB
      await storage.saveMessage(storedMessage);

      // 5. Dispatch over real transport
      await transport.sendPacket(packet);

      lastSendTimesRef.current = [...recentSends, now];
      setInputText('');
      onMessageSent();
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setSending(false);
    }
  };

  const renderStatusBadge = (status: DeliveryStatus, ackedBy?: string[]) => {
    switch (status) {
      case 'ACKNOWLEDGED':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#73966A', fontWeight: 700 }}>
            <CheckCheck size={14} />
            <span>ACK{ackedBy && ackedBy.length > 0 ? ` by ${ackedBy.join(', ')}` : ''}</span>
          </span>
        );
      case 'TRANSMITTED':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#5E635C', fontWeight: 600 }}>
            <Check size={14} />
            <span>TRANSMITTED</span>
          </span>
        );
      case 'SAVED_LOCALLY':
      default:
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#EA644B', fontWeight: 600 }}>
            <HardDrive size={13} />
            <span>SAVED LOCALLY (NOT SENT)</span>
          </span>
        );
    }
  };

  return (
    <div className="messages-page-container">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div className="page-title-group">
          <h1>Emergency Dispatch</h1>
          <p>Direct peer-to-peer and broadcast emergency channel</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="pill pill-muted">
            {connectedPeers.length} Peer{connectedPeers.length === 1 ? '' : 's'} in Direct Range
          </span>
        </div>
      </div>

      {/* Recipient Filter Bar */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8, 
        padding: '10px 12px', 
        background: 'var(--color-paper-card)', 
        border: '2px solid var(--color-ink)', 
        borderRadius: 'var(--radius-md)', 
        marginBottom: 16,
        boxShadow: 'var(--shadow-tactile)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 180px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
            TO:
          </span>
          <select
            value={selectedRecipient}
            onChange={(e) => setSelectedRecipient(e.target.value)}
            style={{
              flex: 1,
              minWidth: 130,
              padding: '6px 10px',
              border: '1.5px solid var(--color-ink)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-paper)',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            <option value="*">Broadcast to All Nearby (*)</option>
            {connectedPeers.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.address}){p.ecdhPublicKey ? ' [PFS]' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* PFS / AES Encryption Indicators & Key Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {hasPfs ? (
            <span 
              className="pill" 
              style={{ 
                background: '#E0F2FE', 
                color: '#0369A1', 
                border: '1.5px solid #0284C7',
                fontSize: '0.74rem', 
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px'
              }}
              title="ECDH P-256 Ephemeral Key Exchange active — Perfect Forward Secrecy enabled"
            >
              <ShieldCheck size={13} />
              <span>ECDH PFS Active</span>
            </span>
          ) : (
            <>
              <button
                type="button"
                className="btn-tactile btn-sm"
                onClick={() => setShowKeyInput(!showKeyInput)}
                style={{
                  padding: '4px 8px',
                  fontSize: '0.74rem',
                  background: encryptionKey ? '#73966A' : 'var(--color-paper)',
                  color: encryptionKey ? '#FFFFFF' : 'var(--color-ink)'
                }}
                title="Toggle AES-256 GCM encryption"
              >
                {encryptionKey ? <Lock size={13} /> : <Unlock size={13} />}
                <span>{encryptionKey ? 'AES Locked' : 'Plaintext'}</span>
              </button>

              {showKeyInput && (
                <input
                  type="password"
                  placeholder="Shared key..."
                  value={encryptionKey}
                  onChange={(e) => setEncryptionKey(e.target.value)}
                  style={{
                    width: 110,
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1.5px solid var(--color-ink)',
                    background: 'var(--color-paper)'
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Message List */}
      <div className="messages-scroll-area">
        {messages.length === 0 ? (
          <div style={{ 
            margin: 'auto', 
            textAlign: 'center', 
            color: 'var(--color-ink-muted)', 
            maxWidth: 360,
            padding: 20
          }}>
            <Radio size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-ink)' }}>No Messages Yet</h3>
            <p style={{ fontSize: '0.8rem', marginTop: 4 }}>
              Send an update below to broadcast to nearby mesh peers.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isSelf = m.senderId === identity.nodeId;
            const isEcdh = m.content && m.content.startsWith('ecdh:');
            const isAes = m.content && m.content.startsWith('aes:');
            return (
              <div 
                key={m.id} 
                className={`msg-bubble ${isSelf ? 'outgoing' : 'incoming'} ${m.type === 'SOS' ? 'sos' : ''}`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 800, fontSize: '0.85rem', color: isSelf ? 'var(--color-ink)' : '#EA644B' }}>
                    {isSelf ? 'You' : m.senderName}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div style={{ fontSize: '0.92rem', lineHeight: 1.4, wordBreak: 'break-word' }}>
                  {isEcdh && (
                    <span title="Forward Secret ECDH" style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 5 }}>
                      <ShieldCheck size={13} style={{ color: '#0284C7' }} />
                    </span>
                  )}
                  {isAes && (
                    <span title="Shared Passphrase AES" style={{ display: 'inline-flex', verticalAlign: '-1px', marginRight: 5 }}>
                      <Lock size={12} style={{ color: '#73966A' }} />
                    </span>
                  )}
                  {isEcdh || isAes ? (decryptedTexts[m.id] || '🔒 Encrypted message...') : m.content}
                </div>

                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  marginTop: 6, 
                  paddingTop: 4, 
                  borderTop: '1px dashed var(--color-border)', 
                  fontSize: '0.7rem', 
                  fontFamily: 'var(--font-mono)' 
                }}>
                  <span>Hop: {m.hopCount}/{m.ttl}</span>
                  {isSelf && renderStatusBadge(m.status, m.acknowledgedBy)}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Composer */}
      <form onSubmit={handleSendMessage} style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={connectedPeers.length > 0 ? "Type emergency update..." : "Saved locally (offline)..."}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            border: '2px solid var(--color-ink)',
            background: 'var(--color-paper-card)',
            fontSize: '0.95rem',
            fontFamily: 'inherit',
            boxShadow: 'var(--shadow-tactile)'
          }}
        />
        <button
          type="submit"
          className="btn-tactile btn-coral"
          disabled={!inputText.trim() || sending || cooldown > 0}
          style={{ padding: '10px 16px', flexShrink: 0 }}
        >
          <Send size={16} />
          <span>{sending ? '...' : cooldown > 0 ? `${cooldown}s` : 'Send'}</span>
        </button>
      </form>
    </div>
  );
};
