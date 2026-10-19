/**
 * Mock recognizer for development and automated checks.
 *
 * Words are fed from outside (a dev panel, a test script, or the `hear()`
 * hook on window) and get timestamps like real recognition results would.
 * The "microphone" for recording is a quiet synthetic tone so MediaRecorder
 * has something to record.
 */
import type { Recognizer, RecognizerEvents, RecognizerStatus, TimedWord } from './recognizer';

export interface MockRecognizer extends Recognizer {
  /** Feed words as if they were just recognized. */
  hear(text: string, final?: boolean): void;
}

export function createMockRecognizer(events: RecognizerEvents = {}): MockRecognizer {
  let status: RecognizerStatus = 'idle';
  let words: TimedWord[] = [];
  let synthetic: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  const setStatus = (s: RecognizerStatus) => {
    status = s;
    events.onStatus?.(s);
  };
  const ensureStream = () => {
    if (synthetic) return synthetic;
    try {
      ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.05;
      osc.frequency.value = 220;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      synthetic = dest.stream;
    } catch {
      synthetic = null;
    }
    return synthetic;
  };
  return {
    supported: true,
    get status() {
      return status;
    },
    start() {
      ensureStream();
      if (ctx?.state === 'suspended') void ctx.resume();
      setStatus('listening');
    },
    stop() {
      setStatus('idle');
    },
    words() {
      return words.slice();
    },
    reset() {
      words = [];
    },
    level() {
      return 0;
    },
    stream() {
      return synthetic;
    },
    hear(text, final = true) {
      if (status !== 'listening') return;
      const now = performance.now();
      const parts = text.trim().split(/\s+/).filter(Boolean);
      words = words.concat(parts.map((t) => ({ text: t, atMs: now, final })));
      events.onWords?.(words.slice());
    },
  };
}
