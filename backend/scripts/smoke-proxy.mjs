import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import pg from 'pg';

// Run with: node --env-file=.env scripts/smoke-proxy.mjs (from backend).
const origin = 'http://127.0.0.1:5173';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ids = [];
let socket;
async function request(path, cookie = '', body) {
  const response = await fetch(`${origin}/api${path}`, {
    method: body ? 'POST' : 'GET', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(response.headers.get('content-type')?.includes('application/json'));
  assert.ok(response.ok, `HTTP ${response.status} on ${path}`);
  return response;
}
async function register() {
  const username = `qa_proxy_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const response = await request('/auth/register', '', { username, password: randomUUID() });
  ids.push((await response.json()).id);
  return { username, cookie: response.headers.get('set-cookie').split(';')[0] };
}
function event(name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${name}`)), 5000);
    socket.once(name, () => { clearTimeout(timer); resolve(); });
  });
}
try {
  for (const path of ['/src.js', '/app-client.js', '/api.js']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, `Frontend module ${path} must not be captured by the API proxy`);
    assert.match(response.headers.get('content-type') ?? '', /javascript/);
  }
  assert.equal((await (await request('/health')).json()).ok, true);
  const a = await register(), b = await register();
  for (const transport of ['polling', 'websocket']) {
    socket = io(origin, { autoConnect: false, transports: [transport], reconnection: false,
      extraHeaders: transport === 'polling' ? { Cookie: b.cookie, Referer: `${origin}/` } : { Cookie: b.cookie, Origin: origin } });
    const ready = event('session:ready'); socket.connect(); await ready;
    const changed = event('messages:changed');
    const body = `Proxy smoke check ${transport}`;
    await request('/messages', a.cookie, { recipient: b.username, body, clientId: randomUUID() });
    await changed;
    const history = await (await request(`/messages/${a.username}`, b.cookie)).json();
    assert.equal(history.messages.at(-1).body, body);
    socket.disconnect();
  }
  console.log('Frontend modules, proxy HTTP, cookie session, polling + WebSocket, and message delivery: PASS');
} finally {
  socket?.disconnect();
  await db.query('DELETE FROM chat_messages WHERE sender_id=ANY($1::uuid[]) OR recipient_id=ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM app_users WHERE id=ANY($1::uuid[])', [ids]);
  await db.end();
}
