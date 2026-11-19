import { describe, expect, it } from 'vitest';
import { cleanLook } from '../src/world/avatar';
import { findMatches, keywords } from '../src/world/match';
import { zoneAt } from '../src/world/venue';
import { cleanStroke } from '../src/world/whiteboard';

describe('matchmaking', () => {
  it('ignores filler words and light plurals', () => {
    expect([...keywords('Looking to meet some designers for pitch decks')]).toEqual(['design', 'pitch', 'deck']);
  });

  it('pairs what you are here for with what others can help with', () => {
    const matches = findMatches({ tag: 'sourdough', goal: 'find a designer for pitch decks' }, [
      { id: 'a', name: 'Ann', tag: 'pitch decks' },
      { id: 'b', name: 'Bob', tag: 'climate tech' },
      { id: 'c', name: 'Cat', tag: 'golf', goal: 'learn sourdough' },
    ]);
    expect(matches.map((m) => m.id)).toEqual(['a', 'c']);
    expect(matches[0]!.reason).toContain('pitch decks');
  });

  it('finds nothing when you have not said what you are after', () => {
    expect(findMatches({}, [{ id: 'a', name: 'Ann', tag: 'pitch decks' }])).toEqual([]);
  });
});

describe('untrusted network data', () => {
  it('clamps avatar looks', () => {
    expect(cleanLook({ height: 9, build: -1, tv: 'hologram' as never, prop: 'sword' as never, casing: 'gold' as never, cam: { zoom: 50, x: -3, y: Number.NaN } })).toEqual({
      height: 1.1,
      build: 0.8,
      tv: 'crt',
      casing: 'cream',
      prop: 'none',
      cam: { zoom: 3, x: 0, y: 0.5 },
    });
    expect(cleanLook(undefined)).toEqual({ height: 1, build: 1, tv: 'crt', casing: 'cream', prop: 'none', cam: { zoom: 1, x: 0.5, y: 0.5 } });
  });

  it('rejects bad whiteboard strokes', () => {
    expect(cleanStroke({ b: 'podA', c: 'red;', w: 99, p: [1, 2, 3, 4] })).toEqual({ b: 'podA', c: '#1d2027', w: 40, p: [1, 2, 3, 4] });
    expect(cleanStroke({ b: 'lobby' as never, c: '#000000', w: 5, p: [1, 2] })).toBeNull();
    expect(cleanStroke({ b: 'podB', c: '#000000', w: 5, p: [1, 5000] })).toBeNull();
  });
});

describe('pods', () => {
  it('are their own zones inside the lobby', () => {
    expect(zoneAt(-16, 26, 0)).toBe('podA');
    expect(zoneAt(16, 27, 0)).toBe('podB');
    expect(zoneAt(0, 26, 0)).toBe('lobby');
  });
});
