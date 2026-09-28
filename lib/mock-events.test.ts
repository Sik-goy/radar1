import { describe, expect, it } from 'vitest';
import { buildMockEvents } from '@/lib/mock-events';
import { normalizeRaw } from '@/lib/normalize';
import { GENRES } from '@/lib/types';

const now = new Date('2026-09-30T10:00:00Z');
const raws = buildMockEvents(now);
const normalized = raws.map(normalizeRaw);

describe('buildMockEvents', () => {
  it('is big enough to exercise the feed', () => {
    expect(raws.length).toBeGreaterThanOrEqual(60);
  });

  it('every raw event normalizes without throwing (checked above) and covers all genres', () => {
    expect(new Set(normalized.map((n) => n.genre))).toEqual(new Set(GENRES));
  });

  it('covers the four cities', () => {
    const cities = new Set(normalized.map((n) => n.city));
    for (const city of ['Bratislava', 'Praha', 'Brno', 'Košice']) expect(cities.has(city)).toBe(true);
  });

  it('includes free, unknown-price, multi-day and other-currency listings', () => {
    expect(normalized.some((n) => n.price === 0)).toBe(true);
    expect(normalized.some((n) => n.price === null)).toBe(true);
    expect(normalized.filter((n) => n.endsAt !== null).length).toBeGreaterThanOrEqual(4);
    expect(normalized.some((n) => n.country === 'CZ' && n.priceCurrency === 'EUR')).toBe(true);
  });

  it('has exactly one repeated URL, to exercise the re-scrape path', () => {
    const urls = normalized.map((n) => n.url);
    expect(new Set(urls).size).toBe(urls.length - 1);
  });

  it('includes an event that started 30 minutes ago and one that started 3 hours ago', () => {
    const starts = normalized.map((n) => now.getTime() - n.startsAt.getTime());
    expect(starts.some((ms) => ms === 30 * 60_000)).toBe(true);
    expect(starts.some((ms) => ms === 180 * 60_000)).toBe(true);
  });
});
