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

function hasCommand(cmd) {
  try {
    const checkCmd = os.platform() === 'win32' ? `where.exe ${cmd}` : `command -v ${cmd} || which ${cmd}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function generateCertificates() {
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
  const keyPath = path.join(certsDir, 'key.pem');

  // 1. Windows: Native PowerShell PKI
  if (os.platform() === 'win32' && hasCommand('powershell.exe')) {
    console.log('[WAYLINE] Generating local SSL/TLS certificate for secure WebRTC voice calling (Windows PKI)...');
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
        syncPublicCrt(crtPath);
        console.log(`[WAYLINE] Certificate generated successfully!`);
        console.log(`  PFX: ${pfxPath}`);
        console.log(`  CRT: ${crtPath}`);
        console.log(`  SANs: ${sanEntries.join(', ')}`);
        return true;
      }
    } catch (err) {
      console.warn('[WAYLINE] Windows certificate generation notice:', err.message);
      try { fs.unlinkSync(tempPs1); } catch {}
    }
    return false;
  }

  // 2. Linux / Android Termux / macOS: Native OpenSSL
  if (hasCommand('openssl')) {
    console.log('[WAYLINE] Generating local SSL/TLS certificate for secure WebRTC voice calling (OpenSSL)...');
    const opensslCnf = path.join(certsDir, 'openssl.cnf');
    const cnfContent = [
      '[req]',
      'default_bits = 2048',
      'prompt = no',
      'default_md = sha256',
      'distinguished_name = dn',
      'x509_extensions = v3_ca',
      '',
      '[dn]',
      'CN = wayline.local',
      '',
      '[v3_ca]',
      'basicConstraints = critical, CA:true',
      'keyUsage = critical, digitalSignature, keyEncipherment, keyCertSign',
      'extendedKeyUsage = serverAuth',
      'subjectAltName = @alt_names',
      '',
      '[alt_names]',
      ...dnsNames.map((d, i) => `DNS.${i + 1} = ${d}`),
      ...ips.map((ip, i) => `IP.${i + 1} = ${ip}`)
    ].join('\n');

    try {
      fs.writeFileSync(opensslCnf, cnfContent, 'utf8');
      execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${crtPath}" -days 1095 -config "${opensslCnf}"`, {
        stdio: 'ignore'
      });
      execSync(`openssl pkcs12 -export -out "${pfxPath}" -inkey "${keyPath}" -in "${crtPath}" -passout pass:wayline_offline`, {
        stdio: 'ignore'
      });
      try { fs.unlinkSync(opensslCnf); } catch {}
      try { fs.unlinkSync(keyPath); } catch {}

      if (fs.existsSync(pfxPath)) {
        syncPublicCrt(crtPath);
        console.log(`[WAYLINE] Certificate generated successfully!`);
        console.log(`  PFX: ${pfxPath}`);
        console.log(`  CRT: ${crtPath}`);
        console.log(`  SANs: ${sanEntries.join(', ')}`);
        return true;
      }
    } catch (err) {
      console.warn('[WAYLINE] OpenSSL certificate generation notice:', err.message);
      try { fs.unlinkSync(opensslCnf); } catch {}
      try { fs.unlinkSync(keyPath); } catch {}
    }
    return false;
  }

  // 3. Fallback when neither PowerShell nor OpenSSL is present (e.g. fresh Termux)
  console.log('[WAYLINE] Notice: Neither PowerShell nor OpenSSL detected on host.');
  console.log('[WAYLINE] Running on plain HTTP. (To enable HTTPS on Termux, run: pkg install openssl)');
  return false;
}

function syncPublicCrt(crtPath) {
  try {
    const publicDir = path.resolve('public');
    if (fs.existsSync(publicDir) && fs.existsSync(crtPath)) {
      fs.copyFileSync(crtPath, path.join(publicDir, 'wayline-ca.crt'));
    }
  } catch {}
}

if (process.argv[1] && process.argv[1].endsWith('generate-cert.js')) {
  generateCertificates();
}
