import type { RunSummary } from '../engine/types';
import { speak } from '../speech/tts';

export interface ResultsOptions {
  root: HTMLElement;
  summary: RunSummary;
  newBestScore: boolean;
  newBestCombo: boolean;
  voiceName: string | null;
  onPlayAgain: () => void;
  onHome: () => void;
}

export function mountResults(o: ResultsOptions): void {
  const s = o.summary;
  const stumbles = s.entries.filter((e) => e.outcome !== 'clean');
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
      <div class="stumbles">
        <h3>${stumbles.length === 0 ? 'Flawless run. Nothing to review.' : `Where you stumbled (${stumbles.length})`}</h3>
        ${stumbles
          .map(
            (e, i) => `
          <div class="stumble">
            <span class="tag ${e.outcome}">${e.outcome.toUpperCase()}</span>
            <div class="text">${esc(e.phrase.text)}<span class="tr">${esc(e.phrase.translation)}</span>${e.heard ? `<span class="heard">heard: ${esc(e.heard)} (${Math.round(e.matchRatio * 100)}%)</span>` : ''}</div>
            <button data-i="${i}" class="listen">Listen</button>
          </div>`,
          )
          .join('')}
      </div>
    </div>
  `;
  o.root.querySelector('#again')!.addEventListener('click', o.onPlayAgain);
  o.root.querySelector('#home')!.addEventListener('click', o.onHome);
  o.root.querySelectorAll<HTMLButtonElement>('button.listen').forEach((b) =>
    b.addEventListener('click', () => {
      const e = stumbles[Number(b.dataset.i)];
      if (e) void speak(e.phrase.text, { voiceName: o.voiceName });
    }),
  );
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
