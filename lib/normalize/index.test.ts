import { describe, expect, it } from 'vitest';
import { normalizeRaw } from '@/lib/normalize';
import type { RawEvent } from '@/lib/types';

const base: RawEvent = {
  source: 'goout',
  sourceUrl: 'https://goout.net/en/e/1/?utm_source=x',
  title: '  Nočný   Jazz – LIVE!  ',
  venue: 'Majestic Music Club',
  city: 'BA',
  startsAt: new Date('2026-10-10T18:00:00Z'),
  priceFrom: 12,
  rawGenre: 'Koncerty',
  imageUrl: 'https://img.example/x.jpg',
};

describe('normalizeRaw', () => {
  it('normalizes a Slovak event end to end', () => {
    const n = normalizeRaw(base);
    expect(n).toEqual({
      sourceSlug: 'goout',
      url: 'https://goout.net/en/e/1',
      title: 'Nočný Jazz – LIVE!',
      venue: 'Majestic Music Club',
      city: 'Bratislava',
      country: 'SK',
      currency: 'EUR',
      genre: 'concert',
      startsAt: base.startsAt,
      endsAt: null,
      imageUrl: 'https://img.example/x.jpg',
      fingerprint: 'nocny jazz live|majestic music club|2026-10-10',
      price: 12,
      priceCurrency: 'EUR',
    });
  });

  it('maps Prague to Praha / CZ / CZK', () => {
    const n = normalizeRaw({ ...base, city: 'Prague' });
    expect(n.city).toBe('Praha');
    expect(n.country).toBe('CZ');
    expect(n.currency).toBe('CZK');
    expect(n.priceCurrency).toBe('CZK');
  });

  it('trusts a known city over a conflicting raw country', () => {
    expect(normalizeRaw({ ...base, city: 'Praha', country: 'SK' }).country).toBe('CZ');
  });

  it('uses raw.country for an unknown city', () => {
    const n = normalizeRaw({ ...base, city: 'Poprad', country: 'SK' });
    expect(n.city).toBe('Poprad');
    expect(n.country).toBe('SK');
  });

  it('keeps a source currency that differs from the event currency', () => {
    const n = normalizeRaw({ ...base, city: 'Praha', currency: 'EUR', priceFrom: 35 });
    expect(n.currency).toBe('CZK');
    expect(n.priceCurrency).toBe('EUR');
  });

  it('treats free as 0 and missing/invalid prices as unknown', () => {
    expect(normalizeRaw({ ...base, priceFrom: 0 }).price).toBe(0);
    expect(normalizeRaw({ ...base, priceFrom: 12.5 }).price).toBe(12.5);
    expect(normalizeRaw({ ...base, priceFrom: undefined }).price).toBeNull();
    expect(normalizeRaw({ ...base, priceFrom: null }).price).toBeNull();
    expect(normalizeRaw({ ...base, priceFrom: -5 }).price).toBeNull();
    expect(normalizeRaw({ ...base, priceFrom: Number.NaN }).price).toBeNull();
    expect(normalizeRaw({ ...base, priceFrom: Number.POSITIVE_INFINITY }).price).toBeNull();
  });

  it('keeps a valid endsAt and drops an invalid or earlier one', () => {
    const later = new Date('2026-10-12T18:00:00Z');
    expect(normalizeRaw({ ...base, endsAt: later }).endsAt).toEqual(later);
    expect(normalizeRaw({ ...base, endsAt: new Date('2026-10-10T10:00:00Z') }).endsAt).toBeNull();
    expect(normalizeRaw({ ...base, endsAt: new Date('nope') }).endsAt).toBeNull();
  });

  it('accepts only http(s) image URLs', () => {
    expect(normalizeRaw({ ...base, imageUrl: 'not a url' }).imageUrl).toBeNull();
    expect(normalizeRaw({ ...base, imageUrl: '' }).imageUrl).toBeNull();
    expect(normalizeRaw({ ...base, imageUrl: 'data:image/png;base64,AAAA' }).imageUrl).toBeNull();
    expect(normalizeRaw({ ...base, imageUrl: null }).imageUrl).toBeNull();
  });

  it('rejects titles that normalize to nothing', () => {
    expect(() => normalizeRaw({ ...base, title: '🎉🎉' })).toThrow('empty title');
    expect(() => normalizeRaw({ ...base, title: '!!!' })).toThrow('empty title');
    expect(() => normalizeRaw({ ...base, title: '   ' })).toThrow('empty title');
  });

  it('rejects an invalid startsAt', () => {
    expect(() => normalizeRaw({ ...base, startsAt: new Date('nope') })).toThrow('invalid startsAt');
  });

  it('rejects a blank city and an unknown city without country', () => {
    expect(() => normalizeRaw({ ...base, city: '  ' })).toThrow('empty city');
    expect(() => normalizeRaw({ ...base, city: 'Nowhereville' })).toThrow(/unknown country/);
  });

  it('propagates an invalid source URL', () => {
    expect(() => normalizeRaw({ ...base, sourceUrl: 'nope' })).toThrow();
  });

  it('allows an empty venue', () => {
    expect(normalizeRaw({ ...base, venue: '' }).venue).toBe('');
  });
});
