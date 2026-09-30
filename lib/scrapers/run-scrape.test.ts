import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scrapePredpredaj, upsertRawEvents, sourceUpsert, sourceUpdate, eventSourceFindMany, eventSourceUpdateMany } = vi.hoisted(
  () => ({
    scrapePredpredaj: vi.fn(),
    upsertRawEvents: vi.fn(),
    sourceUpsert: vi.fn(),
    sourceUpdate: vi.fn(),
    eventSourceFindMany: vi.fn(),
    eventSourceUpdateMany: vi.fn(),
  }),
);

vi.mock('@/lib/scrapers/predpredaj', () => ({ scrapePredpredaj }));
vi.mock('@/lib/ingest', () => ({ upsertRawEvents }));
vi.mock('@/lib/db', () => ({
  prisma: {
    source: { upsert: sourceUpsert, update: sourceUpdate },
    eventSource: { findMany: eventSourceFindMany, updateMany: eventSourceUpdateMany },
  },
}));

import { runScrape } from '@/lib/scrapers/run-scrape';

beforeEach(() => {
  scrapePredpredaj.mockReset().mockResolvedValue({ raws: [{ source: 'predpredaj' }], touchedUrls: [] });
  upsertRawEvents.mockReset().mockResolvedValue({ created: 1, updated: 0, merged: 0, skipped: [] });
  sourceUpsert.mockReset().mockResolvedValue({ id: 'source-id' });
  sourceUpdate.mockReset().mockResolvedValue({});
  eventSourceFindMany.mockReset().mockResolvedValue([]);
  eventSourceUpdateMany.mockReset().mockResolvedValue({ count: 0 });
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

  it('loads known URLs for this source and passes them to the scraper as a url -> lastDetailFetchedAt map', async () => {
    const fetchedAt = new Date('2026-10-01T00:00:00Z');
    eventSourceFindMany.mockResolvedValue([
      { url: 'https://predpredaj.zoznam.sk/sk/listky/a/', lastDetailFetchedAt: fetchedAt },
      { url: 'https://predpredaj.zoznam.sk/sk/listky/b/', lastDetailFetchedAt: null },
    ]);

    await runScrape({ source: 'predpredaj' });

    expect(eventSourceFindMany).toHaveBeenCalledWith({
      where: { sourceId: 'source-id' },
      select: { url: true, lastDetailFetchedAt: true },
    });
    const passedOptions = scrapePredpredaj.mock.calls[0][0];
    expect(passedOptions.knownUrls).toEqual(
      new Map([
        ['https://predpredaj.zoznam.sk/sk/listky/a/', fetchedAt],
        ['https://predpredaj.zoznam.sk/sk/listky/b/', null],
      ]),
    );
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
    });

    await runScrape({ source: 'predpredaj' });

    expect(eventSourceUpdateMany).toHaveBeenCalledWith({
      where: { url: { in: ['https://predpredaj.zoznam.sk/sk/listky/a/', 'https://predpredaj.zoznam.sk/sk/listky/b/'] } },
      data: { lastSeenAt: expect.any(Date) },
    });
  });

  it('does not touch eventSource.updateMany when nothing was skipped', async () => {
    scrapePredpredaj.mockResolvedValue({ raws: [], touchedUrls: [] });
    await runScrape({ source: 'predpredaj' });
    expect(eventSourceUpdateMany).not.toHaveBeenCalled();
  });
});
