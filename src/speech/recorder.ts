/**
 * Per-phrase audio recording on the microphone stream that recognition uses.
 *
 * One MediaRecorder per phrase: started a little before the phrase enters the
 * zone, stopped a little after it leaves. Chunks are collected into one blob.
 * The recorder pauses with the game so a paused run does not record the
 * reference audio or a coffee break.
 */

export const RECORD_LEAD_MS = 200;
export const RECORD_TAIL_MS = 300;
export const RECORD_BITRATE = 32_000;

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm'];

export function recordingMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}

export function recordingSupported(): boolean {
  return recordingMimeType() !== null;
}

export interface PhraseRecording {
  /** Resolves with the recorded blob, or null if nothing usable was recorded. */
  readonly blob: Promise<Blob | null>;
  stop(): void;
  pause(): void;
  resume(): void;
  readonly active: boolean;
}

export function startRecording(stream: MediaStream): PhraseRecording | null {
  const mime = recordingMimeType();
  if (!mime) return null;
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: RECORD_BITRATE });
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  let active = true;
  let resolveBlob: (b: Blob | null) => void = () => {};
  const blob = new Promise<Blob | null>((resolve) => {
    resolveBlob = resolve;
  });
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  rec.onstop = () => {
    active = false;
    resolveBlob(chunks.length > 0 ? new Blob(chunks, { type: mime.split(';')[0] }) : null);
  };
  rec.onerror = () => {
    active = false;
    resolveBlob(null);
  };
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    blob,
    get active() {
      return active;
    },
    stop() {
      if (rec.state !== 'inactive') rec.stop();
    },
    pause() {
      if (rec.state === 'recording') rec.pause();
    },
    resume() {
      if (rec.state === 'paused') rec.resume();
    },
  };
}
