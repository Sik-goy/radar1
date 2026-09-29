import * as cheerio from 'cheerio';
import {
  decodeHtmlEntities,
  minPriceFromText,
  parseIsoLikeDateTime,
  splitAddress,
  splitDateAndAddress,
  stripPostalCode,
} from '@/lib/scrapers/predpredaj/text';

export const PREDPREDAJ_CATEGORIES = ['koncert', 'sport', 'show', 'divadlo', 'festival', 'pre-deti', 'ostatne'] as const;
export type PredpredajCategory = (typeof PREDPREDAJ_CATEGORIES)[number];

export const PREDPREDAJ_CATEGORY_LABEL: Record<PredpredajCategory, string> = {
  koncert: 'Koncert',
  sport: 'Šport',
  show: 'Show',
  divadlo: 'Divadlo',
  festival: 'Festival',
  'pre-deti': 'Pre deti',
  ostatne: 'Ostatné',
};

export const PREDPREDAJ_BASE_URL = 'https://predpredaj.zoznam.sk';

export interface ListingCard {
  title: string;
  href: string;
}

/** Parses a /sk/kategoria/{slug}/ listing page into its event cards. */
export function parseCategoryListing(html: string): ListingCard[] {
  const $ = cheerio.load(html);
  const cards: ListingCard[] = [];
  $('.box-item-btn').each((_, el) => {
    const $link = $(el);
    const href = $link.attr('href');
    if (!href) return;
    const title = decodeHtmlEntities($link.closest('.box-content').find('.box-item-title span').first().text().trim());
    cards.push({ title, href: new URL(href, PREDPREDAJ_BASE_URL).toString() });
  });
  return cards;
}

export interface ParsedSingleDateEvent {
  kind: 'single';
  title: string;
  startsAt: Date;
  venue: string;
  city: string;
  imageUrl: string | null;
  priceFrom: number | null;
}

export interface ParsedTourStop {
  title: string;
  startsAt: Date;
  venue: string;
  city: string;
  href: string;
}

export interface ParsedTour {
  kind: 'tour';
  stops: ParsedTourStop[];
  imageUrl: string | null;
}

export type ParsedEventDetail = ParsedSingleDateEvent | ParsedTour;

interface JsonLdEvent {
  name: string;
  startDate: string;
  location: { name: string; address: string };
  image: string;
}

/**
 * predpredaj's JSON-LD sometimes embeds a raw newline/tab inside a string value (e.g. the
 * `description` field), which is invalid JSON — real browsers' `JSON.parse` would reject it too.
 * Escape control characters that occur inside string literals before parsing.
 */
function sanitizeJsonLd(raw: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const ch of raw) {
    if (inString && !escaped && (ch === '\n' || ch === '\r' || ch === '\t')) {
      result += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
      continue;
    }
    result += ch;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    }
  }
  return result;
}

function readJsonLd($: ReturnType<typeof cheerio.load>): JsonLdEvent {
  const raw = $('script[type="application/ld+json"]').first().html() ?? '[]';
  const parsed = JSON.parse(sanitizeJsonLd(raw)) as JsonLdEvent | JsonLdEvent[];
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function parsePriceTiers($: ReturnType<typeof cheerio.load>): number | null {
  const blocks: string[] = [];
  $('small.color-blue').each((_, el) => {
    if ($(el).text().trim() !== 'Cena') return;
    blocks.push($(el).parent().text());
  });
  return minPriceFromText(blocks);
}

/**
 * Parses a /sk/listky/{slug}/ event page. Single-date vs. tour is decided by JSON-LD's
 * `startDate`: populated means a real single date+place; empty means a tour hub page whose
 * real per-stop data lives in the `li.list-group-item` list instead.
 */
export function parseEventDetail(html: string): ParsedEventDetail {
  const $ = cheerio.load(html);
  const jsonLd = readJsonLd($);

  if (jsonLd.startDate) {
    const { venue } = splitAddress(decodeHtmlEntities(jsonLd.location.name));
    return {
      kind: 'single',
      title: decodeHtmlEntities(jsonLd.name),
      startsAt: parseIsoLikeDateTime(jsonLd.startDate),
      venue,
      city: decodeHtmlEntities(jsonLd.location.address),
      imageUrl: jsonLd.image || null,
      priceFrom: parsePriceTiers($),
    };
  }

  const stops: ParsedTourStop[] = [];
  $('li.list-group-item > a[href^="/sk/listky/"]').each((_, el) => {
    const $stop = $(el);
    const href = $stop.attr('href');
    const title = decodeHtmlEntities($stop.find('strong').first().text().trim());
    const spanText = $stop.find('span.text-readable').first().text();
    if (!href || !title || !spanText) return;
    const { startsAt, address } = splitDateAndAddress(spanText);
    const { venue, cityRaw } = splitAddress(address);
    stops.push({
      title,
      startsAt,
      venue,
      city: stripPostalCode(cityRaw),
      href: new URL(href, PREDPREDAJ_BASE_URL).toString(),
    });
  });

  return { kind: 'tour', stops, imageUrl: jsonLd.image || null };
}
