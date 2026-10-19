/**
 * Progress lives in one local JSON file (data/progress.json next to the app),
 * recordings as .webm files in data/recordings/.
 *
 * The page talks to the launcher's tiny HTTP API; a copy of the JSON is
 * mirrored into localStorage so a run never loses progress if the launcher
 * goes away. Moving progress to another machine means copying that file (or
 * using Export / Import on the home screen) plus the recordings folder; the
 * app works without the folder, just without comparisons.
 */
import { emptySave, normalizeSave } from '../engine/progress';
import type { SaveFile } from '../engine/types';

const LS_KEY = 'speaking-game.progress.v1';
const API = './api/progress';
const REC_API = './api/recordings';

export type StorageBackend = 'file' | 'localStorage';

export interface RecordingFileInfo {
  name: string;
  size: number;
  /** ISO timestamp of the last change. */
  mtime: string;
}

export interface RecordingsApi {
  /** Store a recording. With overwrite=false an existing file is kept and `exists` is returned. */
  put(name: string, blob: Blob, overwrite: boolean): Promise<{ status: 'created' | 'replaced' | 'exists'; date?: string }>;
  /** URL to play the file from. */
  url(name: string): string;
  list(): Promise<{ files: RecordingFileInfo[]; totalBytes: number; dir: string }>;
  remove(name: string): Promise<void>;
}

export interface Storage {
  backend: StorageBackend;
  load(): Promise<SaveFile>;
  save(data: SaveFile): Promise<void>;
  /** Where the file lives, for the UI. */
  location(): Promise<string | null>;
  /** Recording files; null when there is no launcher to keep files. */
  recordings: RecordingsApi | null;
}

async function apiAvailable(): Promise<boolean> {
  try {
    const r = await fetch(API, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

function readLocal(): SaveFile | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? normalizeSave(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(data: SaveFile): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    /* quota or private mode: ignore */
  }
}

function recordingsApi(): RecordingsApi {
  return {
    async put(name, blob, overwrite) {
      const r = await fetch(`${REC_API}/${encodeURIComponent(name)}${overwrite ? '?overwrite=1' : ''}`, {
        method: 'PUT',
        headers: { 'content-type': blob.type || 'audio/webm' },
        body: blob,
      });
      if (r.status === 201) return { status: 'created' };
      if (r.status === 204) return { status: 'replaced' };
      if (r.status === 409) {
        const info = (await r.json().catch(() => ({}))) as { mtime?: string };
        return { status: 'exists', date: info.mtime?.slice(0, 10) };
      }
      throw new Error(`HTTP ${r.status}`);
    },
    url(name) {
      return `${REC_API}/${encodeURIComponent(name)}`;
    },
    async list() {
      const r = await fetch(REC_API, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { files: RecordingFileInfo[]; totalBytes: number; dir: string };
    },
    async remove(name) {
      const r = await fetch(`${REC_API}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
    },
  };
}

export async function createStorage(): Promise<Storage> {
  const hasApi = await apiAvailable();
  if (hasApi) {
    return {
      backend: 'file',
      recordings: recordingsApi(),
      async load() {
        try {
          const r = await fetch(API, { cache: 'no-store' });
          if (r.status === 404) {
            const local = readLocal();
            return local ?? emptySave();
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = normalizeSave(await r.json());
          writeLocal(data);
          return data;
        } catch (e) {
          console.warn('progress: file load failed, using local copy', e);
          return readLocal() ?? emptySave();
        }
      },
      async save(data) {
        writeLocal(data);
        const r = await fetch(API, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data, null, 2),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      },
      async location() {
        try {
          const r = await fetch('./api/info');
          const info = (await r.json()) as { progressPath?: string };
          return info.progressPath ?? null;
        } catch {
          return null;
        }
      },
    };
  }
  return {
    backend: 'localStorage',
    recordings: null,
    async load() {
      return readLocal() ?? emptySave();
    },
    async save(data) {
      writeLocal(data);
    },
    async location() {
      return null;
    },
  };
}

export function exportSave(data: SaveFile): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `speaking-game-progress-${data.updatedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importSaveFromFile(file: File): Promise<SaveFile> {
  return file.text().then((t) => normalizeSave(JSON.parse(t)));
}
