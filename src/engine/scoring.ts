import type { Outcome } from './types';

export const CLEAN_THRESHOLD = 0.85;
export const POINTS: Record<Outcome, number> = { clean: 10, late: 4, miss: 0, silence: -5 };
export const COMBO_STEP = 5;
export const COMBO_INCREMENT = 0.5;
export const COMBO_MAX = 3;

export interface Classification {
  /** Match ratio while the phrase was inside the zone (plus latency allowance). */
  ratioInZone: number;
  /** Match ratio once the late grace period is over. */
  ratioAfterGrace: number;
  /** Whether any speech at all was heard for this phrase (zone + grace). */
  spokeAnything: boolean;
}

export function classify(c: Classification): Outcome {
  if (c.ratioInZone >= CLEAN_THRESHOLD) return 'clean';
  if (c.ratioAfterGrace >= CLEAN_THRESHOLD) return 'late';
  if (c.spokeAnything) return 'miss';
  return 'silence';
}

/** Every 5 clean hits in a row add +0.5, capped at x3. */
export function comboMultiplier(cleanStreak: number): number {
  return Math.min(COMBO_MAX, 1 + COMBO_INCREMENT * Math.floor(cleanStreak / COMBO_STEP));
}

export interface ScoreUpdate {
  outcome: Outcome;
  points: number;
  multiplier: number;
  cleanStreak: number;
  score: number;
  /** True when this hit just raised the multiplier. */
  comboUp: boolean;
  /** True when the streak was broken by this outcome. */
  comboBroken: boolean;
}

export class ScoreState {
  score = 0;
  cleanStreak = 0;
  bestCombo = 0;
  counts: Record<Outcome, number> = { clean: 0, late: 0, miss: 0, silence: 0 };

  apply(outcome: Outcome): ScoreUpdate {
    this.counts[outcome]++;
    let comboUp = false;
    let comboBroken = false;
    if (outcome === 'clean') {
      const before = comboMultiplier(this.cleanStreak);
      this.cleanStreak++;
      const after = comboMultiplier(this.cleanStreak);
      comboUp = after > before;
      this.bestCombo = Math.max(this.bestCombo, this.cleanStreak);
    } else {
      comboBroken = this.cleanStreak > 0;
      this.cleanStreak = 0;
    }
    const multiplier = outcome === 'clean' ? comboMultiplier(this.cleanStreak) : 1;
    const points = Math.round(POINTS[outcome] * multiplier);
    this.score += points;
    return { outcome, points, multiplier, cleanStreak: this.cleanStreak, score: this.score, comboUp, comboBroken };
  }
}
