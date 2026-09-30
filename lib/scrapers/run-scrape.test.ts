import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  scrapePredpredaj,
  upsertRawEvents,
  sourceUpsert,
  sourceUpdate,
  eventSourceUpdateMany,
  scrapedPageFindMany,
  scrapedPageCreateMany,
  scrapedPageUpdateMany,
} = vi.hoisted(() => ({
  scrapePredpredaj: vi.fn(),
  upsertRawEvents: vi.fn(),
  sourceUpsert: vi.fn(),
  sourceUpdate: vi.fn(),
  eventSourceUpdateMany: vi.fn(),
  scrapedPageFindMany: vi.fn(),
  scrapedPageCreateMany: vi.fn(),
  scrapedPageUpdateMany: vi.fn(),
}));

vi.mock('@/lib/scrapers/predpredaj', () => ({ scrapePredpredaj }));
vi.mock('@/lib/ingest', () => ({ upsertRawEvents }));
vi.mock('@/lib/db', () => ({
  prisma: {
    source: { upsert: sourceUpsert, update: sourceUpdate },
    eventSource: { updateMany: eventSourceUpdateMany },
    scrapedPage: { findMany: scrapedPageFindMany, createMany: scrapedPageCreateMany, updateMany: scrapedPageUpdateMany },
  },
}));

import { runScrape } from '@/lib/scrapers/run-scrape';

beforeEach(() => {
  scrapePredpredaj.mockReset().mockResolvedValue({ raws: [{ source: 'predpredaj' }], touchedUrls: [], fetchedUrls: [] });
  upsertRawEvents.mockReset().mockResolvedValue({ created: 1, updated: 0, merged: 0, skipped: [] });
  sourceUpsert.mockReset().mockResolvedValue({ id: 'source-id' });
  sourceUpdate.mockReset().mockResolvedValue({});
  eventSourceUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  scrapedPageFindMany.mockReset().mockResolvedValue([]);
  scrapedPageCreateMany.mockReset().mockResolvedValue({ count: 0 });
  scrapedPageUpdateMany.mockReset().mockResolvedValue({ count: 0 });
});

describe('runScrape', () => {
  it('ensures the Source row exists before scraping', async () => {
    await runScrape({ source: 'predpredaj' });
    expect(sourceUpsert).toHaveBeenCalledWith({
      where: { slug: 'predpredaj' },
      update: {},
      create: { slug: 'predpredaj', name: 'Predpredaj', baseUrl: 'https://predpredaj.zoznam.sk' },
    });
  });

  it('loads known scraped pages and passes them to the scraper as a url -> lastFetchedAt map', async () => {
    // Sourced from ScrapedPage, not EventSource: a tour card's own href never becomes an
    // EventSource.url (only its stops' do), so EventSource alone can't carry a tour card's freshness.
    const fetchedAt = new Date('2026-10-01T00:00:00Z');
    scrapedPageFindMany.mockResolvedValue([
      { url: 'https://predpredaj.zoznam.sk/sk/listky/a/', lastFetchedAt: fetchedAt },
      { url: 'https://predpredaj.zoznam.sk/sk/listky/tour/', lastFetchedAt: null },
    ]);

    await runScrape({ source: 'predpredaj' });

    expect(scrapedPageFindMany).toHaveBeenCalledWith({ select: { url: true, lastFetchedAt: true } });
    const passedOptions = scrapePredpredaj.mock.calls[0][0];
    expect(passedOptions.knownUrls).toEqual(
      new Map([
        ['https://predpredaj.zoznam.sk/sk/listky/a/', fetchedAt],
        ['https://predpredaj.zoznam.sk/sk/listky/tour/', null],
      ]),
    );
  });

  it('persists every fetched URL to ScrapedPage: seeds new ones, then bumps all of them to now', async () => {
    scrapePredpredaj.mockResolvedValue({
      raws: [],
      touchedUrls: [],
      fetchedUrls: ['https://predpredaj.zoznam.sk/sk/listky/a/', 'https://predpredaj.zoznam.sk/sk/listky/tour/'],
    });

    await runScrape({ source: 'predpredaj' });

    expect(scrapedPageCreateMany).toHaveBeenCalledWith({
      data: [
        { url: 'https://predpredaj.zoznam.sk/sk/listky/a/', lastFetchedAt: expect.any(Date) },
        { url: 'https://predpredaj.zoznam.sk/sk/listky/tour/', lastFetchedAt: expect.any(Date) },
      ],
      skipDuplicates: true,
    });
    expect(scrapedPageUpdateMany).toHaveBeenCalledWith({
      where: { url: { in: ['https://predpredaj.zoznam.sk/sk/listky/a/', 'https://predpredaj.zoznam.sk/sk/listky/tour/'] } },
      data: { lastFetchedAt: expect.any(Date) },
    });
  });

  it('does not touch ScrapedPage when nothing was fetched', async () => {
    scrapePredpredaj.mockResolvedValue({ raws: [], touchedUrls: [], fetchedUrls: [] });
    await runScrape({ source: 'predpredaj' });
    expect(scrapedPageCreateMany).not.toHaveBeenCalled();
    expect(scrapedPageUpdateMany).not.toHaveBeenCalled();
  });

  it('scrapes with the given options, ingests, updates lastScrapedAt, and returns the ingest stats', async () => {
    const stats = await runScrape({ source: 'predpredaj', categories: ['koncert'], maxEventsPerCategory: 5 });
    expect(scrapePredpredaj).toHaveBeenCalledWith(
      expect.objectContaining({ categories: ['koncert'], maxEventsPerCategory: 5 }),
    );
    expect(upsertRawEvents).toHaveBeenCalledWith([{ source: 'predpredaj' }], expect.any(Date));
    expect(sourceUpdate).toHaveBeenCalledWith({ where: { slug: 'predpredaj' }, data: { lastScrapedAt: expect.any(Date) } });
    expect(stats).toEqual({ created: 1, updated: 0, merged: 0, skipped: [] });
  });

  it('bumps lastSeenAt for every touched (skipped, no detail fetch) URL', async () => {
    scrapePredpredaj.mockResolvedValue({
      raws: [],
      touchedUrls: ['https://predpredaj.zoznam.sk/sk/listky/a/', 'https://predpredaj.zoznam.sk/sk/listky/b/'],
      fetchedUrls: [],
    });

    await runScrape({ source: 'predpredaj' });

    expect(eventSourceUpdateMany).toHaveBeenCalledWith({
      where: { url: { in: ['https://predpredaj.zoznam.sk/sk/listky/a/', 'https://predpredaj.zoznam.sk/sk/listky/b/'] } },
      data: { lastSeenAt: expect.any(Date) },
    });
  });

  it('does not touch eventSource.updateMany when nothing was skipped', async () => {
    scrapePredpredaj.mockResolvedValue({ raws: [], touchedUrls: [], fetchedUrls: [] });
    await runScrape({ source: 'predpredaj' });
    expect(eventSourceUpdateMany).not.toHaveBeenCalled();
  });
});
