/**
 * One shared audio player for recordings and the reference voice.
 * Only one thing plays at a time; the button that started it is marked
 * `.playing` until the sound ends.
 */
import { speak, stopSpeaking } from '../speech/tts';

export interface Playback {
  done: Promise<void>;
  stop(): void;
}

let current: { stop: () => void } | null = null;

export function stopPlayback(): void {
  current?.stop();
  current = null;
}

export function playUrl(url: string): Playback {
  const audio = new Audio(url);
  let finish: () => void = () => {};
  let fail: (e: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  audio.onended = () => finish();
  audio.onerror = () => fail(new Error('recording file not found'));
  audio.play().catch((e: unknown) => fail(e instanceof Error ? e : new Error(String(e))));
  return {
    done,
    stop() {
      audio.pause();
      audio.src = '';
      finish();
    },
  };
}

export function playTts(text: string, voiceName: string | null): Playback {
  const done = speak(text, { voiceName });
  return {
    done,
    stop() {
      stopSpeaking();
    },
  };
}

/** Wire a button: click starts (or stops) playback and toggles `.playing` while it runs. */
export function attachPlayButton(btn: HTMLElement, make: () => Playback, onError?: (message: string) => void): void {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('playing')) {
      stopPlayback();
      return;
    }
    stopPlayback();
    const pb = make();
    const mine = { stop: () => pb.stop() };
    current = mine;
    btn.classList.add('playing');
    pb.done
      .catch((e: unknown) => onError?.(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        btn.classList.remove('playing');
        if (current === mine) current = null;
      });
  });
}
