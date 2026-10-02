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
test('recording automatically stops at bar length without replaying the take', () => {
  const {audio, studio, calls} = make(); studio.start(true);
  audio.ctx.currentTime = .12; studio.capture('q');
  audio.ctx.currentTime = 2.13; studio.tick(); studio.tick();
  assert.equal(studio.layers.length, 1); assert.equal(studio.take, null);
  assert.equal(studio.running, false); assert.equal(calls.length, 0);
});
test('four bars capture all 16 quarter-note kicks and 23 snare hits', () => {
  const {audio, studio, calls} = make(); studio.bars = 4; studio.grid = 1; studio.countIn = true;
  studio.record();
  for (let i = 0; i < 16; i++) studio.capture('q', studio.startTime + (i + .01) * .5);
  audio.ctx.currentTime = studio.endTime; studio.tick();
  assert.equal(studio.layers[0].events.length, 16);
  studio.record();
  assert(Math.abs(studio.startTime - audio.ctx.currentTime - 4.12) < 1e-9);
  assert.equal(calls.length, 16); // Entire backing pass is scheduled before UI work.
  for (let i = 0; i < 23; i++) studio.capture('w', studio.startTime + (i + .01) * 8 / 23);
  audio.ctx.currentTime = studio.endTime + .5; studio.tick();
  assert.equal(studio.layers[1].events.length, 23);
  assert.equal(studio.running, false); assert.equal(calls.length, 16);
});
test('count-in excludes early hits and stop preserves a partial layer', () => {
  const {audio, studio} = make(); studio.countIn = true; studio.start(true);
  assert.equal(studio.startTime, 4.12);
  audio.ctx.currentTime = 2.3; studio.capture('q');
  assert.equal(studio.take.events.length, 0);
  audio.ctx.currentTime = 4.3; studio.capture('w'); studio.stop();
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
test('new takes are unquantized and each layer saves its own grid and playback preserves independent timing', () => {
  const {audio, studio, calls} = make();
  studio.record(); studio.capture('q', studio.startTime + .19); studio.stop();
  assert.equal(studio.layers[0].grid, 0); studio.layers[0].grid = 1;
  studio.record(); studio.capture('w', studio.startTime + .19); studio.stop();
  assert.equal(studio.layers[1].grid, 0); studio.layers[1].grid = .25;
  assert.deepEqual(studio.layers.map(l => l.grid), [1, .25]);
  calls.length = 0; studio.start();
  assert.equal(calls[0][1], studio.startTime);
  assert.equal(calls[1][1], studio.startTime + .25);
  studio.stop(); studio.layers[0].grid = 0; calls.length = 0; studio.start();
  assert.equal(calls[0][1], studio.startTime + .19);
  assert.equal(studio.layers[1].grid, .25);
});

test("metronome starts enabled", () => { const {studio} = make(); assert.equal(studio.metronome, true); });
