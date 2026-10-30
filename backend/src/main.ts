import { createApp } from './app.js';

async function main() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '127.0.0.1');
  console.log(`Cathcy API siap pada port ${process.env.PORT ?? 3001}.`);
}
main().catch(() => { console.error('API gagal dimulai. Periksa konfigurasi dan koneksi database.'); process.exitCode = 1; });
