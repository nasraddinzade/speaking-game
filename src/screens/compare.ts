/**
 * The reward moment: a phrase just became learned. Hear the very first clean
 * take next to today's take, then continue.
 */
import { daysBetween } from '../engine/progress';
import type { Phrase, PhraseProgress } from '../engine/types';
import { confetti, sfx } from '../game/fx';
import { stopPlayback } from '../game/player';
import type { RecordingsApi } from '../storage/storage';
import { buildRecordingButtons } from './recording-buttons';

export interface CompareOptions {
  root: HTMLElement;
  phrase: Phrase;
  record: PhraseProgress;
  api: RecordingsApi;
  voiceName: string | null;
  today: string;
  /** "1 of 3" when several phrases were learned in one run. */
  position?: string;
  onError: (message: string) => void;
  onContinue: () => void;
}

export function mountCompare(o: CompareOptions): void {
  const first = o.record.recordings!.first!;
  const latest = o.record.recordings!.latest!;
  const span = daysBetween(first.date, latest.date);
  o.root.innerHTML = `
    <div class="screen compare">
      <canvas class="confetti" id="confetti"></canvas>
      <div class="compare-badge">PHRASE LEARNED${o.position ? ` <small>${o.position}</small>` : ''}</div>
      <h2 class="compare-title">Hear how far you have come</h2>
      <div class="phrase-card compare-phrase">${esc(o.phrase.text)}<div class="translation">${esc(o.phrase.translation)}</div></div>
      <div class="compare-span">${span === 0 ? 'both takes from today' : `${span} day${span === 1 ? '' : 's'} between the two takes`}</div>
      <div id="buttons"></div>
      <button class="primary" id="continue">Continue</button>
    </div>
  `;
  o.root.querySelector('#buttons')!.appendChild(
    buildRecordingButtons({
      phrase: o.phrase,
      record: o.record,
      api: o.api,
      voiceName: o.voiceName,
      today: o.today,
      onError: o.onError,
      large: true,
    }),
  );
  o.root.querySelector('#continue')!.addEventListener('click', () => {
    stopPlayback();
    o.onContinue();
  });
  sfx.fanfare();
  const canvas = o.root.querySelector<HTMLCanvasElement>('#confetti')!;
  confetti(canvas, 200, 0.3);
  setTimeout(() => confetti(canvas, 120, 0.5), 900);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
