import { CURRENCY_BY_COUNTRY, type Country, type Currency, type Genre, type RawEvent } from '@/lib/types';
import { countryForCity, normalizeCity } from '@/lib/normalize/city';
import { fingerprint } from '@/lib/normalize/fingerprint';
import { normalizeGenre } from '@/lib/normalize/genre';
import { normalizeText } from '@/lib/normalize/text';
import { canonicalizeUrl } from '@/lib/normalize/url';

export interface NormalizedEvent {
  sourceSlug: string;
  url: string;
  title: string;
  venue: string;
  city: string;
  country: Country;
  currency: Currency;
  genre: Genre;
  startsAt: Date;
  endsAt: Date | null;
  imageUrl: string | null;
  fingerprint: string;
  price: number | null;
  priceCurrency: Currency;
}

const isValidDate = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

export function normalizeRaw(raw: RawEvent): NormalizedEvent {
  const title = raw.title.replace(/\s+/g, ' ').trim();
  if (!normalizeText(title)) throw new Error('empty title');
  if (!isValidDate(raw.startsAt)) throw new Error('invalid startsAt');

  const city = normalizeCity(raw.city);
  if (!city) throw new Error('empty city');
  const country = countryForCity(city) ?? raw.country;
  if (!country) throw new Error(`unknown country for city "${city}"`);

  const currency = CURRENCY_BY_COUNTRY[country];
  const venue = raw.venue.replace(/\s+/g, ' ').trim();
  const price =
    typeof raw.priceFrom === 'number' && Number.isFinite(raw.priceFrom) && raw.priceFrom >= 0
      ? Math.round(raw.priceFrom * 100) / 100
      : null;
  const endsAt = isValidDate(raw.endsAt) && raw.endsAt > raw.startsAt ? raw.endsAt : null;
  const imageUrl = raw.imageUrl && /^https?:\/\//i.test(raw.imageUrl.trim()) ? raw.imageUrl.trim() : null;

  return {
    sourceSlug: raw.source,
    url: canonicalizeUrl(raw.sourceUrl),
    title,
    venue,
    city,
    country,
    currency,
    genre: normalizeGenre(raw.rawGenre),
    startsAt: raw.startsAt,
    endsAt,
    imageUrl,
    fingerprint: fingerprint(title, venue, raw.startsAt),
    price,
    priceCurrency: raw.currency ?? currency,
  };
}
