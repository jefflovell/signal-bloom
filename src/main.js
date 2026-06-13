import "./styles.css";
import { AudioEngine } from "./audio.js";
import { keyMap, orderedKeys } from "./keys.js";
import { VisualEngine } from "./visuals.js";

const instrument = document.querySelector(".instrument");
const canvas = document.querySelector("#visuals");
const keyGrid = document.querySelector(".key-grid");
const statusCopy = document.querySelector(".status-copy");
const soundToggle = document.querySelector(".sound-toggle");
const meter = document.querySelector(".meter");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const audio = new AudioEngine(keyMap);
const visuals = new VisualEngine(canvas, reducedMotion);
const buttons = new Map();
let hasPlayed = false;

for (const config of orderedKeys) {
  const button = document.createElement("button");
  button.className = "key";
  button.type = "button";
  button.textContent = config.key;
  button.dataset.key = config.key;
  button.style.setProperty("--key-color", config.color);
  button.setAttribute("aria-label", `Play ${config.key.toUpperCase()}`);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    trigger(config.key, {
      x: event.clientX,
      y: Math.min(event.clientY, window.innerHeight * 0.62),
    });
  });
  keyGrid.append(button);
  buttons.set(config.key, button);
}

function trigger(key, origin) {
  const normalizedKey = key.toLowerCase();
  const config = keyMap[normalizedKey];

  if (!config || audio.muted) {
    return;
  }

  const playback = audio.play(normalizedKey);
  visuals.trigger(config, playback, origin);
  flashKey(normalizedKey);

  if (!hasPlayed) {
    hasPlayed = true;
    instrument.classList.add("has-played");
  }

  statusCopy.textContent = `${normalizedKey.toUpperCase()} / ${config.mode}`;
}

function flashKey(key) {
  const button = buttons.get(key);
  if (!button) {
    return;
  }

  button.classList.remove("is-active");
  requestAnimationFrame(() => button.classList.add("is-active"));
  window.setTimeout(() => button.classList.remove("is-active"), 180);
}

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (keyMap[event.key.toLowerCase()]) {
    event.preventDefault();
    trigger(event.key);
  }
});

soundToggle.addEventListener("click", () => {
  const muted = audio.toggleMute();
  soundToggle.setAttribute("aria-pressed", String(muted));
  soundToggle.textContent = muted ? "Sound off" : "Sound on";
  statusCopy.textContent = muted ? "Audio muted" : "Ready for input";
});

function frame(time) {
  audio.sample();
  visuals.update(audio, time);
  meter.style.setProperty("--meter-level", Math.max(audio.energy, 0.025).toFixed(3));
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
