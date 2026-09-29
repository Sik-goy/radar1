import 'dotenv/config';
import { prisma } from '@/lib/db';
import { upsertRawEvents } from '@/lib/ingest';
import { buildMockEvents } from '@/lib/mock-events';

const SOURCES = [
  { slug: 'goout', name: 'GoOut', baseUrl: 'https://goout.net' },
  { slug: 'predpredaj', name: 'Predpredaj', baseUrl: 'https://predpredaj.zoznam.sk' },
  { slug: 'ticketportal', name: 'Ticketportal', baseUrl: 'https://www.ticketportal.sk' },
];

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error('Refusing to seed in production: the seed wipes all events.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');

  console.log(`Seeding ${new URL(process.env.DATABASE_URL).host} (wipes Event + EventSource)`);
  await prisma.eventSource.deleteMany();
  await prisma.event.deleteMany();

  for (const source of SOURCES) {
    await prisma.source.upsert({
      where: { slug: source.slug },
      update: { name: source.name, baseUrl: source.baseUrl },
      create: source,
    });
  }

  const stats = await upsertRawEvents(buildMockEvents(new Date()));
  console.log({ created: stats.created, updated: stats.updated, merged: stats.merged, skipped: stats.skipped });

  const total = await prisma.event.count();
  console.log(`events in DB: ${total} (expect ${stats.created})`);

  const aurora = await prisma.event.findFirst({ where: { title: { contains: 'Aurora Bloom' } }, include: { sources: true } });
  console.log(`fuzzy merge: ${aurora?.sources.length} sources (expect 2)`);

  const tribute = await prisma.event.findFirst({ where: { title: { contains: 'Metal Tribute' } }, include: { sources: true } });
  console.log(`currency mix: priceFrom ${tribute?.priceFrom?.toString()}, ${tribute?.sources.length} sources (expect 890, 2)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
