# Speaking Game

A desktop game for training fluent spoken English. Phrases fall from the top of the screen; you say each one out loud while it passes through the hit zone. The goal is not to translate but to get whole phrases out in one breath, at a natural tempo, with linking and contractions.

Single user, no accounts, no server. The interface is in English, phrase translations are in Russian.

Specification: [speaking-game-spec.md](speaking-game-spec.md).

## Run it

Requirements: Node.js 18+, Google Chrome, a microphone, internet access (the speech engine behind the Web Speech API runs in the cloud).

```bash
npm install
npm start
```

`npm start` builds the game once, starts a tiny local server and opens Chrome in app mode: a plain window without tabs or address bar. Closing the window stops the server. Double-clicking `Speaking Game.cmd` does the same.

On the first run the browser asks for microphone access. Allow it once; the game keeps its own browser profile under `data/browser-profile`, so the choice is remembered.

Flags: `node launcher/start.cjs --edge` prefers Edge (its speech service answered `network` on the test machine, so Chrome is the supported browser), `--no-browser` only serves the game, `--port 8000` picks a port.

## Why not Electron or Tauri

The spec recommends Tauri or Electron. Both were checked on 2026-10-19:

- **Electron 44 (Chromium 152):** `SpeechRecognition` starts, then fails immediately with `error: network`. Electron does not ship Google's speech API keys, so the Web Speech API cannot reach the recognition service. This is a long-standing Electron limitation, not something a config flag fixes.
- **Tauri 2 (WebView2):** WebView2 does support `SpeechRecognition` through Microsoft's speech service, but Runtime 153 broke it with the same `network` error (see [WebView2Feedback #5724](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5724), open as of October 2026; a `--disable-features` workaround exists). Building Tauri also needs the Rust toolchain and MSVC, which are not installed on the target machine.

- **Edge 151:** `SpeechRecognition` fails with `network` as well, with and without the `--disable-features=msSpeechRecognitionServiceUseCetoService` workaround.

Chrome itself has working recognition (verified end to end with a WAV file fed in as the microphone: a 7-word and an 18-word phrase both scored a clean hit), so the app is a web game plus a launcher that runs it in a Chrome app-mode window. Everything in `src/` is shell-agnostic: if a Tauri shell is added later, only the storage backend (`src/storage/storage.ts`) needs a file-system implementation.

## How the game works

- A phrase spawns above the field and falls at a constant speed for the whole run.
- The zone is a band. Its height comes from the phrase length: `expectedSeconds = wordCount / 150 * 60`, `zoneHeight = expectedSeconds * fallSpeed * 1.4` plus the rendered height of the phrase itself, so the time between the phrase top touching the zone top and the phrase bottom leaving the zone bottom is exactly `expectedSeconds * 1.4`.
- Recognition (`continuous`, `interimResults`, `en-US`) starts once per run with the microphone track from getUserMedia (`recognition.start(track)`), and is only restarted if the browser ends the session on its own.
- Each recognized word carries a timestamp. Words whose timestamp falls inside a phrase's window (plus a 700 ms recognition-latency allowance) count for that phrase. Words heard during a pause never count.
- Matching is per word after normalization on both sides: lowercase, no punctuation, contractions expanded (`gonna` = `going to`, `I'd` = `I would`, `can't` = `can not`...). `matchRatio = matched words / reference words`, clean threshold 0.85. Words light up as they are heard.
- Outcomes: clean +10, late +4 (finished within 2 s after leaving the zone), word miss 0, silence -5. Every 5 clean hits in a row raise the multiplier by 0.5, up to x3; anything but clean resets it.
- After a word miss or silence the reference audio plays (system `speechSynthesis`, en-US or en-GB voice) and the game pauses until it finishes. Listen buttons are also on the pause screen and the results screen.
- Translation is hidden while a phrase falls. On the pause screen, hover the phrase or press `T`.

Keys during a run: `Esc` / `Space` pause and resume, `T` translation (paused), `L` listen (paused).

## Recordings

Every clean hit is recorded (MediaRecorder on the same microphone stream the recognizer uses, `audio/webm;codecs=opus` at 32 kbps, from 200 ms before the phrase enters the zone to 300 ms after it leaves). Misses are not recorded. Each phrase keeps two files in `data/recordings/`:

- `{phraseId}_first.webm`: the very first clean take, never overwritten (the launcher refuses to replace it).
- `{phraseId}_latest.webm`: the most recent clean take, replaced on every clean hit.

The progress JSON stores only file names and dates under `recordings`. When moving progress to another machine, copy the recordings folder too; without it the app works, playback just reports that the file is missing.

Where to listen:

- Results screen: every phrase of the run that has both takes gets First / Now / Reference buttons. Nothing autoplays; the active button is highlighted while the sound plays.
- When a phrase becomes learned (clean hits on 3 different days), a comparison screen opens right after the run, before the results: first take, latest take, days between them.
- Home, "My recordings": all phrases with a pair, newest first.

If the folder grows past 500 MB the home screen shows a warning with a button that deletes the recordings of learned phrases older than six months. Nothing is deleted automatically.

The run pauses by itself while the window is hidden or covered (Chromium stops animation frames there) and resumes when it is visible again.

## Progress

A phrase is learned after clean hits on 3 different calendar days (several hits on the same day count once). A word miss adds to `misses` and makes the phrase come back more often; silence only costs points. Learned phrases leave the rotation and come back for a check after 14 days.

Progress is one JSON file: `data/progress.json` (the launcher prints the path, the home screen shows it). Copy it to another machine, or use Export / Import on the home screen, which read and write the same format.

## Phrase base

`src/data/phrases.json`: 240 phrases, four levels, every entry has `id`, `text`, `translation`, `wordCount`, `difficulty`, `category`, `tags`. 65% carry the `linking` tag (connected speech where spelling and sound diverge). The generator and validator scripts used to build it are not part of the repo; edit the JSON directly and keep `wordCount` equal to the number of space-separated words.

## Development

```bash
npm run dev        # Vite dev server with hot reload
npm test           # engine unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # production build into dist/
```

Open the game with `?mock=1` to replace the microphone with a dev panel where you type what you would have said. `window.__game` exposes the current run, `hear(text)` and `start(settings)` for scripted checks.

Layout: `src/engine` (pure logic: normalization, zone math, scoring, progress), `src/speech` (Web Speech wrapper, recorder, TTS, mock), `src/game` (run timeline, clock, effects, player, run screen), `src/screens` (home, results, comparison, recordings list), `src/storage` (progress file and recordings API), `launcher/` (server + browser window).

In mock mode the microphone is a quiet synthetic tone, so recordings and the comparison screen can be exercised without a real microphone.
