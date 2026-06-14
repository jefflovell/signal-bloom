import { Howl, Howler } from "howler";

export class AudioEngine {
  constructor(keyMap) {
    this.sounds = new Map();
    this.analyser = null;
    this.timeData = null;
    this.frequencyData = null;
    this.energy = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.visualData = new Uint8Array(32 * 4);
    this.muted = false;

    for (const config of Object.values(keyMap)) {
      const source = new URL(`../sounds/${config.sound}.mp3`, import.meta.url).href;
      this.sounds.set(
        config.key,
        new Howl({
          src: [source],
          preload: true,
          pool: 8,
          volume: 0.72,
        }),
      );
    }
  }

  ensureAnalyser() {
    if (this.analyser || !Howler.usingWebAudio || !Howler.ctx) {
      return;
    }

    this.analyser = Howler.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    Howler.masterGain.connect(this.analyser);
  }

  play(key) {
    this.ensureAnalyser();
    const sound = this.sounds.get(key);

    if (!sound) {
      return null;
    }

    const id = sound.play();
    return {
      id,
      duration: Math.max(sound.duration(id) || sound.duration() || 0.9, 0.25),
    };
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
    Howler.mute(this.muted);
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
