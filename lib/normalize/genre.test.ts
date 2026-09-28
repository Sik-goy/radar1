import { describe, expect, it } from 'vitest';
import { normalizeGenre } from '@/lib/normalize/genre';

describe('normalizeGenre', () => {
  it.each([
    ['Koncerty', 'concert'],
    ['Festival', 'concert'],
    ['Klasická hudba', 'concert'],
    ['Hip hop', 'concert'],
    ['Concert', 'concert'],
    ['Elektronická hudba', 'electronic'],
    ['Electronic music', 'electronic'],
    ['Electronic festival', 'electronic'],
    ['DJ set', 'electronic'],
    ['Divadlo', 'theatre'],
    ['Hudobné divadlo', 'theatre'],
    ['Divadlo Komédia', 'theatre'],
    ['Detské divadlo', 'theatre'],
    ['Theatre', 'theatre'],
    ['Výstavy', 'exhibition'],
    ['Exhibition', 'exhibition'],
    ['Stand-up', 'standup'],
    ['Stand-up comedy', 'standup'],
    ['Šport', 'sport'],
    ['Sportovní', 'sport'],
    ['Hokej', 'sport'],
    ['Sports', 'sport'],
    ['Maraton', 'sport'],
    ['Deti a rodina', 'other'],
    ['Popularna veda', 'other'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeGenre(raw)).toBe(expected);
  });

  it('falls back to other for empty input', () => {
    expect(normalizeGenre('')).toBe('other');
    expect(normalizeGenre(null)).toBe('other');
    expect(normalizeGenre(undefined)).toBe('other');
  });
});
