export class AudioEngine {
  constructor(keyMap) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    this.master.connect(this.analyser);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.energy = this.bass = this.mid = this.treble = 0;
    this.visualData = new Uint8Array(128);
    this.muted = false;
    this.buffers = new Map();
    this.voices = new Set();
    this.ready = Promise.all(Object.values(keyMap).map(async config => {
      const url = new URL(`../sounds/${config.sound}.mp3`, import.meta.url).href;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${config.key.toUpperCase()}`);
      this.buffers.set(config.key, await this.ctx.decodeAudioData(await response.arrayBuffer()));
    }));
  }

  async unlock() { await this.ctx.resume(); await this.ready; }

  play(key, when = this.ctx.currentTime, group = 'live', until = Infinity) {
    const buffer = this.buffers.get(key);
    if (!buffer) return null;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.72;
    source.connect(gain).connect(this.master);
    const voice = { source, group };
    this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); };
    source.start(when);
    if (Number.isFinite(until)) source.stop(until);
    return { duration: buffer.duration };
  }

  click(when, accent) {
    const source = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    source.frequency.value = accent ? 1200 : 800;
    gain.gain.setValueAtTime(0.12, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
    source.connect(gain).connect(this.master);
    const voice = { source, group: 'click' };
    this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); };
    source.start(when); source.stop(when + 0.05);
  }

  silence(group) {
    for (const voice of this.voices) if (!group || voice.group === group) {
      try { voice.source.stop(); } catch { /* Already ended. */ }
    }
  }

  sample() {
    if (!this.analyser) {
      this.energy *= 0.92;
      this.bass *= 0.92;
      this.mid *= 0.92;
      this.treble *= 0.92;
      this.#decayVisualData();
      return this;
    }

    this.analyser.getByteTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.frequencyData);

    let sum = 0;
    for (const value of this.timeData) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }

    const rms = Math.sqrt(sum / this.timeData.length);
    const bassEnd = Math.max(2, Math.floor(this.frequencyData.length * 0.14));
    const midEnd = Math.floor(this.frequencyData.length * 0.55);
    const trebleStart = Math.floor(this.frequencyData.length * 0.55);
    this.energy = this.#smooth(this.energy, Math.min(rms * 4.2, 1), 0.24);
    this.bass = this.#smooth(
      this.bass,
      this.#averageRange(this.frequencyData, 0, bassEnd) / 255,
      0.2,
    );
    this.mid = this.#smooth(
      this.mid,
      this.#averageRange(this.frequencyData, bassEnd, midEnd) / 255,
      0.2,
    );
    this.treble = this.#smooth(
      this.treble,
      this.#averageRange(this.frequencyData, trebleStart, this.frequencyData.length) /
        255,
      0.2,
    );
    this.#updateVisualData();

    return this;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }

  #averageRange(values, start, end) {
    let total = 0;
    for (let index = start; index < end; index += 1) {
      total += values[index];
    }
    return total / Math.max(end - start, 1);
  }

  #smooth(current, target, amount) {
    return current + (target - current) * amount;
  }

  #updateVisualData() {
    const bandCount = 32;

    for (let band = 0; band < bandCount; band += 1) {
      const startRatio = band / bandCount;
      const endRatio = (band + 1) / bandCount;
      const start = Math.floor(startRatio ** 2 * this.frequencyData.length);
      const end = Math.max(
        start + 1,
        Math.floor(endRatio ** 2 * this.frequencyData.length),
      );
      const spectrum = Math.min(
        this.#averageRange(this.frequencyData, start, end) * 1.45,
        255,
      );
      const waveformIndex = Math.floor(
        (band / (bandCount - 1)) * (this.timeData.length - 1),
      );
      const offset = band * 4;

      this.visualData[offset] = spectrum;
      this.visualData[offset + 1] = this.timeData[waveformIndex];
      this.visualData[offset + 2] = Math.min(this.treble * 255, 255);
      this.visualData[offset + 3] = 255;
    }
  }

  #decayVisualData() {
    for (let offset = 0; offset < this.visualData.length; offset += 4) {
      this.visualData[offset] *= 0.9;
      this.visualData[offset + 1] += (128 - this.visualData[offset + 1]) * 0.12;
      this.visualData[offset + 2] *= 0.9;
    }
  }
}
