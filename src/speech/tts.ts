/**
 * Reference audio through the system SpeechSynthesis. Free, offline.
 * Picks an en-US voice, then en-GB, then any English voice.
 */

let cachedVoices: SpeechSynthesisVoice[] = [];

function loadVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length > 0) cachedVoices = v;
  return cachedVoices;
}

if ('speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

export function englishVoices(): SpeechSynthesisVoice[] {
  const all = loadVoices();
  const score = (v: SpeechSynthesisVoice) => {
    const lang = v.lang.toLowerCase().replace('_', '-');
    if (lang === 'en-us') return 0;
    if (lang === 'en-gb') return 1;
    if (lang.startsWith('en')) return 2;
    return 9;
  };
  return all.filter((v) => score(v) < 9).sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

export function pickVoice(preferredName: string | null): SpeechSynthesisVoice | null {
  const voices = englishVoices();
  if (preferredName) {
    const hit = voices.find((v) => v.name === preferredName);
    if (hit) return hit;
  }
  return voices[0] ?? null;
}

export interface SpeakOptions {
  voiceName?: string | null;
  rate?: number;
}

/** Speak the phrase and resolve when it finishes (or fails). Never rejects. */
export function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(opts.voiceName ?? null);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = 'en-US';
    }
    u.rate = opts.rate ?? 1;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;
    // Some voices never fire onend; never leave the game paused forever.
    const guard = window.setTimeout(finish, 2000 + text.length * 120);
    synth.speak(u);
  });
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
