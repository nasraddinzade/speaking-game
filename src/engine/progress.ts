import type { Difficulty, Outcome, Phrase, PhraseProgress, Profile, SaveFile, Settings } from './types';

export const REQUIRED_DAYS = 3;
/** Learned phrases come back for a check this many days after they were last seen. */
export const LEARNED_CHECK_AFTER_DAYS = 14;

export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.UTC(+fromDay.slice(0, 4), +fromDay.slice(5, 7) - 1, +fromDay.slice(8, 10));
  const b = Date.UTC(+toDay.slice(0, 4), +toDay.slice(5, 7) - 1, +toDay.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function newRecord(phraseId: string): PhraseProgress {
  return { phraseId, cleanHitDays: [], requiredDays: REQUIRED_DAYS, lastSeen: null, misses: 0, learned: false };
}

/**
 * Apply one outcome to a phrase record. Pure: returns a new record.
 * - clean: counts one hit for the day; several hits on the same day count once.
 * - late: seen, nothing else.
 * - miss (words): +1 miss, raises the show frequency; a learned phrase drops back.
 * - silence: seen, nothing else. Silence only costs points.
 */
export function applyOutcome(
  record: PhraseProgress | undefined,
  phraseId: string,
  outcome: Outcome,
  day: string,
): PhraseProgress {
  const r: PhraseProgress = record ? { ...record, cleanHitDays: [...record.cleanHitDays] } : newRecord(phraseId);
  r.lastSeen = day;
  if (outcome === 'clean') {
    if (!r.cleanHitDays.includes(day)) r.cleanHitDays.push(day);
    if (r.cleanHitDays.length >= r.requiredDays) r.learned = true;
  } else if (outcome === 'miss') {
    r.misses += 1;
    if (r.learned) {
      r.learned = false;
      r.cleanHitDays.pop();
    }
  }
  return r;
}

export interface SelectionOptions {
  startLevel: Difficulty;
  count: number;
  day: string;
  rng?: () => number;
}

const LEVEL_WEIGHT = [1, 0.35, 0.12, 0.04];

/** Weight of a phrase for the next run. 0 means "not in rotation". */
export function phraseWeight(phrase: Phrase, record: PhraseProgress | undefined, opts: SelectionOptions): number {
  const d = phrase.difficulty - opts.startLevel;
  if (d < 0) return 0;
  const levelFactor = LEVEL_WEIGHT[d] ?? 0.04;
  if (record?.learned) {
    const since = record.lastSeen ? daysBetween(record.lastSeen, opts.day) : Infinity;
    return since >= LEARNED_CHECK_AFTER_DAYS ? 0.15 * levelFactor : 0;
  }
  let w = 1 + 0.6 * Math.min(record?.misses ?? 0, 5);
  if (!record) w *= 1.2;
  if (record?.cleanHitDays.includes(opts.day)) w *= 0.3;
  else if (record?.lastSeen === opts.day) w *= 0.7;
  return w * levelFactor;
}

function weightedPick<T>(items: Array<{ item: T; weight: number }>, rng: () => number): number {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= items[i].weight;
    if (r <= 0) return i;
  }
  return items.length - 1;
}

/** Pick phrases for a run, weighted, without repeats, ordered by a gentle difficulty ramp. */
export function selectRunPhrases(
  phrases: Phrase[],
  progress: Record<string, PhraseProgress>,
  opts: SelectionOptions,
): Phrase[] {
  const rng = opts.rng ?? Math.random;
  const pool = phrases
    .map((p) => ({ item: p, weight: phraseWeight(p, progress[p.id], opts) }))
    .filter((x) => x.weight > 0);
  const chosen: Phrase[] = [];
  while (chosen.length < opts.count && pool.length > 0) {
    const i = weightedPick(pool, rng);
    chosen.push(pool[i].item);
    pool.splice(i, 1);
  }
  if (chosen.length < opts.count) {
    // Not enough in rotation: fall back to anything not yet chosen, learned ones included.
    const taken = new Set(chosen.map((p) => p.id));
    const rest = phrases.filter((p) => !taken.has(p.id)).map((item) => ({ item, weight: 1 }));
    while (chosen.length < opts.count && rest.length > 0) {
      const i = weightedPick(rest, rng);
      chosen.push(rest[i].item);
      rest.splice(i, 1);
    }
  }
  // Gentle ramp: lower difficulties first, random order inside a level.
  return chosen
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.difficulty - b.p.difficulty || a.i - b.i)
    .map((x) => x.p);
}

export function defaultSettings(): Settings {
  return { startLevel: 1, runLength: 15, voiceName: null, speedScale: 1, soundOn: true };
}

export function defaultProfile(): Profile {
  return { bestScore: 0, bestCombo: 0, runsPlayed: 0, totals: { clean: 0, late: 0, miss: 0, silence: 0 } };
}

export function emptySave(): SaveFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    phrases: {},
    profile: defaultProfile(),
    settings: defaultSettings(),
  };
}

/** Validate and repair a loaded save file. Throws on something that is not a save file at all. */
export function normalizeSave(raw: unknown): SaveFile {
  if (!raw || typeof raw !== 'object') throw new Error('Save file is not an object');
  const obj = raw as Partial<SaveFile>;
  if (obj.version !== 1) throw new Error(`Unsupported save version: ${String(obj.version)}`);
  const base = emptySave();
  const phrases: Record<string, PhraseProgress> = {};
  if (obj.phrases && typeof obj.phrases === 'object') {
    for (const [id, rec] of Object.entries(obj.phrases)) {
      if (!rec || typeof rec !== 'object') continue;
      const r = rec as Partial<PhraseProgress>;
      phrases[id] = {
        phraseId: id,
        cleanHitDays: Array.isArray(r.cleanHitDays) ? r.cleanHitDays.filter((d) => typeof d === 'string') : [],
        requiredDays: typeof r.requiredDays === 'number' ? r.requiredDays : REQUIRED_DAYS,
        lastSeen: typeof r.lastSeen === 'string' ? r.lastSeen : null,
        misses: typeof r.misses === 'number' ? r.misses : 0,
        learned: Boolean(r.learned),
      };
    }
  }
  return {
    version: 1,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : base.updatedAt,
    phrases,
    profile: {
      ...base.profile,
      ...(obj.profile ?? {}),
      totals: { ...base.profile.totals, ...(obj.profile?.totals ?? {}) },
    },
    settings: { ...base.settings, ...(obj.settings ?? {}) },
  };
}

export function learnedCount(save: SaveFile): number {
  return Object.values(save.phrases).filter((r) => r.learned).length;
}
