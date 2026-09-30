import { canonicalizeUrl } from '@/lib/normalize/url';
import {
  PREDPREDAJ_BASE_URL,
  PREDPREDAJ_CATEGORIES,
  PREDPREDAJ_CATEGORY_LABEL,
  parseCategoryListing,
  parseEventDetail,
  type ListingCard,
  type PredpredajCategory,
} from '@/lib/scrapers/predpredaj/parse';
import type { RawEvent } from '@/lib/types';

const USER_AGENT = 'RadarBot/0.1 (+https://github.com/Sik-goy/radar1; contact: matejn2012@gmail.com)';
const DEFAULT_DELAY_MS = 1500;

/**
 * How often a known URL's detail page is re-fetched. Below this, its page is assumed unchanged and
 * only EventSource.lastSeenAt is bumped (from the listing, no detail fetch) — one threshold covers
 * both "skip anything fetched very recently" and "never go more than a few days without a real
 * refresh": a URL touched more often than this never crosses the gate, one touched less often always
 * does. Must be checked against `lastDetailFetchedAt`, never `lastSeenAt` — a listing-only touch would
 * make lastSeenAt look permanently fresh under a schedule that runs more often than this interval,
 * and a re-fetch would never become due.
 */
export const PREDPREDAJ_REFETCH_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

export interface ScrapePredpredajOptions {
  categories?: PredpredajCategory[];
  maxEventsPerCategory?: number;
  delayMs?: number;
  fetchImpl?: typeof fetch;
  /** url -> last time its detail page was actually fetched. Absent or null means "never — always fetch". */
  knownUrls?: Map<string, Date | null>;
  now?: Date;
}

export interface ScrapePredpredajResult {
  raws: RawEvent[];
  /** Listed but not re-fetched this run (still within PREDPREDAJ_REFETCH_INTERVAL_MS) — the caller should bump their lastSeenAt directly, since no RawEvent exists for them. */
  touchedUrls: string[];
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

/**
 * `knownUrls` is built from EventSource.url, which ingest.ts stores canonicalized (lib/normalize/url's
 * canonicalizeUrl strips predpredaj's trailing slash, among other things) — so the lookup key must go
 * through the same canonicalization, or every URL looks "never fetched" (a real bug this was: 100% of
 * URLs got re-fetched on a run right after they'd all just been fetched).
 */
function needsRefetch(href: string, knownUrls: Map<string, Date | null> | undefined, now: Date): boolean {
  const lastFetched = knownUrls?.get(canonicalizeUrl(href));
  if (!lastFetched) return true; // never in the map, or explicitly null (legacy row): always due
  return now.getTime() - lastFetched.getTime() >= PREDPREDAJ_REFETCH_INTERVAL_MS;
}

/** Scrapes predpredaj.zoznam.sk: one or more categories, sequentially, with a delay before every request. */
export async function scrapePredpredaj(options: ScrapePredpredajOptions = {}): Promise<ScrapePredpredajResult> {
  const categories = options.categories ?? [...PREDPREDAJ_CATEGORIES];
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();

  const disallowed = await loadDisallowedPatterns(fetchImpl);
  const raws: RawEvent[] = [];
  const touchedUrls: string[] = [];

  for (const category of categories) {
    await wait(delayMs);
    const listingHtml = await fetchText(`${PREDPREDAJ_BASE_URL}/sk/kategoria/${category}/`, fetchImpl);
    const allowed = parseCategoryListing(listingHtml).filter((card) => !isDisallowed(card.href, disallowed));

    const toFetch: ListingCard[] = [];
    for (const card of allowed) {
      if (needsRefetch(card.href, options.knownUrls, now)) toFetch.push(card);
      // Recorded canonicalized too, so runScrape's later `WHERE url IN (touchedUrls)` actually matches
      // the real stored rows.
      else touchedUrls.push(canonicalizeUrl(card.href));
    }
    // undefined means "no cap" — a full run has no serverless timeout to bound itself against;
    // the cap exists only for smoke tests and manual partial runs (CLI's --max-pages). It bounds real
    // fetches only — a skipped (touched) card never made a request, so it never counts against it.
    const cards = options.maxEventsPerCategory === undefined ? toFetch : toFetch.slice(0, options.maxEventsPerCategory);

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

  return { raws, touchedUrls };
}
