/**
 * Game clock: milliseconds of unpaused play since start().
 * Real timestamps (performance.now()) map to game time, or to null when they
 * fall inside a pause, so nothing heard during a pause (the reference audio,
 * for instance) can be attributed to a phrase.
 */
export class GameClock {
  private startReal = 0;
  private paused = false;
  private pauseStartReal = 0;
  private pausedTotal = 0;
  private pauses: Array<[number, number]> = [];
  private started = false;

  start(): void {
    this.startReal = performance.now();
    this.started = true;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  now(): number {
    if (!this.started) return 0;
    const r = this.paused ? this.pauseStartReal : performance.now();
    return r - this.startReal - this.pausedTotal;
  }

  pause(): void {
    if (this.paused || !this.started) return;
    this.paused = true;
    this.pauseStartReal = performance.now();
  }

  resume(): void {
    if (!this.paused) return;
    const r = performance.now();
    this.pausedTotal += r - this.pauseStartReal;
    this.pauses.push([this.pauseStartReal, r]);
    this.paused = false;
  }

  /** Game time for a real timestamp, or null if it happened during a pause / before start. */
  toGame(real: number): number | null {
    if (!this.started || real < this.startReal) return null;
    if (this.paused && real >= this.pauseStartReal) return null;
    let p = 0;
    for (const [a, b] of this.pauses) {
      if (real >= a && real < b) return null;
      if (b <= real) p += b - a;
    }
    return real - this.startReal - p;
  }
}
