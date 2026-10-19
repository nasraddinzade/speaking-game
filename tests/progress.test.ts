import { describe, expect, it } from 'vitest';
import { applyOutcome, daysBetween, normalizeSave, phraseWeight, selectRunPhrases } from '../src/engine/progress';
import type { Phrase, PhraseProgress } from '../src/engine/types';

const mk = (id: string, difficulty: 1 | 2 | 3 | 4, wordCount = 5): Phrase => ({
  id,
  text: `phrase ${id}`,
  translation: 'фраза',
  wordCount,
  difficulty,
  category: 'work',
  tags: [],
});

describe('applyOutcome', () => {
  it('learns after clean hits on three different days, same day counts once', () => {
    let r: PhraseProgress | undefined;
    r = applyOutcome(r, 'p1', 'clean', '2026-10-19');
    r = applyOutcome(r, 'p1', 'clean', '2026-10-19');
    expect(r.cleanHitDays).toEqual(['2026-10-19']);
    expect(r.learned).toBe(false);
    r = applyOutcome(r, 'p1', 'clean', '2026-10-21');
    expect(r.learned).toBe(false);
    r = applyOutcome(r, 'p1', 'clean', '2026-10-25');
    expect(r.learned).toBe(true);
    expect(r.lastSeen).toBe('2026-10-25');
  });

  it('a word miss adds to misses, silence and late do not', () => {
    let r = applyOutcome(undefined, 'p1', 'miss', '2026-10-19');
    expect(r.misses).toBe(1);
    r = applyOutcome(r, 'p1', 'silence', '2026-10-19');
    r = applyOutcome(r, 'p1', 'late', '2026-10-19');
    expect(r.misses).toBe(1);
    expect(r.cleanHitDays).toEqual([]);
  });

  it('a learned phrase drops back on a word miss', () => {
    let r = applyOutcome(undefined, 'p1', 'clean', '2026-10-01');
    r = applyOutcome(r, 'p1', 'clean', '2026-10-02');
    r = applyOutcome(r, 'p1', 'clean', '2026-10-03');
    expect(r.learned).toBe(true);
    r = applyOutcome(r, 'p1', 'miss', '2026-10-20');
    expect(r.learned).toBe(false);
    expect(r.cleanHitDays).toHaveLength(2);
  });
});

describe('weights and selection', () => {
  const day = '2026-10-19';
  it('misses raise the weight, silence does not', () => {
    const p = mk('p1', 1);
    const fresh = phraseWeight(p, undefined, { startLevel: 1, count: 1, day });
    const missed = phraseWeight(p, applyOutcome(undefined, 'p1', 'miss', '2026-10-10'), { startLevel: 1, count: 1, day });
    const silent = phraseWeight(p, applyOutcome(undefined, 'p1', 'silence', '2026-10-10'), { startLevel: 1, count: 1, day });
    expect(missed).toBeGreaterThan(fresh);
    expect(silent).toBeLessThanOrEqual(fresh);
    expect(silent).toBeGreaterThan(0);
  });

  it('learned phrases leave rotation and return for a check later', () => {
    const p = mk('p1', 1);
    const learned: PhraseProgress = { phraseId: 'p1', cleanHitDays: ['a', 'b', 'c'], requiredDays: 3, lastSeen: '2026-10-18', misses: 0, learned: true };
    expect(phraseWeight(p, learned, { startLevel: 1, count: 1, day })).toBe(0);
    expect(phraseWeight(p, { ...learned, lastSeen: '2026-09-01' }, { startLevel: 1, count: 1, day })).toBeGreaterThan(0);
  });

  it('phrases below the start level are excluded, higher levels are rarer', () => {
    expect(phraseWeight(mk('a', 1), undefined, { startLevel: 2, count: 1, day })).toBe(0);
    const l2 = phraseWeight(mk('b', 2), undefined, { startLevel: 2, count: 1, day });
    const l3 = phraseWeight(mk('c', 3), undefined, { startLevel: 2, count: 1, day });
    expect(l2).toBeGreaterThan(l3);
  });

  it('selects without repeats and ramps difficulty', () => {
    const phrases = [mk('a', 2), mk('b', 3), mk('c', 2), mk('d', 4), mk('e', 2), mk('f', 3)];
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const run = selectRunPhrases(phrases, {}, { startLevel: 2, count: 5, day, rng });
    expect(new Set(run.map((p) => p.id)).size).toBe(5);
    const diffs = run.map((p) => p.difficulty);
    expect([...diffs].sort((x, y) => x - y)).toEqual(diffs);
  });

  it('pads from outside the rotation when the pool is too small', () => {
    const phrases = [mk('a', 1), mk('b', 1), mk('c', 1)];
    const run = selectRunPhrases(phrases, {}, { startLevel: 4, count: 2, day });
    expect(run).toHaveLength(2);
  });
});

describe('save file', () => {
  it('repairs partial records and rejects foreign files', () => {
    const s = normalizeSave({ version: 1, phrases: { p1: { cleanHitDays: ['2026-10-19'] } } });
    expect(s.phrases.p1.misses).toBe(0);
    expect(s.phrases.p1.requiredDays).toBe(3);
    expect(s.settings.runLength).toBe(15);
    expect(() => normalizeSave({ hello: 'world' })).toThrow();
    expect(() => normalizeSave('nope')).toThrow();
  });

  it('counts days', () => {
    expect(daysBetween('2026-10-19', '2026-10-21')).toBe(2);
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
  });
});
