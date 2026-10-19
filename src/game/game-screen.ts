/**
 * The run screen: falling phrases, the zone band, score, combo, mic indicator,
 * pause overlay with translation and reference audio.
 */
import type { Phrase, RunResultEntry, RunSummary, Settings } from '../engine/types';
import { fallSpeedForRun, type FieldLayout } from '../engine/zone';
import type { Recognizer } from '../speech/recognizer';
import type { MockRecognizer } from '../speech/mock';
import { speak, stopSpeaking } from '../speech/tts';
import { RECORD_LEAD_MS, RECORD_TAIL_MS, startRecording, type PhraseRecording } from '../speech/recorder';
import { confetti, sfx } from './fx';
import { Run, type ActivePhrase } from './run';

export interface GameScreenOptions {
  root: HTMLElement;
  phrases: Phrase[];
  settings: Settings;
  recognizer: Recognizer;
  mock?: MockRecognizer;
  onOutcome: (entry: RunResultEntry) => void;
  onFinished: (summary: RunSummary) => void;
  onQuit: () => void;
  /** Microphone stream for recording; polled when a recording should start. */
  getStream?: () => MediaStream | null;
  /** Audio of a clean hit, called after onOutcome for that phrase. */
  onRecording?: (phrase: Phrase, blob: Blob) => void;
}

const PREFERRED_FALL_SPEED = 110;
const OUTCOME_LABEL = { clean: 'CLEAN', late: 'LATE', miss: 'MISS', silence: 'SILENCE' } as const;

export interface GameHandle {
  dispose(): void;
  run: Run;
}

export function mountGameScreen(opts: GameScreenOptions): GameHandle {
  const { root, phrases, settings, recognizer } = opts;
  root.innerHTML = `
    <div class="game">
      <div class="hud">
        <div class="score"><small>SCORE</small><span id="score">0</span></div>
        <div class="combo" id="combo"><small>COMBO</small>x1</div>
        <div class="progress" id="progress">0 / ${phrases.length}</div>
        <div class="mic" id="mic"><span class="dot"></span><span id="mic-text">mic</span></div>
        <button class="ghost" id="pause-btn" title="Pause (Esc)">Pause</button>
      </div>
      <div class="field" id="field">
        <div class="zone" id="zone"><span class="zone-label">SAY IT HERE</span></div>
        <canvas class="confetti" id="confetti"></canvas>
      </div>
      <div class="overlay hidden" id="pause">
        <h2>PAUSED</h2>
        <div class="phrase-card" id="pause-phrase"></div>
        <div class="translation hidden-text" id="pause-translation">hover or press T for translation</div>
        <div class="row">
          <button class="primary" id="resume-btn">Resume</button>
          <button id="listen-btn">Listen (L)</button>
          <button class="ghost" id="quit-btn">Quit run</button>
        </div>
        <div class="hint">Esc or Space to resume</div>
      </div>
      <div class="overlay hidden" id="listening">
        <div class="listening-card"><small>LISTEN</small><span id="listening-text"></span></div>
      </div>
      ${opts.mock ? '<div class="dev-panel"><input id="dev-say" type="text" placeholder="type what you would say and press Enter" /><button id="dev-perfect">say current</button></div>' : ''}
    </div>
  `;

  const field = root.querySelector<HTMLElement>('#field')!;
  const zoneEl = root.querySelector<HTMLElement>('#zone')!;
  const scoreEl = root.querySelector<HTMLElement>('#score')!;
  const comboEl = root.querySelector<HTMLElement>('#combo')!;
  const progressEl = root.querySelector<HTMLElement>('#progress')!;
  const micEl = root.querySelector<HTMLElement>('#mic')!;
  const micText = root.querySelector<HTMLElement>('#mic-text')!;
  const micDot = micEl.querySelector<HTMLElement>('.dot')!;
  const pauseOverlay = root.querySelector<HTMLElement>('#pause')!;
  const pausePhrase = root.querySelector<HTMLElement>('#pause-phrase')!;
  const pauseTranslation = root.querySelector<HTMLElement>('#pause-translation')!;
  const listeningOverlay = root.querySelector<HTMLElement>('#listening')!;
  const listeningText = root.querySelector<HTMLElement>('#listening-text')!;
  const confettiCanvas = root.querySelector<HTMLCanvasElement>('#confetti')!;

  // Font size: smaller for long phrases so a 20-word phrase stays at three lines.
  const maxWords = Math.max(...phrases.map((p) => p.wordCount));
  const fieldWidth = field.clientWidth;
  const phraseSize = maxWords > 14 || fieldWidth < 900 ? 30 : 36;
  field.style.setProperty('--phrase-size', `${phraseSize}px`);

  const measure = (text: string): number => {
    const el = buildPhraseEl(text);
    el.classList.add('measure');
    field.appendChild(el);
    const h = el.getBoundingClientRect().height;
    el.remove();
    return Math.ceil(h);
  };
  const heights = phrases.map((p) => measure(p.text));
  const fieldHeight = field.clientHeight;
  const layout: FieldLayout = {
    fieldHeight,
    zoneTop: Math.max(120, Math.round(fieldHeight * 0.17)),
    bottomMargin: 28,
  };
  const fallSpeed = fallSpeedForRun(layout, maxWords, Math.max(...heights), PREFERRED_FALL_SPEED * (settings.speedScale || 1));

  const els = new Map<number, HTMLElement>();
  const entries: RunResultEntry[] = [];
  const startedAt = new Date().toISOString();
  let disposed = false;
  let rafId = 0;
  let pausedByUser = false;
  let autoPausing = false;
  let translationShown = false;
  /** Recorder per phrase index, started a little before the zone and stopped a little after. */
  const recordings = new Map<number, PhraseRecording>();
  const recordingDone = new Set<number>();

  function pauseRecorders(paused: boolean): void {
    for (const r of recordings.values()) {
      if (!r.active) continue;
      if (paused) r.pause();
      else r.resume();
    }
  }

  const run = new Run(
    { phrases, layout, fallSpeed, heights },
    {
      onSpawn(p) {
        const el = buildPhraseEl(p.phrase.text);
        el.style.top = `${run.topOf(p)}px`;
        field.appendChild(el);
        els.set(p.index, el);
        updateZone();
      },
      onEnterZone(p) {
        els.get(p.index)?.classList.add('active');
        updateZone();
        setMic(recognizer.status, true);
      },
      onWordsUpdate(p) {
        const el = els.get(p.index);
        if (!el) return;
        const spans = el.querySelectorAll<HTMLElement>('.w');
        let newlyHeard = 0;
        p.wordsHeard.forEach((heard, i) => {
          const s = spans[i];
          if (!s) return;
          if (heard && !s.classList.contains('heard')) newlyHeard++;
          s.classList.toggle('heard', heard);
        });
        if (newlyHeard > 0) sfx.word();
      },
      onOutcome(p, update) {
        const el = els.get(p.index);
        el?.classList.remove('active');
        el?.classList.add(update.outcome);
        setMic(recognizer.status, false);
        scoreEl.textContent = String(update.score);
        progressEl.textContent = `${p.index + 1} / ${phrases.length}`;
        const mult = update.outcome === 'clean' ? update.multiplier : 1;
        comboEl.innerHTML = `<small>COMBO</small>x${mult}${update.cleanStreak > 0 ? ` <span style="font-size:13px;color:var(--muted)">${update.cleanStreak} in a row</span>` : ''}`;
        comboEl.classList.add('pop');
        setTimeout(() => comboEl.classList.remove('pop'), 200);
        showPopup(update.outcome, update.points, run.topOf(p) + p.height / 2);
        sfx[update.outcome]();
        if (update.comboUp) {
          sfx.combo();
          showBanner(`COMBO x${update.multiplier}`);
          confetti(confettiCanvas, 90, 0.4);
        }
        const entry: RunResultEntry = {
          phrase: p.phrase,
          outcome: update.outcome,
          matchRatio: Math.max(p.ratioInZone, p.ratioAfterGrace),
          points: update.points,
          multiplier: update.multiplier,
          heard: p.heardText,
        };
        entries.push(entry);
        opts.onOutcome(entry);
        const rec = recordings.get(p.index);
        if (rec && opts.onRecording && update.outcome === 'clean') {
          void rec.blob.then((blob) => {
            if (blob) opts.onRecording?.(p.phrase, blob);
          });
        }
        updateZone();
        if (update.outcome === 'miss' || update.outcome === 'silence') void playReferenceAfterMiss(p);
      },
      onGone(p) {
        const el = els.get(p.index);
        el?.remove();
        els.delete(p.index);
      },
      onFinished() {
        finish();
      },
    },
  );

  function buildPhraseEl(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'phrase';
    text.split(/\s+/).forEach((w) => {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = w;
      el.appendChild(s);
    });
    return el;
  }

  function updateZone(): void {
    const owner = run.zoneOwner();
    if (!owner) return;
    zoneEl.style.top = `${owner.window.zoneTop}px`;
    zoneEl.style.height = `${owner.window.zoneBottom - owner.window.zoneTop}px`;
    zoneEl.classList.toggle('active', owner.state === 'inZone');
  }

  function setMic(status: Recognizer['status'], rec: boolean): void {
    micEl.className = `mic ${status}${rec && status === 'listening' ? ' rec' : ''}${opts.mock ? ' mock' : ''}`;
    const label: Record<string, string> = {
      idle: 'mic off',
      starting: 'mic starting',
      listening: rec ? 'REC' : 'listening',
      restarting: 'reconnecting',
      error: 'mic error',
      unsupported: 'no speech API',
    };
    micText.textContent = opts.mock ? `mock ${label[status] ?? status}` : (label[status] ?? status);
  }

  function showPopup(outcome: keyof typeof OUTCOME_LABEL, points: number, y: number): void {
    const el = document.createElement('div');
    el.className = `popup ${outcome}`;
    const sign = points > 0 ? '+' : '';
    el.innerHTML = `${points !== 0 ? `${sign}${points}` : OUTCOME_LABEL[outcome]}<small>${points !== 0 ? OUTCOME_LABEL[outcome] : '&nbsp;'}</small>`;
    el.style.top = `${Math.max(40, Math.min(field.clientHeight - 120, y - 40))}px`;
    field.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  function showBanner(text: string): void {
    const el = document.createElement('div');
    el.className = 'banner';
    el.textContent = text;
    field.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  async function playReferenceAfterMiss(p: ActivePhrase): Promise<void> {
    if (disposed) return;
    autoPausing = true;
    run.pause();
    pauseRecorders(true);
    listeningText.textContent = p.phrase.text;
    listeningOverlay.classList.remove('hidden');
    await speak(p.phrase.text, { voiceName: settings.voiceName });
    await new Promise((r) => setTimeout(r, 350));
    listeningOverlay.classList.add('hidden');
    autoPausing = false;
    if (!disposed && !pausedByUser) {
      run.resume();
      pauseRecorders(false);
    }
  }

  let lastMicStatus = '';
  function frame(): void {
    if (disposed) return;
    try {
      step();
    } catch (e) {
      console.error('game loop error', e);
    }
    rafId = requestAnimationFrame(frame);
  }

  /** One simulation step. Runs from requestAnimationFrame and, as a fallback, from a timer:
   *  Chromium stops animation frames for a hidden or covered window, and the run must still
   *  stop its recorders and finish cleanly. */
  function step(): void {
    run.tick();
    const nowMs = run.clock.now();
    for (const p of run.active) {
      const w = p.window;
      if (!recordings.has(p.index) && !recordingDone.has(p.index) && nowMs >= w.enterMs - RECORD_LEAD_MS && nowMs < w.exitMs) {
        const stream = opts.getStream?.();
        if (stream) {
          const r = startRecording(stream);
          if (r) recordings.set(p.index, r);
          else recordingDone.add(p.index);
        }
      }
      const r = recordings.get(p.index);
      if (r && r.active && !recordingDone.has(p.index) && nowMs >= w.exitMs + RECORD_TAIL_MS) {
        r.stop();
        recordingDone.add(p.index);
      }
    }
    const inZone = run.active.some((p) => p.state === 'inZone');
    const micKey = `${recognizer.status}:${inZone}`;
    if (micKey !== lastMicStatus) {
      lastMicStatus = micKey;
      setMic(recognizer.status, inZone);
    }
    const lvl = recognizer.level();
    micDot.style.transform = `scale(${1 + lvl * 1.6})`;
    micDot.style.opacity = String(0.7 + lvl * 0.3);
    const now = run.clock.now();
    for (const p of run.active) {
      const el = els.get(p.index);
      if (el) el.style.top = `${run.topOf(p, now)}px`;
    }
  }

  /** The player cannot see the phrases while the window is hidden or covered: pause there, resume when it is back. */
  let pausedByVisibility = false;
  const onVisibility = () => {
    if (run.isFinished || autoPausing) return;
    if (document.hidden && !pausedByUser) {
      togglePause();
      pausedByVisibility = true;
    } else if (!document.hidden && pausedByVisibility) {
      pausedByVisibility = false;
      if (pausedByUser) togglePause();
    }
  };

  function togglePause(): void {
    if (disposed || run.isFinished || autoPausing) return;
    if (pausedByUser) {
      pausedByUser = false;
      stopSpeaking();
      pauseOverlay.classList.add('hidden');
      run.resume();
      pauseRecorders(false);
    } else {
      pausedByUser = true;
      run.pause();
      pauseRecorders(true);
      const cur = run.current() ?? run.all[Math.min(run.all.length - 1, Math.max(0, entries.length))];
      pausePhrase.textContent = cur?.phrase.text ?? '';
      pausePhrase.dataset.translation = cur?.phrase.translation ?? '';
      translationShown = false;
      renderTranslation();
      pauseOverlay.classList.remove('hidden');
    }
  }

  function renderTranslation(): void {
    const tr = pausePhrase.dataset.translation ?? '';
    if (translationShown && tr) {
      pauseTranslation.textContent = tr;
      pauseTranslation.classList.remove('hidden-text');
    } else {
      pauseTranslation.textContent = 'hover or press T for translation';
      pauseTranslation.classList.add('hidden-text');
    }
  }

  function listenCurrent(): void {
    const text = pausePhrase.textContent;
    if (text) void speak(text, { voiceName: settings.voiceName });
  }

  function finish(): void {
    if (disposed) return;
    const summary: RunSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      score: run.score.score,
      bestCombo: run.score.bestCombo,
      counts: { ...run.score.counts },
      entries,
      startLevel: settings.startLevel,
    };
    sfx.fanfare();
    confetti(confettiCanvas, 220, 0.3);
    setTimeout(() => {
      if (!disposed) opts.onFinished(summary);
    }, 1400);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape' || e.key === ' ') {
      e.preventDefault();
      togglePause();
    } else if (pausedByUser && (e.key === 't' || e.key === 'T')) {
      translationShown = !translationShown;
      renderTranslation();
    } else if (pausedByUser && (e.key === 'l' || e.key === 'L')) {
      listenCurrent();
    }
  };

  root.querySelector('#pause-btn')!.addEventListener('click', togglePause);
  root.querySelector('#resume-btn')!.addEventListener('click', togglePause);
  root.querySelector('#listen-btn')!.addEventListener('click', listenCurrent);
  root.querySelector('#quit-btn')!.addEventListener('click', () => {
    handle.dispose();
    opts.onQuit();
  });
  pausePhrase.addEventListener('mouseenter', () => {
    translationShown = true;
    renderTranslation();
  });
  pausePhrase.addEventListener('mouseleave', () => {
    translationShown = false;
    renderTranslation();
  });
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  const fallbackTimer = window.setInterval(() => {
    if (disposed) return;
    try {
      step();
    } catch (e) {
      console.error('game loop error', e);
    }
  }, 250);

  if (opts.mock) {
    const input = root.querySelector<HTMLInputElement>('#dev-say')!;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        opts.mock!.hear(input.value);
        input.value = '';
      }
    });
    root.querySelector('#dev-perfect')!.addEventListener('click', () => {
      const cur = run.current();
      if (cur) opts.mock!.hear(cur.phrase.text);
    });
  }

  setMic(recognizer.status, false);
  updateZone();
  run.start();
  rafId = requestAnimationFrame(frame);

  const handle: GameHandle = {
    run,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      clearInterval(fallbackTimer);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      stopSpeaking();
      for (const r of recordings.values()) r.stop();
    },
  };
  return handle;
}
