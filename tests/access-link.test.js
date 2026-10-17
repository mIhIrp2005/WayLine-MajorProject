// Automated Test: Access Link, Interface Detection & QR Target Stability
import assert from 'node:assert';
import os from 'node:os';

console.log('[TEST] Starting Access Link & Interface Filtering Verification...');

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
  'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.1.140' }],
  'Ethernet': [{ family: 'IPv4', internal: false, address: '10.0.0.52' }]
};

const ranked = filterTestAdapters(mockNics);
assert.strictEqual(ranked[0].name, 'Wi-Fi', 'Physical Wi-Fi must rank higher than vEthernet and VirtualBox');
assert.strictEqual(ranked[0].priority, 100);
assert.strictEqual(ranked[ranked.length - 1].priority, 1, 'vEthernet or VirtualBox must have lowest priority');
console.log('✓ Network adapter ranking & virtual interface exclusion verified');

// 2. Verify Canonical URL vs Local Node URL resolution logic
function computePhoneUrls(envPublicUrl, listeningAddress, browserOrigin) {
  const canonicalAppUrl = envPublicUrl || browserOrigin || '';
  const isListeningValid = Boolean(
    listeningAddress && 
    !listeningAddress.includes('Awaiting') && 
    !listeningAddress.includes('unreachable') &&
    !listeningAddress.includes('Checking')
  );
  const localNodeUrl = isListeningValid ? `http://${listeningAddress}` : '';
  const directPhoneUrl = localNodeUrl || canonicalAppUrl;
  return { canonicalAppUrl, localNodeUrl, directPhoneUrl };
}

// Case A: Node connected with valid IP
const resA = computePhoneUrls('https://wayline.app', '192.168.1.140:8765', 'http://localhost:5173');
assert.strictEqual(resA.canonicalAppUrl, 'https://wayline.app');
assert.strictEqual(resA.localNodeUrl, 'http://192.168.1.140:8765');
assert.strictEqual(resA.directPhoneUrl, 'http://192.168.1.140:8765');
console.log('✓ Valid local node address properly overrides for subnet pairing');

// Case B: Startup state before daemon connects ("Awaiting local node...")
const resB = computePhoneUrls('https://wayline.app', 'Awaiting local node...', 'http://localhost:5173');
assert.strictEqual(resB.localNodeUrl, '', 'Placeholder string must not produce a localNodeUrl');
assert.strictEqual(resB.directPhoneUrl, 'https://wayline.app', 'Fallback to canonical PWA URL must be clean');
assert.ok(!resB.directPhoneUrl.includes('Awaiting'), 'Never leak placeholder strings into target URL');
console.log('✓ Startup pending placeholder cleanly falls back to canonical PWA URL');

// Case C: Node offline / unreachable
const resC = computePhoneUrls('', 'Local node unreachable', 'http://localhost:5173');
assert.strictEqual(resC.localNodeUrl, '');
assert.strictEqual(resC.directPhoneUrl, 'http://localhost:5173');
console.log('✓ Standalone offline mode uses clean browser origin');

console.log('[TEST] All Access Link & Interface tests PASSED successfully!\n');
