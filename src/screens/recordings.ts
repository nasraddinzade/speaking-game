/**
 * All phrases with a pair of recordings, newest first. Sit back and listen
 * to your own progress without playing.
 */
import { stopPlayback } from '../game/player';
import type { RecordingsApi } from '../storage/storage';
import type { ComparisonEntry } from '../storage/recordings';
import { buildRecordingButtons } from './recording-buttons';

export interface RecordingsScreenOptions {
  root: HTMLElement;
  entries: ComparisonEntry[];
  api: RecordingsApi | null;
  voiceName: string | null;
  today: string;
  folder: string | null;
  onError: (message: string) => void;
  onBack: () => void;
}

export function mountRecordingsScreen(o: RecordingsScreenOptions): void {
  o.root.innerHTML = `
    <div class="screen results recordings-screen">
      <h2 class="compare-title">My recordings</h2>
      <p class="subtitle">${o.api === null ? 'Recordings need the launcher (npm start): files are kept next to the app.' : o.entries.length === 0 ? 'No pairs yet. A phrase gets a pair once it has two clean hits on different runs.' : `${o.entries.length} phrase${o.entries.length === 1 ? '' : 's'} with a first and a latest take.`}</p>
      <div class="row"><button class="ghost" id="back">Back</button></div>
      <div class="stumbles" id="list"></div>
      ${o.folder ? `<div class="hint">Files: ${esc(o.folder)}</div>` : ''}
    </div>
  `;
  const list = o.root.querySelector<HTMLElement>('#list')!;
  if (o.api) {
    for (const e of o.entries) {
      const row = document.createElement('div');
      row.className = 'stumble rec-row';
      row.innerHTML = `<div class="text">${esc(e.phrase.text)}<span class="tr">${esc(e.phrase.translation)}</span><span class="heard">level ${e.phrase.difficulty}${e.record.learned ? ' · learned' : ''}</span></div>`;
      row.appendChild(
        buildRecordingButtons({ phrase: e.phrase, record: e.record, api: o.api, voiceName: o.voiceName, today: o.today, onError: o.onError }),
      );
      list.appendChild(row);
    }
  }
  o.root.querySelector('#back')!.addEventListener('click', () => {
    stopPlayback();
    o.onBack();
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
