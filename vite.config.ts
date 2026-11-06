import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const pfxPath = path.resolve('server', 'certs', 'wayline.pfx');
const httpsConfig = fs.existsSync(pfxPath)
  ? { pfx: fs.readFileSync(pfxPath), passphrase: 'wayline_offline' }
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: httpsConfig
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    https: httpsConfig
  }
});
