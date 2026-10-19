/**
 * The three playback buttons of a phrase with two recordings:
 * first recording, latest recording, reference voice. Shared by the results
 * screen, the comparison screen and the recordings list.
 */
import { relativeDayLabel } from '../engine/progress';
import type { Phrase, PhraseProgress } from '../engine/types';
import { attachPlayButton, playTts, playUrl } from '../game/player';
import type { RecordingsApi } from '../storage/storage';

export interface RecordingButtonsOptions {
  phrase: Phrase;
  record: PhraseProgress;
  api: RecordingsApi;
  voiceName: string | null;
  today: string;
  onError: (message: string) => void;
  /** Bigger buttons for the comparison screen. */
  large?: boolean;
}

export function buildRecordingButtons(o: RecordingButtonsOptions): HTMLElement {
  const box = document.createElement('div');
  box.className = `rec-buttons${o.large ? ' large' : ''}`;
  const first = o.record.recordings?.first;
  const latest = o.record.recordings?.latest;
  if (first) {
    const b = button('First', first.date, relativeDayLabel(first.date, o.today), 'first');
    attachPlayButton(b, () => playUrl(o.api.url(first.file)), o.onError);
    box.appendChild(b);
  }
  if (latest) {
    const b = button('Now', latest.date, relativeDayLabel(latest.date, o.today), 'latest');
    attachPlayButton(b, () => playUrl(o.api.url(latest.file)), o.onError);
    box.appendChild(b);
  }
  const ref = button('Reference', '', 'voice', 'ref');
  attachPlayButton(ref, () => playTts(o.phrase.text, o.voiceName), o.onError);
  box.appendChild(ref);
  return box;
}

function button(label: string, date: string, sub: string, kind: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `rec-btn ${kind}`;
  b.innerHTML = `<span class="rec-icon"></span><span class="rec-label">${label}${date ? ` <small>${date}</small>` : ''}<small class="rec-sub">${sub}</small></span>`;
  return b;
}
