import type { Store } from 'express-rate-limit';
import { Database } from './db.js';

export class PostgresRateLimitStore implements Store {
  private nextCleanup = 0;
  constructor(private readonly db: Database, readonly prefix: string) {}
  async increment(key: string) {
    const result = await this.db.query<{ totalHits: number; resetTime: Date }>(
      `INSERT INTO api_rate_limits(key,total_hits,reset_at) VALUES($1,1,now()+interval '60 seconds')
       ON CONFLICT(key) DO UPDATE SET
         total_hits=CASE WHEN api_rate_limits.reset_at<=now() THEN 1 ELSE api_rate_limits.total_hits+1 END,
         reset_at=CASE WHEN api_rate_limits.reset_at<=now() THEN now()+interval '60 seconds' ELSE api_rate_limits.reset_at END
       RETURNING total_hits AS "totalHits", reset_at AS "resetTime"`, [this.prefix + key]);
    if (Date.now() >= this.nextCleanup) {
      this.nextCleanup = Date.now() + 60_000;
      await this.db.query("DELETE FROM api_rate_limits WHERE reset_at<now()-interval '1 day'");
    }
    return result.rows[0];
  }
  async decrement(key: string) { await this.db.query('UPDATE api_rate_limits SET total_hits=GREATEST(0,total_hits-1) WHERE key=$1', [this.prefix + key]); }
  async resetKey(key: string) { await this.db.query('DELETE FROM api_rate_limits WHERE key=$1', [this.prefix + key]); }
}
