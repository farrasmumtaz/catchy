import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

export function databaseSchema() {
  const schema = process.env.DATABASE_SCHEMA ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('DATABASE_SCHEMA tidak valid.');
  return schema;
}

@Injectable()
export class Database extends Pool implements OnApplicationShutdown {
  constructor() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi.');
    super({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 10000,
      options: `-c search_path=${databaseSchema()}`,
      ...(process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true,
        ca: readFileSync(new URL('../certs/supabase-ca.crt', import.meta.url), 'utf8') } } : {}),
    });
    this.on('error', () => console.error('Koneksi idle PostgreSQL terputus.'));
  }
  async onApplicationShutdown() { await this.end(); }
}
