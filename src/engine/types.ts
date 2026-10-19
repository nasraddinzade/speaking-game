export type Difficulty = 1 | 2 | 3 | 4;

export interface Phrase {
  id: string;
  text: string;
  translation: string;
  wordCount: number;
  difficulty: Difficulty;
  category: string;
  tags: string[];
}

/** Four outcomes, deliberately not three: a word miss and silence are different situations. */
export type Outcome = 'clean' | 'late' | 'miss' | 'silence';

export interface RecordingRef {
  /** File name inside the recordings folder, e.g. p_0142_first.webm */
  file: string;
  /** Local day (YYYY-MM-DD) the recording was made. */
  date: string;
}

/** Two recordings per phrase: the very first clean hit (never overwritten) and the latest one. */
export interface PhraseRecordings {
  first?: RecordingRef;
  latest?: RecordingRef;
}

export interface PhraseProgress {
  phraseId: string;
  recordings?: PhraseRecordings;
  /** Local calendar days (YYYY-MM-DD) with at least one clean hit. Same-day hits count once. */
  cleanHitDays: string[];
  requiredDays: number;
  lastSeen: string | null;
  misses: number;
  learned: boolean;
}

export interface Profile {
  bestScore: number;
  bestCombo: number;
  runsPlayed: number;
  totals: Record<Outcome, number>;
}

export interface Settings {
  startLevel: Difficulty;
  runLength: number;
  voiceName: string | null;
  /** 1 = default speed. Lower is slower. Purely visual: time inside the zone is unchanged. */
  speedScale: number;
  soundOn: boolean;
}

export interface SaveFile {
  version: 1;
  updatedAt: string;
  phrases: Record<string, PhraseProgress>;
  profile: Profile;
  settings: Settings;
}

export interface RunResultEntry {
  phrase: Phrase;
  outcome: Outcome;
  matchRatio: number;
  points: number;
  multiplier: number;
  heard: string;
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  score: number;
  bestCombo: number;
  counts: Record<Outcome, number>;
  entries: RunResultEntry[];
  startLevel: Difficulty;
}
