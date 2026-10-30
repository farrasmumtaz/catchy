import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class Database extends Pool implements OnModuleDestroy {
  constructor() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi.');
    super({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 });
    this.on('error', () => console.error('Koneksi idle PostgreSQL terputus.'));
  }
  async onModuleDestroy() { await this.end(); }
}
