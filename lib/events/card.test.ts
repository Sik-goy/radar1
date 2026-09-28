import { describe, expect, it } from 'vitest';
import { toEventCard, type EventRow } from '@/lib/events/card';

const dec = (n: number) => ({ toNumber: () => n });

const row: EventRow = {
  id: 'e1',
  title: 'Aurora Bloom',
  venue: 'O2 arena',
  city: 'Praha',
  country: 'CZ',
  startsAt: new Date('2026-10-10T18:00:00Z'),
  endsAt: null,
  priceFrom: dec(300),
  currency: 'CZK',
  genre: 'concert',
  imageUrl: null,
  sources: [
    { id: 's1', url: 'https://g/1', priceFrom: dec(25), currency: 'EUR', source: { name: 'Gamma' } },
    { id: 's2', url: 'https://g/2', priceFrom: dec(500), currency: 'CZK', source: { name: 'Zeta' } },
    { id: 's3', url: 'https://g/3', priceFrom: null, currency: 'CZK', source: { name: 'Alpha' } },
    { id: 's4', url: 'https://g/4', priceFrom: dec(300), currency: 'CZK', source: { name: 'Beta' } },
  ],
};

describe('toEventCard', () => {
  it('converts decimals to numbers', () => {
    const card = toEventCard(row);
    expect(card.priceFrom).toBe(300);
    expect(card.sources.find((s) => s.sourceName === 'Zeta')?.priceFrom).toBe(500);
    expect(card.sources.find((s) => s.sourceName === 'Alpha')?.priceFrom).toBeNull();
  });

  it('orders sources: event currency first, priced before unknown, cheapest first', () => {
    expect(toEventCard(row).sources.map((s) => s.sourceName)).toEqual(['Beta', 'Zeta', 'Alpha', 'Gamma']);
  });

  it('keeps null event price null and free as 0', () => {
    expect(toEventCard({ ...row, priceFrom: null }).priceFrom).toBeNull();
    expect(toEventCard({ ...row, priceFrom: dec(0) }).priceFrom).toBe(0);
  });
});
