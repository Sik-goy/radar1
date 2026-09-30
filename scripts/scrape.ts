import 'dotenv/config';
import { prisma } from '@/lib/db';
import { PREDPREDAJ_CATEGORIES, type PredpredajCategory } from '@/lib/scrapers/predpredaj/parse';
import { runScrape, SOURCES, type ScraperSource } from '@/lib/scrapers/run-scrape';

function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

function parseArgs(argv: string[]): { source: ScraperSource; category?: PredpredajCategory; maxPages?: number } {
  const source = flagValue(argv, '--source');
  if (!source || !(SOURCES as readonly string[]).includes(source)) {
    throw new Error(`--source is required, one of: ${SOURCES.join(', ')}`);
  }
  const category = flagValue(argv, '--category');
  if (category !== undefined && !(PREDPREDAJ_CATEGORIES as readonly string[]).includes(category)) {
    throw new Error(`--category must be one of: ${PREDPREDAJ_CATEGORIES.join(', ')}`);
  }
  const maxPagesRaw = flagValue(argv, '--max-pages');
  const maxPages = maxPagesRaw !== undefined ? Number(maxPagesRaw) : undefined;
  return { source: source as ScraperSource, category: category as PredpredajCategory | undefined, maxPages };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');
  const { source, category, maxPages } = parseArgs(process.argv.slice(2));

  console.log(
    `Scraping ${source}` +
      (category ? ` (category=${category})` : ' (all categories)') +
      (maxPages !== undefined ? ` maxPages=${maxPages}` : ''),
  );

  const startedAt = Date.now();
  const stats = await runScrape({
    source,
    categories: category ? [category] : undefined,
    maxEventsPerCategory: maxPages,
  });
  const duration = formatDuration(Date.now() - startedAt);

  console.log('Ingest stats:', stats);
  if (stats.skipped.length > 0) {
    console.log(`${stats.skipped.length} item(s) skipped:`);
    for (const s of stats.skipped) console.log(`  - ${s.url}: ${s.reason}`);
  }
  console.log(`Duration: ${duration}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
