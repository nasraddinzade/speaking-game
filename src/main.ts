import './styles.css';
import phrasesJson from './data/phrases.json';
import { applyOutcome, dayKey, emptySave, selectRunPhrases } from './engine/progress';
import type { Phrase, RunResultEntry, RunSummary, SaveFile, Settings } from './engine/types';
import { setSoundEnabled, unlockAudio } from './game/fx';
import { mountGameScreen, type GameHandle } from './game/game-screen';
import { mountHome } from './screens/home';
import { mountResults } from './screens/results';
import { createMockRecognizer, type MockRecognizer } from './speech/mock';
import { createWebSpeechRecognizer, getSpeechRecognitionCtor, type Recognizer, type TimedWord } from './speech/recognizer';
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
    return { ok: false, text: 'This browser has no SpeechRecognition. Run the game through the launcher (Chrome or Edge).' };
  }
  if (micError) return { ok: false, text: `Microphone problem last time: ${micError}. Allow the microphone and try again.` };
  if (navigator.userAgent.includes('Edg/')) return { ok: false, text: 'Edge: speech recognition failed in testing (network). Run the game in Google Chrome.' };
  return { ok: true, text: 'Speech recognition available. Allow the microphone when the browser asks.' };
}

async function showHome(): Promise<void> {
  game?.dispose();
  game = null;
  recognizer.stop();
  const location_ = await storage.location();
  mountHome({
    root,
    save,
    phraseCount: PHRASES.length,
    micStatus: micStatus(),
    storageNote: storage.backend === 'file' ? `Progress file: ${location_ ?? 'data/progress.json'}` : 'Progress is stored in this browser profile (no launcher API found). Use Export to keep a file.',
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
        if (!confirm(`Replace progress on this machine?\nThis device: ${learnedHere} learned.\nFile: ${learnedThere} learned (${imported.updatedAt.slice(0, 10)}).`)) return;
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

function startRun(settings: Settings): void {
  unlockAudio();
  setSoundEnabled(settings.soundOn);
  const fixed = FIXED_PHRASES.map((id) => PHRASES.find((p) => p.id === id)).filter((p): p is Phrase => Boolean(p));
  const phrases =
    fixed.length > 0 ? fixed : selectRunPhrases(PHRASES, save.phrases, { startLevel: settings.startLevel, count: settings.runLength, day: dayKey() });
  lastRunPhrases = phrases;
  micError = null;
  recognizer.reset();
  recognizer.start();
  game = mountGameScreen({
    root,
    phrases,
    settings,
    recognizer,
    mock,
    onOutcome(entry: RunResultEntry) {
      const day = dayKey();
      save.phrases[entry.phrase.id] = applyOutcome(save.phrases[entry.phrase.id], entry.phrase.id, entry.outcome, day);
      save.profile.totals[entry.outcome]++;
      void persist();
    },
    onFinished(summary: RunSummary) {
      recognizer.stop();
      const newBestScore = summary.score > save.profile.bestScore;
      const newBestCombo = summary.bestCombo > save.profile.bestCombo;
      save.profile.bestScore = Math.max(save.profile.bestScore, summary.score);
      save.profile.bestCombo = Math.max(save.profile.bestCombo, summary.bestCombo);
      save.profile.runsPlayed++;
      void persist();
      game?.dispose();
      game = null;
      mountResults({
        root,
        summary,
        newBestScore,
        newBestCombo,
        voiceName: settings.voiceName,
        onPlayAgain: () => startRun(save.settings),
        onHome: () => void showHome(),
      });
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
    start: (settings?: Partial<Settings>) => startRun({ ...save.settings, ...(settings ?? {}) }),
  };
}

void boot();
