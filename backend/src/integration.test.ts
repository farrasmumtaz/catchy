import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { io, Socket } from 'socket.io-client';
import { createApp } from './app.js';
import { sessionHash } from './auth.js';

function event(socket: Socket, name: string) {
  return new Promise<unknown>(resolve => {
    const timer = setTimeout(() => { socket.disconnect(); resolve('TIMEOUT'); }, 5000);
    socket.once(name, value => { clearTimeout(timer); resolve(value ?? 'OK'); });
  });
}

test('real PostgreSQL: auth, authorization, WebSocket, pagination, offline delivery, and restart durability', { timeout: 40000 }, async t => {
  assert.ok(process.env.DATABASE_URL, 'Set DATABASE_URL to the development database before running integration tests');
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const origin = process.env.APP_ORIGIN!;
  let app = await createApp();
  await app.listen(0, '127.0.0.1');
  let base = await app.getUrl();
  const names = ['a', 'b', 'c'].map(letter => `qa_${randomUUID().replaceAll('-', '').slice(0, 14)}_${letter}`);
  const ids: string[] = [], sockets: Socket[] = [];
  const identities = new Map<string, string>();
  const password = 'Test739!';
  const request = (path: string, cookie = '', method = 'GET', body?: object, requestOrigin = origin) => fetch(`${base}/api${path}`, {
    method, headers: { Origin: requestOrigin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  async function register(username: string) {
    const response = await request('/auth/register', '', 'POST', { username, password });
    assert.equal(response.status, 201);
    const data = await response.json() as { id: string; username: string };
    ids.push(data.id);
    identities.set(data.username, data.id);
    const header = response.headers.get('set-cookie')!;
    assert.match(header, /HttpOnly/i); assert.match(header, /SameSite=Lax/i);
    assert.equal('password_hash' in data, false);
    return header.split(';')[0];
  }
  function socket(cookie: string, requestOrigin = origin, polling = false) {
    const client = io(base, { autoConnect: false, transports: polling ? ['polling'] : ['websocket'], reconnection: false,
      extraHeaders: polling ? { Cookie: cookie, Referer: `${requestOrigin}/` } : { Cookie: cookie, Origin: requestOrigin } });
    sockets.push(client); return client;
  }
  t.after(async () => {
    sockets.forEach(client => client.disconnect());
    await app.close();
    // Delete only records created by this test's random identities.
    await db.query('DELETE FROM chat_messages WHERE sender_id=ANY($1::uuid[]) OR recipient_id=ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM app_users WHERE id=ANY($1::uuid[])', [ids]);
    await db.end();
  });
  const [alice, bob, outsider] = await Promise.all(names.map(register));

  await t.test('normal session checks do not consume the login limiter', async () => {
    for (let i = 0; i < 20; i++) assert.equal((await request('/auth/me', alice)).status, 200);
  });

  await t.test('rejects unauthenticated, invalid, forged, and cross-origin requests', async () => {
    assert.equal((await request('/conversations')).status, 401);
    assert.equal((await request('/conversations', 'cathcy_session=invalid')).status, 401);
    assert.equal((await request('/auth/login', '', 'POST', { username: names[0], password: 'Wrong-password-739!' })).status, 401);
    assert.equal((await request('/messages', alice, 'POST', { recipient: names[1], body: 'hello', clientId: randomUUID(), sender: names[2] })).status, 400);
    assert.equal((await request('/messages', alice, 'POST', { recipient: names[1], body: '   ', clientId: randomUUID() })).status, 400);
    assert.equal((await request('/messages', alice, 'POST', { recipient: names[1], body: 'hello', clientId: randomUUID() }, 'https://other.invalid')).status, 403);
    const anonymous = socket(''); const disconnected = event(anonymous, 'disconnect'); anonymous.connect();
    assert.equal(await disconnected, 'io server disconnect');
    const crossOrigin = socket(alice, 'https://other.invalid', true);
    const rejected = event(crossOrigin, 'disconnect'); crossOrigin.connect();
    assert.equal(await rejected, 'io server disconnect');
  });

  // Match a browser polling handshake: same-origin GET has Referer but no Origin.
  const receiver = socket(bob, origin, true); const ready = event(receiver, 'session:ready'); receiver.connect();
  assert.equal(await ready, 'OK');
  const payload = { recipient: names[1], body: '<img src=x onerror=alert(1)>', clientId: randomUUID() };
  let firstId = 0;
  await t.test('persists a message and notifies its recipient; retries are idempotent', async () => {
    const notification = event(receiver, 'messages:changed');
    const response = await request('/messages', alice, 'POST', payload);
    assert.equal(response.status, 201);
    const message = await response.json() as { id: number; body: string; sender: string };
    firstId = message.id;
    assert.equal(message.body, payload.body); assert.equal(message.sender, names[0]);
    assert.equal(await notification, 'OK');
    const duplicate = await (await request('/messages', alice, 'POST', payload)).json() as { id: number };
    assert.equal(duplicate.id, firstId);
    assert.equal((await request('/messages', alice, 'POST', { ...payload, body: 'different content' })).status, 409);
    const page = await (await request(`/messages/${names[0]}`, bob)).json() as { messages: { id: number }[] };
    assert.equal(page.messages[0].id, firstId);
    const forbidden = await (await request(`/messages/${names[0]}`, outsider)).json() as { messages: unknown[] };
    assert.equal(forbidden.messages.length, 0, 'An outsider cannot retrieve Alice/Bob messages');
  });

  await t.test('loads paginated history without missing or duplicating messages', async () => {
    await db.query(`INSERT INTO chat_messages(sender_id,recipient_id,client_id,body)
      SELECT $1,$2,gen_random_uuid(),'history ' || i FROM generate_series(1,52) AS i`, [identities.get(names[0]), identities.get(names[1])]);
    const recent = await (await request(`/messages/${names[0]}`, bob)).json() as { messages: { id: number }[]; hasMore: boolean; nextBefore: number };
    assert.equal(recent.messages.length, 50); assert.equal(recent.hasMore, true);
    const older = await (await request(`/messages/${names[0]}?before=${recent.nextBefore}`, bob)).json() as { messages: { id: number }[]; hasMore: boolean };
    const all = [...older.messages, ...recent.messages].map(message => message.id);
    assert.equal(all.length, 53); assert.equal(new Set(all).size, 53);
    assert.equal(all[0], firstId); assert.equal(older.hasMore, false);
    assert.equal((await request(`/messages/${names[0]}?before=-1`, bob)).status, 400);
  });

  await t.test('offline messages and login sessions survive API restart', async () => {
    receiver.disconnect();
    const offline = { ...payload, clientId: randomUUID(), body: 'Stored while recipient is offline' };
    assert.equal((await request('/messages', alice, 'POST', offline)).status, 201);
    await app.close();
    app = await createApp(); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    assert.equal((await request('/auth/me', bob)).status, 200);
    const page = await (await request(`/messages/${names[0]}`, bob)).json() as { messages: { body: string }[] };
    assert.equal(page.messages.at(-1)?.body, offline.body);
    const conversations = await (await request('/conversations', bob)).json() as { username: string }[];
    assert.equal(conversations[0].username, names[0]);
  });

  await t.test('logout disconnects the session socket and revokes its cookie; expired sessions are rejected', async () => {
    const live = socket(bob); const joined = event(live, 'session:ready'); live.connect(); assert.equal(await joined, 'OK');
    const disconnected = event(live, 'disconnect');
    assert.equal((await request('/auth/logout', bob, 'POST')).status, 200);
    assert.equal(await disconnected, 'io server disconnect');
    assert.equal((await request('/auth/me', bob)).status, 401);
    const token = outsider.slice(outsider.indexOf('=') + 1);
    await db.query('UPDATE app_sessions SET expires_at=now()-interval \'1 second\' WHERE token_hash=$1', [sessionHash(token)]);
    assert.equal((await request('/auth/me', outsider)).status, 401);
    const response = await request('/auth/login', '', 'POST', { username: names[1], password });
    assert.equal(response.status, 200);
  });

  await t.test('repeated login failures remain limited without blocking an existing session', async () => {
    let limited: Response | undefined;
    for (let i = 0; i < 16; i++) {
      const response = await request('/auth/login', '', 'POST', { username: names[0], password: 'incorrect-password' });
      assert.ok([401, 429].includes(response.status));
      if (response.status === 429) limited = response;
    }
    assert.ok(limited);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.match((await limited.json() as { message: string }).message, /Terlalu banyak/);
    assert.equal((await request('/auth/me', alice)).status, 200);
  });
});
