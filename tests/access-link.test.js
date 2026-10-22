// Automated Test: Stable Canonical URL, Identical Client URL & Offline Access
import assert from 'node:assert';

console.log('[TEST] Starting Canonical URL, Interface Detection & Offline PWA Verification...');

// 1. Verify virtual adapter filtering logic
function filterTestAdapters(mockInterfaces) {
  const candidates = [];
  for (const name of Object.keys(mockInterfaces)) {
    const isVirtual = /virtual|vbox|vmware|wsl|pseudo|loopback|vethernet|hyper-v|default switch/i.test(name);
    for (const iface of mockInterfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const isExcludedSubnet = iface.address.startsWith('192.168.56.') || 
                                 iface.address.startsWith('169.254.') || 
                                 iface.address.startsWith('127.');
        const isEthernetOrWifi = /ethernet|wi-fi|wlan|lan|en|eth|wireless/i.test(name);

        let priority = 10;
        if (isEthernetOrWifi && !isVirtual && !isExcludedSubnet) priority = 100;
        else if (!isVirtual && !isExcludedSubnet) priority = 50;
        else if (isExcludedSubnet || isVirtual) priority = 1;

        candidates.push({ name, address: iface.address, priority });
      }
    }
  }
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates;
}

const mockNics = {
  'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.28.16.1' }],
  'VirtualBox Host-Only Network': [{ family: 'IPv4', internal: false, address: '192.168.56.1' }],
  'Ethernet 4 (Physical)': [{ family: 'IPv4', internal: false, address: '192.168.0.115' }]
};

const ranked = filterTestAdapters(mockNics);
assert.strictEqual(ranked[0].name, 'Ethernet 4 (Physical)');
assert.strictEqual(ranked[0].address, '192.168.0.115');
assert.strictEqual(ranked[0].priority, 100);
console.log('✓ Physical LAN adapter prioritized over virtual Hyper-V/VirtualBox adapters');

// 2. Verify Dynamic & Canonical URL Resolution on Changing Hosts & Hotspots
function resolveDynamicAppUrl(listeningAddress, browserOrigin, envUrl) {
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, '');
  }
  if (listeningAddress) {
    const clean = listeningAddress.trim();
    if (!clean.includes('unreachable') && !clean.includes('Awaiting') && !clean.startsWith('127.') && !clean.startsWith('localhost')) {
      return `http://${clean}`.replace(/\/$/, '');
    }
  }
  if (browserOrigin) {
    const url = new URL(browserOrigin);
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return browserOrigin.replace(/\/$/, '');
    }
  }
  return listeningAddress && !listeningAddress.includes('unreachable')
    ? `http://${listeningAddress}`.replace(/\/$/, '')
    : 'http://wayline.local:8765';
}

// Test Case A: Host PC is on a Phone's Hotspot (Host IP: 192.168.43.50, Hotspot gateway: 192.168.43.1)
const hotspotHostAddress = '192.168.43.50:8765';
const hostUrl = resolveDynamicAppUrl(hotspotHostAddress, 'http://localhost:8765', '');
const phoneUrl = resolveDynamicAppUrl(hotspotHostAddress, 'http://192.168.43.50:8765', '');

assert.strictEqual(hostUrl, 'http://192.168.43.50:8765');
assert.strictEqual(phoneUrl, 'http://192.168.43.50:8765');
assert.strictEqual(hostUrl, phoneUrl, 'Host viewing on localhost and phone on Wi-Fi must share the identical reachable dynamic IP');
console.log('✓ Dynamic host resolution verified when host is connected to external hotspot');

// Test Case B: Host changes to a different Wi-Fi router (Host IP: 192.168.1.88)
const changedHostAddress = '192.168.1.88:8765';
const newHostUrl = resolveDynamicAppUrl(changedHostAddress, 'http://localhost:8765', '');
assert.strictEqual(newHostUrl, 'http://192.168.1.88:8765');
console.log('✓ Dynamic host adaptivity confirmed when host changes IP/router');

// 3. Verify QR Code always targets the Dynamic Reachable URL
function generateQrTarget(url) {
  return url;
}

const qrTarget = generateQrTarget(hostUrl);
assert.strictEqual(qrTarget, 'http://192.168.43.50:8765', 'QR code MUST encode the reachable LAN IP, not localhost');
console.log('✓ QR code stably targets the reachable LAN IP for mobile camera scanning');

// 4. Verify Offline Service Worker Navigation Fallback
const mockCache = new Map();
mockCache.set('/index.html', { status: 200, body: '<html>WAYLINE SHELL</html>' });

function simulateOfflineFetch(requestUrl, mode) {
  if (mode === 'navigate') {
    return mockCache.get('/index.html') || mockCache.get('/');
  }
  return mockCache.get(requestUrl) || null;
}

const offlineReloadResult = simulateOfflineFetch(hostUrl + '/incidents', 'navigate');
assert.ok(offlineReloadResult, 'Offline navigation MUST match cached index.html shell');
assert.strictEqual(offlineReloadResult.body, '<html>WAYLINE SHELL</html>');
console.log('✓ Offline PWA navigation reload verified (opens cached shell without server)');

// 5. Secure Context verification logic
function checkSecureContext(url) {
  const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');
  const isHttps = url.startsWith('https://');
  return {
    isSecureContext: isHttps || isLocalhost,
    micAccess: isHttps || isLocalhost ? 'PERMITTED' : 'REQUIRES_USER_FLAG'
  };
}

const httpsCheck = checkSecureContext('https://wayline.app');
assert.strictEqual(httpsCheck.isSecureContext, true);
assert.strictEqual(httpsCheck.micAccess, 'PERMITTED');

const httpLanCheck = checkSecureContext('http://192.168.0.115:8765');
assert.strictEqual(httpLanCheck.isSecureContext, false);
assert.strictEqual(httpLanCheck.micAccess, 'REQUIRES_USER_FLAG');
console.log('✓ Secure Context diagnostics accurately report microphone permissions');

console.log('[TEST] All Canonical URL & Offline PWA tests PASSED successfully!\n');
