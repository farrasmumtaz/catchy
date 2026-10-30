import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayInit } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/postgres-adapter';
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Server, Socket } from 'socket.io';
import type { Response } from 'express';
import { Database } from './db.js';
import { AuthGuard, AuthRequest, AuthService, COOKIE, cookieOptions } from './auth.js';

export class NewMessage {
  @IsString() @Matches(/^[a-z0-9][a-z0-9_.-]{2,31}$/) recipient!: string;
  @IsString() @Length(1, 4000) body!: string;
  @IsUUID('4') clientId!: string;
}
class HistoryPage {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) before?: number;
}
export interface ChatMessage { id: number; sender: string; recipient: string; body: string; clientId: string; createdAt: Date }

@WebSocketGateway({ maxHttpBufferSize: 8192 })
export class ChatGateway implements OnGatewayConnection, OnGatewayInit {
  @WebSocketServer() server!: Server;
  constructor(private readonly auth: AuthService, private readonly db: Database) {
    auth.revoked.on('session', (hash: string) => this.logout(hash));
  }
  afterInit(server: Server) {
    server.adapter(createAdapter(this.db, { channelPrefix: 'cathcy', errorHandler: () => console.error('Sinkronisasi chat PostgreSQL terputus.') }));
  }
  async handleConnection(client: Socket) {
    try {
      // Same-origin polling GETs can omit Origin; the browser supplies Referer instead.
      const headers = client.handshake.headers;
      const origin = headers.origin ?? (headers.referer ? new URL(headers.referer).origin : null);
      if (origin !== process.env.APP_ORIGIN) { client.disconnect(true); return; }
      const cookies = Object.fromEntries((client.handshake.headers.cookie ?? '').split(';').map(part => {
        const index = part.indexOf('=');
        return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
      }));
      const identity = await this.auth.resolve(cookies[COOKIE]);
      if (!identity || !client.connected) { client.disconnect(true); return; }
      await client.join([`user:${identity.userId}`, `session:${identity.sessionHash}`]);
      const timer = setTimeout(() => client.disconnect(true), Math.max(0, identity.expiresAt.getTime() - Date.now()));
      client.once('disconnect', () => clearTimeout(timer));
      client.emit('session:ready');
    } catch { client.disconnect(true); }
  }
  changed(sender: string, recipient: string) {
    this.server.to(`user:${sender}`).to(`user:${recipient}`).emit('messages:changed');
  }
  logout(hash: string) { this.server?.in(`session:${hash}`).disconnectSockets(true); }
}

const messageColumns = `m.id, s.username AS sender, r.username AS recipient,
  m.body, m.client_id AS "clientId", m.created_at AS "createdAt"`;

@Injectable()
export class ChatService {
  constructor(private readonly db: Database, private readonly gateway: ChatGateway) {}
  async user(username: string) {
    const result = await this.db.query<{ id: string; username: string }>('SELECT id,username FROM app_users WHERE username=$1', [username]);
    if (!result.rows[0]) throw new NotFoundException('Username aplikasi tidak ditemukan. Buat akun aplikasi di browser tujuan dahulu.');
    return result.rows[0];
  }
  async send(sender: string, input: NewMessage) {
    if (!input.body.trim()) throw new BadRequestException('Pesan tidak boleh kosong.');
    const recipient = await this.user(input.recipient);
    const inserted = await this.db.query<{ id: number }>(
      `INSERT INTO chat_messages(sender_id,recipient_id,client_id,body) VALUES($1,$2,$3,$4)
       ON CONFLICT(sender_id,client_id) DO NOTHING RETURNING id`, [sender, recipient.id, input.clientId, input.body]);
    const result = await this.db.query<ChatMessage>(
      `SELECT ${messageColumns} FROM chat_messages m JOIN app_users s ON s.id=m.sender_id JOIN app_users r ON r.id=m.recipient_id
       WHERE m.sender_id=$1 AND m.client_id=$2`, [sender, input.clientId]);
    const message = result.rows[0];
    if (message.recipient !== input.recipient || message.body !== input.body) throw new ConflictException('ID pesan sudah digunakan.');
    if (inserted.rowCount) this.gateway.changed(sender, recipient.id);
    return message;
  }
  async history(userId: string, username: string, before?: number) {
    const peer = await this.user(username);
    const result = await this.db.query<ChatMessage>(
      `SELECT ${messageColumns} FROM chat_messages m JOIN app_users s ON s.id=m.sender_id JOIN app_users r ON r.id=m.recipient_id
       WHERE ((m.sender_id=$1 AND m.recipient_id=$2) OR (m.sender_id=$2 AND m.recipient_id=$1))
       AND ($3::integer IS NULL OR m.id<$3) ORDER BY m.id DESC LIMIT 51`, [userId, peer.id, before ?? null]);
    const messages = result.rows.slice(0, 50).reverse();
    return { messages, hasMore: result.rows.length > 50, nextBefore: messages[0]?.id ?? null };
  }
  async conversations(userId: string) {
    const result = await this.db.query<{ username: string; lastMessage: string; updatedAt: Date }>(
      `SELECT u.username, latest.body AS "lastMessage", latest.created_at AS "updatedAt" FROM (
         SELECT DISTINCT ON (peer_id) peer_id, body, created_at, id FROM (
           SELECT CASE WHEN sender_id=$1 THEN recipient_id ELSE sender_id END AS peer_id, body, created_at, id
           FROM chat_messages WHERE sender_id=$1 OR recipient_id=$1
         ) messages ORDER BY peer_id, id DESC
       ) latest JOIN app_users u ON u.id=latest.peer_id ORDER BY latest.id DESC LIMIT 200`, [userId]);
    return result.rows;
  }
}

@Controller('api') @UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService, private readonly auth: AuthService) {}
  @Get('users/:username') user(@Param('username') username: string) { return this.chat.user(username); }
  @Get('conversations') conversations(@Req() req: AuthRequest) { return this.chat.conversations(req.identity.userId); }
  @Get('messages/:username') history(@Req() req: AuthRequest, @Param('username') username: string, @Query() page: HistoryPage) {
    return this.chat.history(req.identity.userId, username, page.before);
  }
  @Post('messages') send(@Req() req: AuthRequest, @Body() body: NewMessage) { return this.chat.send(req.identity.userId, body); }
  @Post('auth/logout') @HttpCode(200)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.revoke(req.identity.sessionHash);
    res.clearCookie(COOKIE, cookieOptions());
    return { ok: true };
  }
}
