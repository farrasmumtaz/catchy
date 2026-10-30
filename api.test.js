import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from './api.js';

test('an HTML fallback from an unconfigured proxy is never mistaken for a logged-in user', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>app</html>', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(api('/auth/me'), /Respons API tidak valid/);
});

test('rate-limit errors show the retry delay supplied by the server', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ message: 'Terlalu banyak percobaan.' }), {
    status: 429, headers: { 'content-type': 'application/json', 'retry-after': '42' },
  }));
  await assert.rejects(api('/auth/login'), error => error.status === 429 && error.message.includes('42 detik'));
});
