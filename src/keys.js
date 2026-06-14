const palette = [
  "#3155f5",
  "#4ee7f5",
  "#bdb5ff",
  "#ff755f",
  "#725bff",
  "#67f0c2",
  "#ff9e7d",
];

const soundFiles = [
  "bubbles",
  "clay",
  "confetti",
  "corona",
  "dotted-spiral",
  "flash-1",
  "flash-2",
  "flash-3",
  "glimmer",
  "piston-3",
  "pinwheel",
  "piston-1",
  "piston-2",
  "prism-1",
  "prism-2",
  "prism-3",
  "splits",
  "squiggle",
  "strike",
  "suspension",
  "timer",
  "ufo",
  "veil",
  "wipe",
  "zig-zag",
  "moon",
];

export const keyRows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].map((row) =>
  row.split(""),
);
const letters = keyRows.flat();
const modes = ["burst", "flow", "shatter", "ripple"];

export const keyMap = Object.fromEntries(
  letters.map((key, index) => [
    key,
    {
      key,
      color: palette[index % palette.length],
      sound: soundFiles[index],
      mode: modes[index % modes.length],
      seed: index / letters.length,
    },
  ]),
);

export const orderedKeys = letters.map((key) => keyMap[key]);
