import test from 'node:test';
import assert from 'node:assert/strict';
import { quantize, encodeWav, LoopStudio } from '../src/loop.js';
const make = () => {
  const calls = [];
  const audio = {ctx: {currentTime: 0}, play: (...args) => calls.push(args), silence() {}, click() {}};
  const studio = new LoopStudio(audio, () => {}, () => {});
  clearInterval(studio.timer); studio.bars = 1; studio.countIn = false;
  return {audio, studio, calls};
};
test('quantization wraps at loop boundary and leaves source timing unchanged', () => {
  const event = {beat: 3.98};
  assert.equal(quantize(event.beat, .25, 4), 0);
  assert.equal(quantize(event.beat, 0, 4), 3.98);
  assert.equal(event.beat, 3.98);
});
test('recording completes once and schedules the new layer at its first boundary', () => {
  const {audio, studio, calls} = make(); studio.start(true);
  audio.ctx.currentTime = .12; studio.capture('q');
  audio.ctx.currentTime = 2.06; studio.tick();
  assert.equal(calls.length, 1); assert.equal(calls[0][1], 2.12);
  audio.ctx.currentTime = 2.13; studio.tick(); studio.tick();
  assert.equal(studio.layers.length, 1); assert.equal(studio.take, null);
  assert.equal(calls.length, 1);
});
test('count-in excludes early hits and stop preserves a partial layer', () => {
  const {audio, studio} = make(); studio.countIn = true; studio.start(true);
  studio.capture('q'); assert.equal(studio.take.events.length, 0);
  audio.ctx.currentTime = 2.3; studio.capture('w'); studio.stop();
  assert.equal(studio.layers[0].events.length, 1); assert.equal(studio.running, false);
});
test('muted layers are not scheduled', () => {
  const {studio, calls} = make(); studio.layers = [{id: 1, muted: true, events:[{key:'q',beat:0}]}];
  studio.start(); assert.equal(calls.length, 0);
});
test('WAV header, stereo interleaving and peak protection', () => {
  const bytes = encodeWav({numberOfChannels:2, length:2, sampleRate:44100, getChannelData:i => i ? new Float32Array([-2,0]) : new Float32Array([2,1])});
  const view = new DataView(bytes);
  assert.equal(bytes.byteLength,52); assert.equal(view.getUint32(24,true),44100);
  assert.equal(view.getUint16(22,true),2); assert.equal(view.getInt16(44,true),32767);
  assert.equal(view.getInt16(46,true),-32768); assert.equal(view.getInt16(48,true),16384);
});
