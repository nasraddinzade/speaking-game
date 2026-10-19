/**
 * Continuous speech recognition on top of the Web Speech API.
 *
 * Started once per run and kept alive for the whole run. Chromium ends a
 * continuous session on its own after a while (silence, time limit), so an
 * unexpected `end` restarts it; we never restart it per phrase.
 *
 * The microphone is opened once with getUserMedia and its track is handed to
 * `recognition.start(track)` (Chromium 132+). That keeps one explicit audio
 * source for the whole run, gives us a level meter, and makes the recognizer
 * follow the same device the page was granted. Older engines ignore the
 * argument and use the default microphone.
 *
 * Every recognized word gets a timestamp (performance.now()) when it first
 * appeared in the transcript. Interim results get revised by the engine; a
 * revision keeps the original timestamps for positions that already existed.
 */

export interface TimedWord {
  text: string;
  /** performance.now() when this word first showed up. */
  atMs: number;
  final: boolean;
}

export interface RecognizerEvents {
  onWords?: (words: TimedWord[]) => void;
  onStatus?: (status: RecognizerStatus) => void;
  onError?: (error: string) => void;
}

export type RecognizerStatus = 'idle' | 'starting' | 'listening' | 'restarting' | 'error' | 'unsupported';

export interface Recognizer {
  readonly supported: boolean;
  readonly status: RecognizerStatus;
  start(): void;
  stop(): void;
  /** All words heard since start(), with timestamps. */
  words(): TimedWord[];
  /** Forget everything heard so far (timestamps of earlier words become irrelevant). */
  reset(): void;
  /** Microphone input level 0..1 (0 when unknown). */
  level(): number;
  /** The microphone stream opened for this run, for recording. Null until the mic is open. */
  stream(): MediaStream | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }>;
}

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const RESTART_DELAY_MS = 120;
const MAX_RESTARTS_PER_MINUTE = 20;

export function createWebSpeechRecognizer(events: RecognizerEvents = {}): Recognizer {
  const Ctor = getSpeechRecognitionCtor();
  let status: RecognizerStatus = Ctor ? 'idle' : 'unsupported';
  let wanted = false;
  let rec: SpeechRecognitionLike | null = null;
  let restartTimer: number | null = null;
  let restartStamps: number[] = [];
  let fatal = false;
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let audioCtx: AudioContext | null = null;
  let levelBuf: Float32Array<ArrayBuffer> | null = null;

  /** Words from results that are final, in order. */
  let finalWords: TimedWord[] = [];
  /** Words from the current interim segment. */
  let interimWords: TimedWord[] = [];
  /** How many leading results of the current session are already final. */
  let finalizedCount = 0;

  const setStatus = (s: RecognizerStatus) => {
    status = s;
    events.onStatus?.(s);
  };

  const splitWords = (s: string) => s.trim().split(/\s+/).filter((w) => w.length > 0);

  const mergeTimed = (prev: TimedWord[], next: string[], now: number, final: boolean): TimedWord[] =>
    next.map((text, i) => {
      const old = prev[i];
      // A revised word keeps the earlier timestamp: it was spoken then, only its spelling changed.
      return { text, atMs: old ? old.atMs : now, final };
    });

  const handleResult = (ev: SpeechRecognitionEventLike) => {
    const now = performance.now();
    let newFinal: string[] = [];
    let interim: string[] = [];
    let finalizedNow = finalizedCount;
    for (let i = 0; i < ev.results.length; i++) {
      const r = ev.results[i];
      const text = r[0]?.transcript ?? '';
      if (r.isFinal) {
        if (i >= finalizedCount) {
          newFinal = newFinal.concat(splitWords(text));
          finalizedNow = i + 1;
        }
      } else {
        interim = interim.concat(splitWords(text));
      }
    }
    if (newFinal.length > 0) {
      // The interim segment just became final: inherit its timestamps.
      const merged = mergeTimed(interimWords, newFinal, now, true);
      finalWords = finalWords.concat(merged);
      interimWords = interimWords.slice(newFinal.length);
      finalizedCount = finalizedNow;
    }
    interimWords = mergeTimed(interimWords, interim, now, false);
    events.onWords?.(finalWords.concat(interimWords));
  };

  const build = () => {
    if (!Ctor) return null;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.maxAlternatives = 1;
    r.onstart = () => setStatus('listening');
    r.onresult = handleResult;
    r.onerror = (e) => {
      const err = e.error || 'unknown';
      if (err === 'no-speech' || err === 'aborted') return; // Chromium raises these during normal pauses.
      events.onError?.(err);
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture' || err === 'network') {
        fatal = true;
        setStatus('error');
      }
    };
    r.onend = () => {
      // A new session starts a fresh results array.
      interimWords = [];
      finalizedCount = 0;
      if (!wanted || fatal) {
        if (!fatal) setStatus('idle');
        return;
      }
      const t = performance.now();
      restartStamps = restartStamps.filter((s) => t - s < 60_000);
      if (restartStamps.length >= MAX_RESTARTS_PER_MINUTE) {
        events.onError?.('restart-loop');
        setStatus('error');
        return;
      }
      restartStamps.push(t);
      setStatus('restarting');
      restartTimer = window.setTimeout(() => {
        restartTimer = null;
        if (wanted) safeStart();
      }, RESTART_DELAY_MS);
    };
    return r;
  };

  const liveTrack = (): MediaStreamTrack | undefined => {
    const t = stream?.getAudioTracks()[0];
    return t && t.readyState === 'live' ? t : undefined;
  };

  const safeStart = () => {
    if (!wanted) return;
    if (!rec) rec = build();
    if (!rec) return;
    try {
      const track = liveTrack();
      if (track) rec.start(track);
      else rec.start();
      setStatus('starting');
    } catch (e) {
      // "already started" is harmless; anything else is reported.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already started/i.test(msg)) events.onError?.(msg);
    }
  };

  const openMic = async (): Promise<void> => {
    if (liveTrack()) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      try {
        audioCtx = audioCtx ?? new AudioContext();
        if (audioCtx.state === 'suspended') void audioCtx.resume();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        levelBuf = new Float32Array(analyser.fftSize);
        audioCtx.createMediaStreamSource(stream).connect(analyser);
      } catch {
        analyser = null;
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : String(e);
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        events.onError?.('not-allowed');
        fatal = true;
        setStatus('error');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        events.onError?.('audio-capture');
      }
      // Any other failure: let the engine open the default microphone itself.
    }
  };

  const closeMic = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    analyser = null;
  };

  return {
    get supported() {
      return Ctor !== null;
    },
    get status() {
      return status;
    },
    start() {
      if (!Ctor) {
        setStatus('unsupported');
        return;
      }
      wanted = true;
      fatal = false;
      restartStamps = [];
      setStatus('starting');
      void openMic().then(() => {
        if (wanted && !fatal) safeStart();
      });
    },
    stop() {
      wanted = false;
      if (restartTimer !== null) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      rec = null;
      interimWords = [];
      finalizedCount = 0;
      closeMic();
      setStatus('idle');
    },
    words() {
      return finalWords.concat(interimWords);
    },
    reset() {
      finalWords = [];
      interimWords = [];
    },
    level() {
      if (!analyser || !levelBuf) return 0;
      analyser.getFloatTimeDomainData(levelBuf);
      let sum = 0;
      for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
      return Math.min(1, Math.sqrt(sum / levelBuf.length) * 4);
    },
    stream() {
      return liveTrack() ? stream : null;
    },
  };
}
