import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scrapePredpredaj, upsertRawEvents, sourceUpsert, sourceUpdate } = vi.hoisted(() => ({
  scrapePredpredaj: vi.fn(),
  upsertRawEvents: vi.fn(),
  sourceUpsert: vi.fn(),
  sourceUpdate: vi.fn(),
}));

vi.mock('@/lib/scrapers/predpredaj', () => ({ scrapePredpredaj }));
vi.mock('@/lib/ingest', () => ({ upsertRawEvents }));
vi.mock('@/lib/db', () => ({ prisma: { source: { upsert: sourceUpsert, update: sourceUpdate } } }));

import { runScrape } from '@/lib/scrapers/run-scrape';

beforeEach(() => {
  scrapePredpredaj.mockReset().mockResolvedValue([{ source: 'predpredaj' }]);
  upsertRawEvents.mockReset().mockResolvedValue({ created: 1, updated: 0, merged: 0, skipped: [] });
  sourceUpsert.mockReset().mockResolvedValue({});
  sourceUpdate.mockReset().mockResolvedValue({});
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

  it('scrapes with the given options, ingests, updates lastScrapedAt, and returns the ingest stats', async () => {
    const stats = await runScrape({ source: 'predpredaj', categories: ['koncert'], maxEventsPerCategory: 5 });
    expect(scrapePredpredaj).toHaveBeenCalledWith({ categories: ['koncert'], maxEventsPerCategory: 5 });
    expect(upsertRawEvents).toHaveBeenCalledWith([{ source: 'predpredaj' }]);
    expect(sourceUpdate).toHaveBeenCalledWith({ where: { slug: 'predpredaj' }, data: { lastScrapedAt: expect.any(Date) } });
    expect(stats).toEqual({ created: 1, updated: 0, merged: 0, skipped: [] });
  });
});
