/**
 * Recording bookkeeping: which file a clean hit goes to, and what can be
 * cleaned up when the folder grows too large.
 */
import { daysBetween } from '../engine/progress';
import type { Phrase, PhraseProgress, SaveFile } from '../engine/types';
import type { RecordingsApi } from './storage';

export const STORAGE_WARNING_BYTES = 500 * 1024 * 1024;
export const CLEANUP_AGE_DAYS = 183;

export function recordingFileName(phraseId: string, which: 'first' | 'latest'): string {
  return `${phraseId}_${which}.webm`;
}

/**
 * Store the audio of a clean hit. The first recording of a phrase is written
 * once and never replaced; every later clean hit replaces `latest`.
 * Returns the updated recordings block for the phrase record.
 */
export async function storeCleanRecording(
  api: RecordingsApi,
  record: PhraseProgress,
  blob: Blob,
  day: string,
): Promise<PhraseProgress['recordings']> {
  const recs = { ...(record.recordings ?? {}) };
  if (!recs.first) {
    const file = recordingFileName(record.phraseId, 'first');
    const res = await api.put(file, blob, false);
    if (res.status === 'created') {
      recs.first = { file, date: day };
      return recs;
    }
    // The file was already there (progress reset or imported without this entry):
    // keep it as the first recording and treat this hit as the latest one.
    recs.first = { file, date: res.date ?? day };
  }
  const file = recordingFileName(record.phraseId, 'latest');
  await api.put(file, blob, true);
  recs.latest = { file, date: day };
  return recs;
}

export interface CleanupCandidate {
  phraseId: string;
  files: string[];
}

/** Learned phrases whose newest recording is older than half a year. */
export function cleanupCandidates(save: SaveFile, today: string): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];
  for (const r of Object.values(save.phrases)) {
    if (!r.learned || !r.recordings) continue;
    const newest = r.recordings.latest?.date ?? r.recordings.first?.date;
    if (!newest || daysBetween(newest, today) < CLEANUP_AGE_DAYS) continue;
    const files = [r.recordings.first?.file, r.recordings.latest?.file].filter((f): f is string => Boolean(f));
    if (files.length) out.push({ phraseId: r.phraseId, files });
  }
  return out;
}

export interface ComparisonEntry {
  phrase: Phrase;
  record: PhraseProgress;
}

function newestDate(r: PhraseProgress): string {
  return r.recordings?.latest?.date ?? r.recordings?.first?.date ?? '';
}

/** All phrases with at least one recording, newest first. Pairs come before single takes of the same day. */
export function recordingList(phrases: Phrase[], save: SaveFile): ComparisonEntry[] {
  const byId = new Map(phrases.map((p) => [p.id, p]));
  return Object.values(save.phrases)
    .filter((r) => r.recordings?.first || r.recordings?.latest)
    .map((record) => ({ record, phrase: byId.get(record.phraseId) }))
    .filter((x): x is ComparisonEntry => Boolean(x.phrase))
    .sort((a, b) => {
      const d = newestDate(b.record).localeCompare(newestDate(a.record));
      if (d !== 0) return d;
      return Number(Boolean(b.record.recordings?.latest)) - Number(Boolean(a.record.recordings?.latest));
    });
}

/** Only phrases with two different recordings, newest first. */
export function comparisonList(phrases: Phrase[], save: SaveFile): ComparisonEntry[] {
  return recordingList(phrases, save).filter(
    (e) => e.record.recordings?.first && e.record.recordings.latest && e.record.recordings.first.file !== e.record.recordings.latest.file,
  );
}
