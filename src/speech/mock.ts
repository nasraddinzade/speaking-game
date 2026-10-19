/**
 * Mock recognizer for development and automated checks.
 *
 * Words are fed from outside (a dev panel, a test script, or the `speak()`
 * hook on window) and get timestamps like real recognition results would.
 */
import type { Recognizer, RecognizerEvents, RecognizerStatus, TimedWord } from './recognizer';

export interface MockRecognizer extends Recognizer {
  /** Feed words as if they were just recognized. */
  hear(text: string, final?: boolean): void;
}

export function createMockRecognizer(events: RecognizerEvents = {}): MockRecognizer {
  let status: RecognizerStatus = 'idle';
  let words: TimedWord[] = [];
  const setStatus = (s: RecognizerStatus) => {
    status = s;
    events.onStatus?.(s);
  };
  return {
    supported: true,
    get status() {
      return status;
    },
    start() {
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
    hear(text, final = true) {
      if (status !== 'listening') return;
      const now = performance.now();
      const parts = text.trim().split(/\s+/).filter(Boolean);
      words = words.concat(parts.map((t) => ({ text: t, atMs: now, final })));
      events.onWords?.(words.slice());
    },
  };
}
