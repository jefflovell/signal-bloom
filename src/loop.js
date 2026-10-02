export function quantize(beat, grid, length, bpm = 120) {
  // Allow up to 10 ms early, capped at one quarter of a subdivision.
  const tolerance = Math.min(0.01 * bpm / 60, grid / 4);
  return grid ? Math.max(0, Math.min(Math.floor((beat + tolerance) / grid) * grid, length - grid)) : beat;
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
    Object.assign(this, { audio, changed, played, bpm: 120, bars: 4,
      layers: [], running: false, metronome: true, countIn: true, take: null, serial: 0 });
    this.timer = setInterval(() => this.tick(), 25);
  }
  get length() { return this.bars * 4; }
  get beat() { return (this.audio.ctx.currentTime - this.startTime) * this.bpm / 60; }
  start(record = false) {
    if (this.running) this.stop();
    this.running = true;
    this.recordingPass = record;
    this.nextCycle = 1;
    this.startTime = this.audio.ctx.currentTime + 0.12 + (record && this.countIn ? 480 / this.bpm : 0);
    this.endTime = this.startTime + this.length * 60 / this.bpm;
    this.take = record ? { start: 0, events: [], grid: 0 } : null;
    this.visualQueue = [];
    // Schedule the whole bounded pass on the audio clock, independent of UI frames.
    for (const layer of this.layers) this.scheduleLayer(layer);
    const first = record && this.countIn ? -8 : 0;
    for (let beat = first; beat < this.length; beat++) {
      if (beat < 0 || this.metronome) this.audio.click(this.startTime + beat * 60 / this.bpm, beat % 4 === 0);
    }
    this.changed();
  }
  scheduleLayer(layer, cycle = 0) {
    if (!this.running || layer.muted) return;
    for (const event of layer.events) {
      const beat = quantize(event.beat, layer.grid, this.length, this.bpm);
      const time = this.startTime + (beat + cycle * this.length) * 60 / this.bpm;
      if (time < this.audio.ctx.currentTime) continue;
      this.audio.play(event.key, time, layer.id, this.recordingPass ? this.endTime : Infinity);
      this.visualQueue.push({ key: event.key, time, layer: layer.id });
    }
    this.visualQueue.sort((a, b) => a.time - b.time);
  }
  updateLayer(layer) {
    this.audio.silence(layer.id);
    this.visualQueue = (this.visualQueue || []).filter(event => event.layer !== layer.id);
    if (this.layers.includes(layer)) {
      const currentCycle = this.recordingPass ? 0 : Math.max(0, Math.floor(this.beat / this.length));
      for (let cycle = currentCycle; cycle < this.nextCycle; cycle++) this.scheduleLayer(layer, cycle);
    }
  }
  record() {
    if (this.take) { this.stop(); return; }
    this.start(true);
  }
  capture(key, time = this.audio.ctx.currentTime) {
    if (!this.take) return;
    const position = (time - this.startTime) * this.bpm / 60;
    if (position >= 0 && position < this.length) this.take.events.push({ key, beat: position });
  }
  finish() {
    if (this.take?.events.length) this.layers.push({ id: ++this.serial, events: this.take.events, grid: this.take.grid, muted: false });
    this.take = null;
  }
  stop() {
    this.finish();
    this.running = false; this.visualQueue = []; this.audio.silence(); this.changed();
  }
  tick() {
    if (!this.running) return;
    if (this.recordingPass && this.audio.ctx.currentTime >= this.endTime) { this.stop(); return; }
    if (!this.recordingPass) {
      const duration = this.length * 60 / this.bpm;
      const horizon = this.audio.ctx.currentTime + 1;
      while (this.startTime + this.nextCycle * duration <= horizon) {
        const cycle = this.nextCycle++;
        for (const layer of this.layers) this.scheduleLayer(layer, cycle);
        if (this.metronome) for (let beat = 0; beat < this.length; beat++) {
          const time = this.startTime + (cycle * this.length + beat) * 60 / this.bpm;
          if (time >= this.audio.ctx.currentTime) this.audio.click(time, beat % 4 === 0);
        }
      }
    }
    // Coalesce visual events after a slow frame; audio has already been scheduled.
    let latest;
    while (this.visualQueue.length && this.visualQueue[0].time <= this.audio.ctx.currentTime) latest = this.visualQueue.shift();
    if (latest) this.played(latest.key, 0);
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
      source.start(cycle * frames / rate + quantize(event.beat, layer.grid, this.length, this.bpm) * 60 / this.bpm);
    }
    const rendered = await context.startRendering();
    const loop = new AudioBuffer({numberOfChannels: 2, length: frames, sampleRate: rate});
    for (let channel = 0; channel < 2; channel++) loop.copyToChannel(rendered.getChannelData(channel).subarray(warmup * frames), channel);
    return new Blob([encodeWav(loop)], {type: 'audio/wav'});
  }
}
