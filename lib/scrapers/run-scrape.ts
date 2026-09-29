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

/** Scrapes one source end to end: ensures its Source row exists, scrapes, ingests, stamps lastScrapedAt. */
export async function runScrape(options: RunScrapeOptions): Promise<IngestStats> {
  await prisma.source.upsert({
    where: { slug: options.source },
    update: {},
    create: { slug: options.source, ...SOURCE_INFO[options.source] },
  });

  const raws = await scrapePredpredaj({ categories: options.categories, maxEventsPerCategory: options.maxEventsPerCategory });
  const stats = await upsertRawEvents(raws);
  await prisma.source.update({ where: { slug: options.source }, data: { lastScrapedAt: new Date() } });
  return stats;
}
