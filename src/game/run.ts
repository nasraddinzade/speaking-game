/**
 * One run: a sequence of phrases falling through the hit zone.
 *
 * This module owns timing, word attribution and outcomes. It knows nothing
 * about the DOM except the numbers it is given (field layout, phrase heights).
 */
import { matchPhrase } from '../engine/normalize';
import { ScoreState, classify, type ScoreUpdate } from '../engine/scoring';
import type { Outcome, Phrase } from '../engine/types';
import {
  EARLY_START_MS,
  GAP_BETWEEN_PHRASES_MS,
  LATE_GRACE_MS,
  RECOGNITION_LATENCY_MS,
  phraseTopAt,
  phraseWindow,
  type FieldLayout,
  type PhraseWindow,
} from '../engine/zone';
import type { TimedWord } from '../speech/recognizer';
import { GameClock } from './clock';

export type PhraseState = 'waiting' | 'falling' | 'inZone' | 'grace' | 'done';

export interface ActivePhrase {
  index: number;
  phrase: Phrase;
  height: number;
  spawnMs: number;
  window: PhraseWindow;
  state: PhraseState;
  outcome: Outcome | null;
  /** Everything heard that is attributed to this phrase (zone + grace). */
  heardText: string;
  wordsHeard: boolean[];
  ratioInZone: number;
  ratioAfterGrace: number;
  decidedAtMs: number | null;
  score: ScoreUpdate | null;
}

export interface RunOptions {
  phrases: Phrase[];
  layout: FieldLayout;
  fallSpeed: number;
  /** Rendered height of each phrase, same order as `phrases`. */
  heights: number[];
  firstSpawnDelayMs?: number;
}

export interface RunEvents {
  onSpawn?: (p: ActivePhrase) => void;
  onEnterZone?: (p: ActivePhrase) => void;
  onWordsUpdate?: (p: ActivePhrase) => void;
  onOutcome?: (p: ActivePhrase, update: ScoreUpdate) => void;
  onGone?: (p: ActivePhrase) => void;
  onFinished?: () => void;
}

export class Run {
  readonly clock = new GameClock();
  readonly score = new ScoreState();
  readonly active: ActivePhrase[] = [];
  readonly all: ActivePhrase[] = [];
  private nextIndex = 0;
  private words: TimedWord[] = [];
  private finished = false;
  readonly fallSpeed: number;
  readonly layout: FieldLayout;

  constructor(
    private readonly opts: RunOptions,
    private readonly events: RunEvents = {},
  ) {
    this.fallSpeed = opts.fallSpeed;
    this.layout = opts.layout;
    this.schedule();
  }

  /** Lay out every phrase in time: the next one enters its zone a fixed gap after the previous one leaves. */
  private schedule(): void {
    let spawn = this.opts.firstSpawnDelayMs ?? 700;
    this.opts.phrases.forEach((phrase, index) => {
      const height = this.opts.heights[index];
      const window = phraseWindow(spawn, height, phrase.wordCount, this.fallSpeed, this.layout);
      this.all.push({
        index,
        phrase,
        height,
        spawnMs: spawn,
        window,
        state: 'waiting',
        outcome: null,
        heardText: '',
        wordsHeard: phrase.text.split(/\s+/).map(() => false),
        ratioInZone: 0,
        ratioAfterGrace: 0,
        decidedAtMs: null,
        score: null,
      });
      const next = this.opts.phrases[index + 1];
      if (next) {
        const nextHeight = this.opts.heights[index + 1];
        const lead = ((this.layout.zoneTop + nextHeight) / this.fallSpeed) * 1000;
        spawn = window.exitMs + GAP_BETWEEN_PHRASES_MS - lead;
      }
    });
  }

  get total(): number {
    return this.all.length;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  start(): void {
    this.clock.start();
  }

  pause(): void {
    this.clock.pause();
  }

  resume(): void {
    this.clock.resume();
  }

  /** The phrase currently in or about to enter the zone, for the zone band and the pause screen. */
  current(): ActivePhrase | null {
    return this.active.find((p) => p.state === 'inZone') ?? this.active.find((p) => p.state === 'falling') ?? null;
  }

  /** The phrase whose zone the band should show. */
  zoneOwner(): ActivePhrase | null {
    return this.active.find((p) => p.state === 'falling' || p.state === 'inZone') ?? this.all[this.nextIndex] ?? null;
  }

  topOf(p: ActivePhrase, nowMs = this.clock.now()): number {
    return phraseTopAt(p.spawnMs, p.height, this.fallSpeed, nowMs);
  }

  /** Latest words from the recognizer (all of them; attribution happens here). */
  setWords(words: TimedWord[]): void {
    this.words = words;
    for (const p of this.active) if (p.state === 'inZone' || p.state === 'grace') this.evaluate(p, this.clock.now());
  }

  private heardBetween(fromMs: number, toMs: number): string[] {
    const out: string[] = [];
    for (const w of this.words) {
      const t = this.clock.toGame(w.atMs);
      if (t === null) continue;
      if (t >= fromMs && t <= toMs) out.push(w.text);
    }
    return out;
  }

  private evaluate(p: ActivePhrase, nowMs: number): void {
    if (p.state !== 'inZone' && p.state !== 'grace') return;
    const { exitMs } = p.window;
    const enterMs = p.window.enterMs - EARLY_START_MS;
    const graceWords = this.heardBetween(enterMs, exitMs + LATE_GRACE_MS);
    const graceMatch = matchPhrase(p.phrase.text, graceWords.join(' '));
    p.heardText = graceWords.join(' ');
    p.wordsHeard = graceMatch.wordsHeard;
    p.ratioAfterGrace = graceMatch.ratio;
    if (p.state === 'inZone') {
      const zoneWords = this.heardBetween(enterMs, exitMs + RECOGNITION_LATENCY_MS);
      p.ratioInZone = matchPhrase(p.phrase.text, zoneWords.join(' ')).ratio;
      this.events.onWordsUpdate?.(p);
      if (p.ratioInZone >= 0.85) this.decide(p, nowMs);
    } else {
      this.events.onWordsUpdate?.(p);
      if (p.ratioAfterGrace >= 0.85) this.decide(p, nowMs);
    }
  }

  private decide(p: ActivePhrase, nowMs: number): void {
    if (p.state === 'done') return;
    const outcome = classify({
      ratioInZone: p.ratioInZone,
      ratioAfterGrace: p.ratioAfterGrace,
      spokeAnything: p.heardText.trim().length > 0,
    });
    p.outcome = outcome;
    p.state = 'done';
    p.decidedAtMs = nowMs;
    const update = this.score.apply(outcome);
    p.score = update;
    this.events.onOutcome?.(p, update);
  }

  /** Advance the simulation to the current game time. Call every frame. */
  tick(): void {
    if (this.finished) return;
    const now = this.clock.now();

    while (this.nextIndex < this.all.length && this.all[this.nextIndex].spawnMs <= now) {
      const p = this.all[this.nextIndex++];
      p.state = 'falling';
      this.active.push(p);
      this.events.onSpawn?.(p);
    }

    for (const p of this.active) {
      const { enterMs, exitMs, goneMs } = p.window;
      if (p.state === 'falling' && now >= enterMs) {
        p.state = 'inZone';
        this.events.onEnterZone?.(p);
        this.evaluate(p, now);
      }
      if (p.state === 'inZone' && now > exitMs + RECOGNITION_LATENCY_MS) {
        this.evaluate(p, now);
        if (p.state === 'inZone') p.state = 'grace';
      }
      if (p.state === 'grace') {
        this.evaluate(p, now);
        if (p.state === 'grace' && now > exitMs + LATE_GRACE_MS) this.decide(p, now);
      }
      if (now >= goneMs && !(p as { gone?: boolean }).gone) {
        (p as { gone?: boolean }).gone = true;
        this.events.onGone?.(p);
      }
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      if (p.state === 'done' && now >= p.window.goneMs) this.active.splice(i, 1);
    }

    if (this.nextIndex >= this.all.length && this.all.every((p) => p.state === 'done')) {
      const last = this.all[this.all.length - 1];
      if (!last || now >= Math.min(last.window.goneMs, (last.decidedAtMs ?? now) + 1200)) {
        this.finished = true;
        this.events.onFinished?.();
      }
    }
  }
}
