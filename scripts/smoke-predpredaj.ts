import 'dotenv/config';
import { prisma } from '@/lib/db';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');
  console.log(`Reporting on predpredaj events in ${new URL(process.env.DATABASE_URL).host}`);

  const events = await prisma.event.findMany({
    where: { sources: { some: { source: { slug: 'predpredaj' } } } },
    include: { sources: { include: { source: true } } },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\n${events.length} predpredaj-sourced event(s) in the DB:`);
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
