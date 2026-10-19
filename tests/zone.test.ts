import { describe, expect, it } from 'vitest';
import { budgetSeconds, expectedSeconds, fallSpeedForRun, phraseTopAt, phraseWindow, zoneHeight } from '../src/engine/zone';

const layout = { fieldHeight: 900, zoneTop: 160, bottomMargin: 40 };

describe('zone formulas', () => {
  it('follows the spec formula plus the phrase height', () => {
    // targetWPM = 150 -> 8 words = 3.2 s; zone = 3.2 * 100 * 1.4 = 448 px at 100 px/s
    expect(expectedSeconds(8)).toBeCloseTo(3.2);
    expect(zoneHeight(8, 100)).toBeCloseTo(448);
    expect(zoneHeight(8, 100, 60)).toBeCloseTo(508);
  });

  it('keeps a constant run speed unless the longest zone would not fit', () => {
    expect(fallSpeedForRun(layout, 8, 60, 100)).toBe(100);
    // 20 words: 8 s * 1.4 = 11.2 s; room = 700 - 120 = 580 px -> 51.8 px/s
    const v = fallSpeedForRun(layout, 20, 120, 100);
    expect(v).toBeCloseTo(580 / 11.2);
    expect(layout.zoneTop + zoneHeight(20, v, 120)).toBeLessThanOrEqual(layout.fieldHeight - layout.bottomMargin + 1e-6);
  });
});

describe('phrase window', () => {
  it('starts when the phrase top touches the zone top and ends when its bottom leaves the zone bottom', () => {
    const v = 100;
    const h = 60;
    const w = phraseWindow(1000, h, 8, v, layout);
    // top reaches zoneTop: travel = zoneTop + h = 220 px -> 2.2 s
    expect(w.enterMs).toBeCloseTo(3200);
    expect(phraseTopAt(1000, h, v, w.enterMs)).toBeCloseTo(layout.zoneTop);
    // bottom leaves zoneBottom: bottom y = top + h = zoneTop + zh
    expect(phraseTopAt(1000, h, v, w.exitMs) + h).toBeCloseTo(w.zoneBottom);
    // time inside the zone is exactly the budget, whatever the phrase height
    expect((w.exitMs - w.enterMs) / 1000).toBeCloseTo(budgetSeconds(8));
    expect((w.exitMs - w.enterMs) / 1000).toBeCloseTo(3.2 * 1.4);
  });

  it('a two-word phrase still gets its full budget', () => {
    const w = phraseWindow(0, 60, 2, 100, layout);
    expect((w.exitMs - w.enterMs) / 1000).toBeCloseTo(0.8 * 1.4);
  });

  it('gives a 12+ word phrase its full time at the run speed and the zone fits the field', () => {
    const h = 120; // three lines
    const v = fallSpeedForRun(layout, 16, h, 100);
    const w = phraseWindow(0, h, 16, v, layout);
    const inside = (w.exitMs - w.enterMs) / 1000;
    expect(inside).toBeCloseTo(budgetSeconds(16));
    expect(inside).toBeGreaterThan(expectedSeconds(16));
    expect(w.zoneBottom).toBeLessThanOrEqual(layout.fieldHeight - layout.bottomMargin + 1e-6);
    expect(w.goneMs).toBeGreaterThan(w.exitMs);
  });
});
