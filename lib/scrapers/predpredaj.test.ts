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

  it('skips one item whose detail page has unparseable JSON-LD and keeps going', async () => {
    const fetchImpl = fetchImplFrom({
      [ROBOTS_URL]: ROBOTS_TXT,
      [`${PREDPREDAJ_BASE_URL}/sk/kategoria/koncert/`]: listingHtml([
        { title: 'Malformed', slug: 'malformed' },
        { title: 'Fine', slug: 'fine' },
      ]),
      // An unescaped quote inside a JSON-LD string value — real, live-observed predpredaj data.
      // No amount of control-character escaping can recover this; it must be skipped, not crash the run.
      [`${PREDPREDAJ_BASE_URL}/sk/listky/malformed/`]: `<script type="application/ld+json">[{"name":"Malformed","startDate":"2026-12-01 20:00","location":{"name":"Klub, Ulica, Mesto","address":"Mesto"},"image":"https://img/x.jpg","description":"a "quoted" phrase"}]</script>`,
      [`${PREDPREDAJ_BASE_URL}/sk/listky/fine/`]: singleDetailHtml('Fine', '2026-12-01 20:00', 'Nitra'),
    });

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

    const raws = await scrapePredpredaj({ categories: ['koncert'], delayMs: 0, fetchImpl });

    expect(raws).toHaveLength(3);
  });
});
