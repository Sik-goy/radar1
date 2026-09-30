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

/**
 * Window a URL's jitter is drawn from. Without jitter, every URL scraped in the same run becomes due
 * on the same later run (whichever one first crosses 3 days), so the "every run is cheap" savings
 * this whole skip-logic exists for would collapse right back into one expensive spike every 3 days.
 */
export const PREDPREDAJ_JITTER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic per-URL offset in [0, PREDPREDAJ_JITTER_WINDOW_MS) added to the base refetch interval,
 * so different URLs' due dates spread across a day instead of all landing on the same run. Deterministic
 * (same URL always gets the same offset) so a URL's due date doesn't drift run to run — only a hash of
 * its own canonical form decides it.
 */
export function refetchJitterMs(canonicalUrl: string): number {
  let hash = 5381;
  for (let i = 0; i < canonicalUrl.length; i++) {
    hash = (hash * 33 + canonicalUrl.charCodeAt(i)) >>> 0;
  }
  return hash % PREDPREDAJ_JITTER_WINDOW_MS;
}

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
  /**
   * Every card href actually fetched this run (canonicalized), regardless of whether it parsed into
   * a RawEvent. This is the freshness source of truth the caller persists for the *next* run's
   * knownUrls — not EventSource.url, which a tour card's own href never becomes (only its stops' do).
   */
  fetchedUrls: string[];
  /** Category listing pages fetched — always every requested category; listings are never skipped. */
  listingPagesFetched: number;
  /** Cards never seen before (absent from knownUrls entirely). */
  newUrls: number;
  /** Cards previously seen whose jittered PREDPREDAJ_REFETCH_INTERVAL_MS has elapsed. */
  duePages: number;
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

type RefetchDecision = 'new' | 'due' | 'fresh';

/**
 * `knownUrls` is built from a canonical URL, which ingest.ts stores canonicalized (lib/normalize/url's
 * canonicalizeUrl strips predpredaj's trailing slash, among other things) — so the lookup key must go
 * through the same canonicalization, or every URL looks "never fetched" (a real bug this was: 100% of
 * URLs got re-fetched on a run right after they'd all just been fetched).
 *
 * 'new' (never in the map at all) and 'due' (known, past its own jittered interval) both mean "fetch
 * it" but are counted separately for reporting; 'fresh' means skip.
 */
function classifyRefetch(href: string, knownUrls: Map<string, Date | null> | undefined, now: Date): RefetchDecision {
  const canonical = canonicalizeUrl(href);
  if (!knownUrls?.has(canonical)) return 'new';
  const lastFetched = knownUrls.get(canonical);
  if (!lastFetched) return 'due'; // explicitly null (legacy row, never tracked): always due
  const interval = PREDPREDAJ_REFETCH_INTERVAL_MS + refetchJitterMs(canonical);
  return now.getTime() - lastFetched.getTime() >= interval ? 'due' : 'fresh';
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
  const fetchedUrls: string[] = [];
  let listingPagesFetched = 0;
  let newUrls = 0;
  let duePages = 0;

  for (const category of categories) {
    await wait(delayMs);
    const listingHtml = await fetchText(`${PREDPREDAJ_BASE_URL}/sk/kategoria/${category}/`, fetchImpl);
    listingPagesFetched += 1;
    const allowed = parseCategoryListing(listingHtml).filter((card) => !isDisallowed(card.href, disallowed));

    const toFetch: { card: ListingCard; decision: RefetchDecision }[] = [];
    for (const card of allowed) {
      const decision = classifyRefetch(card.href, options.knownUrls, now);
      if (decision === 'fresh') {
        // Recorded canonicalized too, so runScrape's later `WHERE url IN (touchedUrls)` actually
        // matches the real stored rows.
        touchedUrls.push(canonicalizeUrl(card.href));
      } else {
        toFetch.push({ card, decision });
      }
    }
    // undefined means "no cap" — a full run has no serverless timeout to bound itself against;
    // the cap exists only for smoke tests and manual partial runs (CLI's --max-pages). It bounds real
    // fetches only — a skipped (touched) card never made a request, so it never counts against it.
    const cards = options.maxEventsPerCategory === undefined ? toFetch : toFetch.slice(0, options.maxEventsPerCategory);

    for (const { card, decision } of cards) {
      await wait(delayMs);
      fetchedUrls.push(canonicalizeUrl(card.href));
      if (decision === 'new') newUrls += 1;
      else duePages += 1;
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

  return { raws, touchedUrls, fetchedUrls, listingPagesFetched, newUrls, duePages };
}
