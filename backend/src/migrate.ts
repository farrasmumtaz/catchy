import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database, databaseSchema } from './db.js';

async function migrate() {
  const db = new Database();
  try {
    const schema = databaseSchema();
    if (schema !== 'public') {
      await db.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await db.query(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC`);
    }
    await db.query(readFileSync(join(import.meta.dirname, '../schema.sql'), 'utf8'));
    console.log('Schema Cathcy siap.');
  } finally { await db.end(); }
}
migrate().catch(() => { console.error('Migrasi gagal. Periksa koneksi dan hak akses database.'); process.exitCode = 1; });
