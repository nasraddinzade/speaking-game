import { describe, expect, it } from 'vitest';
import { ScoreState, classify, comboMultiplier } from '../src/engine/scoring';

describe('classify', () => {
  it('maps the four outcomes', () => {
    expect(classify({ ratioInZone: 0.9, ratioAfterGrace: 0.9, spokeAnything: true })).toBe('clean');
    expect(classify({ ratioInZone: 0.85, ratioAfterGrace: 0.85, spokeAnything: true })).toBe('clean');
    expect(classify({ ratioInZone: 0.5, ratioAfterGrace: 0.9, spokeAnything: true })).toBe('late');
    expect(classify({ ratioInZone: 0.5, ratioAfterGrace: 0.6, spokeAnything: true })).toBe('miss');
    expect(classify({ ratioInZone: 0, ratioAfterGrace: 0, spokeAnything: false })).toBe('silence');
  });
});

describe('combo', () => {
  it('adds 0.5 every 5 clean hits, capped at 3', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(4)).toBe(1);
    expect(comboMultiplier(5)).toBe(1.5);
    expect(comboMultiplier(10)).toBe(2);
    expect(comboMultiplier(20)).toBe(3);
    expect(comboMultiplier(40)).toBe(3);
  });

  it('scores and resets', () => {
    const s = new ScoreState();
    for (let i = 0; i < 4; i++) expect(s.apply('clean').points).toBe(10);
    const fifth = s.apply('clean');
    expect(fifth.points).toBe(15);
    expect(fifth.comboUp).toBe(true);
    expect(s.score).toBe(55);
    const late = s.apply('late');
    expect(late.points).toBe(4);
    expect(late.comboBroken).toBe(true);
    expect(s.cleanStreak).toBe(0);
    expect(s.apply('miss').points).toBe(0);
    expect(s.apply('silence').points).toBe(-5);
    expect(s.score).toBe(54);
    expect(s.bestCombo).toBe(5);
    expect(s.counts).toEqual({ clean: 5, late: 1, miss: 1, silence: 1 });
  });
});
