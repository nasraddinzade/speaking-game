import { hasComparison } from '../engine/progress';
import type { PhraseProgress, RunSummary } from '../engine/types';
import { attachPlayButton, playTts, stopPlayback } from '../game/player';
import type { RecordingsApi } from '../storage/storage';
import { buildRecordingButtons } from './recording-buttons';

export interface ResultsOptions {
  root: HTMLElement;
  summary: RunSummary;
  newBestScore: boolean;
  newBestCombo: boolean;
  voiceName: string | null;
  records: Record<string, PhraseProgress>;
  recordings: RecordingsApi | null;
  today: string;
  onError: (message: string) => void;
  onPlayAgain: () => void;
  onHome: () => void;
}

export function mountResults(o: ResultsOptions): void {
  const s = o.summary;
  const stumbles = s.entries.filter((e) => e.outcome !== 'clean');
  const seen = new Set<string>();
  const withRecordings = s.entries.filter((e) => {
    if (seen.has(e.phrase.id)) return false;
    seen.add(e.phrase.id);
    return o.recordings !== null && hasComparison(o.records[e.phrase.id]);
  });
  o.root.innerHTML = `
    <div class="screen results">
      <p class="big-score"><small>${o.newBestScore ? 'NEW BEST SCORE' : 'SCORE'}</small>${s.score}</p>
      <div class="outcomes">
        <div class="stat clean"><b>${s.counts.clean}</b><span>clean</span></div>
        <div class="stat late"><b>${s.counts.late}</b><span>late</span></div>
        <div class="stat miss"><b>${s.counts.miss}</b><span>missed words</span></div>
        <div class="stat silence"><b>${s.counts.silence}</b><span>silence</span></div>
        <div class="stat"><b>${s.bestCombo}</b><span>${o.newBestCombo ? 'new best combo' : 'best combo'}</span></div>
      </div>
      <div class="row">
        <button class="primary" id="again">PLAY AGAIN</button>
        <button class="ghost" id="home">Home</button>
      </div>
      <div class="stumbles" id="stumbles">
        <h3>${stumbles.length === 0 ? 'Flawless run. Nothing to review.' : `Where you stumbled (${stumbles.length})`}</h3>
      </div>
      <div class="stumbles" id="recordings"></div>
    </div>
  `;
  const stumbleBox = o.root.querySelector<HTMLElement>('#stumbles')!;
  stumbles.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'stumble';
    row.innerHTML = `
      <span class="tag ${e.outcome}">${e.outcome.toUpperCase()}</span>
      <div class="text">${esc(e.phrase.text)}<span class="tr">${esc(e.phrase.translation)}</span>${e.heard ? `<span class="heard">heard: ${esc(e.heard)} (${Math.round(e.matchRatio * 100)}%)</span>` : ''}</div>
      <button class="listen">Listen</button>`;
    attachPlayButton(row.querySelector('button.listen')!, () => playTts(e.phrase.text, o.voiceName), o.onError);
    stumbleBox.appendChild(row);
  });

  const recBox = o.root.querySelector<HTMLElement>('#recordings')!;
  if (withRecordings.length > 0 && o.recordings) {
    const h = document.createElement('h3');
    h.textContent = `Your recordings (${withRecordings.length})`;
    recBox.appendChild(h);
    for (const e of withRecordings) {
      const row = document.createElement('div');
      row.className = 'stumble rec-row';
      row.innerHTML = `<div class="text">${esc(e.phrase.text)}<span class="tr">${esc(e.phrase.translation)}</span></div>`;
      row.appendChild(
        buildRecordingButtons({
          phrase: e.phrase,
          record: o.records[e.phrase.id],
          api: o.recordings,
          voiceName: o.voiceName,
          today: o.today,
          onError: o.onError,
        }),
      );
      recBox.appendChild(row);
    }
  }

  o.root.querySelector('#again')!.addEventListener('click', () => {
    stopPlayback();
    o.onPlayAgain();
  });
  o.root.querySelector('#home')!.addEventListener('click', () => {
    stopPlayback();
    o.onHome();
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
