import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureCamera, replaceVideoTrack, releaseMedia } from './media.js';

const track = () => ({ kind: 'video', enabled: true, stopped: false, stop() { this.stopped = true; } });

test('camera preview requests video only and the selected device', async () => {
  let requested;
  const stream = {};
  assert.equal(await captureCamera('rear-camera', { getUserMedia: async constraints => { requested = constraints; return stream; } }), stream);
  assert.equal(requested.audio, false);
  assert.equal(requested.video.deviceId.exact, 'rear-camera');
});

test('camera permission errors are understandable', async () => {
  await assert.rejects(captureCamera('', { getUserMedia: async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); } }), /Izin kamera ditolak/);
  await assert.rejects(captureCamera('', {}), /HTTPS atau localhost/);
});

test('switching cameras preserves mute state and releases the previous device after replacement', async () => {
  const previous = track(), next = track(); previous.enabled = false;
  const sender = { track: previous, async replaceTrack(value) { assert.equal(previous.stopped, false); this.track = value; } };
  await replaceVideoTrack({ getSenders: () => [sender] }, next);
  assert.equal(sender.track, next); assert.equal(next.enabled, false); assert.equal(previous.stopped, true);
  const local = { srcObject: { getTracks: () => [next] } };
  releaseMedia({ getSenders: () => [sender] }, [local]);
  assert.equal(next.stopped, true); assert.equal(local.srcObject, null);
});

test('failed switching keeps the old camera and releases the unused replacement', async () => {
  const previous = track(), next = track();
  const sender = { track: previous, replaceTrack: async () => { throw new Error('Negotiation required'); } };
  await assert.rejects(replaceVideoTrack({ getSenders: () => [sender] }, next), /sebelumnya tetap/);
  assert.equal(previous.stopped, false); assert.equal(next.stopped, true);
});

test('audio-only calls cannot silently add an unnegotiated video track', async () => {
  const next = track();
  await assert.rejects(replaceVideoTrack({ getSenders: () => [] }, next), /hanya tersedia pada video call/);
  assert.equal(next.stopped, true);
});
