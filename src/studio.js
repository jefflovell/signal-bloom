import { LoopStudio } from './loop.js';
export function createStudio(audio, onPlayback) {
  const panel = document.createElement('details');
  panel.className = 'studio'; panel.open = true;
  panel.innerHTML = `<summary>Loop studio <span>RECORD / LAYER / EXPORT</span></summary>
    <div class="studio-body">
      <div class="transport"><button id="play" disabled>Play loop</button><button id="record" disabled>Record layer</button><button id="stop" disabled>Stop</button><button id="undo" disabled>Undo layer</button><button id="download" disabled>Download WAV</button></div>
      <div class="settings">
        <label>Tempo <input id="tempo" type="number" min="40" max="240" value="120"> BPM</label>
        <label>Loop <select id="bars"><option>1</option><option>2</option><option selected>4</option><option>8</option></select> bars</label>
        <label>Quantize <select id="grid"><option value="0">Off</option><option value="0.5">1/8 note</option><option value="0.25" selected>1/16 note</option></select></label>
        <label><input id="click" type="checkbox"> Metronome</label>
        <label><input id="count" type="checkbox" checked> Count-in</label>
      </div>
      <div class="position"><progress id="position" max="1" value="0" aria-label="Loop position"></progress><span id="beat">Stopped</span></div>
      <p id="studio-status" role="status">Loading samples…</p>
      <div id="layers" aria-label="Recorded layers"></div>
      <p class="studio-help">Record one loop, then record again to add a layer. Live pads play immediately; quantization affects loop playback. Stop to edit timing. Sessions last until this page closes. WAV exports loop tails and reduces peaks only if needed to prevent clipping.</p>
    </div>`;
  document.querySelector('.instrument').append(panel);
  const el = id => panel.querySelector('#' + id);
  let loaded = false, busy = false;
  const studio = new LoopStudio(audio, render, onPlayback);
  const message = text => el('studio-status').textContent = text;
  function render() {
    el('play').disabled = !loaded || studio.running || busy;
    el('record').disabled = !loaded || busy;
    el('record').textContent = studio.take ? 'Finish layer' : 'Record layer';
    el('record').classList.toggle('recording', !!studio.take);
    el('stop').disabled = !studio.running;
    el('undo').disabled = !studio.layers.length || !!studio.take || busy;
    el('download').disabled = !studio.layers.some(l => !l.muted) || !!studio.take || busy;
    for (const id of ['tempo', 'bars', 'grid']) el(id).disabled = studio.running || busy || (id === 'bars' && studio.layers.length > 0);
    el('count').disabled = studio.running;
    el('layers').replaceChildren();
    for (const layer of studio.layers) {
      const row = document.createElement('div'); row.className = 'layer';
      const name = document.createElement('span'); name.textContent = `Layer ${layer.id} · ${layer.events.length} hits`;
      const mute = document.createElement('button'); mute.textContent = layer.muted ? 'Unmute' : 'Mute'; mute.setAttribute('aria-label', `${mute.textContent} layer ${layer.id}`); mute.setAttribute('aria-pressed', String(layer.muted));
      const remove = document.createElement('button'); remove.textContent = 'Delete'; remove.setAttribute('aria-label', `Delete layer ${layer.id}`);
      mute.disabled = remove.disabled = busy;
      mute.onclick = () => { layer.muted = !layer.muted; audio.silence(layer.id); render(); };
      remove.onclick = () => { studio.layers = studio.layers.filter(l => l !== layer); audio.silence(layer.id); render(); };
      row.append(name, mute, remove); el('layers').append(row);
    }
    if (loaded && !busy) message(studio.take ? 'Recording armed — play pads when the count finishes.' : studio.running ? 'Playing loop. Record adds a layer at the next loop boundary.' : 'Ready. Choose a tempo and record a layer.');
  }
  async function action(fn) {
    try { await audio.unlock(); fn(); } catch (error) { message(`Audio unavailable: ${error.message}`); }
  }
  el('play').onclick = () => action(() => studio.start());
  el('record').onclick = () => action(() => studio.record());
  el('stop').onclick = () => studio.stop();
  el('undo').onclick = () => { const layer = studio.layers.pop(); if (layer) audio.silence(layer.id); render(); };
  el('tempo').onchange = () => { studio.bpm = Math.min(240, Math.max(40, Number(el('tempo').value) || 120)); el('tempo').value = studio.bpm; };
  el('bars').onchange = () => studio.bars = Number(el('bars').value);
  el('grid').onchange = () => studio.grid = Number(el('grid').value);
  el('click').onchange = () => { studio.metronome = el('click').checked; if (!studio.metronome) audio.silence('click'); };
  el('count').onchange = () => studio.countIn = el('count').checked;
  el('download').onclick = async () => {
    busy = true; render(); message('Rendering WAV…');
    try {
      const blob = await studio.export();
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `signal-bloom-${studio.bpm}bpm-${studio.bars}bars.wav`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      busy = false; render(); message('WAV downloaded. The metronome is excluded.');
    } catch (error) { busy = false; render(); message(error.message); }
  };
  audio.ready.then(() => { loaded = true; render(); }).catch(error => message(`Samples could not load. Reload to retry. ${error.message}`));
  document.addEventListener('visibilitychange', () => { if (document.hidden && studio.running) { studio.stop(); message('Stopped because the page was hidden. Your layers are retained.'); } });
  function position() {
    if (studio.running) {
      const beat = studio.beat;
      const wait = studio.take && studio.take.start - beat;
      el('position').value = beat < 0 ? 0 : (beat % studio.length) / studio.length;
      el('beat').textContent = wait > 0 ? `Count-in · ${Math.ceil(wait)}` : `${studio.take ? 'Recording' : 'Playing'} · Bar ${Math.floor(Math.max(0, beat) % studio.length / 4) + 1} / ${studio.bars} · Beat ${Math.floor(Math.max(0, beat) % 4) + 1}`;
    } else { el('position').value = 0; el('beat').textContent = 'Stopped'; }
    requestAnimationFrame(position);
  }
  render(); position(); return studio;
}
