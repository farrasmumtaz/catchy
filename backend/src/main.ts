import type { Server } from 'node:http';
import { createApp } from './app.js';

const app = await createApp();
await app.init();
const server: Server = app.getHttpServer();

// Vercel needs the HTTP server itself to forward WebSocket upgrades.
if (!process.env.VERCEL) {
  await app.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '127.0.0.1');
  console.log(`Cathcy API siap pada port ${process.env.PORT ?? 3001}.`);
}

export default server;
