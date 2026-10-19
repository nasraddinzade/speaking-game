import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Phrase } from '../src/engine/types';
import { EARLY_START_MS, LATE_GRACE_MS } from '../src/engine/zone';
import { Run } from '../src/game/run';

const phrase: Phrase = {
  id: 'p_0001',
  text: 'Nice to meet you.',
  translation: 'x',
  wordCount: 4,
  difficulty: 1,
  category: 'smalltalk',
  tags: [],
};
const layout = { fieldHeight: 800, zoneTop: 160, bottomMargin: 28 };

function setNow(ms: number) {
  vi.spyOn(performance, 'now').mockReturnValue(ms);
}

afterEach(() => vi.restoreAllMocks());

describe('Run word attribution', () => {
  it('counts words spoken a little before the phrase reaches the zone', () => {
    setNow(0);
    const outcomes: string[] = [];
    const run = new Run({ phrases: [phrase], layout, fallSpeed: 100, heights: [60] }, { onOutcome: (p) => outcomes.push(p.outcome!) });
    run.start();
    const { enterMs } = run.all[0].window;
    setNow(enterMs - 500);
    run.tick(); // spawned, falling
    expect(run.all[0].state).toBe('falling');
    // all four words heard 400 ms before the zone, within the early-start allowance
    const at = enterMs - 400;
    run.setWords(['Nice', 'to', 'meet', 'you'].map((text) => ({ text, atMs: at, final: false })));
    setNow(enterMs + 50);
    run.tick();
    expect(outcomes).toEqual(['clean']);
    expect(run.all[0].ratioInZone).toBe(1);
  });

  it('ignores words spoken well before the allowance', () => {
    setNow(0);
    const outcomes: string[] = [];
    const run = new Run({ phrases: [phrase], layout, fallSpeed: 100, heights: [60] }, { onOutcome: (p) => outcomes.push(p.outcome!) });
    run.start();
    const { enterMs, exitMs } = run.all[0].window;
    setNow(enterMs - 1500);
    run.tick();
    run.setWords(['Nice', 'to', 'meet', 'you'].map((text) => ({ text, atMs: enterMs - EARLY_START_MS - 300, final: false })));
    setNow(exitMs + LATE_GRACE_MS + 10);
    run.tick();
    expect(outcomes).toEqual(['silence']);
  });

  it('a single dropped word fails a four-word phrase, so the first word must count', () => {
    setNow(0);
    const outcomes: string[] = [];
    const run = new Run({ phrases: [phrase], layout, fallSpeed: 100, heights: [60] }, { onOutcome: (p) => outcomes.push(p.outcome!) });
    run.start();
    const { enterMs, exitMs } = run.all[0].window;
    setNow(enterMs + 100);
    run.tick();
    run.setWords(['to', 'meet', 'you'].map((text) => ({ text, atMs: enterMs + 300, final: false })));
    setNow(exitMs + LATE_GRACE_MS + 10);
    run.tick();
    expect(outcomes).toEqual(['miss']);
  });
});
