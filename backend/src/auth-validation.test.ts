import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { Credentials } from './auth.js';

test('passwords allow 8 through 128 characters and reject values outside those bounds', async () => {
  for (const [length, accepted] of [[7, false], [8, true], [128, true], [129, false]] as const) {
    const input = Object.assign(new Credentials(), { username: '1001', password: 'a'.repeat(length) });
    assert.equal((await validate(input)).length === 0, accepted, `password length ${length}`);
  }
});
