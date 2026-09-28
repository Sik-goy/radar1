import { describe, expect, it } from 'vitest';
import { effectiveEnd, mergeHappeningNow } from '@/lib/events/happening';

const ev = (id: string, startsAt: string, endsAt: string | null) => ({
  id,
  startsAt: new Date(startsAt),
  endsAt: endsAt ? new Date(endsAt) : null,
});

describe('effectiveEnd', () => {
  it('is endsAt when present', () => {
    expect(effectiveEnd(ev('a', '2026-09-20T10:00:00Z', '2026-10-30T18:00:00Z')).toISOString()).toBe('2026-10-30T18:00:00.000Z');
  });

  it('is startsAt + 2h for single-time events', () => {
    expect(effectiveEnd(ev('b', '2026-09-30T09:00:00Z', null)).toISOString()).toBe('2026-09-30T11:00:00.000Z');
  });
});

describe('mergeHappeningNow', () => {
  const a = ev('a', '2026-09-20T10:00:00Z', '2026-10-30T18:00:00Z');
  const b = ev('b', '2026-09-30T09:00:00Z', null); // ends 11:00
  const c = ev('c', '2026-09-29T10:00:00Z', '2026-09-30T20:00:00Z');
  const d = ev('d', '2026-09-30T08:30:00Z', null); // ends 10:30

  it('sorts both lists together by effective end, soonest first', () => {
    expect(mergeHappeningNow([a, c], [b, d], 12).map((e) => e.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('keeps only the first `limit` after sorting', () => {
    expect(mergeHappeningNow([a, c], [b, d], 2).map((e) => e.id)).toEqual(['d', 'b']);
  });

  it('breaks ties on the earlier startsAt', () => {
    const earlier = ev('early', '2026-09-30T05:00:00Z', '2026-09-30T11:00:00Z');
    expect(mergeHappeningNow([earlier], [b], 12).map((e) => e.id)).toEqual(['early', 'b']);
  });

  it('handles empty inputs', () => {
    expect(mergeHappeningNow([], [], 12)).toEqual([]);
    expect(mergeHappeningNow([a], [], 12).map((e) => e.id)).toEqual(['a']);
  });

  it('does not mutate its inputs', () => {
    const multi = [a, c];
    mergeHappeningNow(multi, [b, d], 12);
    expect(multi.map((e) => e.id)).toEqual(['a', 'c']);
  });
});
