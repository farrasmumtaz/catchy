import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { Database } from '../dist/db.js';

// From repository root: node --env-file=.env backend/scripts/smoke-production.mjs
// Creates two isolated accounts, then removes only their messages and accounts.
const origin = process.env.APP_ORIGIN;
assert.ok(origin?.startsWith('https://'), 'APP_ORIGIN must use HTTPS');
const db = new Database(), ids = [];
// Reserve cleanup capacity before creating any QA account.
const cleanup = await db.connect();
let socket;
async function request(path, cookie = '', body, status = 200) {
  const response = await fetch(`${origin}/api${path}`, {
    method: body ? 'POST' : 'GET', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, status, `HTTP on ${path}`);
  return response;
}
async function register() {
  const username = `qa_cloud_${randomUUID().replaceAll('-', '').slice(0, 16)}`, password = randomUUID();
  const response = await request('/auth/register', '', { username, password }, 201);
  const user = await response.json(); ids.push(user.id);
  const cookieHeader = response.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/i); assert.match(cookieHeader, /Secure/i);
  return { username, password, cookie: cookieHeader.split(';')[0] };
}
function event(name) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off(name, done); reject(new Error(`Timeout: ${name}`)); }, 30_000);
    const done = () => { clearTimeout(timeout); resolve(); };
    socket.once(name, done);
  });
}
try {
  assert.equal((await (await request('/health')).json()).ok, true);
  const a = await register(), b = await register();
  assert.equal((await (await request('/auth/me', a.cookie)).json()).username, a.username);
  await request('/auth/login', '', { username: a.username, password: randomUUID() }, 401);
  const login = await request('/auth/login', a.cookie, { username: a.username, password: a.password });
  a.cookie = login.headers.get('set-cookie').split(';')[0];
  socket = io(origin, { autoConnect: false, transports: ['websocket'], reconnection: false,
    extraHeaders: { Cookie: b.cookie, Origin: origin } });
  const ready = event('session:ready'); socket.connect(); await ready;
  const changed = event('messages:changed'), body = 'Production smoke check';
  const payload = { recipient: b.username, body, clientId: randomUUID() };
  await request('/messages', a.cookie, payload, 201); await changed;
  await request('/messages', a.cookie, payload, 201);
  const history = await (await request(`/messages/${a.username}`, b.cookie)).json();
  assert.equal(history.messages.length, 1); assert.equal(history.messages[0].body, body);
  assert.equal((await (await request('/conversations', b.cookie)).json())[0].username, a.username);
  const disconnected = event('disconnect');
  await request('/auth/logout', b.cookie, {}); await disconnected;
  await request('/auth/me', b.cookie, undefined, 401);
} finally {
  socket?.disconnect();
  await cleanup.query('DELETE FROM chat_messages WHERE sender_id=ANY($1::uuid[]) OR recipient_id=ANY($1::uuid[])', [ids]);
  await cleanup.query('DELETE FROM app_users WHERE id=ANY($1::uuid[])', [ids]);
  cleanup.release();
  await db.end();
}

console.log('PASS: HTTPS health, secure cookies, register/login, invalid credentials, WebSocket delivery, persisted history, idempotency, conversations, logout, and QA cleanup.');
