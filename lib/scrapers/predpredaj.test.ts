import { describe, expect, it, vi } from 'vitest';
import { PREDPREDAJ_REFETCH_INTERVAL_MS, refetchJitterMs, scrapePredpredaj } from '@/lib/scrapers/predpredaj';
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

    const { raws } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

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

    const { raws } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

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

    const { raws } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

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

    const { raws } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

    expect(raws).toHaveLength(1);
    expect(raws[0].title).toBe('Fine');
  });

  it('recovers an event whose JSON-LD has an unescaped quote via the escaping retry', async () => {
    const fetchImpl = fetchImplFrom({
      [ROBOTS_URL]: ROBOTS_TXT,
      [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([{ title: 'Recovered', slug: 'recovered' }]),
      // An unescaped quote inside a JSON-LD string value — real, live-observed predpredaj data
      // (a description containing a quoted phrase the site forgot to escape).
      [`${PREDPREDAJ_BASE_URL}/sk/listky/recovered/`]: `<script type="application/ld+json">[{"name":"Recovered","startDate":"2026-12-01 20:00","location":{"name":"Klub, Ulica, Mesto","address":"Mesto"},"image":"https://img/x.jpg","description":"a "quoted" phrase"}]</script>`,
    });

    const { raws } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

    expect(raws).toHaveLength(1);
    expect(raws[0].title).toBe('Recovered');
  });

  it('skips one item whose page has no usable shape at all (no JSON-LD, no tour stops, no single-date markup) and keeps going', async () => {
    const fetchImpl = fetchImplFrom({
      [ROBOTS_URL]: ROBOTS_TXT,
      [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([
        { title: 'Broken', slug: 'broken' },
        { title: 'Fine', slug: 'fine' },
      ]),
      [`${PREDPREDAJ_BASE_URL}/sk/listky/broken/`]: `<div>nothing recognizable here</div>`,
      [`${PREDPREDAJ_BASE_URL}/sk/listky/fine/`]: singleDetailHtml('Fine', '2026-12-01 20:00', 'Nitra'),
    });

    const { raws } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

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

    const { raws } = await scrapePredpredaj({ categories: ['koncert'], maxEventsPerCategory: 2, delayMs: 0, fetchImpl });

    expect(raws).toHaveLength(2);
    expect(fetchImpl).not.toHaveBeenCalledWith(`${PREDPREDAJ_BASE_URL}/sk/listky/c/`, expect.anything());
  });

  it('does not cap detail-page fetches when maxEventsPerCategory is not given', async () => {
    const fetchImpl = fetchImplFrom({
      [ROBOTS_URL]: ROBOTS_TXT,
      [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([
        { title: 'A', slug: 'a' },
        { title: 'B', slug: 'b' },
        { title: 'C', slug: 'c' },
      ]),
      [`${PREDPREDAJ_BASE_URL}/sk/listky/a/`]: singleDetailHtml('A', '2026-12-01 20:00', 'Nitra'),
      [`${PREDPREDAJ_BASE_URL}/sk/listky/b/`]: singleDetailHtml('B', '2026-12-01 20:00', 'Nitra'),
      [`${PREDPREDAJ_BASE_URL}/sk/listky/c/`]: singleDetailHtml('C', '2026-12-01 20:00', 'Nitra'),
    });

    const { raws } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

    expect(raws).toHaveLength(3);
  });

  describe('re-fetch skipping', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    // parseCategoryListing always produces a trailing-slash href (predpredaj's own URL convention),
    // but EventSource.url is stored canonicalized (lib/normalize/url's canonicalizeUrl strips it) —
    // so a real `knownUrls` map, built from actual DB rows, is always keyed without the slash. Real
    // bug, caught live: a naive `knownUrls.get(card.href)` never matched, so every single URL looked
    // "never fetched" — 524/524 got re-fetched on a run right after they'd all just been fetched.
    const knownUrl = `${PREDPREDAJ_BASE_URL}/sk/listky/known/`;
    const canonicalKnownUrl = `${PREDPREDAJ_BASE_URL}/sk/listky/known`;

    it('skips the detail fetch for a URL fetched within the last day, and reports it as touched (canonicalized, matching the real DB)', async () => {
      const fetchImpl = fetchImplFrom({
        [ROBOTS_URL]: ROBOTS_TXT,
        [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([{ title: 'Known', slug: 'known' }]),
      });
      const knownUrls = new Map([[canonicalKnownUrl, new Date(now.getTime() - 60 * 60_000)]]); // fetched 1h ago

      const { raws, touchedUrls } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl, knownUrls, now });

      expect(raws).toEqual([]);
      expect(touchedUrls).toEqual([canonicalKnownUrl]);
      expect(fetchImpl).not.toHaveBeenCalledWith(knownUrl, expect.anything());
    });

    it('fetches a known URL again once PREDPREDAJ_REFETCH_INTERVAL_MS has passed', async () => {
      const fetchImpl = fetchImplFrom({
        [ROBOTS_URL]: ROBOTS_TXT,
        [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([{ title: 'Known', slug: 'known' }]),
        [knownUrl]: singleDetailHtml('Known', '2026-12-01 20:00', 'Nitra'),
      });
      const dueAt = PREDPREDAJ_REFETCH_INTERVAL_MS + refetchJitterMs(canonicalKnownUrl); // base + this URL's own jitter
      const knownUrls = new Map([[canonicalKnownUrl, new Date(now.getTime() - dueAt)]]); // exactly due

      const { raws, touchedUrls } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl, knownUrls, now });

      expect(raws).toHaveLength(1);
      expect(touchedUrls).toEqual([]);
    });

    it('does not refetch a URL that only just passed the base interval but hasn\'t reached its own jittered due date yet', async () => {
      // Real risk this guards against: without jitter, every URL scraped together becomes due on the
      // same later run, turning the "cheap every run" savings back into one expensive spike every 3
      // days. A URL whose jitter is 0 has no gap to test here, so skip that (rare) case.
      const jitter = refetchJitterMs(canonicalKnownUrl);
      if (jitter === 0) return;
      const fetchImpl = fetchImplFrom({
        [ROBOTS_URL]: ROBOTS_TXT,
        [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([{ title: 'Known', slug: 'known' }]),
      });
      const knownUrls = new Map([[canonicalKnownUrl, new Date(now.getTime() - PREDPREDAJ_REFETCH_INTERVAL_MS)]]); // base interval only, jitter not yet elapsed

      const { raws, touchedUrls } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl, knownUrls, now });

      expect(raws).toEqual([]);
      expect(touchedUrls).toEqual([canonicalKnownUrl]);
    });

    it('always fetches a URL that has never been seen before, even with a knownUrls map present', async () => {
      const fetchImpl = fetchImplFrom({
        [ROBOTS_URL]: ROBOTS_TXT,
        [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([{ title: 'New', slug: 'new' }]),
        [`${PREDPREDAJ_BASE_URL}/sk/listky/new/`]: singleDetailHtml('New', '2026-12-01 20:00', 'Nitra'),
      });
      const knownUrls = new Map([[knownUrl, now]]); // unrelated URL, just proves the map's presence alone isn't the trigger

      const { raws, touchedUrls } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl, knownUrls, now });

      expect(raws).toHaveLength(1);
      expect(touchedUrls).toEqual([]);
    });

    it('a null lastDetailFetchedAt (legacy row) is treated as always due for a fetch', async () => {
      const fetchImpl = fetchImplFrom({
        [ROBOTS_URL]: ROBOTS_TXT,
        [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([{ title: 'Known', slug: 'known' }]),
        [knownUrl]: singleDetailHtml('Known', '2026-12-01 20:00', 'Nitra'),
      });
      const knownUrls = new Map([[knownUrl, null]]);

      const { raws, touchedUrls } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl, knownUrls, now });

      expect(raws).toHaveLength(1);
      expect(touchedUrls).toEqual([]);
    });

    it('reports every actually-fetched card href in fetchedUrls, canonicalized', async () => {
      const fetchImpl = fetchImplFrom({
        [ROBOTS_URL]: ROBOTS_TXT,
        [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([{ title: 'New', slug: 'new' }]),
        [`${PREDPREDAJ_BASE_URL}/sk/listky/new/`]: singleDetailHtml('New', '2026-12-01 20:00', 'Nitra'),
      });

      const { fetchedUrls } = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl, now });

      expect(fetchedUrls).toEqual([`${PREDPREDAJ_BASE_URL}/sk/listky/new`]);
    });

    it('a tour card is skipped by the same freshness check as a single-date card, keyed by its own href (not any stop\'s href)', async () => {
      // Real bug, caught live: a tour's card.href never becomes an EventSource.url — only each stop's
      // href does, under its own row — so a knownUrls map built from EventSource had no entry a tour
      // card could ever match, and every tour card looked "never fetched" on every single run, forever.
      // fetchedUrls (not EventSource) is the freshness source of truth precisely so a tour card has one.
      const tourUrl = `${PREDPREDAJ_BASE_URL}/sk/listky/tour/`;
      const canonicalTourUrl = `${PREDPREDAJ_BASE_URL}/sk/listky/tour`;
      const fetchImpl = fetchImplFrom({
        [ROBOTS_URL]: ROBOTS_TXT,
        [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([{ title: 'Tour', slug: 'tour' }]),
      });
      const knownUrls = new Map([[canonicalTourUrl, new Date(now.getTime() - 60 * 60_000)]]); // fetched 1h ago

      const { raws, touchedUrls, fetchedUrls } = await scrapePredpredaj({
        categories: ['koncert'],
        delayMs: 0,
        fetchImpl,
        knownUrls,
        now,
      });

      expect(raws).toEqual([]);
      expect(touchedUrls).toEqual([canonicalTourUrl]);
      expect(fetchedUrls).toEqual([]);
      expect(fetchImpl).not.toHaveBeenCalledWith(tourUrl, expect.anything());
    });

    it('counts listing pages fetched, new URLs, and due refetches separately from fresh skips', async () => {
      const dueUrl = `${PREDPREDAJ_BASE_URL}/sk/listky/due/`;
      const canonicalDueUrl = `${PREDPREDAJ_BASE_URL}/sk/listky/due`;
      const fetchImpl = fetchImplFrom({
        [ROBOTS_URL]: ROBOTS_TXT,
        [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([
          { title: 'Known', slug: 'known' }, // fresh: skipped
          { title: 'Due', slug: 'due' }, // known but past its jittered interval: refetched
          { title: 'New', slug: 'new' }, // never seen: refetched
        ]),
        [dueUrl]: singleDetailHtml('Due', '2026-12-01 20:00', 'Nitra'),
        [`${PREDPREDAJ_BASE_URL}/sk/listky/new/`]: singleDetailHtml('New', '2026-12-01 20:00', 'Nitra'),
      });
      const knownUrls = new Map([
        [canonicalKnownUrl, new Date(now.getTime() - 60 * 60_000)], // fresh
        [canonicalDueUrl, new Date(now.getTime() - PREDPREDAJ_REFETCH_INTERVAL_MS - refetchJitterMs(canonicalDueUrl))], // due
      ]);

      const result = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl, knownUrls, now });

      expect(result.listingPagesFetched).toBe(1);
      expect(result.newUrls).toBe(1);
      expect(result.duePages).toBe(1);
      expect(result.touchedUrls).toEqual([canonicalKnownUrl]);
    });

    it('a skipped (touched) card does not count against maxEventsPerCategory', async () => {
      const freshUrl = `${PREDPREDAJ_BASE_URL}/sk/listky/fresh/`;
      const fetchImpl = fetchImplFrom({
        [ROBOTS_URL]: ROBOTS_TXT,
        [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([
          { title: 'Known', slug: 'known' },
          { title: 'Fresh', slug: 'fresh' },
        ]),
        [freshUrl]: singleDetailHtml('Fresh', '2026-12-01 20:00', 'Nitra'),
      });
      const knownUrls = new Map([[canonicalKnownUrl, new Date(now.getTime() - 60 * 60_000)]]);

      const { raws, touchedUrls } = await scrapePredpredaj({
        categories: ['koncert'],
        maxEventsPerCategory: 1,
        delayMs: 0,
        fetchImpl,
        knownUrls,
        now,
      });

      expect(raws).toHaveLength(1);
      expect(raws[0].title).toBe('Fresh');
      expect(touchedUrls).toEqual([canonicalKnownUrl]);
    });
  });
});
