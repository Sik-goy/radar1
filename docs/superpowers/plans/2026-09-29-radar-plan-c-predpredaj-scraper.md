# Radar Plan C′: Predpredaj Scraper + Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working `predpredaj.zoznam.sk` scraper (`lib/scrapers/predpredaj.ts`) feeding the existing `upsertRawEvents` pipeline, a `/api/cron/scrape` route with bearer auth and per-category chunking, a `vercel.json` cron schedule, and a live smoke run against the Neon dev branch that reports real dedupe behavior.

**Architecture:** Three pure/testable layers under `lib/scrapers/predpredaj/`: string parsing (`text.ts`, no DOM), DOM/JSON-LD parsing against saved fixtures (`parse.ts`, no network), then a thin network-and-delay orchestration layer (`lib/scrapers/predpredaj.ts`) that assembles `RawEvent[]`. The cron route (`app/api/cron/scrape/route.ts`) is a thin wrapper: auth check, call the scraper for one category, call `upsertRawEvents`, update `Source.lastScrapedAt`. `vercel.json` fans the six-hourly tick out to one call per category so no single invocation risks a serverless timeout.

**Tech Stack:** Same as plan 1 (Next.js 15, TypeScript strict, Prisma, Vitest) plus `cheerio` for HTML parsing (already the spec's chosen library, not previously installed) and `@date-fns/tz`'s `TZDate` (already a dependency) for Prague-time date construction.

**Spec:** `docs/superpowers/specs/2026-09-28-radar-design.md` — read the whole "Addendum (2026-09-29)" section before starting; it documents the real site structure (verified against live fixtures, not assumed) this plan's code depends on.

## Global Constraints

- Node 20+. Scripts are npm + `tsx` only; no bash-only steps.
- `predpredaj.zoznam.sk` is SK-only. Every `RawEvent` this scraper emits sets `country: 'SK'` explicitly — most Slovak towns it covers are outside `lib/normalize/city.ts`'s 8-city `CITIES` table, and `normalizeRaw` throws `unknown country for city "X"` when neither the city table nor `raw.country` supplies one.
- `RawEvent.currency` is always `'EUR'`.
- `User-Agent` on every request names the project and a contact email. 1–2s delay before every request (category listing and detail pages alike) — never `Promise.all` across requests. `robots.txt` is fetched fresh each run and its `Disallow:` entries (as of 2026-09-29: five specific stale 2020 event slugs) are honored, skipping the detail-page fetch entirely for a disallowed URL, not just excluding it after the fact.
- Descriptions are never scraped. Images are hotlinked (predpredaj's own URL), never rehosted.
- Genre: the crawled category's Slovak display name (`Koncert`, `Šport`, `Divadlo`, `Festival`, `Show`, `Pre deti`, `Ostatné`) is passed straight through as `RawEvent.rawGenre` — verified against the real keyword rules in `lib/normalize/genre.ts` to already resolve correctly (`Koncert`/`Festival` → `concert`, `Šport` → `sport`, `Divadlo` → `theatre`, the rest → `other`). No separate mapping table, no bypass of `normalizeGenre`.
- Tour-stop events (see below) always get `priceFrom: null` — price tiers only render on single-date pages, never on a tour's hub page.
- `/api/cron/scrape` requires `Authorization: Bearer $CRON_SECRET` and a required `?category=` query param, one of the 7 category slugs (`koncert`, `sport`, `show`, `divadlo`, `festival`, `pre-deti`, `ostatne`) — there is no whole-site mode. An optional `?maxEvents=` overrides the per-run cap.
- Cron chunking: `vercel.json` defines seven cron entries, one per category, at `0,8,16,24,32,40,48 */6 * * *` minute offsets (koncert=0, sport=8, show=16, divadlo=24, festival=32, pre-deti=40, ostatne=48) so they never overlap. Default cap is `PREDPREDAJ_MAX_EVENTS_PER_CATEGORY` (env var, default 30) detail-page fetches per run.
- Commits: conventional-commit subject, ending with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Browsing the live site (if ever needed beyond the saved fixtures) is done with the `/browse` skill only.

## Review Focus

Inputs the spec implies but does not spell out for every task's tests. Each has a pinning test in the task named.

1. A small Slovak town outside the 8-city `CITIES` table (e.g. `Bardejov`, `Senec`) must not crash the ingest pipeline — `country: 'SK'` must be set on every emitted `RawEvent`, not left to city-table inference. (Task 3)
2. Tour-page vs. single-date-page detection must key off the JSON-LD `startDate` being empty, not off `li.list-group-item` merely being present on the page — that class name is reused elsewhere (a single-date page fixture has 14 unrelated `li.list-group-item` elements, zero of them tour stops). (Task 2)
3. JSON-LD string values on this site are themselves HTML-entity-escaped (`"Diana Damrau \&amp; ..."` literally, not a real `&`) — every JSON-LD string needs decoding, or titles/venues render with literal escape sequences. (Task 1, consumed by Task 2)
4. A `robots.txt`-disallowed URL must be skipped before its detail page is ever fetched, not filtered out of the result afterward — this is a network-courtesy requirement, not just a data-correctness one. (Task 3)
5. `maxEventsPerCategory` must cap the number of *detail-page fetches actually made*, not just the length of the returned array — the cap exists specifically to bound cron runtime, and a bug that still fetches everything but truncates the output defeats its purpose. (Task 3)

---

## File Structure

```
lib/scrapers/predpredaj/text.ts        pure string/date/price parsing, no DOM
lib/scrapers/predpredaj/parse.ts       cheerio + JSON-LD parsing (category listing, event detail)
lib/scrapers/predpredaj.ts             network orchestration: scrapePredpredaj()
lib/scrapers/__fixtures__/             3 real saved pages (already committed)
app/api/cron/scrape/route.ts           bearer-auth cron endpoint
vercel.json                            7 staggered cron entries
scripts/smoke-predpredaj.ts            live smoke-test script (not part of `npm test`)
```

Tests sit next to the code as `*.test.ts`, except the route test at `app/api/cron/scrape/route.test.ts`.

---

### Task 1: Pure text, date and price helpers

**Files:**
- Create: `lib/scrapers/predpredaj/text.ts`
- Test: `lib/scrapers/predpredaj/text.test.ts`

**Interfaces:**
- Consumes: `TZDate` from `@date-fns/tz`, `TZ` from `@/lib/dates`.
- Produces: `decodeHtmlEntities(input: string): string`, `splitAddress(address: string): { venue: string; cityRaw: string }`, `stripPostalCode(cityRaw: string): string`, `parseSlovakDateTime(input: string): Date`, `parseIsoLikeDateTime(input: string): Date`, `splitDateAndAddress(spanText: string): { startsAt: Date; address: string }`, `minPriceFromText(blocks: string[]): number | null`.

- [ ] **Step 1: Write the failing tests**

`lib/scrapers/predpredaj/text.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  decodeHtmlEntities,
  minPriceFromText,
  parseIsoLikeDateTime,
  parseSlovakDateTime,
  splitAddress,
  splitDateAndAddress,
  stripPostalCode,
} from '@/lib/scrapers/predpredaj/text';

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('Diana Damrau &amp; Slovenská filharmónia')).toBe('Diana Damrau & Slovenská filharmónia');
    expect(decodeHtmlEntities('&#39;quoted&#39;')).toBe("'quoted'");
    expect(decodeHtmlEntities('&lt;b&gt;')).toBe('<b>');
  });

  it('leaves plain text untouched', () => {
    expect(decodeHtmlEntities('Juraj HNILICA – Bardejov')).toBe('Juraj HNILICA – Bardejov');
  });
});

describe('splitAddress', () => {
  it('takes the first comma segment as venue, the last as the raw city', () => {
    expect(splitAddress('Hotel Astória, Bardejovské Kúpele, 086 31 Bardejov')).toEqual({
      venue: 'Hotel Astória',
      cityRaw: '086 31 Bardejov',
    });
  });

  it('works with only venue and city, no street', () => {
    expect(splitAddress('Námestie pred Pradiarňou 1900, Páričkova ulica, Bratislava')).toEqual({
      venue: 'Námestie pred Pradiarňou 1900',
      cityRaw: 'Bratislava',
    });
  });
});

describe('stripPostalCode', () => {
  it('strips a "NNN NN " prefix', () => {
    expect(stripPostalCode('086 31 Bardejov')).toBe('Bardejov');
  });

  it('handles a double space after the code', () => {
    expect(stripPostalCode('080 01  Prešov')).toBe('Prešov');
  });

  it('is a no-op when there is no postal code', () => {
    expect(stripPostalCode('Bratislava')).toBe('Bratislava');
  });
});

describe('parseSlovakDateTime', () => {
  it('parses "DD.MM.YYYY HH:MM" as Europe/Prague wall-clock time', () => {
    expect(parseSlovakDateTime('05.12.2026 17:00').toISOString()).toBe('2026-12-05T16:00:00.000Z');
  });

  it('throws on an unrecognized format', () => {
    expect(() => parseSlovakDateTime('2026-12-05 17:00')).toThrow();
  });
});

describe('parseIsoLikeDateTime', () => {
  it('parses JSON-LD\'s "YYYY-MM-DD HH:MM" as Europe/Prague wall-clock time', () => {
    expect(parseIsoLikeDateTime('2026-11-06 19:00').toISOString()).toBe('2026-11-06T18:00:00.000Z');
  });

  it('throws on an unrecognized format', () => {
    expect(() => parseIsoLikeDateTime('06.11.2026 19:00')).toThrow();
  });
});

describe('splitDateAndAddress', () => {
  it('splits a tour stop\'s "date time - address" span text', () => {
    expect(splitDateAndAddress('05.12.2026 17:00 - PKO Čierny Orol, Hlavná 50, 080 01  Prešov')).toEqual({
      startsAt: parseSlovakDateTime('05.12.2026 17:00'),
      address: 'PKO Čierny Orol, Hlavná 50, 080 01  Prešov',
    });
  });

  it('trims surrounding whitespace', () => {
    const result = splitDateAndAddress('  12.12.2026 17:00 - Dom Armády (ODA), Hviezdoslavova 205/16, 911 01 Trenčín  ');
    expect(result.address).toBe('Dom Armády (ODA), Hviezdoslavova 205/16, 911 01 Trenčín');
  });
});

describe('minPriceFromText', () => {
  it('finds the minimum comma-decimal price across several blocks', () => {
    expect(minPriceFromText(['129,00€', '109,00€', '89,00€', '29,00€', '49,00€', '49,00€', '29,00€'])).toBe(29);
  });

  it('handles a single tier', () => {
    expect(minPriceFromText(['Cena\n15,00 €'])).toBe(15);
  });

  it('is null with no price blocks', () => {
    expect(minPriceFromText([])).toBeNull();
  });

  it('ignores blocks with no price in them', () => {
    expect(minPriceFromText(['no price here'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/scrapers/predpredaj/text.test.ts`
Expected: FAIL, cannot resolve `@/lib/scrapers/predpredaj/text`.

- [ ] **Step 3: Implement**

`lib/scrapers/predpredaj/text.ts`:
```ts
import { TZDate } from '@date-fns/tz';
import { TZ } from '@/lib/dates';

/** Decodes the handful of HTML entities predpredaj embeds inside its JSON-LD string values (a site-wide escaping quirk, not spec-compliant JSON-LD). */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

/** Splits a comma-joined "<venue>, <street>, <city>" address. The city segment is returned as-is (may still carry a postal code prefix). */
export function splitAddress(address: string): { venue: string; cityRaw: string } {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return { venue: parts[0] ?? '', cityRaw: parts[parts.length - 1] ?? '' };
}

/** Strips a Slovak postal code ("NNN NN") prefix, e.g. "080 01  Prešov" -> "Prešov". */
export function stripPostalCode(cityRaw: string): string {
  return cityRaw.replace(/^\d{3}\s?\d{2}\s+/, '').trim();
}

function buildPragueDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(new TZDate(year, month - 1, day, hour, minute, 0, TZ).getTime());
}

/** Parses a tour stop's "DD.MM.YYYY HH:MM" format. */
export function parseSlovakDateTime(input: string): Date {
  const m = input.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`invalid Slovak date/time: "${input}"`);
  const [, day, month, year, hour, minute] = m;
  return buildPragueDate(Number(year), Number(month), Number(day), Number(hour), Number(minute));
}

/** Parses JSON-LD's "YYYY-MM-DD HH:MM" `startDate` format. */
export function parseIsoLikeDateTime(input: string): Date {
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`invalid JSON-LD startDate: "${input}"`);
  const [, year, month, day, hour, minute] = m;
  return buildPragueDate(Number(year), Number(month), Number(day), Number(hour), Number(minute));
}

/** Splits a tour stop's "DD.MM.YYYY HH:MM - <address>" span text. */
export function splitDateAndAddress(spanText: string): { startsAt: Date; address: string } {
  const m = spanText.trim().match(/^(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})\s+-\s+(.+)$/);
  if (!m) throw new Error(`unrecognized tour-stop text: "${spanText}"`);
  return { startsAt: parseSlovakDateTime(m[1]), address: m[2].trim() };
}

/** The minimum "X,XX" price found across a set of text blocks, or null if none contain a price. */
export function minPriceFromText(blocks: string[]): number | null {
  const prices: number[] = [];
  for (const block of blocks) {
    const m = block.match(/(\d+),(\d{2})/);
    if (m) prices.push(Number(`${m[1]}.${m[2]}`));
  }
  return prices.length ? Math.min(...prices) : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/scrapers/predpredaj/text.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scrapers/predpredaj/text.ts lib/scrapers/predpredaj/text.test.ts
git commit -m "feat: add predpredaj text/date/price parsing helpers"
```

---

### Task 2: Category listing and event-detail DOM parsing

**Files:**
- Create: `lib/scrapers/predpredaj/parse.ts`
- Test: `lib/scrapers/predpredaj/parse.test.ts`
- Fixtures (already committed): `lib/scrapers/__fixtures__/predpredaj-category-koncert.html`, `lib/scrapers/__fixtures__/predpredaj-event-single.html`, `lib/scrapers/__fixtures__/predpredaj-event-tour.html`

**Interfaces:**
- Consumes: `decodeHtmlEntities`, `minPriceFromText`, `parseIsoLikeDateTime`, `splitAddress`, `splitDateAndAddress`, `stripPostalCode` from `@/lib/scrapers/predpredaj/text`.
- Produces: `PREDPREDAJ_CATEGORIES`, `type PredpredajCategory`, `PREDPREDAJ_CATEGORY_LABEL: Record<PredpredajCategory, string>`, `interface ListingCard { title: string; href: string }`, `parseCategoryListing(html: string): ListingCard[]`, `interface ParsedSingleDateEvent { kind: 'single'; title: string; startsAt: Date; venue: string; city: string; imageUrl: string | null; priceFrom: number | null }`, `interface ParsedTourStop { title: string; startsAt: Date; venue: string; city: string; href: string }`, `interface ParsedTour { kind: 'tour'; stops: ParsedTourStop[]; imageUrl: string | null }`, `type ParsedEventDetail = ParsedSingleDateEvent | ParsedTour`, `parseEventDetail(html: string): ParsedEventDetail`.

- [ ] **Step 1: Install cheerio**

```bash
npm install cheerio
```

- [ ] **Step 2: Confirm the fixtures are in place**

Run: `ls lib/scrapers/__fixtures__/`
Expected: the three files listed above.

- [ ] **Step 3: Write the failing tests**

`lib/scrapers/predpredaj/parse.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCategoryListing, parseEventDetail } from '@/lib/scrapers/predpredaj/parse';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf-8');

describe('parseCategoryListing', () => {
  const cards = parseCategoryListing(fixture('predpredaj-category-koncert.html'));

  it('parses every event card on the page', () => {
    expect(cards).toHaveLength(80);
  });

  it('gets the title and absolute detail-page URL right', () => {
    expect(cards[0]).toEqual({
      title: 'Filip Jančík - Dokonalé Vianoce 2026',
      href: 'https://predpredaj.zoznam.sk/sk/listky/filip-jancik-dokonale-vianoce-2026/',
    });
  });
});

describe('parseEventDetail: single-date page', () => {
  const detail = parseEventDetail(fixture('predpredaj-event-single.html'));

  it('reads title, date, venue and city from JSON-LD', () => {
    if (detail.kind !== 'single') throw new Error('expected a single-date event');
    expect(detail.title).toBe('Juraj HNILICA – Bardejov');
    expect(detail.startsAt.toISOString()).toBe('2026-11-06T18:00:00.000Z');
    expect(detail.venue).toBe('Hotel Astória');
    expect(detail.city).toBe('Bardejov');
    expect(detail.imageUrl).toBe('https://cdn-predpredaj.zoznam.sk/media/tickets/images/Bardejov_%C5%A1tvorec.jpg');
  });

  it('parses the minimum price tier from the rendered page', () => {
    if (detail.kind !== 'single') throw new Error('expected a single-date event');
    expect(detail.priceFrom).toBe(15);
  });
});

describe('parseEventDetail: tour page', () => {
  const detail = parseEventDetail(fixture('predpredaj-event-tour.html'));

  it('detects a tour page (empty JSON-LD startDate) and expands every stop', () => {
    if (detail.kind !== 'tour') throw new Error('expected a tour');
    expect(detail.stops).toHaveLength(13);
  });

  it('gets the first stop\'s title, date, venue, city and own URL right', () => {
    if (detail.kind !== 'tour') throw new Error('expected a tour');
    const first = detail.stops[0];
    expect(first.title).toBe('Filip Jančík - Dokonalé Vianoce 2026 - Prešov');
    expect(first.startsAt.toISOString()).toBe('2026-12-05T16:00:00.000Z');
    expect(first.venue).toBe('PKO Čierny Orol');
    expect(first.city).toBe('Prešov');
    expect(first.href).toBe('https://predpredaj.zoznam.sk/sk/listky/filip-jancik-dokonale-vianoce-2026-presov-1-2026-12-05/');
  });

  it('reuses the tour\'s own JSON-LD image for every stop', () => {
    if (detail.kind !== 'tour') throw new Error('expected a tour');
    expect(detail.imageUrl).toBe(
      'https://cdn-predpredaj.zoznam.sk/media/tickets/images/filij_jancik_vianocne_turne_2026_1200x1200_SK_B.jpg',
    );
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run lib/scrapers/predpredaj/parse.test.ts`
Expected: FAIL, cannot resolve `@/lib/scrapers/predpredaj/parse`.

- [ ] **Step 5: Implement**

`lib/scrapers/predpredaj/parse.ts`:
```ts
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

function readJsonLd($: ReturnType<typeof cheerio.load>): JsonLdEvent {
  const raw = $('script[type="application/ld+json"]').first().html() ?? '[]';
  const parsed = JSON.parse(raw) as JsonLdEvent | JsonLdEvent[];
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/scrapers/predpredaj/parse.test.ts`
Expected: PASS (all tests).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/scrapers/predpredaj/parse.ts lib/scrapers/predpredaj/parse.test.ts
git commit -m "feat: add predpredaj category and event-detail parsing"
```

---

### Task 3: Scrape orchestration

**Files:**
- Create: `lib/scrapers/predpredaj.ts`
- Test: `lib/scrapers/predpredaj.test.ts`

**Interfaces:**
- Consumes: `PREDPREDAJ_CATEGORIES`, `PREDPREDAJ_CATEGORY_LABEL`, `PREDPREDAJ_BASE_URL`, `type PredpredajCategory`, `parseCategoryListing`, `parseEventDetail` from `@/lib/scrapers/predpredaj/parse`; `RawEvent` from `@/lib/types`.
- Produces: `interface ScrapePredpredajOptions { categories?: PredpredajCategory[]; maxEventsPerCategory?: number; delayMs?: number; fetchImpl?: typeof fetch }`, `scrapePredpredaj(options?: ScrapePredpredajOptions): Promise<RawEvent[]>`.

- [ ] **Step 1: Write the failing tests**

`lib/scrapers/predpredaj.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { scrapePredpredaj } from '@/lib/scrapers/predpredaj';
import { PREDPREDAJ_BASE_URL } from '@/lib/scrapers/predpredaj/parse';

const ROBOTS_URL = `${PREDPREDAJ_BASE_URL}/robots.txt`;
const ROBOTS_TXT = 'User-agent: *\nDisallow: /*blocked-slug\n';

const listingHtml = (cards: { title: string; slug: string }[]) =>
  cards
    .map(
      (c) => `<article class="box"><div class="box-content d-none d-md-block">
        <h2 class="box-item-title"><span>${c.title}</span></h2>
        <a href="/sk/listky/${c.slug}/" class="box-item-btn">Detail</a>
      </div></article>`,
    )
    .join('\n');

const singleDetailHtml = (name: string, startDate: string, city: string) => `
  <script type="application/ld+json">[{"name":"${name}","startDate":"${startDate}","location":{"name":"Klub X, Ulica 1, ${city}","address":"${city}"},"image":"https://img/${city}.jpg"}]</script>
`;

const tourDetailHtml = `
  <script type="application/ld+json">[{"name":"Tour","startDate":"","location":{"name":"Slovensko","address":""},"image":"https://img/tour.jpg"}]</script>
  <ul>
    <li class="list-group-item"><a href="/sk/listky/tour-stop-1/" class="row">
      <div><strong>Tour - Mesto A</strong><br><span class="text-readable">01.12.2026 20:00 - Klub A, Ulica 1, Mesto A</span></div>
    </a></li>
    <li class="list-group-item"><a href="/sk/listky/tour-stop-2/" class="row">
      <div><strong>Tour - Mesto B</strong><br><span class="text-readable">02.12.2026 20:00 - Klub B, Ulica 2, Mesto B</span></div>
    </a></li>
  </ul>
`;

function fetchImplFrom(responses: Record<string, string>) {
  const fn = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    const body = responses[url];
    if (body === undefined) throw new Error(`unexpected fetch: ${url}`);
    return { ok: true, status: 200, text: async () => body } as Response;
  });
  return fn as unknown as typeof fetch;
}

describe('scrapePredpredaj', () => {
  it('converts a single-date event into a RawEvent with country SK and the category label as rawGenre', async () => {
    const fetchImpl = fetchImplFrom({
      [ROBOTS_URL]: ROBOTS_TXT,
      [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([{ title: 'Event A', slug: 'event-a' }]),
      [`${PREDPREDAJ_BASE_URL}/sk/listky/event-a/`]: singleDetailHtml('Event A', '2026-12-01 20:00', 'Bardejov'),
    });

    const raws = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

    expect(raws).toEqual([
      {
        source: 'predpredaj',
        sourceUrl: `${PREDPREDAJ_BASE_URL}/sk/listky/event-a/`,
        title: 'Event A',
        venue: 'Klub X',
        city: 'Bardejov',
        country: 'SK',
        currency: 'EUR',
        startsAt: new Date('2026-12-01T19:00:00.000Z'),
        priceFrom: null,
        rawGenre: 'Koncert',
        imageUrl: 'https://img/Bardejov.jpg',
      },
    ]);
  });

  it('expands a tour page into one RawEvent per stop, each with its own url and a null price', async () => {
    const fetchImpl = fetchImplFrom({
      [ROBOTS_URL]: ROBOTS_TXT,
      [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([{ title: 'Tour', slug: 'tour' }]),
      [`${PREDPREDAJ_BASE_URL}/sk/listky/tour/`]: tourDetailHtml,
    });

    const raws = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

    expect(raws).toHaveLength(2);
    expect(raws.map((r) => r.sourceUrl)).toEqual([
      `${PREDPREDAJ_BASE_URL}/sk/listky/tour-stop-1/`,
      `${PREDPREDAJ_BASE_URL}/sk/listky/tour-stop-2/`,
    ]);
    expect(raws.every((r) => r.priceFrom === null && r.country === 'SK')).toBe(true);
  });

  it('skips a robots.txt-disallowed listing without ever fetching its detail page', async () => {
    const fetchImpl = fetchImplFrom({
      [ROBOTS_URL]: ROBOTS_TXT,
      [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([
        { title: 'Blocked', slug: 'blocked-slug' },
        { title: 'Allowed', slug: 'allowed' },
      ]),
      [`${PREDPREDAJ_BASE_URL}/sk/listky/allowed/`]: singleDetailHtml('Allowed', '2026-12-01 20:00', 'Košice'),
    });

    const raws = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

    expect(raws).toHaveLength(1);
    expect(raws[0].title).toBe('Allowed');
    expect(fetchImpl).not.toHaveBeenCalledWith(`${PREDPREDAJ_BASE_URL}/sk/listky/blocked-slug/`, expect.anything());
  });

  it('skips one item whose detail page fetch fails and keeps going', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === ROBOTS_URL) return { ok: true, status: 200, text: async () => ROBOTS_TXT } as Response;
      if (url === `${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            listingHtml([
              { title: 'Broken', slug: 'broken' },
              { title: 'Fine', slug: 'fine' },
            ]),
        } as Response;
      }
      if (url === `${PREDPREDAJ_BASE_URL}/sk/listky/broken/`) throw new Error('network error');
      if (url === `${PREDPREDAJ_BASE_URL}/sk/listky/fine/`) {
        return { ok: true, status: 200, text: async () => singleDetailHtml('Fine', '2026-12-01 20:00', 'Nitra') } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const raws = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

    expect(raws).toHaveLength(1);
    expect(raws[0].title).toBe('Fine');
  });

  it('caps the number of detail-page fetches at maxEventsPerCategory', async () => {
    const fetchImpl = fetchImplFrom({
      [ROBOTS_URL]: ROBOTS_TXT,
      [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([
        { title: 'A', slug: 'a' },
        { title: 'B', slug: 'b' },
        { title: 'C', slug: 'c' },
      ]),
      [`${PREDPREDAJ_BASE_URL}/sk/listky/a/`]: singleDetailHtml('A', '2026-12-01 20:00', 'Nitra'),
      [`${PREDPREDAJ_BASE_URL}/sk/listky/b/`]: singleDetailHtml('B', '2026-12-01 20:00', 'Nitra'),
    });

    const raws = await scrapePredpredaj({ categories: ['koncert'], maxEventsPerCategory: 2, delayMs: 0, fetchImpl });

    expect(raws).toHaveLength(2);
    expect(fetchImpl).not.toHaveBeenCalledWith(`${PREDPREDAJ_BASE_URL}/sk/listky/c/`, expect.anything());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/scrapers/predpredaj.test.ts`
Expected: FAIL, cannot resolve `@/lib/scrapers/predpredaj`.

- [ ] **Step 3: Implement**

`lib/scrapers/predpredaj.ts`:
```ts
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
const DEFAULT_MAX_EVENTS_PER_CATEGORY = Number(process.env.PREDPREDAJ_MAX_EVENTS_PER_CATEGORY) || 30;

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
  const maxEventsPerCategory = options.maxEventsPerCategory ?? DEFAULT_MAX_EVENTS_PER_CATEGORY;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const disallowed = await loadDisallowedPatterns(fetchImpl);
  const raws: RawEvent[] = [];

  for (const category of categories) {
    await wait(delayMs);
    const listingHtml = await fetchText(`${PREDPREDAJ_BASE_URL}/sk/kategoria/${category}/`, fetchImpl);
    const cards = parseCategoryListing(listingHtml)
      .filter((card) => !isDisallowed(card.href, disallowed))
      .slice(0, maxEventsPerCategory);

    for (const card of cards) {
      await wait(delayMs);
      let detailHtml: string;
      try {
        detailHtml = await fetchText(card.href, fetchImpl);
      } catch {
        continue; // one bad item never aborts the crawl
      }

      const detail = parseEventDetail(detailHtml);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/scrapers/predpredaj.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/scrapers/predpredaj.ts lib/scrapers/predpredaj.test.ts
git commit -m "feat: add predpredaj scrape orchestration (delay, robots.txt, cap)"
```

---

### Task 4: Cron route, vercel.json, env and seed wiring

**Files:**
- Create: `app/api/cron/scrape/route.ts`, `vercel.json`
- Modify: `.env.example`, `README.md`, `prisma/seed.ts` (predpredaj `baseUrl` — it redirects to `predpredaj.zoznam.sk`, point the record at the real domain)
- Test: `app/api/cron/scrape/route.test.ts`

**Interfaces:**
- Consumes: `PREDPREDAJ_CATEGORIES`, `type PredpredajCategory` from `@/lib/scrapers/predpredaj/parse`; `scrapePredpredaj` from `@/lib/scrapers/predpredaj`; `upsertRawEvents` from `@/lib/ingest`; `prisma` from `@/lib/db`.
- Produces: `GET` handler at `app/api/cron/scrape/route.ts`.

- [ ] **Step 1: Write the failing tests**

`app/api/cron/scrape/route.test.ts`:
```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scrapePredpredaj, upsertRawEvents, sourceUpdate } = vi.hoisted(() => ({
  scrapePredpredaj: vi.fn(),
  upsertRawEvents: vi.fn(),
  sourceUpdate: vi.fn(),
}));

vi.mock('@/lib/scrapers/predpredaj', () => ({ scrapePredpredaj }));
vi.mock('@/lib/ingest', () => ({ upsertRawEvents }));
vi.mock('@/lib/db', () => ({ prisma: { source: { update: sourceUpdate } } }));

import { GET } from '@/app/api/cron/scrape/route';

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, { headers });

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret';
  scrapePredpredaj.mockReset().mockResolvedValue([]);
  upsertRawEvents.mockReset().mockResolvedValue({ created: 1, updated: 0, merged: 0, skipped: [] });
  sourceUpdate.mockReset().mockResolvedValue({});
});

describe('GET /api/cron/scrape', () => {
  it('rejects a request without the right bearer token', async () => {
    const res = await GET(request('/api/cron/scrape?category=koncert', { authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    expect(scrapePredpredaj).not.toHaveBeenCalled();
  });

  it('rejects a request with a missing or invalid category', async () => {
    const missing = await GET(request('/api/cron/scrape', { authorization: 'Bearer test-secret' }));
    expect(missing.status).toBe(400);

    const invalid = await GET(request('/api/cron/scrape?category=bogus', { authorization: 'Bearer test-secret' }));
    expect(invalid.status).toBe(400);
    expect(scrapePredpredaj).not.toHaveBeenCalled();
  });

  it('scrapes the given category, ingests, updates lastScrapedAt, and returns the stats', async () => {
    const res = await GET(request('/api/cron/scrape?category=koncert', { authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 1, updated: 0, merged: 0, skipped: [] });
    expect(scrapePredpredaj).toHaveBeenCalledWith({ categories: ['koncert'], maxEventsPerCategory: undefined });
    expect(upsertRawEvents).toHaveBeenCalledWith([]);
    expect(sourceUpdate).toHaveBeenCalledWith({ where: { slug: 'predpredaj' }, data: { lastScrapedAt: expect.any(Date) } });
  });

  it('passes an explicit maxEvents override through to the scraper', async () => {
    await GET(request('/api/cron/scrape?category=sport&maxEvents=5', { authorization: 'Bearer test-secret' }));
    expect(scrapePredpredaj).toHaveBeenCalledWith({ categories: ['sport'], maxEventsPerCategory: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/cron/scrape/route.test.ts`
Expected: FAIL, cannot resolve `@/app/api/cron/scrape/route`.

- [ ] **Step 3: Implement the route**

`app/api/cron/scrape/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { upsertRawEvents } from '@/lib/ingest';
import { scrapePredpredaj } from '@/lib/scrapers/predpredaj';
import { PREDPREDAJ_CATEGORIES, type PredpredajCategory } from '@/lib/scrapers/predpredaj/parse';

export const maxDuration = 60;

function isPredpredajCategory(value: string | null): value is PredpredajCategory {
  return !!value && (PREDPREDAJ_CATEGORIES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const category = request.nextUrl.searchParams.get('category');
  if (!isPredpredajCategory(category)) {
    return NextResponse.json(
      { error: `category query param is required, one of: ${PREDPREDAJ_CATEGORIES.join(', ')}` },
      { status: 400 },
    );
  }

  const maxEventsParam = request.nextUrl.searchParams.get('maxEvents');
  const maxEventsPerCategory = maxEventsParam ? Number(maxEventsParam) : undefined;

  const raws = await scrapePredpredaj({ categories: [category], maxEventsPerCategory });
  const stats = await upsertRawEvents(raws);
  await prisma.source.update({ where: { slug: 'predpredaj' }, data: { lastScrapedAt: new Date() } });

  return NextResponse.json(stats);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/cron/scrape/route.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Write `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/scrape?category=koncert", "schedule": "0 */6 * * *" },
    { "path": "/api/cron/scrape?category=sport", "schedule": "8 */6 * * *" },
    { "path": "/api/cron/scrape?category=show", "schedule": "16 */6 * * *" },
    { "path": "/api/cron/scrape?category=divadlo", "schedule": "24 */6 * * *" },
    { "path": "/api/cron/scrape?category=festival", "schedule": "32 */6 * * *" },
    { "path": "/api/cron/scrape?category=pre-deti", "schedule": "40 */6 * * *" },
    { "path": "/api/cron/scrape?category=ostatne", "schedule": "48 */6 * * *" }
  ]
}
```

Note for whoever deploys this: Vercel's Hobby tier has historically capped the number of cron jobs and how often they can run (as low as one per day on some past tiers). Confirm the deployed plan actually supports seven six-hourly crons before relying on this; if it doesn't, the fallback is a single cron entry that calls the route once per category itself (a small loop inside the handler, or a `?category=` rotation driven by a stored cursor) — not implemented here since it depends on a plan tier this repo doesn't have visibility into.

- [ ] **Step 6: Update `.env.example` and `README.md`**

Add to `.env.example`:
```
# Bearer token /api/cron/scrape requires. Generate any long random string.
CRON_SECRET="change-me"

# Optional: caps detail-page fetches per predpredaj category per cron run (default 30).
PREDPREDAJ_MAX_EVENTS_PER_CATEGORY=30
```

Add to `README.md`, after the existing "Scripts" section:
```markdown
## Scraping

`GET /api/cron/scrape?category=<koncert|sport|show|divadlo|festival|pre-deti|ostatne>` with
`Authorization: Bearer $CRON_SECRET` scrapes predpredaj.zoznam.sk for that one category and
ingests the result. `vercel.json` schedules all seven categories every 6 hours, staggered by
a few minutes each so they never run concurrently.
```

- [ ] **Step 7: Fix the predpredaj `Source.baseUrl` in the seed**

In `prisma/seed.ts`, change:
```ts
{ slug: 'predpredaj', name: 'Predpredaj', baseUrl: 'https://www.predpredaj.sk' },
```
to:
```ts
{ slug: 'predpredaj', name: 'Predpredaj', baseUrl: 'https://predpredaj.zoznam.sk' },
```
(`predpredaj.sk` redirects here; point the informational field at the real domain the scraper actually talks to.)

- [ ] **Step 8: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed; the build output lists route `/api/cron/scrape`.

- [ ] **Step 9: Commit**

```bash
git add app/api/cron/scrape/route.ts app/api/cron/scrape/route.test.ts vercel.json .env.example README.md prisma/seed.ts
git commit -m "feat: add /api/cron/scrape route, vercel.json cron schedule"
```

---

### Task 5: Live smoke run against Neon dev

**Files:**
- Create: `scripts/smoke-predpredaj.ts`

**Interfaces:**
- Consumes: `scrapePredpredaj` from `@/lib/scrapers/predpredaj`, `upsertRawEvents` from `@/lib/ingest`, `prisma` from `@/lib/db`.
- Produces: nothing later tasks depend on — this is a one-off script, not part of `npm test`, matching the spec's "one live smoke run reported, not in CI."

- [ ] **Step 1: Write the script**

`scripts/smoke-predpredaj.ts`:
```ts
import 'dotenv/config';
import { prisma } from '@/lib/db';
import { upsertRawEvents } from '@/lib/ingest';
import { scrapePredpredaj } from '@/lib/scrapers/predpredaj';
import type { PredpredajCategory } from '@/lib/scrapers/predpredaj/parse';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');
  const category = (process.argv[2] ?? 'koncert') as PredpredajCategory;
  const maxEvents = Number(process.argv[3] ?? 8);

  console.log(`Smoke run: category=${category} maxEvents=${maxEvents} against ${new URL(process.env.DATABASE_URL).host}`);

  const raws = await scrapePredpredaj({ categories: [category], maxEventsPerCategory: maxEvents });
  console.log(`Scraped ${raws.length} raw events from predpredaj.`);

  const stats = await upsertRawEvents(raws);
  console.log('Ingest stats:', stats);

  const events = await prisma.event.findMany({
    where: { sources: { some: { source: { slug: 'predpredaj' } } } },
    include: { sources: { include: { source: true } } },
    orderBy: { createdAt: 'desc' },
    take: raws.length + 10,
  });

  console.log(`\n${events.length} predpredaj-sourced events now in the DB:`);
  for (const e of events) {
    console.log(
      `- ${e.title} | ${e.venue}, ${e.city} | ${e.startsAt.toISOString()} | ` +
        `price=${e.priceFrom ?? 'null'} ${e.currency} | genre=${e.genre} | ${e.sources.length} source(s)`,
    );
  }

  const merged = events.filter((e) => e.sources.length > 1);
  console.log(`\n${merged.length} event(s) with more than one EventSource (real dedupe activity):`);
  for (const e of merged) {
    console.log(`- "${e.title}" (${e.venue}, ${e.city}): ${e.sources.map((s) => s.url).join(', ')}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-predpredaj.ts
git commit -m "feat: add predpredaj live smoke-test script"
```

- [ ] **Step 4: Run it against the Neon dev branch**

Run: `npx tsx scripts/smoke-predpredaj.ts koncert 8`
Expected: no crash; prints scraped/ingest counts and the resulting DB rows. This talks to the real live site and the real Neon dev database — it is the one live network call this plan makes outside of tests, matching the spec's "one live smoke run reported, not in CI." Rerun with a second, different category (e.g. `npx tsx scripts/smoke-predpredaj.ts sport 8`) to get a second, independent data point.

- [ ] **Step 5: Report real dedupe behavior against the spec's Open Questions**

Read the console output from step 4 and write up, in the final report (not a file the plan requires — this is the "report" the spec and the human partner asked for):
- Whether any predpredaj-sourced event ended up with more than one `EventSource` (i.e., the fingerprint or fuzzy matcher fired within a single scrape — expected to be rare since each real show has exactly one predpredaj listing, but a tour with two same-day, same-venue stops, or a rerun of the smoke script itself, could trigger it).
- Whether any two distinct real events shared a title differing only by a trailing number or venue suffix (the spec's open question about `pickFuzzyMatch`'s number-conflict guard) — predpredaj's tour-stop titles append a *place name*, not a bare number, so this is expected not to apply directly; say so if that holds.
- Whether the `country: 'SK'` requirement (Review Focus #1) actually got exercised — check whether any scraped city fell outside the 8-city `CITIES` table (e.g. a smaller town) and confirm it ingested without throwing.

---

## Self-Review (done while writing)

**Spec coverage:** `lib/scrapers/predpredaj.ts` exporting `scrapePredpredaj` (Task 3), SK-only + `country: 'SK'` handling (Task 3, Review Focus #1), category listing + single-date + tour-page parsing including the JSON-LD discovery and the `li.list-group-item` false-positive trap (Task 2, Review Focus #2), HTML entity decoding (Task 1, Review Focus #3), price-tier parsing and the tour-stop `null` price rule (Tasks 1–3), robots.txt-aware skip before fetch (Task 3, Review Focus #4), the `maxEventsPerCategory` cap on actual fetches (Task 3, Review Focus #5), category→genre via the existing `normalizeGenre` (verified in the spec, consumed directly in Task 3's `PREDPREDAJ_CATEGORY_LABEL`), `/api/cron/scrape` with bearer auth and required `?category=` (Task 4), `vercel.json` seven-entry stagger (Task 4), fixtures and fixture-only unit tests plus one live smoke run reported (Tasks 1–2 for fixtures, Task 5 for the live run). Images hotlinked not rehosted, descriptions never scraped: both are simply never read from the parsed data (Task 2/3 — there is no field for either).

**Type consistency:** `PredpredajCategory`/`PREDPREDAJ_CATEGORIES`/`PREDPREDAJ_CATEGORY_LABEL`/`PREDPREDAJ_BASE_URL` defined in Task 2, used identically in Tasks 3 and 4. `ParsedSingleDateEvent`/`ParsedTour`/`ParsedTourStop`/`ParsedEventDetail` defined in Task 2, consumed by name (`detail.kind`, `detail.venue`, `detail.stops`, etc.) in Task 3 with matching field names throughout. `ScrapePredpredajOptions` defined and consumed within Task 3; its shape (`categories`, `maxEventsPerCategory`, `delayMs`, `fetchImpl`) matches what Task 4's route and Task 5's script pass.

**Review Focus:** all five items have an owning task and a named test, as listed under Spec coverage above.

**Placeholders:** none.
