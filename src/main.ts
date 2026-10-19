import './styles.css';
import phrasesJson from './data/phrases.json';
import { applyOutcome, dayKey, emptySave, hasComparison, selectRunPhrases } from './engine/progress';
import type { Phrase, RunResultEntry, RunSummary, SaveFile, Settings } from './engine/types';
import { setSoundEnabled, unlockAudio } from './game/fx';
import { mountGameScreen, type GameHandle } from './game/game-screen';
import { mountCompare } from './screens/compare';
import { mountHome } from './screens/home';
import { mountRecordingsScreen } from './screens/recordings';
import { mountResults } from './screens/results';
import { createMockRecognizer, type MockRecognizer } from './speech/mock';
import { createWebSpeechRecognizer, getSpeechRecognitionCtor, type Recognizer, type TimedWord } from './speech/recognizer';
import { recordingSupported } from './speech/recorder';
import { STORAGE_WARNING_BYTES, cleanupCandidates, recordingList, storeCleanRecording } from './storage/recordings';
import { createStorage, exportSave, importSaveFromFile, type Storage } from './storage/storage';

const PHRASES = phrasesJson as Phrase[];
const root = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const MOCK = params.get('mock') === '1';
/** ?phrases=p_0059,p_0001 fixes the run to these phrases (practice or automated checks); ?autostart=1 starts at once. */
const FIXED_PHRASES = (params.get('phrases') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const AUTOSTART = params.get('autostart') === '1';

let storage: Storage;
let save: SaveFile = emptySave();
let recognizer: Recognizer;
let mock: MockRecognizer | undefined;
let game: GameHandle | null = null;
let lastRunPhrases: Phrase[] = [];
let micError: string | null = null;
let recordingsFolder: string | null = null;
let storageWarning: { totalMB: number } | null = null;

async function persist(): Promise<void> {
  save.updatedAt = new Date().toISOString();
  try {
    await storage.save(save);
  } catch (e) {
    toast(`Could not save progress: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function toast(text: string, ms = 4000): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function micStatus(): { ok: boolean; text: string } {
  if (MOCK) return { ok: true, text: 'Mock recognizer: type what you would say in the dev panel.' };
  if (!getSpeechRecognitionCtor()) {
    return { ok: false, text: 'This browser has no SpeechRecognition. Run the game through the launcher (Chrome).' };
  }
  if (micError) return { ok: false, text: `Microphone problem last time: ${micError}. Allow the microphone and try again.` };
  if (navigator.userAgent.includes('Edg/')) {
    return { ok: false, text: 'Edge: speech recognition failed in testing (network). Run the game in Google Chrome.' };
  }
  const rec = recordingSupported() ? '' : ' Recording is not supported here, so takes will not be saved.';
  return { ok: true, text: `Speech recognition available. Allow the microphone when the browser asks.${rec}` };
}

async function checkStorage(): Promise<void> {
  storageWarning = null;
  if (!storage.recordings) return;
  try {
    const info = await storage.recordings.list();
    recordingsFolder = info.dir;
    if (info.totalBytes > STORAGE_WARNING_BYTES) storageWarning = { totalMB: Math.round(info.totalBytes / 1024 / 1024) };
  } catch {
    /* no folder, no launcher: nothing to warn about */
  }
}

async function cleanupOldRecordings(): Promise<void> {
  const api = storage.recordings;
  if (!api) return;
  const candidates = cleanupCandidates(save, dayKey());
  let removed = 0;
  for (const c of candidates) {
    for (const f of c.files) {
      try {
        await api.remove(f);
        removed++;
      } catch (e) {
        toast(`Could not delete ${f}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const rec = save.phrases[c.phraseId];
    if (rec) delete rec.recordings;
  }
  await persist();
  toast(`Deleted ${removed} recording file${removed === 1 ? '' : 's'}.`);
  await checkStorage();
  void showHome();
}

async function showHome(): Promise<void> {
  game?.dispose();
  game = null;
  recognizer.stop();
  const location_ = await storage.location();
  const recorded = recordingList(PHRASES, save).length;
  const candidates = cleanupCandidates(save, dayKey()).reduce((n, c) => n + c.files.length, 0);
  mountHome({
    root,
    save,
    phraseCount: PHRASES.length,
    micStatus: micStatus(),
    storageNote:
      storage.backend === 'file'
        ? `Progress file: ${location_ ?? 'data/progress.json'}`
        : 'Progress is stored in this browser profile (no launcher API found). Use Export to keep a file.',
    recordingPairs: recorded,
    storageWarning: storageWarning ? { totalMB: storageWarning.totalMB, candidateFiles: candidates, onCleanup: () => void cleanupOldRecordings() } : null,
    onRecordings: () => showRecordings(),
    onPlay(settings) {
      save.settings = settings;
      void persist();
      startRun(settings);
    },
    onSettingsChange(settings) {
      save.settings = settings;
      setSoundEnabled(settings.soundOn);
      void persist();
    },
    onExport() {
      exportSave(save);
    },
    async onImport(file) {
      try {
        const imported = await importSaveFromFile(file);
        const learnedHere = Object.values(save.phrases).filter((r) => r.learned).length;
        const learnedThere = Object.values(imported.phrases).filter((r) => r.learned).length;
        if (
          !confirm(
            `Replace progress on this machine?\nThis device: ${learnedHere} learned.\nFile: ${learnedThere} learned (${imported.updatedAt.slice(0, 10)}).\nRecordings are separate files: copy the recordings folder yourself.`,
          )
        )
          return;
        save = imported;
        await persist();
        void showHome();
      } catch (e) {
        toast(`Import failed: ${e instanceof Error ? e.message : 'not a progress file'}`);
      }
    },
    async onReset() {
      const settings = save.settings;
      save = emptySave();
      save.settings = settings;
      await persist();
      void showHome();
    },
  });
}

function showRecordings(): void {
  mountRecordingsScreen({
    root,
    entries: recordingList(PHRASES, save),
    api: storage.recordings,
    voiceName: save.settings.voiceName,
    today: dayKey(),
    folder: recordingsFolder,
    onError: (m) => toast(m),
    onBack: () => void showHome(),
  });
}

function startRun(settings: Settings): void {
  unlockAudio();
  setSoundEnabled(settings.soundOn);
  const fixed = FIXED_PHRASES.map((id) => PHRASES.find((p) => p.id === id)).filter((p): p is Phrase => Boolean(p));
  const phrases =
    fixed.length > 0
      ? fixed
      : selectRunPhrases(PHRASES, save.phrases, { startLevel: settings.startLevel, count: settings.runLength, day: dayKey() });
  lastRunPhrases = phrases;
  micError = null;
  recognizer.reset();
  recognizer.start();
  const uploads: Promise<void>[] = [];
  const newlyLearned: Phrase[] = [];
  game = mountGameScreen({
    root,
    phrases,
    settings,
    recognizer,
    mock,
    getStream: () => recognizer.stream(),
    onOutcome(entry: RunResultEntry) {
      const day = dayKey();
      const before = save.phrases[entry.phrase.id];
      const after = applyOutcome(before, entry.phrase.id, entry.outcome, day);
      save.phrases[entry.phrase.id] = after;
      save.profile.totals[entry.outcome]++;
      if (after.learned && !before?.learned && !newlyLearned.some((p) => p.id === entry.phrase.id)) newlyLearned.push(entry.phrase);
      void persist();
    },
    onRecording(phrase, blob) {
      const api = storage.recordings;
      if (!api) return;
      const record = save.phrases[phrase.id];
      if (!record) return;
      const job = storeCleanRecording(api, record, blob, dayKey())
        .then((recordings) => {
          const current = save.phrases[phrase.id];
          if (current) {
            if (recordings) current.recordings = recordings;
            else delete current.recordings;
          }
          return persist();
        })
        .catch((e: unknown) => {
          toast(`Could not save the recording: ${e instanceof Error ? e.message : String(e)}`);
        });
      uploads.push(job);
    },
    async onFinished(summary: RunSummary) {
      recognizer.stop();
      const newBestScore = summary.score > save.profile.bestScore;
      const newBestCombo = summary.bestCombo > save.profile.bestCombo;
      save.profile.bestScore = Math.max(save.profile.bestScore, summary.score);
      save.profile.bestCombo = Math.max(save.profile.bestCombo, summary.bestCombo);
      save.profile.runsPlayed++;
      void persist();
      game?.dispose();
      game = null;
      // The last recording may still be uploading; wait a moment for it, then celebrate.
      await Promise.race([Promise.allSettled(uploads), new Promise((r) => setTimeout(r, 6000))]);
      const queue = newlyLearned.filter((p) => storage.recordings && hasComparison(save.phrases[p.id]));
      const showResults = () =>
        mountResults({
          root,
          summary,
          newBestScore,
          newBestCombo,
          voiceName: settings.voiceName,
          records: save.phrases,
          recordings: storage.recordings,
          today: dayKey(),
          onError: (m) => toast(m),
          onPlayAgain: () => startRun(save.settings),
          onHome: () => void showHome(),
        });
      const next = (i: number) => {
        if (i >= queue.length || !storage.recordings) {
          showResults();
          return;
        }
        mountCompare({
          root,
          phrase: queue[i],
          record: save.phrases[queue[i].id],
          api: storage.recordings,
          voiceName: settings.voiceName,
          today: dayKey(),
          position: queue.length > 1 ? `${i + 1} of ${queue.length}` : undefined,
          onError: (m) => toast(m),
          onContinue: () => next(i + 1),
        });
      };
      next(0);
    },
    onQuit() {
      void showHome();
    },
  });
}

function buildRecognizer(): Recognizer {
  const events = {
    onWords: (words: TimedWord[]) => {
      game?.run.setWords(words);
    },
    onStatus: () => {
      /* the game screen polls recognizer.status when it matters */
    },
    onError: (err: string) => {
      micError = err;
      if (err === 'not-allowed' || err === 'service-not-allowed') toast('Microphone access was denied. Allow it in the browser and start a new run.');
      else if (err === 'network') toast('Speech service unreachable (network). Check the internet connection.');
      else if (err === 'audio-capture') toast('No microphone found.');
      else if (err === 'restart-loop') toast('Speech recognition keeps stopping. Check the microphone.');
    },
  };
  if (MOCK) {
    mock = createMockRecognizer(events);
    return mock;
  }
  return createWebSpeechRecognizer(events);
}

async function boot(): Promise<void> {
  storage = await createStorage();
  try {
    save = await storage.load();
  } catch (e) {
    toast(`Progress file is damaged, starting fresh: ${e instanceof Error ? e.message : String(e)}`);
    save = emptySave();
  }
  setSoundEnabled(save.settings.soundOn);
  recognizer = buildRecognizer();
  await checkStorage();
  await showHome();
  if (AUTOSTART) startRun(save.settings);

  // Hooks for automated checks and the dev panel.
  (window as unknown as { __game: unknown }).__game = {
    get run() {
      return game?.run ?? null;
    },
    hear: (text: string) => mock?.hear(text),
    phrases: () => lastRunPhrases,
    save: () => save,
    setSave: (data: SaveFile) => {
      save = data;
      return persist();
    },
    start: (settings?: Partial<Settings>, phraseIds?: string[]) => {
      if (phraseIds) FIXED_PHRASES.splice(0, FIXED_PHRASES.length, ...phraseIds);
      startRun({ ...save.settings, ...(settings ?? {}) });
    },
    home: () => showHome(),
  };
}

void boot();
