import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupInterface } from './ui.js';

function interfaceTest(check) {
  const documentBefore = globalThis.document, windowBefore = globalThis.window;
  const element = () => ({ type: 'password', value: '', disabled: false, attributes: {}, events: {},
    addEventListener(name, callback) { this.events[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector() { return this.form ??= element(); },
    requestSubmit() { this.submits = (this.submits ?? 0) + 1; },
  });
  const elements = Object.fromEntries(['appPassword', 'toggleAppPassword', 'auth', 'password', 'toggleSipPassword', 'settings', 'authMode', 'message', 'composer'].map(id => [id, element()]));
  const properties = {}, root = { dataset: {}, style: { setProperty(name, value) { properties[name] = value; } } };
  const viewport = { ...element(), height: 844, scale: 1 };
  globalThis.document = { getElementById: id => elements[id], documentElement: root };
  globalThis.window = { ...element(), visualViewport: viewport, innerHeight: 844 };
  try { setupInterface(); check(elements, viewport, root, properties); }
  finally { globalThis.document = documentBefore; globalThis.window = windowBefore; }
}

test('password eye toggles preserve values and return to hidden on submit, close, and mode change', () => interfaceTest(e => {
  for (const [input, toggle, dialog] of [['appPassword', 'toggleAppPassword', 'auth'], ['password', 'toggleSipPassword', 'settings']]) {
    e[input].value = 'private-test-value';
    e[toggle].events.click();
    assert.equal(e[input].type, 'text'); assert.equal(e[toggle].attributes['aria-pressed'], 'true');
    assert.match(e[toggle].attributes['aria-label'], /Sembunyikan/);
    e[dialog].form.events.submit();
    assert.equal(e[input].type, 'password'); assert.equal(e[input].value, 'private-test-value');
    e[toggle].events.click(); e[dialog].events.close();
    assert.equal(e[input].type, 'password');
  }
  e.toggleAppPassword.events.click(); e.authMode.events.click();
  assert.equal(e.appPassword.type, 'password');
}));

test('composer sends on Enter while keeping Shift+Enter and IME composition intact', () => interfaceTest(e => {
  e.message.value = 'Halo'; let prevented = 0;
  const key = overrides => ({ key: 'Enter', preventDefault() { prevented++; }, ...overrides });
  e.message.events.keydown(key({ shiftKey: true }));
  e.message.events.keydown(key({ isComposing: true }));
  e.message.events.keydown(key({ keyCode: 229 }));
  assert.equal(e.composer.submits, undefined);
  e.message.events.keydown(key({}));
  assert.equal(e.composer.submits, 1); assert.equal(prevented, 1);
  e.message.disabled = true; e.message.events.keydown(key({}));
  assert.equal(e.composer.submits, 1);
}));

test('viewport follows keyboard height without overriding pinch zoom', () => interfaceTest((e, viewport, root, properties) => {
  assert.equal(properties['--app-height'], '844px');
  viewport.height = 440; viewport.events.resize();
  assert.equal(properties['--app-height'], '440px'); assert.equal(root.dataset.keyboard, 'true');
  viewport.scale = 2; viewport.height = 220; viewport.events.resize();
  assert.equal(properties['--app-height'], '440px');
  viewport.scale = 1; viewport.height = 844; viewport.events.resize();
  assert.equal(root.dataset.keyboard, 'false');
}));
