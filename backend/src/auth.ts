import { Body, CanActivate, ConflictException, Controller, ExecutionContext, Get, HttpCode, Injectable, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import type { Request, Response, CookieOptions } from 'express';
import { Database } from './db.js';

const derive = promisify(scrypt);
export const COOKIE = 'cathcy_session';
export const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const cookieOptions = (): CookieOptions => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });

export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex || hex.length !== 128) return false;
  return timingSafeEqual(await derive(password, salt, 64) as Buffer, Buffer.from(hex, 'hex'));
}

export class Credentials {
  @IsString() @Matches(/^[a-z0-9][a-z0-9_.-]{2,31}$/, { message: 'Username harus 3 sampai 32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.' }) username!: string;
  @IsString() @Length(8, 128, { message: 'Password aplikasi harus 8 sampai 128 karakter.' }) password!: string;
}
export interface Identity { userId: string; username: string; sessionHash: string; expiresAt: Date }
export interface AuthRequest extends Request { identity: Identity }

@Injectable()
export class AuthService {
  readonly revoked = new EventEmitter();
  constructor(private readonly db: Database) {}
  async resolve(token: unknown): Promise<Identity | null> {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const result = await this.db.query<{ userId: string; username: string; expiresAt: Date }>(
      `SELECT u.id AS "userId", u.username, s.expires_at AS "expiresAt"
       FROM app_sessions s JOIN app_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now()`, [sessionHash(token)]);
    return result.rows[0] ? { ...result.rows[0], sessionHash: sessionHash(token) } : null;
  }
  async createSession(user: { id: string; username: string }, response: Response) {
    const oldToken: unknown = response.req.cookies?.[COOKIE];
    if (typeof oldToken === 'string') await this.revoke(sessionHash(oldToken));
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.db.query('DELETE FROM app_sessions WHERE expires_at<=now()');
    await this.db.query('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [sessionHash(token), user.id, expires]);
    response.cookie(COOKIE, token, { ...cookieOptions(), expires });
    return { id: user.id, username: user.username };
  }
  async register(credentials: Credentials, response: Response) {
    const hash = await passwordHash(credentials.password);
    const result = await this.db.query<{ id: string; username: string }>(
      'INSERT INTO app_users(id,username,password_hash) VALUES($1,$2,$3) ON CONFLICT(username) DO NOTHING RETURNING id,username',
      [randomUUID(), credentials.username, hash]);
    if (!result.rows[0]) throw new ConflictException('Username sudah dipakai.');
    return this.createSession(result.rows[0], response);
  }
  async login(credentials: Credentials, response: Response) {
    const result = await this.db.query<{ id: string; username: string; password_hash: string }>(
      'SELECT id,username,password_hash FROM app_users WHERE username=$1', [credentials.username]);
    const user = result.rows[0];
    // Perform a password derivation even for unknown usernames.
    const hash = user?.password_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    if (!await passwordMatches(credentials.password, hash) || !user) throw new UnauthorizedException('Username atau password salah.');
    return this.createSession(user, response);
  }
  async revoke(hash: string) {
    await this.db.query('DELETE FROM app_sessions WHERE token_hash=$1', [hash]);
    this.revoked.emit('session', hash);
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const identity = await this.auth.resolve(request.cookies?.[COOKIE]);
    if (!identity) throw new UnauthorizedException('Sesi berakhir. Silakan masuk kembali.');
    request.identity = identity;
    return true;
  }
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register')
  register(@Body() body: Credentials, @Res({ passthrough: true }) res: Response) { return this.auth.register(body, res); }
  @Post('login') @HttpCode(200)
  login(@Body() body: Credentials, @Res({ passthrough: true }) res: Response) { return this.auth.login(body, res); }
  @Get('me') @UseGuards(AuthGuard)
  me(@Req() req: AuthRequest) { return { id: req.identity.userId, username: req.identity.username }; }
}
