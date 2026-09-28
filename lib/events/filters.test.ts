import { describe, expect, it } from 'vitest';
import { buildHappeningNowWhere, buildVisibleWhere, buildWhere, parseFilters, withPage } from '@/lib/events/filters';

describe('parseFilters', () => {
  it('returns safe defaults for empty params', () => {
    expect(parseFilters({})).toEqual({ cities: [], genres: [], page: 1 });
  });

  it('accepts a single or repeated city, trimmed and de-duplicated', () => {
    expect(parseFilters({ city: 'Praha' }).cities).toEqual(['Praha']);
    expect(parseFilters({ city: [' Praha ', 'Brno', 'Praha', ''] }).cities).toEqual(['Praha', 'Brno']);
  });

  it('drops unknown genres', () => {
    expect(parseFilters({ genre: ['concert', 'bogus', 'sport'] }).genres).toEqual(['concert', 'sport']);
    expect(parseFilters({ genre: 'bogus' }).genres).toEqual([]);
  });

  it('accepts a known when and ignores a bogus one', () => {
    expect(parseFilters({ when: 'weekend' }).when).toBe('weekend');
    expect(parseFilters({ when: 'bogus' }).when).toBeUndefined();
    expect(parseFilters({ when: ['today', 'week'] }).when).toBe('today');
  });

  it('keeps maxPrice=0 and rejects unusable values', () => {
    expect(parseFilters({ maxPrice: '0' }).maxPrice).toBe(0);
    expect(parseFilters({ maxPrice: '30' }).maxPrice).toBe(30);
    expect(parseFilters({ maxPrice: '12.5' }).maxPrice).toBe(12.5);
    expect(parseFilters({ maxPrice: '' }).maxPrice).toBeUndefined();
    expect(parseFilters({ maxPrice: '   ' }).maxPrice).toBeUndefined();
    expect(parseFilters({ maxPrice: 'abc' }).maxPrice).toBeUndefined();
    expect(parseFilters({ maxPrice: '-5' }).maxPrice).toBeUndefined();
    expect(parseFilters({ maxPrice: 'Infinity' }).maxPrice).toBeUndefined();
  });

  it('ignores a maxPrice that overflows once converted to CZK', () => {
    expect(parseFilters({ maxPrice: '1e308' }).maxPrice).toBeUndefined();
    expect(parseFilters({ maxPrice: '1e300' }).maxPrice).toBe(1e300);
  });

  it('clamps page to 1..50', () => {
    expect(parseFilters({ page: '3' }).page).toBe(3);
    expect(parseFilters({ page: '0' }).page).toBe(1);
    expect(parseFilters({ page: '-3' }).page).toBe(1);
    expect(parseFilters({ page: 'abc' }).page).toBe(1);
    expect(parseFilters({ page: '2.7' }).page).toBe(2);
    expect(parseFilters({ page: '999' }).page).toBe(50);
  });
});

const now = new Date('2026-09-30T10:00:00Z'); // a Wednesday
const twoHoursAgo = new Date('2026-09-30T08:00:00Z');
const filters = { cities: [], genres: [], page: 1 };
const priceClause = (max: number, maxCzk: number) => ({
  OR: [
    { priceFrom: null },
    { currency: 'EUR', priceFrom: { lte: max } },
    { currency: 'CZK', priceFrom: { lte: maxCzk } },
  ],
});

describe('buildWhere (main grid)', () => {
  it('by default lists only events that have not started yet', () => {
    expect(buildWhere(filters, now)).toEqual({ AND: [{ startsAt: { gte: now } }] });
  });

  it('adds the range end for today', () => {
    expect(buildWhere({ ...filters, when: 'today' }, now)).toEqual({
      AND: [{ startsAt: { gte: now } }, { startsAt: { lte: new Date('2026-09-30T21:59:59.999Z') } }],
    });
  });

  it('uses the weekend window when when=weekend', () => {
    expect(buildWhere({ ...filters, when: 'weekend' }, now)).toEqual({
      AND: [
        { startsAt: { gte: new Date('2026-10-02T16:00:00Z') } },
        { startsAt: { lte: new Date('2026-10-04T21:59:59.999Z') } },
      ],
    });
  });

  it('adds city and genre membership', () => {
    expect(buildWhere({ ...filters, cities: ['Praha', 'Brno'], genres: ['concert'] }, now)).toEqual({
      AND: [{ startsAt: { gte: now } }, { city: { in: ['Praha', 'Brno'] } }, { genre: { in: ['concert'] } }],
    });
  });

  it('maxPrice passes unknown prices and converts EUR to CZK', () => {
    expect(buildWhere({ ...filters, maxPrice: 30 }, now)).toEqual({
      AND: [{ startsAt: { gte: now } }, priceClause(30, 750)],
    });
  });

  it('maxPrice=0 is a real filter (free + unknown), not "unset"', () => {
    expect(buildWhere({ ...filters, maxPrice: 0 }, now)).toEqual({
      AND: [{ startsAt: { gte: now } }, priceClause(0, 0)],
    });
  });
});

describe('buildHappeningNowWhere', () => {
  it('selects started, not-ended events: multi-day by endsAt, single-time within the 2h window', () => {
    expect(buildHappeningNowWhere(filters, now)).toEqual({
      multiDay: { AND: [{ startsAt: { lt: now } }, { endsAt: { gte: now } }] },
      singleTime: { AND: [{ endsAt: null }, { startsAt: { lt: now } }, { startsAt: { gte: twoHoursAgo } }] },
    });
  });

  it('partitions with the grid at now: grid is startsAt >= now, row is startsAt < now', () => {
    const grid = buildWhere(filters, now);
    const row = buildHappeningNowWhere(filters, now);
    const startedBeforeNow = { AND: expect.arrayContaining([{ startsAt: { lt: now } }]) };
    expect(grid).toEqual({ AND: [{ startsAt: { gte: now } }] });
    expect(row?.multiDay).toEqual(startedBeforeNow);
    expect(row?.singleTime).toEqual(startedBeforeNow);
  });

  it('applies city, genre and maxPrice filters to both queries', () => {
    const common = [{ city: { in: ['Praha'] } }, { genre: { in: ['concert'] } }, priceClause(0, 0)];
    const row = buildHappeningNowWhere({ ...filters, cities: ['Praha'], genres: ['concert'], maxPrice: 0 }, now);
    expect(row?.multiDay).toEqual({ AND: [{ startsAt: { lt: now } }, { endsAt: { gte: now } }, ...common] });
    expect(row?.singleTime).toEqual({
      AND: [{ endsAt: null }, { startsAt: { lt: now } }, { startsAt: { gte: twoHoursAgo } }, ...common],
    });
  });

  it.each(['today', 'week', 'month'] as const)('is available for when=%s and ignores the range end', (when) => {
    expect(buildHappeningNowWhere({ ...filters, when }, now)).toEqual(buildHappeningNowWhere(filters, now));
  });

  it('is hidden when the weekend has not begun yet', () => {
    expect(buildHappeningNowWhere({ ...filters, when: 'weekend' }, now)).toBeNull();
  });

  it('is shown once now is inside the weekend', () => {
    const saturday = new Date('2026-10-03T10:00:00Z');
    expect(buildHappeningNowWhere({ ...filters, when: 'weekend' }, saturday)).not.toBeNull();
  });
});

describe('buildVisibleWhere', () => {
  it('matches events whose effective end is not before now', () => {
    expect(buildVisibleWhere(now)).toEqual({
      OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: twoHoursAgo } }],
    });
  });
});

describe('withPage', () => {
  it('keeps repeated params and replaces page', () => {
    expect(withPage({ city: ['Praha', 'Brno'], when: 'today', page: '2' }, 3)).toBe('?city=Praha&city=Brno&when=today&page=3');
  });

  it('works without existing params', () => {
    expect(withPage({}, 2)).toBe('?page=2');
  });
});
