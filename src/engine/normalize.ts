/**
 * Text normalization and word-level matching.
 *
 * Both the reference phrase and the recognized transcript go through the same
 * canonicalization (lowercase, no punctuation, contractions expanded), so
 * "gonna" and "going to" land on the same tokens, as do "I'd" and "I would".
 */

const COLLOQUIAL: Record<string, string> = {
  gonna: 'going to',
  wanna: 'want to',
  gotta: 'got to',
  kinda: 'kind of',
  sorta: 'sort of',
  outta: 'out of',
  lotta: 'lot of',
  lemme: 'let me',
  gimme: 'give me',
  dunno: 'do not know',
  whatcha: 'what are you',
  gotcha: 'got you',
  betcha: 'bet you',
  hafta: 'have to',
  cuz: 'because',
  cos: 'because',
  cause: 'because',
  ya: 'you',
  yall: 'you all',
  "y'all": 'you all',
  "c'mon": 'come on',
  cmon: 'come on',
  "ain't": 'is not',
  aint: 'is not',
  ok: 'okay',
  alright: 'all right',
  "o'clock": 'oclock',
  "ma'am": 'maam',
  till: 'until',
  til: 'until',
};

const IRREGULAR: Record<string, string> = {
  "can't": 'can not',
  cannot: 'can not',
  "won't": 'will not',
  "shan't": 'shall not',
  "let's": 'let us',
  "i'd've": 'i would have',
  "would've": 'would have',
  "could've": 'could have',
  "should've": 'should have',
  "might've": 'might have',
  "must've": 'must have',
  "y'know": 'you know',
};

const SUFFIXES: Array<[RegExp, string]> = [
  [/n't$/, 'not'],
  [/'ll$/, 'will'],
  [/'re$/, 'are'],
  [/'ve$/, 'have'],
  [/'m$/, 'am'],
  [/'d$/, 'would'],
  [/'s$/, 'is'],
];

const NUMBERS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
  '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
};

/** Split raw text into surface words (keeps apostrophes inside words). */
export function surfaceWords(text: string): string[] {
  return text
    .replace(/[‘’ʼ`´]/g, "'")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

function cleanToken(word: string): string {
  return word
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[^a-z0-9']+/g, '')
    .replace(/^'+|'+$/g, '');
}

/** Expand one cleaned token into its canonical tokens. */
export function expandToken(token: string): string[] {
  if (!token) return [];
  if (NUMBERS[token]) return [NUMBERS[token]];
  if (COLLOQUIAL[token]) return COLLOQUIAL[token].split(' ');
  if (IRREGULAR[token]) return IRREGULAR[token].split(' ');
  for (const [re, replacement] of SUFFIXES) {
    if (re.test(token)) {
      const stem = token.replace(re, '');
      if (stem.length === 0) break;
      // Recurse on the stem so stacked forms and stems with their own rules still expand.
      return [...expandToken(stem), replacement];
    }
  }
  return [token.replace(/'/g, '')];
}

export interface Canonical {
  /** Canonical tokens, all lower-case, contractions expanded. */
  tokens: string[];
  /** For each canonical token, the index of the surface word it came from. */
  wordIndex: number[];
  /** Surface words as written. */
  words: string[];
}

export function canonicalize(text: string): Canonical {
  const words = surfaceWords(text);
  const tokens: string[] = [];
  const wordIndex: number[] = [];
  words.forEach((w, i) => {
    for (const t of expandToken(cleanToken(w))) {
      tokens.push(t);
      wordIndex.push(i);
    }
  });
  return { tokens, wordIndex, words };
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Token equality with a little slack for recognizer spelling noise on longer words. */
export function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 1) return true;
  return false;
}

/**
 * Order-preserving alignment (longest common subsequence) of the target tokens
 * against the spoken tokens. Returns, per target token, whether it was heard.
 */
export function alignTokens(target: string[], spoken: string[]): boolean[] {
  const m = target.length;
  const n = spoken.length;
  const matched = new Array<boolean>(m).fill(false);
  if (m === 0 || n === 0) return matched;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = similar(target[i], spoken[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (similar(target[i], spoken[j])) {
      matched[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matched;
}

export interface MatchResult {
  /** matched canonical tokens / total canonical tokens of the reference */
  ratio: number;
  /** Per surface word of the reference: true when all its tokens were heard. */
  wordsHeard: boolean[];
  matchedTokens: number;
  totalTokens: number;
}

/** Compare what was said against the reference phrase, word by word. */
export function matchPhrase(reference: string, spoken: string): MatchResult {
  const ref = canonicalize(reference);
  const said = canonicalize(spoken);
  const aligned = alignTokens(ref.tokens, said.tokens);
  const wordsHeard = ref.words.map((_, wi) => {
    let any = false;
    for (let ti = 0; ti < ref.tokens.length; ti++) {
      if (ref.wordIndex[ti] !== wi) continue;
      any = true;
      if (!aligned[ti]) return false;
    }
    return any;
  });
  const matchedTokens = aligned.filter(Boolean).length;
  const totalTokens = ref.tokens.length;
  return {
    ratio: totalTokens === 0 ? 0 : matchedTokens / totalTokens,
    wordsHeard,
    matchedTokens,
    totalTokens,
  };
}
