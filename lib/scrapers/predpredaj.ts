import {
  PREDPREDAJ_BASE_URL,
  PREDPREDAJ_CATEGORIES,
  PREDPREDAJ_CATEGORY_LABEL,
  parseCategoryListing,
  parseEventDetail,
  type PredpredajCategory,
} from '@/lib/scrapers/predpredaj/parse';
import type { RawEvent } from '@/lib/types';

const USER_AGENT = 'RadarBot/0.1 (+https://github.com/Sik-goy/radar1; contact: matejn2012@gmail.com)';
const DEFAULT_DELAY_MS = 1500;

export interface ScrapePredpredajOptions {
  categories?: PredpredajCategory[];
  maxEventsPerCategory?: number;
  delayMs?: number;
  fetchImpl?: typeof fetch;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.text();
}

async function loadDisallowedPatterns(fetchImpl: typeof fetch): Promise<string[]> {
  try {
    const text = await fetchText(`${PREDPREDAJ_BASE_URL}/robots.txt`, fetchImpl);
    return text
      .split('\n')
      .filter((line) => line.trim().toLowerCase().startsWith('disallow:'))
      .map((line) => line.slice(line.indexOf(':') + 1).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function robotsPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}`);
}

function isDisallowed(url: string, patterns: string[]): boolean {
  const path = new URL(url).pathname;
  return patterns.some((pattern) => robotsPatternToRegExp(pattern).test(path));
}

function toRawEvent(
  category: PredpredajCategory,
  sourceUrl: string,
  fields: { title: string; startsAt: Date; venue: string; city: string; imageUrl: string | null; priceFrom: number | null },
): RawEvent {
  return {
    source: 'predpredaj',
    sourceUrl,
    title: fields.title,
    venue: fields.venue,
    city: fields.city,
    country: 'SK',
    currency: 'EUR',
    startsAt: fields.startsAt,
    priceFrom: fields.priceFrom,
    rawGenre: PREDPREDAJ_CATEGORY_LABEL[category],
    imageUrl: fields.imageUrl,
  };
}

/** Scrapes predpredaj.zoznam.sk: one or more categories, sequentially, with a delay before every request. */
export async function scrapePredpredaj(options: ScrapePredpredajOptions = {}): Promise<RawEvent[]> {
  const categories = options.categories ?? [...PREDPREDAJ_CATEGORIES];
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const disallowed = await loadDisallowedPatterns(fetchImpl);
  const raws: RawEvent[] = [];

  for (const category of categories) {
    await wait(delayMs);
    const listingHtml = await fetchText(`${PREDPREDAJ_BASE_URL}/sk/kategoria/${category}/`, fetchImpl);
    const allowed = parseCategoryListing(listingHtml).filter((card) => !isDisallowed(card.href, disallowed));
    // undefined means "no cap" — a full run has no serverless timeout to bound itself against;
    // the cap exists only for smoke tests and manual partial runs (CLI's --max-pages).
    const cards = options.maxEventsPerCategory === undefined ? allowed : allowed.slice(0, options.maxEventsPerCategory);

    for (const card of cards) {
      await wait(delayMs);
      let detailHtml: string;
      try {
        detailHtml = await fetchText(card.href, fetchImpl);
      } catch {
        continue; // one bad item never aborts the crawl
      }

      let detail: ReturnType<typeof parseEventDetail>;
      try {
        detail = parseEventDetail(detailHtml);
      } catch (e) {
        // Real predpredaj pages sometimes embed invalid JSON-LD (e.g. an unescaped quote inside a
        // description) that no amount of sanitizing can safely recover. One bad item never aborts the crawl.
        console.warn(`[predpredaj] skipping ${card.href}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      if (detail.kind === 'single') {
        raws.push(toRawEvent(category, card.href, detail));
      } else {
        for (const stop of detail.stops) {
          raws.push(toRawEvent(category, stop.href, { ...stop, imageUrl: detail.imageUrl, priceFrom: null }));
        }
      }
    }
  }

  return raws;
}
