import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sipAddress, mergeMessages } from './model.js';
test('SIP destinations are normalized and reject malformed input', () => {
  assert.equal(sipAddress('1002', 'sip.example.com'), 'sip:1002@sip.example.com');
  assert.equal(sipAddress('sip:alice@example.com', ''), 'sip:alice@example.com');
  for (const value of ['', '<script>', 'a b', 'a@']) assert.throws(() => sipAddress(value, 'example.com'));
});

test('history pages and live notifications merge without duplicates or losing older messages', () => {
  const result = mergeMessages([{ id: 1, body: 'older' }, { id: 3, body: 'latest' }], [{ id: 2, body: 'middle' }, { id: 3, body: 'latest' }]);
  assert.deepEqual(result.map(message => message.id), [1, 2, 3]);
  assert.equal(result[0].body, 'older');
});
