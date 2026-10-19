import { learnedCount } from '../engine/progress';
import type { Difficulty, SaveFile, Settings } from '../engine/types';
import { englishVoices } from '../speech/tts';

export interface HomeOptions {
  root: HTMLElement;
  save: SaveFile;
  phraseCount: number;
  micStatus: { ok: boolean; text: string };
  storageNote: string;
  onPlay: (settings: Settings) => void;
  onSettingsChange: (settings: Settings) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onReset: () => void;
  /** How many phrases have a pair of recordings to listen to. */
  recordingPairs: number;
  onRecordings: () => void;
  /** Shown when the recordings folder is too large. */
  storageWarning: { totalMB: number; candidateFiles: number; onCleanup: () => void } | null;
}

const RUN_LENGTHS = [5, 10, 15, 20, 30];

export function mountHome(o: HomeOptions): void {
  const s = { ...o.save.settings };
  const voices = englishVoices();
  o.root.innerHTML = `
    <div class="screen home">
      <h1 class="title">Speaking Game</h1>
      <p class="subtitle">Phrases fall through the zone. Say each one out loud, in one breath, before it leaves. Fluent and connected beats careful and slow.</p>
      <div class="stats">
        <div class="stat"><b>${learnedCount(o.save)}</b><span>learned / ${o.phraseCount}</span></div>
        <div class="stat"><b>${o.save.profile.bestScore}</b><span>best score</span></div>
        <div class="stat"><b>${o.save.profile.bestCombo}</b><span>best combo</span></div>
        <div class="stat"><b>${o.save.profile.runsPlayed}</b><span>runs</span></div>
      </div>
      <div class="setup">
        <label>Start level
          <div class="segment" id="level">
            ${[1, 2, 3, 4].map((l) => `<button data-v="${l}" class="${s.startLevel === l ? 'on' : ''}" title="${LEVEL_HINT[l - 1]}">${l}</button>`).join('')}
          </div>
        </label>
        <label>Phrases per run
          <div class="segment" id="len">
            ${RUN_LENGTHS.map((n) => `<button data-v="${n}" class="${s.runLength === n ? 'on' : ''}">${n}</button>`).join('')}
          </div>
        </label>
        <label>Reference voice
          <select id="voice">
            ${voices.length === 0 ? '<option value="">(no English voices found)</option>' : ''}
            ${voices.map((v) => `<option value="${esc(v.name)}" ${s.voiceName === v.name ? 'selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('')}
          </select>
        </label>
        <label>Sound
          <div class="segment" id="sound">
            <button data-v="1" class="${s.soundOn ? 'on' : ''}">on</button>
            <button data-v="0" class="${!s.soundOn ? 'on' : ''}">off</button>
          </div>
        </label>
      </div>
      <div class="hint" id="level-hint">${LEVEL_HINT[s.startLevel - 1]}</div>
      <button class="primary" id="play">PLAY</button>
      <div class="mic-note ${o.micStatus.ok ? 'good' : 'bad'}">${esc(o.micStatus.text)}</div>
      ${
        o.storageWarning
          ? `<div class="warning">Recordings take ${o.storageWarning.totalMB} MB. ${o.storageWarning.candidateFiles > 0 ? `<button id="cleanup">Delete ${o.storageWarning.candidateFiles} recordings of learned phrases older than six months</button>` : 'No recordings of learned phrases older than six months to delete yet.'}</div>`
          : ''
      }
      <div class="row">
        <button class="ghost" id="recordings">My recordings (${o.recordingPairs})</button>
        <button class="ghost" id="export">Export progress</button>
        <button class="ghost" id="import">Import progress</button>
        <button class="ghost" id="reset">Reset progress</button>
        <input type="file" id="import-file" accept="application/json" style="display:none" />
      </div>
      <div class="footer-note">${esc(o.storageNote)}</div>
    </div>
  `;

  const commit = () => o.onSettingsChange({ ...s });
  const segment = (id: string, apply: (v: string) => void) => {
    const box = o.root.querySelector<HTMLElement>(`#${id}`)!;
    box.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        apply(b.dataset.v!);
        commit();
      }),
    );
  };
  segment('level', (v) => {
    s.startLevel = Number(v) as Difficulty;
    o.root.querySelector('#level-hint')!.textContent = LEVEL_HINT[s.startLevel - 1];
  });
  segment('len', (v) => {
    s.runLength = Number(v);
  });
  segment('sound', (v) => {
    s.soundOn = v === '1';
  });
  o.root.querySelector<HTMLSelectElement>('#voice')!.addEventListener('change', (e) => {
    s.voiceName = (e.target as HTMLSelectElement).value || null;
    commit();
  });
  o.root.querySelector('#play')!.addEventListener('click', () => o.onPlay({ ...s }));
  o.root.querySelector('#export')!.addEventListener('click', o.onExport);
  o.root.querySelector('#recordings')!.addEventListener('click', o.onRecordings);
  o.root.querySelector('#cleanup')?.addEventListener('click', () => {
    if (confirm('Delete the recordings of learned phrases older than six months? This cannot be undone.')) o.storageWarning?.onCleanup();
  });
  const fileInput = o.root.querySelector<HTMLInputElement>('#import-file')!;
  o.root.querySelector('#import')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) o.onImport(f);
    fileInput.value = '';
  });
  o.root.querySelector('#reset')!.addEventListener('click', () => {
    if (confirm('Reset all progress? The progress file will be overwritten.')) o.onReset();
  });
}

const LEVEL_HINT = [
  'Level 1: up to 5 words, no contractions',
  'Level 2: 5-8 words, one contraction',
  'Level 3: 8-12 words, connected speech',
  'Level 4: 12+ words, fast tempo, several connectors',
];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
