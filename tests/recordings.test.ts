import { describe, expect, it } from 'vitest';
import { applyOutcome, hasComparison, normalizeSave, relativeDayLabel } from '../src/engine/progress';
import type { Phrase, PhraseProgress, SaveFile } from '../src/engine/types';
import { cleanupCandidates, comparisonList, storeCleanRecording } from '../src/storage/recordings';
import type { RecordingsApi } from '../src/storage/storage';

const rec = (id: string, extra: Partial<PhraseProgress> = {}): PhraseProgress => ({
  phraseId: id,
  cleanHitDays: [],
  requiredDays: 3,
  lastSeen: null,
  misses: 0,
  learned: false,
  ...extra,
});

function fakeApi(existing: Set<string> = new Set()): RecordingsApi & { puts: Array<[string, boolean]>; removed: string[] } {
  const puts: Array<[string, boolean]> = [];
  const removed: string[] = [];
  return {
    puts,
    removed,
    async put(name, _blob, overwrite) {
      puts.push([name, overwrite]);
      if (existing.has(name) && !overwrite) return { status: 'exists', date: '2026-01-05' };
      const status = existing.has(name) ? 'replaced' : 'created';
      existing.add(name);
      return { status };
    },
    url: (n) => `/api/recordings/${n}`,
    async list() {
      return { files: [], totalBytes: 0, dir: 'x' };
    },
    async remove(name) {
      removed.push(name);
    },
  };
}

const blob = { size: 10, type: 'audio/webm' } as unknown as Blob;

describe('storeCleanRecording', () => {
  it('writes first once, then latest every time', async () => {
    const api = fakeApi();
    let r = rec('p_0001');
    r.recordings = await storeCleanRecording(api, r, blob, '2026-10-19');
    expect(r.recordings).toEqual({ first: { file: 'p_0001_first.webm', date: '2026-10-19' } });
    expect(hasComparison(r)).toBe(false);
    r.recordings = await storeCleanRecording(api, r, blob, '2026-10-21');
    expect(r.recordings?.first?.date).toBe('2026-10-19');
    expect(r.recordings?.latest).toEqual({ file: 'p_0001_latest.webm', date: '2026-10-21' });
    expect(hasComparison(r)).toBe(true);
    r.recordings = await storeCleanRecording(api, r, blob, '2026-11-02');
    expect(r.recordings?.first?.date).toBe('2026-10-19');
    expect(r.recordings?.latest?.date).toBe('2026-11-02');
    expect(api.puts).toEqual([
      ['p_0001_first.webm', false],
      ['p_0001_latest.webm', true],
      ['p_0001_latest.webm', true],
    ]);
  });

  it('keeps an existing first file when the progress entry lost it', async () => {
    const api = fakeApi(new Set(['p_0001_first.webm']));
    const r = rec('p_0001');
    const recs = await storeCleanRecording(api, r, blob, '2026-10-19');
    expect(recs?.first).toEqual({ file: 'p_0001_first.webm', date: '2026-01-05' });
    expect(recs?.latest).toEqual({ file: 'p_0001_latest.webm', date: '2026-10-19' });
  });
});

describe('progress with recordings', () => {
  it('survives applyOutcome and normalizeSave', () => {
    const r = rec('p_0001', { recordings: { first: { file: 'p_0001_first.webm', date: '2026-10-19' } } });
    const after = applyOutcome(r, 'p_0001', 'miss', '2026-10-20');
    expect(after.recordings).toEqual(r.recordings);
    const s = normalizeSave({ version: 1, phrases: { p_0001: { recordings: { first: { file: 'p_0001_first.webm', date: '2026-10-19' }, latest: { file: '../evil', date: 'x' } } } } });
    expect(s.phrases.p_0001.recordings).toEqual({ first: { file: 'p_0001_first.webm', date: '2026-10-19' } });
    const none = normalizeSave({ version: 1, phrases: { p_0001: { recordings: {} } } });
    expect(none.phrases.p_0001.recordings).toBeUndefined();
  });

  it('labels days', () => {
    expect(relativeDayLabel('2026-10-19', '2026-10-19')).toBe('today');
    expect(relativeDayLabel('2026-10-18', '2026-10-19')).toBe('yesterday');
    expect(relativeDayLabel('2026-09-26', '2026-10-19')).toBe('23 days ago');
  });
});

describe('cleanup and listing', () => {
  const phrases: Phrase[] = ['p_0001', 'p_0002', 'p_0003'].map((id) => ({
    id,
    text: id,
    translation: 'x',
    wordCount: 1,
    difficulty: 1,
    category: 'work',
    tags: [],
  }));
  const save = {
    version: 1,
    updatedAt: '',
    phrases: {
      p_0001: rec('p_0001', { learned: true, recordings: { first: { file: 'p_0001_first.webm', date: '2026-01-01' }, latest: { file: 'p_0001_latest.webm', date: '2026-02-01' } } }),
      p_0002: rec('p_0002', { learned: true, recordings: { first: { file: 'p_0002_first.webm', date: '2026-09-01' }, latest: { file: 'p_0002_latest.webm', date: '2026-10-01' } } }),
      p_0003: rec('p_0003', { learned: false, recordings: { first: { file: 'p_0003_first.webm', date: '2026-01-01' }, latest: { file: 'p_0003_latest.webm', date: '2026-01-02' } } }),
    },
    profile: { bestScore: 0, bestCombo: 0, runsPlayed: 0, totals: { clean: 0, late: 0, miss: 0, silence: 0 } },
    settings: { startLevel: 1, runLength: 5, voiceName: null, speedScale: 1, soundOn: true },
  } as SaveFile;

  it('only learned phrases with recordings older than half a year are cleanup candidates', () => {
    const c = cleanupCandidates(save, '2026-10-19');
    expect(c.map((x) => x.phraseId)).toEqual(['p_0001']);
    expect(c[0].files).toEqual(['p_0001_first.webm', 'p_0001_latest.webm']);
  });

  it('lists pairs newest first', () => {
    const list = comparisonList(phrases, save);
    expect(list.map((e) => e.phrase.id)).toEqual(['p_0002', 'p_0001', 'p_0003']);
  });
});
