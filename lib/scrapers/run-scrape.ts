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

export interface RunScrapeStats extends IngestStats {
  listingPagesFetched: number;
  newUrls: number;
  duePages: number;
  freshSkips: number;
}

/**
 * Scrapes one source end to end: ensures its Source row exists, loads which pages are already known
 * (and when each was last actually fetched, so the scraper can skip re-fetching ones still fresh),
 * scrapes, ingests, bumps lastSeenAt for the URLs the scraper only saw in a listing, records every
 * page actually fetched this run, and stamps lastScrapedAt.
 *
 * Freshness is tracked in ScrapedPage, not EventSource: a single-date event's card.href becomes its
 * EventSource.url one-to-one, but a tour card's href never does — only each of its stops' hrefs do,
 * under their own rows — so EventSource alone has no entry a tour card could ever match, and every
 * tour card looked "never fetched" on every run, forever (a real bug, caught live).
 */
export async function runScrape(options: RunScrapeOptions): Promise<RunScrapeStats> {
  const source = await prisma.source.upsert({
    where: { slug: options.source },
    update: {},
    create: { slug: options.source, ...SOURCE_INFO[options.source] },
  });

  const now = new Date();
  const knownRows = await prisma.scrapedPage.findMany({ select: { url: true, lastFetchedAt: true } });
  const knownUrls = new Map<string, Date | null>(knownRows.map((row) => [row.url, row.lastFetchedAt]));

  const { raws, touchedUrls, fetchedUrls, listingPagesFetched, newUrls, duePages } = await scrapePredpredaj({
    categories: options.categories,
    maxEventsPerCategory: options.maxEventsPerCategory,
    knownUrls,
    now,
  });

  const stats = await upsertRawEvents(raws, now);

  if (touchedUrls.length > 0) {
    await prisma.eventSource.updateMany({ where: { url: { in: touchedUrls } }, data: { lastSeenAt: now } });
  }

  if (fetchedUrls.length > 0) {
    // createMany (skipDuplicates) seeds rows for URLs never tracked before; updateMany then bumps
    // every fetched URL — new or already-tracked — to `now` in one pass.
    await prisma.scrapedPage.createMany({
      data: fetchedUrls.map((url) => ({ url, lastFetchedAt: now })),
      skipDuplicates: true,
    });
    await prisma.scrapedPage.updateMany({ where: { url: { in: fetchedUrls } }, data: { lastFetchedAt: now } });
  }

  await prisma.source.update({ where: { slug: options.source }, data: { lastScrapedAt: now } });
  return {
    ...stats,
    listingPagesFetched: listingPagesFetched ?? 0,
    newUrls: newUrls ?? 0,
    duePages: duePages ?? 0,
    freshSkips: touchedUrls.length,
  };
}
