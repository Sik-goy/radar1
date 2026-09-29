import 'dotenv/config';
import { prisma } from '@/lib/db';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');
  console.log(`Clearing mock-source events from ${new URL(process.env.DATABASE_URL).host}`);

  const mockSource = await prisma.source.findUnique({ where: { slug: 'mock' } });
  if (!mockSource) {
    console.log('No "mock" Source row found — nothing to clear.');
    return;
  }

  const { count: sourcesDeleted } = await prisma.eventSource.deleteMany({ where: { sourceId: mockSource.id } });
  // An event kept afloat only by mock sources is now orphaned; one that also had a real source stays.
  const { count: eventsDeleted } = await prisma.event.deleteMany({ where: { sources: { none: {} } } });

  console.log(`Deleted ${sourcesDeleted} mock EventSource row(s) and ${eventsDeleted} now-orphaned Event(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
