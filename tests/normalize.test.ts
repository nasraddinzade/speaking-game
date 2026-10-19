import { describe, expect, it } from 'vitest';
import { canonicalize, expandToken, matchPhrase } from '../src/engine/normalize';

describe('canonicalize', () => {
  it('lowercases and strips punctuation', () => {
    expect(canonicalize('Fair enough.').tokens).toEqual(['fair', 'enough']);
    expect(canonicalize('Here’s the thing!').tokens).toEqual(['here', 'is', 'the', 'thing']);
  });

  it('expands contractions and colloquial forms to the same tokens', () => {
    expect(canonicalize("I'm gonna grab a coffee").tokens).toEqual(canonicalize('I am going to grab a coffee').tokens);
    expect(canonicalize("I'd push back").tokens).toEqual(canonicalize('I would push back').tokens);
    expect(canonicalize("can't").tokens).toEqual(['can', 'not']);
    expect(canonicalize("won't").tokens).toEqual(['will', 'not']);
    expect(canonicalize("let's").tokens).toEqual(['let', 'us']);
    expect(canonicalize('kinda outta wanna gotta').tokens).toEqual(['kind', 'of', 'out', 'of', 'want', 'to', 'got', 'to']);
    expect(canonicalize("I would've").tokens).toEqual(['i', 'would', 'have']);
    expect(expandToken("they'd've")).toEqual(['they', 'would', 'have']);
  });

  it('keeps a map from tokens back to surface words', () => {
    const c = canonicalize("I'll get back to you.");
    expect(c.words).toEqual(["I'll", 'get', 'back', 'to', 'you.']);
    expect(c.tokens).toEqual(['i', 'will', 'get', 'back', 'to', 'you']);
    expect(c.wordIndex).toEqual([0, 0, 1, 2, 3, 4]);
  });
});

describe('matchPhrase', () => {
  it('is 1.0 for an exact match in any form', () => {
    expect(matchPhrase("I'll get back to you on that.", 'i will get back to you on that').ratio).toBe(1);
    expect(matchPhrase("I'm gonna grab a coffee, want anything?", "I'm going to grab a coffee want anything").ratio).toBe(1);
  });

  it('counts matched words over reference words, ignoring extra speech', () => {
    const r = matchPhrase('Give it a shot.', 'um give it a shot yeah');
    expect(r.ratio).toBe(1);
    expect(r.wordsHeard).toEqual([true, true, true, true]);
  });

  it('reports missing words per surface word', () => {
    const r = matchPhrase('Let me walk you through it.', 'let me walk through it');
    expect(r.wordsHeard).toEqual([true, true, true, false, true, true]);
    expect(r.ratio).toBeCloseTo(5 / 6);
  });

  it('a contraction word lights up only when all its tokens were heard', () => {
    const r = matchPhrase("I'd push back on that.", 'i push back on that');
    expect(r.wordsHeard[0]).toBe(false);
    expect(r.ratio).toBeCloseTo(5 / 6);
  });

  it('keeps word order: scrambled speech does not fully match', () => {
    const r = matchPhrase('That said, there is another angle.', 'angle another is there said that');
    expect(r.ratio).toBeLessThan(0.5);
  });

  it('tolerates one-letter noise on longer words', () => {
    expect(matchPhrase('Which brings me to my next point.', 'which bring me to my next point').ratio).toBe(1);
  });

  it('returns 0 for silence', () => {
    const r = matchPhrase('Moving on.', '');
    expect(r.ratio).toBe(0);
    expect(r.wordsHeard).toEqual([false, false]);
  });
});
