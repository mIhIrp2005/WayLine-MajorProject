// WAYLINE Local HTTPS Certificate Generator
// Generates a local self-signed certificate with Subject Alternative Names (SAN) for
// wayline.local, localhost, and all detected LAN IP addresses.
// Uses native Windows PowerShell PKI commands (zero new npm dependencies).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const certsDir = path.resolve('server', 'certs');
if (!fs.existsSync(certsDir)) {
  fs.mkdirSync(certsDir, { recursive: true });
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const ips = new Set(['127.0.0.1']);
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.add(iface.address);
      }
    }
  }
  return Array.from(ips);
}

export function generateCertificates() {
  console.log('[WAYLINE] Generating local SSL/TLS certificate for secure WebRTC voice calling...');
  const ips = getLocalIpAddresses();
  const dnsNames = ['wayline.local', 'localhost'];
  
  // Build RFC 5280 SAN entries separating DNS names and IP addresses
  const sanEntries = [
    ...dnsNames.map(d => `DNS=${d}`),
    ...ips.map(ip => `IPAddress=${ip}`)
  ];
  const sanText = sanEntries.join('&');

  const pfxPath = path.join(certsDir, 'wayline.pfx');
  const crtPath = path.join(certsDir, 'wayline-ca.crt');
  const tempPs1 = path.join(certsDir, 'gen-temp.ps1');

  const psScript = [
    `$ErrorActionPreference = 'Stop'`,
    `$san = "2.5.29.17={text}${sanText}"`,
    `$basic = "2.5.29.19={text}ca=1&pathlength=1"`,
    `$eku = "2.5.29.37={text}1.3.6.1.5.5.7.3.1"`,
    `$cert = New-SelfSignedCertificate -Subject "CN=wayline.local" -CertStoreLocation "Cert:\\CurrentUser\\My" -NotAfter (Get-Date).AddYears(3) -TextExtension @($san, $basic, $eku) -KeyUsage DigitalSignature,KeyEncipherment,CertSign -Type Custom`,
    `$pwd = ConvertTo-SecureString -String "wayline_offline" -Force -AsPlainText`,
    `Export-PfxCertificate -Cert $cert -FilePath "${pfxPath}" -Password $pwd | Out-Null`,
    `Export-Certificate -Cert $cert -FilePath "${crtPath}" | Out-Null`,
    `Remove-Item ("Cert:\\CurrentUser\\My\\" + $cert.Thumbprint)`,
    `Write-Output "SUCCESS"`
  ].join('\r\n');

  try {
    fs.writeFileSync(tempPs1, psScript, 'utf8');
    const output = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tempPs1}"`, {
      encoding: 'utf8'
    });
    try { fs.unlinkSync(tempPs1); } catch {}

    if (output.includes('SUCCESS') || fs.existsSync(pfxPath)) {
      // Sync CA cert to public/ directory for Vite dev server static access
      try {
        const publicDir = path.resolve('public');
        if (fs.existsSync(publicDir) && fs.existsSync(crtPath)) {
          fs.copyFileSync(crtPath, path.join(publicDir, 'wayline-ca.crt'));
        }
      } catch {}

      console.log(`[WAYLINE] Certificate generated successfully!`);
      console.log(`  PFX: ${pfxPath}`);
      console.log(`  CRT (for mobile trust installation): ${crtPath}`);
      console.log(`  SANs: ${sanEntries.join(', ')}`);
      return true;
    }
  } catch (err) {
    console.warn('[WAYLINE] Automatic PowerShell certificate generation warning:', err.message);
    try { fs.unlinkSync(tempPs1); } catch {}
  }
  return false;
}

if (process.argv[1] && process.argv[1].endsWith('generate-cert.js')) {
  generateCertificates();
}
