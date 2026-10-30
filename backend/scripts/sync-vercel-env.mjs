import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const env = parseEnv(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8'));
const npxCli = join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');
if (process.platform === 'win32' && !fs.existsSync(npxCli)) throw new Error('npx-cli.js tidak ditemukan pada instalasi Node.js.');
const keys = ['DATABASE_URL', 'DATABASE_REALTIME_URL', 'APP_ORIGIN', 'NODE_ENV', 'HOST', 'PORT', 'DATABASE_SCHEMA', 'DATABASE_SSL'];
for (const key of keys) {
  if (!env[key]) throw new Error(`${key} belum diisi di .env utama.`);
  const result = spawnSync(process.platform === 'win32' ? process.execPath : 'npx', [
    ...(process.platform === 'win32' ? [npxCli] : []),
    '--yes', 'vercel@latest', 'env', 'add', key, '--environment', 'production',
    '--project', 'catchy', '--scope', 'farras-mumtazs-projects', '--force', '--yes',
    ...(key === 'DATABASE_URL' || key === 'DATABASE_REALTIME_URL' ? ['--sensitive'] : ['--no-sensitive']),
  ], { cwd: root, input: env[key], encoding: 'utf8', shell: false, windowsHide: true });
  // Environment values travel through stdin and are never echoed to the console.
  if (result.status !== 0) throw new Error(`Gagal menyimpan ${key} di Vercel. Tidak ada nilai rahasia yang ditampilkan.`);
  console.log(`${key}: tersimpan di production.`);
}
