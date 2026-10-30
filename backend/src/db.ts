import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import { readFileSync } from 'node:fs';

export function databaseSchema() {
  const schema = process.env.DATABASE_SCHEMA ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('DATABASE_SCHEMA tidak valid.');
  return schema;
}

function databaseOptions(connectionString: string): PoolConfig {
  return { connectionString, max: 2, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10000,
    application_name: `cathcy:${process.env.VERCEL_DEPLOYMENT_ID ?? 'local'}`,
    options: `-c search_path=${databaseSchema()}`,
    ...(process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true,
      ca: readFileSync(new URL('../certs/supabase-ca.crt', import.meta.url), 'utf8') } } : {}),
  };
}

@Injectable()
export class Database extends Pool implements OnApplicationShutdown {
  readonly realtimePool: Pool;
  constructor() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi.');
    super(databaseOptions(process.env.DATABASE_URL));
    // LISTEN needs a session connection; ordinary queries can use transaction pooling.
    this.realtimePool = process.env.DATABASE_REALTIME_URL
      ? new Pool(databaseOptions(process.env.DATABASE_REALTIME_URL)) : this;
    this.on('error', () => console.error('Koneksi idle PostgreSQL terputus.'));
    if (this.realtimePool !== this) this.realtimePool.on('error', () => console.error('Koneksi realtime PostgreSQL terputus.'));
  }
  async onApplicationShutdown() {
    if (this.realtimePool !== this) await this.realtimePool.end();
    await this.end();
  }
}
