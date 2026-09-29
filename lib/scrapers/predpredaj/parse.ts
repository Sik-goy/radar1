import * as cheerio from 'cheerio';
import {
  decodeHtmlEntities,
  minPriceFromText,
  parseIsoLikeDateTime,
  parseSlovakDateTime,
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
    const url = new URL(href, PREDPREDAJ_BASE_URL);
    if (!url.pathname.startsWith('/sk/listky/')) {
      // The category page also links a handful of non-event cards (external presale pages, a
      // gift-voucher promo) through the same .box-item-btn markup. Not garbage worth a warning —
      // just not an event.
      console.debug(`[predpredaj] ignoring non-event card: ${url.toString()}`);
      return;
    }
    const title = decodeHtmlEntities($link.closest('.box-content').find('.box-item-title span').first().text().trim());
    cards.push({ title, href: url.toString() });
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

/**
 * A second, more aggressive repair pass used only when the plain control-character fix still
 * doesn't parse. Handles both raw control characters *and* an unescaped quote inside a string value
 * (e.g. a quoted phrase in a description the site forgot to escape) in one traversal — running them
 * as two independent passes doesn't compose: the first pass's (wrong) idea of where a string ends
 * leaves later content — including further control characters — outside its view entirely.
 */
function sanitizeJsonLdAggressive(raw: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString && !escaped) {
      if (ch === '\n' || ch === '\r' || ch === '\t') {
        result += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
        continue;
      }
      if (ch === '"') {
        // Look ahead past whitespace: a real string terminator is followed by a JSON structural
        // character. Anything else means this quote was content that should have been escaped.
        let j = i + 1;
        while (j < raw.length && /\s/.test(raw[j])) j++;
        const next = raw[j];
        const looksLikeRealEnd = next === undefined || next === ',' || next === '}' || next === ']' || next === ':';
        if (looksLikeRealEnd) {
          inString = false;
          result += ch;
        } else {
          result += '\\"';
        }
        continue;
      }
    }
    result += ch;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
    } else if (ch === '"') {
      inString = true;
    }
  }
  return result;
}

function tryParseJsonLd(text: string): JsonLdEvent | JsonLdEvent[] | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Returns null when the JSON-LD block is absent or unrecoverable — the caller falls back to the DOM. */
function readJsonLd($: ReturnType<typeof cheerio.load>): JsonLdEvent | null {
  const raw = $('script[type="application/ld+json"]').first().html();
  if (!raw) return null;
  const parsed = tryParseJsonLd(sanitizeJsonLd(raw)) ?? tryParseJsonLd(sanitizeJsonLdAggressive(raw));
  if (parsed === null) return null;
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function fallbackImageUrl($: ReturnType<typeof cheerio.load>): string | null {
  return $('meta[property="og:image"]').attr('content') ?? null;
}

function parseTourStopsFromDom($: ReturnType<typeof cheerio.load>): ParsedTourStop[] {
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
  return stops;
}

/** Last-resort single-date parser straight off the visible page, used when JSON-LD is unrecoverable. */
function parseSingleDateFromDom(
  $: ReturnType<typeof cheerio.load>,
): { title: string; startsAt: Date; venue: string; city: string } | null {
  const title = decodeHtmlEntities($('h1').first().text().trim());
  const infoText = $('p.mb-4').first().text().trim();
  const m = infoText.match(/^(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})\s*(.+)$/s);
  if (!title || !m) return null;
  const { venue, cityRaw } = splitAddress(m[2].trim());
  return { title, startsAt: parseSlovakDateTime(m[1]), venue, city: stripPostalCode(cityRaw) };
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
 * `startDate`: populated means a real single date+place; empty means a tour hub page whose real
 * per-stop data lives in the `li.list-group-item` list instead.
 *
 * predpredaj's own JSON-LD is sometimes invalid (a stray raw control character, or — observed live —
 * an unescaped quote inside a description). `readJsonLd` already retries with two escalating repairs;
 * if both fail (or there is no JSON-LD block at all), this falls all the way back to parsing the
 * visible page: tour stops never needed JSON-LD to begin with, and a single-date page without usable
 * JSON-LD still has its title/date/venue rendered in `h1`/`p.mb-4`, just without the free city split
 * JSON-LD's `location.address` gives — `parseSingleDateFromDom` recovers it with the same
 * postal-code-stripping the tour-stop path already uses.
 */
export function parseEventDetail(html: string): ParsedEventDetail {
  const $ = cheerio.load(html);
  const jsonLd = readJsonLd($);

  if (jsonLd?.startDate) {
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

  const stops = parseTourStopsFromDom($);
  if (stops.length > 0) {
    return { kind: 'tour', stops, imageUrl: jsonLd?.image || fallbackImageUrl($) };
  }

  const domSingle = parseSingleDateFromDom($);
  if (domSingle) {
    return { kind: 'single', ...domSingle, imageUrl: jsonLd?.image || fallbackImageUrl($), priceFrom: parsePriceTiers($) };
  }

  throw new Error('unrecognized event page shape (no usable JSON-LD, no tour stops, no single-date markup)');
}
