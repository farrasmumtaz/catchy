import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) {
  console.log('backend/.env sudah tersedia; tidak diubah.');
  process.exit(0);
}
function sql(statement) {
  const result = spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--', 'runuser', '-u', 'postgres', '--', 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error('Provisioning PostgreSQL gagal. Periksa WSL Ubuntu dan layanan PostgreSQL.');
  return result.stdout.trim();
}
const exists = sql("SELECT (SELECT count(*) FROM pg_roles WHERE rolname='cathcy_app') + (SELECT count(*) FROM pg_database WHERE datname='cathcy_app');");
if (exists !== '0') throw new Error('Role atau database cathcy_app sudah ada. Isi backend/.env dari konfigurasi sebelumnya; tidak ada data yang dihapus.');
const password = randomBytes(32).toString('hex');
sql(`CREATE ROLE cathcy_app LOGIN PASSWORD '${password}';\nCREATE DATABASE cathcy_app OWNER cathcy_app;`);
writeFileSync(envPath, `DATABASE_URL=postgres://cathcy_app:${password}@127.0.0.1:5432/cathcy_app\nAPP_ORIGIN=http://127.0.0.1:5173\nHOST=127.0.0.1\nPORT=3001\nNODE_ENV=development\n`, { mode: 0o600, flag: 'wx' });
console.log('Database cathcy_app dibuat. Konfigurasi rahasia tersimpan di backend/.env (diabaikan Git).');
