# Signal Bloom

A modernized audiovisual instrument based on the original Patatap clone.
Press any letter key or use the on-screen controls to trigger sound-reactive
neon fragments.

Signal Bloom grew from
[Patatap-Clone](https://github.com/jefflovell/Patatap-Clone), which remains
available as the original historical project. Sound credits and licensing are
documented in `sounds/README.md`.

## Stack

- OGL for GPU-rendered visuals
- Native Web Audio for scheduled playback, recording, export, and sound-reactive analysis
- Vite for local development and production builds

## Development

```sh
npm install
npm run dev
```

Build the static site with:

```sh
npm run build
```

## Release 1: Loop studio

Choose 40–240 BPM and a 1-, 2-, 4-, or 8-bar loop in 4/4 time. Record layer
starts an eight-beat / two-bar count-in (optional), captures one take, and stops automatically at the selected bar length.
Record again for a fresh eight-beat count-in; existing layers accompany the new take.
Play take auditions one pass and stops automatically. Continuous overwrite is not enabled. Finish layer or Stop
keeps a partial take; empty takes are discarded. On desktop, Space starts recording
when stopped and stops the transport when running, including during count-in.
The shortcut ignores held-key repeats and does not intercept input fields. Mute, delete, or undo layers
without flattening the original pad events.

Stop playback to change tempo or quantization (Off, 1/4, 1/8, 1/16). Quantization is
reversible and never changes live pad response. Loop length is locked while
layers exist; delete all layers to choose a different length. Tempo changes
adjust event spacing, not sample pitch or duration.

Download WAV renders the unmuted layers as a stereo 44.1 kHz, 16-bit loop,
excluding the metronome. Sample tails wrap into the beginning of the exported
loop. Peaks above full scale are reduced uniformly on export to avoid clipping.
The global Sound off control mutes monitoring, not exported layers.

Sessions are in memory only; download before closing or reloading. Hiding the
page stops transport and retains recorded layers to avoid background timing drift.
Sample load failures appear in the studio status. Imported audio, persistent
projects, EQ, and custom kits belong to later releases.

Run timing, recording-transition, and WAV-format checks with `npm test`.

The amber GET READY countdown changes to a red RECORDING — PLAY NOW banner
when capture begins. Playback is scheduled for the full take on the audio clock,
so delayed visual frames do not discard scheduled hits. Pad capture happens
before asynchronous audio unlocking. Visual rendering is capped at 30 FPS with
bounded active bursts; audio playback and capture are not frame-rate limited.
