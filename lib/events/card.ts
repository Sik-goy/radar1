import type { Country, Currency, Genre } from '@/lib/types';

type DecimalLike = { toNumber(): number };

export interface EventRow {
  id: string;
  title: string;
  venue: string;
  city: string;
  country: Country;
  startsAt: Date;
  endsAt: Date | null;
  priceFrom: DecimalLike | null;
  currency: Currency;
  genre: Genre;
  imageUrl: string | null;
  sources: {
    id: string;
    url: string;
    priceFrom: DecimalLike | null;
    currency: Currency;
    source: { name: string };
  }[];
}

export interface EventSourceView {
  id: string;
  sourceName: string;
  url: string;
  priceFrom: number | null;
  currency: Currency;
}

export interface EventCardData extends Omit<EventRow, 'priceFrom' | 'sources'> {
  priceFrom: number | null;
  sources: EventSourceView[];
}

function compareSources(currency: Currency) {
  return (a: EventSourceView, b: EventSourceView): number =>
    Number(a.currency !== currency) - Number(b.currency !== currency) ||
    Number(a.priceFrom === null) - Number(b.priceFrom === null) ||
    (a.priceFrom ?? 0) - (b.priceFrom ?? 0) ||
    a.sourceName.localeCompare(b.sourceName);
}

export function toEventCard(row: EventRow): EventCardData {
  return {
    id: row.id,
    title: row.title,
    venue: row.venue,
    city: row.city,
    country: row.country,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    priceFrom: row.priceFrom ? row.priceFrom.toNumber() : null,
    currency: row.currency,
    genre: row.genre,
    imageUrl: row.imageUrl,
    sources: row.sources
      .map((s) => ({
        id: s.id,
        sourceName: s.source.name,
        url: s.url,
        priceFrom: s.priceFrom ? s.priceFrom.toNumber() : null,
        currency: s.currency,
      }))
      .sort(compareSources(row.currency)),
  };
}
