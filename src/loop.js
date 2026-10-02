export function quantize(beat, grid, length) {
  return grid ? (Math.round(beat / grid) * grid) % length : beat;
}

export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const bytes = new ArrayBuffer(44 + buffer.length * channels * 2);
  const view = new DataView(bytes);
  const word = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE');
  word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
  const data = Array.from({length: channels}, (_, i) => buffer.getChannelData(i));
  let peak = 1;
  for (const channel of data) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  for (let i = 0; i < buffer.length; i++) for (let c = 0; c < channels; c++) {
    const value = data[c][i] / peak;
    view.setInt16(44 + (i * channels + c) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export class LoopStudio {
  constructor(audio, changed, played) {
    Object.assign(this, { audio, changed, played, bpm: 120, bars: 4, grid: 0.25,
      layers: [], running: false, metronome: false, countIn: true, take: null, serial: 0 });
    this.timer = setInterval(() => this.tick(), 25);
  }
  get length() { return this.bars * 4; }
  get beat() { return (this.audio.ctx.currentTime - this.startTime) * this.bpm / 60; }
  start(record = false) {
    this.running = true;
    this.startTime = this.audio.ctx.currentTime + 0.12 + (record && this.countIn ? 240 / this.bpm : 0);
    this.cursor = (this.audio.ctx.currentTime - this.startTime) * this.bpm / 60;
    if (record) this.take = { start: 0, events: [] };
    this.changed(); this.tick();
  }
  record() {
    if (this.take) { this.finish(); return; }
    if (!this.running) { this.start(true); return; }
    this.take = { start: Math.ceil((this.beat + 0.2) / this.length) * this.length, events: [] };
    this.changed();
  }
  capture(key) {
    if (!this.take) return;
    const position = this.beat - this.take.start;
    if (position >= 0 && position < this.length) this.take.events.push({ key, beat: position });
  }
  finish() {
    if (this.take?.events.length) this.layers.push({ id: ++this.serial, events: this.take.events, muted: false });
    this.take = null; this.changed();
  }
  stop() {
    if (this.take) this.finish();
    this.running = false; this.audio.silence(); this.changed();
  }
  tick() {
    if (!this.running) return;
    const now = this.beat;
    if (this.take && now >= this.take.start + this.length) this.finish();
    const end = now + 0.1 * this.bpm / 60;
    const from = Math.max(this.cursor, now);
    const when = beat => this.startTime + beat * 60 / this.bpm;
    for (let beat = Math.ceil(from); beat < end; beat++) {
      if (this.metronome || (this.take && beat < this.take.start)) this.audio.click(when(beat), beat % 4 === 0);
    }
    const pending = this.take?.events.length ? [{ id: this.serial + 1, events: this.take.events, firstBeat: this.take.start + this.length }] : [];
    for (const layer of [...this.layers, ...pending]) {
      if (layer.muted) continue;
      for (const event of layer.events) {
        const offset = quantize(event.beat, this.grid, this.length);
        const cycle = Math.max(0, Math.ceil((Math.max(from, layer.firstBeat ?? 0) - offset) / this.length));
        const beat = cycle * this.length + offset;
        if (beat >= from && beat < end) {
          this.audio.play(event.key, when(beat), layer.id);
          this.played(event.key, Math.max(0, (when(beat) - this.audio.ctx.currentTime) * 1000));
        }
      }
    }
    this.cursor = end;
  }
  async export() {
    const layers = this.layers.filter(layer => !layer.muted);
    if (!layers.length) throw new Error('Record an audible layer first.');
    const duration = this.length * 60 / this.bpm;
    const rate = 44100;
    const frames = Math.round(duration * rate);
    const maxTail = Math.max(...layers.flatMap(l => l.events.map(e => this.audio.buffers.get(e.key).duration)));
    const warmup = Math.ceil(maxTail / duration);
    const context = new OfflineAudioContext(2, frames * (warmup + 1), rate);
    for (let cycle = 0; cycle <= warmup; cycle++) for (const layer of layers) for (const event of layer.events) {
      const source = context.createBufferSource();
      source.buffer = this.audio.buffers.get(event.key);
      const gain = context.createGain(); gain.gain.value = 0.72;
      source.connect(gain).connect(context.destination);
      source.start(cycle * frames / rate + quantize(event.beat, this.grid, this.length) * 60 / this.bpm);
    }
    const rendered = await context.startRendering();
    const loop = new AudioBuffer({numberOfChannels: 2, length: frames, sampleRate: rate});
    for (let channel = 0; channel < 2; channel++) loop.copyToChannel(rendered.getChannelData(channel).subarray(warmup * frames), channel);
    return new Blob([encodeWav(loop)], {type: 'audio/wav'});
  }
}
