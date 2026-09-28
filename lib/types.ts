export const GENRES = ['concert', 'electronic', 'theatre', 'exhibition', 'standup', 'sport', 'other'] as const;
export type Genre = (typeof GENRES)[number];

export const COUNTRIES = ['SK', 'CZ'] as const;
export type Country = (typeof COUNTRIES)[number];

export const CURRENCIES = ['EUR', 'CZK'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_BY_COUNTRY: Record<Country, Currency> = { SK: 'EUR', CZ: 'CZK' };

/** What a scraper returns. Everything is untrusted until normalizeRaw() has run. */
export interface RawEvent {
  source: string;
  sourceUrl: string;
  title: string;
  venue: string;
  city: string;
  country?: Country;
  startsAt: Date;
  endsAt?: Date | null;
  priceFrom?: number | null;
  currency?: Currency;
  rawGenre?: string | null;
  imageUrl?: string | null;
}
