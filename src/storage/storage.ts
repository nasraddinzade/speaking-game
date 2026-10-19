/**
 * Progress lives in one local JSON file (data/progress.json next to the app).
 *
 * The page talks to the launcher's tiny HTTP API; a copy is mirrored into
 * localStorage so a run never loses progress if the launcher goes away.
 * Moving progress to another machine means copying that file (or using
 * Export / Import on the home screen, which read and write the same JSON).
 */
import { emptySave, normalizeSave } from '../engine/progress';
import type { SaveFile } from '../engine/types';

const LS_KEY = 'speaking-game.progress.v1';
const API = './api/progress';

export type StorageBackend = 'file' | 'localStorage';

export interface Storage {
  backend: StorageBackend;
  load(): Promise<SaveFile>;
  save(data: SaveFile): Promise<void>;
  /** Where the file lives, for the UI. */
  location(): Promise<string | null>;
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

export async function createStorage(): Promise<Storage> {
  const hasApi = await apiAvailable();
  if (hasApi) {
    return {
      backend: 'file',
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
