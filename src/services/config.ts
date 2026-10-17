// WAYLINE Canonical Configuration & URL Management
// Guarantees one permanent, identical URL across host machine and mobile clients

export function getCanonicalAppUrl(): string {
  // 1. Explicitly configured permanent URL (via VITE_PUBLIC_APP_URL)
  const envUrl = ((import.meta as any).env?.VITE_PUBLIC_APP_URL as string) || '';
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, '');
  }

  // 2. Browser origin fallback (if running in browser)
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }

  // 3. Default host IP fallback
  return 'http://192.168.0.115:8765';
}
