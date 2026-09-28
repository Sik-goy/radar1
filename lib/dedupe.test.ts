import { describe, expect, it } from 'vitest';
import { blankFills, computeEventPrice, levenshtein, pickFuzzyMatch, reconcileRescrape, titleDistance } from '@/lib/dedupe';

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
});

describe('titleDistance', () => {
  it('ignores case, diacritics and punctuation', () => {
    expect(titleDistance('Aurora Bloom – Tour 2026', 'aurora bloom tour 2026')).toBe(0);
  });

  it('is edit distance over the longer normalized title', () => {
    expect(titleDistance('abcdefghij', 'abcdefghix')).toBeCloseTo(0.1);
    expect(titleDistance('abcdefghij', 'abcdefghxy')).toBeCloseTo(0.2);
  });

  it('never matches two empty titles', () => {
    expect(titleDistance('!!!', '???')).toBe(1);
  });
});

describe('pickFuzzyMatch', () => {
  it('accepts a distance below 0.2 and rejects exactly 0.2', () => {
    expect(pickFuzzyMatch('abcdefghij', [{ id: 'ok', title: 'abcdefghix' }])?.id).toBe('ok');
    expect(pickFuzzyMatch('abcdefghij', [{ id: 'edge', title: 'abcdefghxy' }])).toBeNull();
  });

  it('picks the lowest distance', () => {
    const picked = pickFuzzyMatch('Jazz Night Live', [
      { id: 'a', title: 'Jazz Night Liv' },
      { id: 'b', title: 'Jazz Night Live' },
    ]);
    expect(picked?.id).toBe('b');
  });

  it('returns null without candidates', () => {
    expect(pickFuzzyMatch('Anything', [])).toBeNull();
  });

  it('does not merge titles that differ only by a number', () => {
    expect(pickFuzzyMatch('Jazz Night 1', [{ id: 'x', title: 'Jazz Night 2' }])).toBeNull();
    expect(pickFuzzyMatch('Aurora Bloom Tour 2026', [{ id: 'x', title: 'Aurora Bloom Tour 2027' }])).toBeNull();
  });

  it('still merges when the numbers are equal or only one title has a number', () => {
    expect(pickFuzzyMatch('Aurora Bloom Tour 2026', [{ id: 'x', title: 'Aurora Bloom – Tour 2026' }])?.id).toBe('x');
    expect(pickFuzzyMatch('Jazz Night', [{ id: 'x', title: 'Jazz Night 2' }])?.id).toBe('x');
  });
});

describe('computeEventPrice', () => {
  it('takes the minimum in the event currency', () => {
    expect(
      computeEventPrice(
        [
          { priceFrom: 20, currency: 'EUR' },
          { priceFrom: 15, currency: 'EUR' },
          { priceFrom: 10, currency: 'CZK' },
        ],
        'EUR',
      ),
    ).toBe(15);
  });

  it('treats 0 as a real (free) price', () => {
    expect(
      computeEventPrice(
        [
          { priceFrom: 0, currency: 'EUR' },
          { priceFrom: 20, currency: 'EUR' },
        ],
        'EUR',
      ),
    ).toBe(0);
  });

  it('is null when nothing is known in the event currency', () => {
    expect(computeEventPrice([], 'EUR')).toBeNull();
    expect(computeEventPrice([{ priceFrom: null, currency: 'EUR' }], 'EUR')).toBeNull();
    expect(computeEventPrice([{ priceFrom: 35, currency: 'EUR' }], 'CZK')).toBeNull();
  });

  it('ignores unknown-price sources when another has a price', () => {
    expect(
      computeEventPrice(
        [
          { priceFrom: null, currency: 'CZK' },
          { priceFrom: 890, currency: 'CZK' },
          { priceFrom: 35, currency: 'EUR' },
        ],
        'CZK',
      ),
    ).toBe(890);
  });
});

describe('blankFills', () => {
  const startsAt = new Date('2026-10-12T18:00:00Z');
  const when = new Date('2026-10-12T20:00:00Z');

  it('fills blank fields from the incoming event', () => {
    expect(blankFills({ startsAt, imageUrl: null, endsAt: null }, { imageUrl: 'https://i/x.jpg', endsAt: when })).toEqual({
      imageUrl: 'https://i/x.jpg',
      endsAt: when,
    });
  });

  it('never overwrites existing values', () => {
    expect(
      blankFills({ startsAt, imageUrl: 'https://i/a.jpg', endsAt: when }, { imageUrl: 'https://i/b.jpg', endsAt: null }),
    ).toEqual({});
  });

  it('returns nothing when the incoming event has nothing to add', () => {
    expect(blankFills({ startsAt, imageUrl: null, endsAt: null }, { imageUrl: null, endsAt: null })).toEqual({});
  });

  it('never fills an endsAt that would land before the existing startsAt', () => {
    // A fuzzy-matched source can have its own (different) startsAt; its endsAt must not predate ours.
    const earlierEnd = new Date('2026-10-12T17:00:00Z');
    expect(blankFills({ startsAt, imageUrl: null, endsAt: null }, { imageUrl: null, endsAt: earlierEnd })).toEqual({});
  });
});

describe('reconcileRescrape', () => {
  const existing = {
    startsAt: new Date('2026-10-10T18:00:00Z'),
    title: 'Jazz Night',
    venue: 'Old Club',
    endsAt: null,
    fingerprint: 'jazz night|old club|2026-10-10',
  };

  it('a single-source event fully trusts the new scrape, fingerprint included', () => {
    const incoming = {
      startsAt: new Date('2026-10-11T19:00:00Z'),
      title: 'Jazz Night Reloaded',
      venue: 'New Club',
      endsAt: new Date('2026-10-11T21:00:00Z'),
      fingerprint: 'jazz night reloaded|new club|2026-10-11',
    };
    expect(reconcileRescrape(existing, incoming, false)).toEqual(incoming);
  });

  it('a multi-source event ignores a small startsAt drift and keeps every other field', () => {
    const incoming = { ...existing, startsAt: new Date(existing.startsAt.getTime() + 30 * 60_000) };
    expect(reconcileRescrape(existing, incoming, true)).toEqual({});
  });

  it('a multi-source event accepts a startsAt change past the fuzzy window as a reschedule', () => {
    const incoming = { ...existing, startsAt: new Date(existing.startsAt.getTime() + 4 * 60 * 60_000) };
    expect(reconcileRescrape(existing, incoming, true)).toEqual({ startsAt: incoming.startsAt });
  });

  it('a multi-source event never updates title, venue or fingerprint from a re-scrape', () => {
    const incoming = {
      startsAt: new Date(existing.startsAt.getTime() + 4 * 60 * 60_000),
      title: 'Different Title',
      venue: 'Different Venue',
      endsAt: null,
      fingerprint: 'different',
    };
    expect(reconcileRescrape(existing, incoming, true)).toEqual({ startsAt: incoming.startsAt });
  });

  it('the drift threshold is exclusive, matching the fuzzy-match window', () => {
    const incoming = { ...existing, startsAt: new Date(existing.startsAt.getTime() + 3 * 60 * 60_000) };
    expect(reconcileRescrape(existing, incoming, true)).toEqual({});
  });
});
