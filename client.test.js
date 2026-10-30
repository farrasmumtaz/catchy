import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sipAddress, parseIceServers, mergeMessages } from './model.js';
import { releaseMedia, cameraConstraints, captureCamera, replaceVideoTrack } from './media.js';

// Exercise actual browser handlers; SIP transport and HTTP are replaced here only.
async function client(signedIn = true, publicPreview = false) {
  const markup = readFileSync(new URL('./src.js', import.meta.url), 'utf8');
  const source = readFileSync(new URL('./app-client.js', import.meta.url), 'utf8');
  class Element {
    children = []; selectors = {}; value = ''; textContent = ''; className = '';
    disabled = false; modalOpened = false; scrollHeight = 0; scrollTop = 0;
    querySelector(selector) {
      if (selector === '.welcome') return this.children.find(child => child.className === 'welcome');
      return this.selectors[selector] ??= new Element();
    }
    cloneNode() { const clone = new Element(); clone.className = this.className; return clone; }
    get firstElementChild() { return this.children[0]; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    addEventListener(name, callback) { this[name] = callback; }
    showModal() { this.modalOpened = true; }
    close() { this.modalOpened = false; }
    focus() { this.focused = true; }
    play() { return Promise.resolve(); }
  }
  const elements = Object.fromEntries([...markup.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  const welcome = new Element(); welcome.className = 'welcome'; elements.messages.append(welcome);
  class UA extends EventEmitter {
    registered = false;
    constructor() { super(); agents.push(this); }
    isRegistered() { return this.registered; }
    start() { this.emit('connecting'); }
    stop() { this.registered = false; this.emit('unregistered'); }
  }
  const agents = [], requests = [];
  const api = async (path, options) => {
    requests.push({ path, options });
    if (!signedIn) { const error = new Error('Sesi berakhir'); error.status = 401; throw error; }
    if (path === '/auth/me') return { id: 'test-user', username: '1001' };
    if (path === '/conversations') return [];
    if (path.startsWith('/users/')) return { username: path.slice(7) };
    if (path.startsWith('/messages/')) return { messages: [], hasMore: false, nextBefore: null };
    throw new Error('Unexpected API request: ' + path);
  };
  const sockets = [];
  class Realtime extends EventEmitter { connectCalls = 0; connect() { this.connectCalls++; this.emit('session:ready'); } disconnect() {} }
  vm.runInNewContext(source.replace(/^import .+;\r?\n/gm, '').replace('export function startClient', 'function startClient') + '\nstartClient(JsSIP);', {
    document: { getElementById: id => elements[id], createElement: () => new Element(), querySelector: () => new Element() },
    window: { addEventListener() {} }, JsSIP: { UA, WebSocketInterface: class {} },
    sipAddress, parseIceServers, mergeMessages, releaseMedia, cameraConstraints, captureCamera, replaceVideoTrack, publicPreview,
    api, openRealtime: () => { const socket = new Realtime(); sockets.push(socket); return socket; }, URL,
    setTimeout() {}, clearTimeout() {}, crypto: { randomUUID: () => 'test-client-id' },
  });
  await new Promise(setImmediate);
  const submit = { preventDefault() {} };
  async function connect(username) {
    Object.entries({ ws: 'ws://localhost:8080/ws', domain: 'localhost', username, password: 'test-only', ice: '' })
      .forEach(([id, value]) => { elements[id].value = value; });
    await elements.connect.onsubmit(submit);
    return agents.at(-1);
  }
  return { elements, connect, submit, requests, sockets };
}

test('application chat works independently of SIP and reconnects preserve the draft', async () => {
  const { elements: e, connect, submit, requests } = await client();
  const action = () => e.messages.querySelector('.welcome').querySelector('button');
  assert.match(action().textContent, /Tambah percakapan/);
  assert.match(e.subtitle.textContent, /1001/);
  e.messages.click({ target: { closest: () => action() } });
  assert.equal(e.target.focused, true);
  e.target.value = '1002'; await e.contact.onsubmit(submit);
  assert.equal(e.message.disabled, false, 'Chat must not require SIP registration');
  assert.equal(e.voice.disabled, true);
  assert.ok(requests.some(request => request.path === '/messages/1002'));
  const ua = await connect('1001'); ua.registered = true; ua.emit('registered');
  assert.equal(e.voice.disabled, false);
  e.message.value = 'Draft belum dikirim';
  ua.registered = false; ua.emit('unregistered'); ua.emit('disconnected');
  assert.equal(e.voice.disabled, true);
  assert.equal(e.message.disabled, false);
  ua.registered = true; ua.emit('registered');
  assert.equal(e.name.textContent, '1002');
  assert.equal(e.message.value, 'Draft belum dikirim');
});

test('SIP callbacks from an old account cannot replace current SIP status', async () => {
  const { elements: e, connect } = await client();
  const old = await connect('1001'), current = await connect('1002');
  current.registered = true; current.emit('registered');
  old.registered = true; old.emit('registered'); old.emit('registrationFailed', { cause: 'Old failure' });
  assert.match(e.status.textContent, /1002@localhost/);
  assert.doesNotMatch(e.status.textContent, /Old failure/);
});

test('incoming calls can be answered without a public session.request property', async () => {
  const { elements: e, connect } = await client();
  const ua = await connect('1002');
  const incoming = new EventEmitter();
  incoming.remote_identity = { uri: { toString: () => 'sip:1001@localhost' } };
  let answerOptions;
  incoming.answer = options => { answerOptions = options; };
  ua.emit('newRTCSession', { session: incoming, originator: 'remote' });
  await e.answer.onclick();
  assert.ok(answerOptions, 'The accept button must invoke JsSIP answer()');
  assert.equal(answerOptions.mediaConstraints, undefined);
  assert.equal(answerOptions.pcConfig.iceServers.length, 0);
  assert.equal(e.answer.hidden, true);
  incoming.emit('failed', { cause: 'Test cleanup' });
  assert.equal(e.call.modalOpened, false);
});

test('an expired application session cannot enable chat just by registering SIP', async () => {
  const { elements: e, connect } = await client(false);
  const ua = await connect('1001'); ua.registered = true; ua.emit('registered');
  assert.equal(e.message.disabled, true);
  assert.equal(e.target.disabled, true);
  assert.match(e.messages.querySelector('.welcome').querySelector('button').textContent, /Masuk/);
});

test('short or autofilled passwords show an inline error without sending a login request', async () => {
  const { elements: e, requests, submit } = await client(false);
  e.auth.showModal();
  e.appUsername.value = '1001';
  e.appPassword.value = '1234567';
  await e.authForm.onsubmit(submit);
  assert.match(e.authError.textContent, /8 sampai 128/);
  assert.equal(e.auth.modalOpened, true);
  assert.equal(e.authSubmit.disabled, false);
  assert.equal(requests.some(request => request.path === '/auth/login'), false);
  e.authMode.onclick();
  assert.equal(e.authError.textContent, '');
});

test('server login errors remain visible inside the open authentication dialog', async () => {
  const { elements: e, submit } = await client(false);
  e.auth.showModal();
  e.appUsername.value = '1001';
  e.appPassword.value = 'abcdefgh';
  await e.authForm.onsubmit(submit);
  assert.equal(e.authError.textContent, 'Sesi berakhir');
  assert.equal(e.auth.modalOpened, true);
});

test('the HTML username pattern compiles with the browser Unicode Sets flag', () => {
  const markup = readFileSync(new URL('./src.js', import.meta.url), 'utf8');
  const pattern = new RegExp(`^(?:${markup.match(/pattern="([^"]+)"/)[1]})$`, 'v');
  for (const value of ['1001', 'alice-b', 'alice.b', 'alice_b']) assert.equal(pattern.test(value), true);
  for (const value of ['a', 'a b', 'alice@host', '<script>']) assert.equal(pattern.test(value), false);
});

test('a server-rejected socket does not create a reconnect and session-check loop', async () => {
  const { elements: e, sockets, requests } = await client();
  sockets[0].emit('disconnect', 'io server disconnect');
  await new Promise(setImmediate);
  assert.equal(sockets[0].connectCalls, 1);
  assert.equal(requests.filter(request => request.path === '/auth/me').length, 2);
  assert.match(e.appStatus.textContent, /ditolak server/);
});

test('the public camera preview does not pretend an unavailable backend is connected', async () => {
  const { elements: e, requests } = await client(false, true);
  assert.equal(requests.length, 0);
  assert.equal(e.accountButton.disabled, true);
  assert.equal(e.settingsButton.disabled, true);
  assert.match(e.appStatus.textContent, /chat belum tersedia/);
  assert.match(e.messages.querySelector('.welcome').querySelector('button').textContent, /Periksa kamera/);
});
