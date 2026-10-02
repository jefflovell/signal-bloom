import test from 'node:test';
import assert from 'node:assert/strict';
import { quantize, playbackEvents, encodeWav, LoopStudio } from '../src/loop.js';
const make = () => {
  const calls = [];
  const audio = {ctx: {currentTime: 0}, play: (...args) => calls.push(args), silence() {}, click() {}};
  const studio = new LoopStudio(audio, () => {}, () => {});
  clearInterval(studio.timer); studio.bars = 1; studio.countIn = false;
  return {audio, studio, calls};
};
test('quantization uses a small early tolerance without wrapping or changing source timing', () => {
  const event = {beat: 3.98};
  assert.equal(quantize(event.beat, .25, 4), 3.75);
  assert.equal(quantize(.49, 1, 4), 0);
  assert.equal(quantize(.51, 1, 4), 0);
  assert.equal(quantize(1, 1, 4), 1);
  assert.equal(quantize(3.99, 1, 4), 3);
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
  assert.equal(calls[1][1], studio.startTime + .125);
  studio.stop(); studio.layers[0].grid = 0; calls.length = 0; studio.start();
  assert.equal(calls[0][1], studio.startTime + .19);
  assert.equal(studio.layers[1].grid, .25);
});

test("metronome starts enabled", () => { const {studio} = make(); assert.equal(studio.metronome, true); });

test('20 ms tolerance preserves 32 H hits with alternating 6 ms timing variation', () => {
  const beats = Array.from({length:32}, (_, i) => Math.max(0, i * .5 + (i % 2 ? -.012 : .012)));
  assert.deepEqual(beats.map(b => quantize(b, .5, 16, 120)), Array.from({length:32}, (_, i) => i * .5));
});
test('tolerance is measured in milliseconds at 160 BPM and does not become nearest rounding', () => {
  const beatsPerSecond = 160 / 60;
  assert.equal(quantize(.25 - .019 * beatsPerSecond, .25, 16, 160), .25);
  assert.equal(quantize(.25 - .021 * beatsPerSecond, .25, 16, 160), 0);
  assert.equal(quantize(.14, .25, 16, 160), 0);
  assert.equal(quantize(15.999, .25, 16, 160), 15.75);
  assert.equal(quantize(.24, 0, 16, 160), .24);
});
test('playback schedules repeated cycles ahead and only stops on request', () => {
  const {audio, studio, calls} = make();
  studio.layers = [{id:1, grid:.5, events:[{key:'h',beat:0},{key:'h',beat:1}]}];
  studio.start(); assert.equal(calls.length, 2);
  audio.ctx.currentTime = 1.2; studio.tick();
  assert.equal(calls.length, 4); assert.equal(calls[2][1], 2.12);
  assert.equal(calls[2][3], Infinity);
  audio.ctx.currentTime = 2.2; studio.tick(); assert.equal(studio.running, true);
  audio.ctx.currentTime = 3.3; studio.tick(); assert.equal(calls.length, 6);
  studio.stop(); assert.equal(studio.running, false);
  audio.ctx.currentTime = 5; studio.tick(); assert.equal(calls.length, 6);
});

test('20 ms tolerance recovers early hits beyond the former 10 ms allowance', () => {
  assert.equal(quantize(.5 - .019 * 2, .5, 16, 120), .5);
  assert.equal(quantize(.5 - .021 * 2, .5, 16, 120), 0);
});

test('quarter-note collisions trigger one voice per pad while Off restores every hit', () => {
  const {studio, calls} = make();
  const events = [{key:'h',beat:.06},{key:'h',beat:.52},{key:'h',beat:1.04},{key:'h',beat:1.54},{key:'q',beat:.08}];
  const original = structuredClone(events);
  const layer = {id:1,grid:1,events};
  assert.deepEqual(playbackEvents(layer,4,120).map(e=>[e.key,e.beat]), [['h',0],['h',1],['q',0]]);
  studio.layers = [layer]; studio.start(); assert.equal(calls.length,3); studio.stop();
  layer.grid = .5; assert.equal(playbackEvents(layer,4,120).length,5);
  layer.grid = 0; assert.deepEqual(playbackEvents(layer,4,120),original);
  assert.deepEqual(layer.events,original);
});
