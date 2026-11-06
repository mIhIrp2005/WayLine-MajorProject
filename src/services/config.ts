// WAYLINE Canonical Configuration & Dynamic Join Link Management
// Computes dynamic reachable URL across host PC, hotspots, and mobile clients

export function getCanonicalAppUrl(
  listeningAddress?: string, 
  httpsListeningAddress?: string | null, 
  hasHttps?: boolean
): string {
  // 1. Explicitly configured permanent URL (via VITE_PUBLIC_APP_URL)
  const envUrl = ((import.meta as any).env?.VITE_PUBLIC_APP_URL as string) || '';
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, '');
  }

  // 2. If HTTPS is active on daemon, prefer HTTPS for mobile microphone access
  if (hasHttps && httpsListeningAddress && !httpsListeningAddress.includes('unreachable') && !httpsListeningAddress.includes('Awaiting')) {
    return `https://${httpsListeningAddress.trim()}`.replace(/\/$/, '');
  }

  // 3. Current browser origin (if accessed directly via HTTPS or LAN IP)
  if (typeof window !== 'undefined' && window.location?.origin) {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return window.location.origin.replace(/\/$/, '');
    }
  }

  // 4. Dynamic host listening address reported by local node daemon (e.g. 192.168.43.50:8765)
  if (listeningAddress) {
    const clean = listeningAddress.trim();
    if (!clean.includes('unreachable') && !clean.includes('Awaiting') && !clean.startsWith('127.') && !clean.startsWith('localhost')) {
      return `http://${clean}`.replace(/\/$/, '');
    }
  }

  // 5. Fallback: if listeningAddress has any port/address, or mDNS domain
  if (listeningAddress && !listeningAddress.includes('unreachable') && !listeningAddress.includes('Awaiting')) {
    return `http://${listeningAddress}`.replace(/\/$/, '');
  }

  return hasHttps ? 'https://wayline.local:8767' : 'http://wayline.local:8765';
}
