import 'reflect-metadata';
import { Controller, Get, Module, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { Database } from './db.js';
import { AuthController, AuthGuard, AuthService } from './auth.js';
import { ChatController, ChatGateway, ChatService } from './chat.js';

@Controller('api')
class HealthController {
  constructor(private readonly db: Database) {}
  @Get('health') async health() {
    try { await this.db.query('SELECT 1'); return { ok: true }; }
    catch { throw new ServiceUnavailableException('Database tidak tersedia.'); }
  }
}
@Module({ controllers: [HealthController, AuthController, ChatController], providers: [Database, AuthService, AuthGuard, ChatGateway, ChatService] })
export class AppModule {}

export async function createApp() {
  if (!process.env.APP_ORIGIN || new URL(process.env.APP_ORIGIN).origin !== process.env.APP_ORIGIN) throw new Error('APP_ORIGIN wajib berupa origin tanpa trailing slash.');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.use(helmet());
  app.use(cookieParser());
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== process.env.APP_ORIGIN) {
      res.status(403).json({ message: 'Origin tidak diizinkan.' }); return;
    }
    next();
  });
  // shortcut: per-process limits, use shared storage before running multiple API instances.
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { message: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.' } }));
  app.use('/api/auth', rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false,
    skip: (req: Request) => req.method !== 'POST' || !['/login', '/register'].includes(req.path),
    message: { message: 'Terlalu banyak percobaan login atau daftar.' } }));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, validationError: { target: false, value: false } }));
  app.enableShutdownHooks();
  return app;
}
