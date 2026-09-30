import { prisma } from '@/lib/db';
import { upsertRawEvents, type IngestStats } from '@/lib/ingest';
import { scrapePredpredaj } from '@/lib/scrapers/predpredaj';
import type { PredpredajCategory } from '@/lib/scrapers/predpredaj/parse';

export const SOURCES = ['predpredaj'] as const;
export type ScraperSource = (typeof SOURCES)[number];

const SOURCE_INFO: Record<ScraperSource, { name: string; baseUrl: string }> = {
  predpredaj: { name: 'Predpredaj', baseUrl: 'https://predpredaj.zoznam.sk' },
};

export interface RunScrapeOptions {
  source: ScraperSource;
  categories?: PredpredajCategory[];
  maxEventsPerCategory?: number;
}

/**
 * Scrapes one source end to end: ensures its Source row exists, loads which of its URLs are already
 * known (and when their detail page was last actually fetched, so the scraper can skip re-fetching
 * ones still fresh), scrapes, ingests, bumps lastSeenAt for the URLs the scraper only saw in a listing,
 * and stamps lastScrapedAt.
 */
export async function runScrape(options: RunScrapeOptions): Promise<IngestStats> {
  const source = await prisma.source.upsert({
    where: { slug: options.source },
    update: {},
    create: { slug: options.source, ...SOURCE_INFO[options.source] },
  });

  const now = new Date();
  const knownRows = await prisma.eventSource.findMany({
    where: { sourceId: source.id },
    select: { url: true, lastDetailFetchedAt: true },
  });
  const knownUrls = new Map(knownRows.map((row) => [row.url, row.lastDetailFetchedAt]));

  const { raws, touchedUrls } = await scrapePredpredaj({
    categories: options.categories,
    maxEventsPerCategory: options.maxEventsPerCategory,
    knownUrls,
    now,
  });

  const stats = await upsertRawEvents(raws, now);

  if (touchedUrls.length > 0) {
    await prisma.eventSource.updateMany({ where: { url: { in: touchedUrls } }, data: { lastSeenAt: now } });
  }

  await prisma.source.update({ where: { slug: options.source }, data: { lastScrapedAt: now } });
  return stats;
}
