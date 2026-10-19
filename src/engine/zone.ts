/**
 * Hit zone geometry and timing.
 *
 * The zone is a horizontal band, not a line. Its height depends on the phrase
 * length so that a phrase spoken at the target tempo fits inside it, with some
 * tolerance. Recording starts when the top of the phrase touches the top of the
 * zone and stops when the bottom of the phrase leaves the bottom of the zone.
 *
 * Between those two moments the phrase travels (zoneHeight - phraseHeight), so
 * the band is the spec's `expectedSeconds * fallSpeed * toleranceFactor` plus
 * the phrase's own height. That way the time budget the player actually gets
 * is exactly expectedSeconds * toleranceFactor, for short and long phrases alike.
 */

export const TARGET_WPM = 150;
export const TOLERANCE_FACTOR = 1.4;

/** Time the phrase would take at the target tempo. */
export function expectedSeconds(wordCount: number): number {
  return (wordCount / TARGET_WPM) * 60;
}

/** Time budget inside the zone. */
export function budgetSeconds(wordCount: number): number {
  return expectedSeconds(wordCount) * TOLERANCE_FACTOR;
}

/** Zone height in pixels for a phrase of this length and rendered height, at this fall speed (px/s). */
export function zoneHeight(wordCount: number, fallSpeed: number, phraseHeight = 0): number {
  return budgetSeconds(wordCount) * fallSpeed + phraseHeight;
}

export interface FieldLayout {
  /** Height of the playfield in px. */
  fieldHeight: number;
  /** Fixed top edge of the zone in px from the top of the field. */
  zoneTop: number;
  /** Space kept below the longest zone so it never touches the field bottom. */
  bottomMargin: number;
}

/**
 * Pick one constant fall speed for a whole run: the preferred speed, reduced
 * only if the zone for the longest phrase in the run would not fit the field.
 * Time inside the zone does not depend on this; only the picture does.
 */
export function fallSpeedForRun(
  layout: FieldLayout,
  maxWordCount: number,
  maxPhraseHeight: number,
  preferred: number,
): number {
  const room = layout.fieldHeight - layout.zoneTop - layout.bottomMargin - maxPhraseHeight;
  const maxSpeed = room / budgetSeconds(Math.max(1, maxWordCount));
  return Math.max(20, Math.min(preferred, maxSpeed));
}

export interface PhraseWindow {
  /** Game time (ms) when the phrase top touches the zone top: recording starts. */
  enterMs: number;
  /** Game time (ms) when the phrase bottom leaves the zone bottom: recording stops. */
  exitMs: number;
  /** Game time (ms) when the phrase is fully below the field. */
  goneMs: number;
  zoneTop: number;
  zoneBottom: number;
}

/**
 * The phrase spawns fully above the field (its bottom at y = 0) at `spawnMs`
 * and moves down at `fallSpeed` px/s.
 */
export function phraseWindow(
  spawnMs: number,
  phraseHeight: number,
  wordCount: number,
  fallSpeed: number,
  layout: FieldLayout,
): PhraseWindow {
  const zh = zoneHeight(wordCount, fallSpeed, phraseHeight);
  const zoneTop = layout.zoneTop;
  const zoneBottom = zoneTop + zh;
  const enterMs = spawnMs + ((zoneTop + phraseHeight) / fallSpeed) * 1000;
  const exitMs = spawnMs + (zoneBottom / fallSpeed) * 1000;
  const goneMs = spawnMs + ((layout.fieldHeight + phraseHeight) / fallSpeed) * 1000;
  return { enterMs, exitMs, goneMs, zoneTop, zoneBottom };
}

/** Y position (px) of the phrase top at game time t. */
export function phraseTopAt(spawnMs: number, phraseHeight: number, fallSpeed: number, nowMs: number): number {
  return -phraseHeight + (fallSpeed * (nowMs - spawnMs)) / 1000;
}

/** Recognition latency allowance: results for speech inside the zone arrive a bit later. */
export const RECOGNITION_LATENCY_MS = 700;
/** How long after leaving the zone a phrase can still be finished for the "late" outcome. */
export const LATE_GRACE_MS = 2000;
/** Gap between one phrase leaving its zone and the next phrase entering its own zone. */
export const GAP_BETWEEN_PHRASES_MS = 2300;
