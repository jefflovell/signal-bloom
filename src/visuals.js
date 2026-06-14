import { Geometry, Mesh, Program, Renderer, Texture } from "ogl";

const MAX_PARTICLES = 2800;
const TAU = Math.PI * 2;

const backgroundVertex = `
  attribute vec2 position;
  varying vec2 vUv;

  void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const backgroundFragment = `
  precision highp float;

  uniform float uTime;
  uniform float uEnergy;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform sampler2D uAudioData;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float line(float value, float width) {
    return 1.0 - smoothstep(0.0, width, abs(value));
  }

  vec2 audioAt(float x) {
    return texture2D(uAudioData, vec2(clamp(x, 0.0, 1.0), 0.5)).rg;
  }

  void main() {
    vec2 uv = vUv;
    vec2 screenUv = vec2(uv.x, 1.0 - uv.y);
    vec2 centered = screenUv - 0.5;
    centered.x *= uResolution.x / max(uResolution.y, 1.0);

    vec2 audio = audioAt(uv.x);
    float spectrum = audio.r;
    float waveform = audio.g * 2.0 - 1.0;
    float idleJitter =
      sin(uv.x * 37.0 + uTime * 1.7) * 0.0025 +
      sin(uv.x * 83.0 - uTime * 2.3) * 0.0015;
    float lowWave = sin(uv.x * 8.0 - uTime * 1.8) * uBass * 0.045;
    float midWave = sin(uv.x * 21.0 + uTime * 2.6) * uMid * 0.018;
    float highWave = sin(uv.x * 52.0 - uTime * 4.4) * uTreble * 0.008;
    float analyzer = spectrum * (0.075 + uEnergy * 0.12);
    float scope = waveform * (0.026 + uEnergy * 0.045);
    float desktop = smoothstep(720.0, 800.0, uResolution.x);
    float restingSurface = mix(0.5, 0.72, desktop);
    float surface =
      restingSurface - analyzer - scope + idleJitter +
      lowWave + midWave + highWave;

    float distanceBelow = max(screenUv.y - surface, 0.0);
    float perspective = distanceBelow * distanceBelow * 0.32;
    float gridY = distanceBelow + perspective;

    float horizontal = line(fract(gridY * 19.0) - 0.5, 0.035);
    float verticalWarp = waveform * uEnergy * 0.035;
    float vertical = line(fract((uv.x + verticalWarp) * 24.0) - 0.5, 0.028);
    float depthMask = smoothstep(-0.005, 0.035, screenUv.y - surface);
    float grid = (horizontal + vertical * 0.55) * depthMask;

    float pulse = exp(-length(centered * vec2(0.82, 1.2)) * 4.8);
    float trace = line(screenUv.y - surface, 0.004 + uTreble * 0.002);
    float traceGlow = line(screenUv.y - surface, 0.018 + uEnergy * 0.01);
    vec3 base = vec3(0.027, 0.043, 0.094);
    vec3 blue = vec3(0.192, 0.333, 0.961);
    vec3 cyan = vec3(0.306, 0.906, 0.961);
    vec3 color = base + blue * grid * (0.11 + uEnergy * 0.45);
    color += cyan * pulse * uEnergy * 0.12;
    color += cyan * trace * (0.32 + spectrum * 1.35);
    color += blue * traceGlow * (0.08 + uEnergy * 0.22);
    color += vec3(0.46, 0.35, 1.0) * grid * spectrum * 0.28;

    float vignette = smoothstep(0.95, 0.18, length(centered));
    gl_FragColor = vec4(color * (0.72 + vignette * 0.45), 1.0);
  }
`;

const particleVertex = `
  attribute vec2 position;
  attribute vec3 color;
  attribute float size;
  attribute float alpha;
  attribute float rotation;

  uniform vec2 uResolution;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRotation;

  void main() {
    vec2 clip = position / uResolution * 2.0 - 1.0;
    clip.y *= -1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
    gl_PointSize = max(size * uPixelRatio, 1.0);
    vColor = color;
    vAlpha = alpha;
    vRotation = rotation;
  }
`;

const particleFragment = `
  precision highp float;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vRotation;

  mat2 rotate2d(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
  }

  void main() {
    vec2 point = (gl_PointCoord - 0.5) * 2.0;
    point = rotate2d(vRotation) * point;

    float triangle = max(abs(point.x) * 1.5 + point.y * 0.78, -point.y) - 0.72;
    float edge = 1.0 - smoothstep(-0.08, 0.02, triangle);
    float core = 1.0 - smoothstep(-0.58, -0.1, triangle);
    float glow = 1.0 - smoothstep(-0.02, 0.34, triangle);
    float alpha = (edge * 0.82 + glow * 0.28) * vAlpha;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor * (1.45 + core * 1.15), alpha);
  }
`;

export class VisualEngine {
  constructor(canvas, reducedMotion = false) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.renderer = new Renderer({
      canvas,
      alpha: false,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio, 2),
    });
    this.gl = this.renderer.gl;
    this.gl.clearColor(0.027, 0.043, 0.094, 1);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);

    this.width = 1;
    this.height = 1;
    this.pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.cursor = 0;
    this.lastTime = performance.now();
    this.activeBursts = [];
    this.audioTextureData = new Uint8Array(32 * 4);
    for (let offset = 0; offset < this.audioTextureData.length; offset += 4) {
      this.audioTextureData[offset + 1] = 128;
      this.audioTextureData[offset + 3] = 255;
    }
    this.audioTexture = new Texture(this.gl, {
      image: this.audioTextureData,
      width: 32,
      height: 1,
      format: this.gl.RGBA,
      internalFormat: this.gl.RGBA,
      type: this.gl.UNSIGNED_BYTE,
      minFilter: this.gl.LINEAR,
      magFilter: this.gl.LINEAR,
      generateMipmaps: false,
      flipY: false,
    });

    this.positions = new Float32Array(MAX_PARTICLES * 2);
    this.velocities = new Float32Array(MAX_PARTICLES * 2);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.alphas = new Float32Array(MAX_PARTICLES);
    this.rotations = new Float32Array(MAX_PARTICLES);
    this.spins = new Float32Array(MAX_PARTICLES);
    this.lives = new Float32Array(MAX_PARTICLES);
    this.maxLives = new Float32Array(MAX_PARTICLES);
    this.drags = new Float32Array(MAX_PARTICLES);

    this.#createBackground();
    this.#createParticles();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  #createBackground() {
    const geometry = new Geometry(this.gl, {
      position: {
        size: 2,
        data: new Float32Array([-1, -1, 3, -1, -1, 3]),
      },
    });
    this.backgroundProgram = new Program(this.gl, {
      vertex: backgroundVertex,
      fragment: backgroundFragment,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uAudioData: { value: this.audioTexture },
        uResolution: { value: [1, 1] },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.background = new Mesh(this.gl, {
      geometry,
      program: this.backgroundProgram,
    });
  }

  #createParticles() {
    this.particleGeometry = new Geometry(this.gl, {
      position: { size: 2, data: this.positions, usage: this.gl.DYNAMIC_DRAW },
      color: { size: 3, data: this.colors, usage: this.gl.DYNAMIC_DRAW },
      size: { size: 1, data: this.sizes, usage: this.gl.DYNAMIC_DRAW },
      alpha: { size: 1, data: this.alphas, usage: this.gl.DYNAMIC_DRAW },
      rotation: { size: 1, data: this.rotations, usage: this.gl.DYNAMIC_DRAW },
    });
    this.particleProgram = new Program(this.gl, {
      vertex: particleVertex,
      fragment: particleFragment,
      uniforms: {
        uResolution: { value: [1, 1] },
        uPixelRatio: { value: this.pixelRatio },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.particles = new Mesh(this.gl, {
      mode: this.gl.POINTS,
      geometry: this.particleGeometry,
      program: this.particleProgram,
    });
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setSize(this.width, this.height);
    this.backgroundProgram.uniforms.uResolution.value = [this.width, this.height];
    this.particleProgram.uniforms.uResolution.value = [this.width, this.height];
    this.particleProgram.uniforms.uPixelRatio.value = this.pixelRatio;
  }

  trigger(config, playback, origin) {
    const duration = playback?.duration || 0.9;
    const color = this.#hexToRgb(config.color);
    const point = origin || this.#originForSeed(config.seed);
    const particleCount = this.reducedMotion ? 28 : 74;

    this.activeBursts.push({
      age: 0,
      attack: Math.min(0.06 + duration * 0.04, 0.16),
      release: Math.min(Math.max(duration * 0.72, 0.48), 2.4),
      x: point.x,
      y: point.y,
      color,
      mode: config.mode,
      seed: config.seed,
    });

    for (let index = 0; index < particleCount; index += 1) {
      this.#spawnParticle(config.mode, point, color, duration, index / particleCount);
    }
  }

  update(audio, time = performance.now()) {
    const delta = Math.min((time - this.lastTime) / 1000, 0.034);
    this.lastTime = time;
    const dt = delta * 60;

    this.#updateBursts(delta);
    const burstLevels = this.#getBurstLevels();
    this.backgroundProgram.uniforms.uTime.value = time / 1000;
    this.backgroundProgram.uniforms.uEnergy.value = Math.max(
      audio.energy,
      burstLevels.energy,
    );
    this.backgroundProgram.uniforms.uBass.value = Math.max(
      audio.bass,
      burstLevels.bass,
    );
    this.backgroundProgram.uniforms.uMid.value = Math.max(
      audio.mid,
      burstLevels.mid,
    );
    this.backgroundProgram.uniforms.uTreble.value = Math.max(
      audio.treble,
      burstLevels.treble,
    );
    this.#updateAudioTexture(audio);
    this.#updateParticles(dt, audio);
    this.renderer.render({ scene: this.background });
    this.renderer.render({ scene: this.particles, clear: false });
  }

  #updateBursts(delta) {
    for (let index = this.activeBursts.length - 1; index >= 0; index -= 1) {
      const burst = this.activeBursts[index];
      burst.age += delta;
      if (burst.age >= burst.attack + burst.release) {
        this.activeBursts.splice(index, 1);
      }
    }
  }

  #updateAudioTexture(audio) {
    this.audioTextureData.set(audio.visualData);

    for (const burst of this.activeBursts) {
      const shapedEnvelope = this.#burstEnvelope(burst);
      const center = 0.08 + burst.seed * 0.84;
      const width =
        burst.mode === "flow" ? 0.24 : burst.mode === "shatter" ? 0.09 : 0.15;
      const oscillations =
        burst.mode === "ripple" ? 8 : burst.mode === "shatter" ? 13 : 5;

      for (let band = 0; band < 32; band += 1) {
        const x = band / 31;
        const distance = x - center;
        const profile = Math.exp(-(distance * distance) / (2 * width * width));
        const wave = Math.sin(x * Math.PI * oscillations + burst.age * 15);
        const offset = band * 4;
        const spectrum = profile * shapedEnvelope * 210;
        const waveform = wave * profile * shapedEnvelope * 92;

        this.audioTextureData[offset] = Math.min(
          this.audioTextureData[offset] + spectrum,
          255,
        );
        this.audioTextureData[offset + 1] = Math.min(
          Math.max(this.audioTextureData[offset + 1] + waveform, 0),
          255,
        );
      }
    }

    this.audioTexture.needsUpdate = true;
  }

  #getBurstLevels() {
    const levels = { energy: 0, bass: 0, mid: 0, treble: 0 };

    for (const burst of this.activeBursts) {
      const envelope = this.#burstEnvelope(burst);
      levels.energy = Math.max(levels.energy, envelope);

      if (burst.seed < 0.34) {
        levels.bass = Math.max(levels.bass, envelope);
      } else if (burst.seed < 0.7) {
        levels.mid = Math.max(levels.mid, envelope);
      } else {
        levels.treble = Math.max(levels.treble, envelope);
      }
    }

    return levels;
  }

  #burstEnvelope(burst) {
    const envelope =
      burst.age < burst.attack
        ? burst.age / burst.attack
        : 1 - (burst.age - burst.attack) / burst.release;
    return Math.max(envelope, 0) ** 1.35;
  }

  #updateParticles(dt, audio) {
    const fieldStrength = 0.005 + audio.bass * 0.035;

    for (let index = 0; index < MAX_PARTICLES; index += 1) {
      if (this.lives[index] <= 0) {
        this.alphas[index] = 0;
        continue;
      }

      const positionOffset = index * 2;
      const lifeRatio = this.lives[index] / this.maxLives[index];
      const x = this.positions[positionOffset];
      const y = this.positions[positionOffset + 1];
      const curlX = Math.sin(y * 0.011 + index * 0.17) * fieldStrength;
      const curlY = Math.cos(x * 0.009 - index * 0.13) * fieldStrength;

      this.velocities[positionOffset] += curlX * dt;
      this.velocities[positionOffset + 1] += curlY * dt;
      this.velocities[positionOffset] *= this.drags[index] ** dt;
      this.velocities[positionOffset + 1] *= this.drags[index] ** dt;
      this.positions[positionOffset] += this.velocities[positionOffset] * dt;
      this.positions[positionOffset + 1] += this.velocities[positionOffset + 1] * dt;
      this.rotations[index] += this.spins[index] * dt;
      this.lives[index] -= dt / 60;
      const fadeIn = Math.min((1 - lifeRatio) * 14, 1);
      const fadeOut = Math.min(lifeRatio * 4, 1);
      this.alphas[index] = Math.max(fadeIn * fadeOut, 0);
      this.sizes[index] *= 0.996 ** dt;
    }

    for (const attribute of Object.values(this.particleGeometry.attributes)) {
      attribute.needsUpdate = true;
    }
  }

  #spawnParticle(mode, origin, color, duration, progress) {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    const positionOffset = index * 2;
    const colorOffset = index * 3;
    const angle = progress * TAU + (Math.random() - 0.5) * 0.42;
    const speedBase = Math.min(this.width, this.height) * 0.009;
    let speed = speedBase * (0.45 + Math.random() * 1.35);
    let spreadX = 1;
    let spreadY = 1;
    let lift = 0;

    if (mode === "flow") {
      spreadX = 1.65;
      spreadY = 0.4;
      speed *= 0.72;
    } else if (mode === "shatter") {
      speed *= 1.4;
      lift = -speed * 0.32;
    } else if (mode === "ripple") {
      spreadY = 0.58;
      speed *= 0.9;
    }

    this.positions[positionOffset] = origin.x + (Math.random() - 0.5) * 24;
    this.positions[positionOffset + 1] = origin.y + (Math.random() - 0.5) * 24;
    this.velocities[positionOffset] = Math.cos(angle) * speed * spreadX;
    this.velocities[positionOffset + 1] =
      Math.sin(angle) * speed * spreadY + lift;
    this.colors[colorOffset] = color[0];
    this.colors[colorOffset + 1] = color[1];
    this.colors[colorOffset + 2] = color[2];
    this.sizes[index] = 11 + Math.random() * 24;
    this.alphas[index] = 1;
    this.rotations[index] = angle + Math.random() * Math.PI;
    this.spins[index] = (Math.random() - 0.5) * 0.12;
    this.maxLives[index] = Math.min(
      0.75 + duration * 0.7 + Math.random() * 0.65,
      2.8,
    );
    this.lives[index] = this.maxLives[index];
    this.drags[index] = 0.965 + Math.random() * 0.02;
  }

  #originForSeed(seed) {
    const angle = seed * TAU * 1.7;
    const radiusX = this.width * (0.18 + (seed % 0.22));
    const radiusY = this.height * (0.12 + ((seed * 1.7) % 0.15));

    return {
      x: this.width * 0.5 + Math.cos(angle) * radiusX,
      y: this.height * 0.5 + Math.sin(angle) * radiusY,
    };
  }

  #hexToRgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [
      ((value >> 16) & 255) / 255,
      ((value >> 8) & 255) / 255,
      (value & 255) / 255,
    ];
  }
}
