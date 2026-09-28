import type { Prisma } from '@prisma/client';
import { HAPPENING_NOW_LIMIT, PAGE_SIZE } from '@/lib/config';
import { prisma } from '@/lib/db';
import { toEventCard, type EventCardData } from '@/lib/events/card';
import { buildHappeningNowWhere, buildVisibleWhere, buildWhere, type EventFilters } from '@/lib/events/filters';
import { mergeHappeningNow } from '@/lib/events/happening';

const withSources = { sources: { include: { source: { select: { name: true } } } } } satisfies Prisma.EventInclude;

/** Main grid: events that have not started yet. Priced first within a day. */
export async function queryEvents(
  filters: EventFilters,
  now: Date = new Date(),
): Promise<{ events: EventCardData[]; hasMore: boolean }> {
  const take = filters.page * PAGE_SIZE;
  const rows = await prisma.event.findMany({
    where: buildWhere(filters, now),
    orderBy: [{ startDay: 'asc' }, { priceKnown: 'desc' }, { startsAt: 'asc' }],
    take: take + 1,
    include: withSources,
  });
  return { events: rows.slice(0, take).map(toEventCard), hasMore: rows.length > take };
}

/**
 * Happening now row: started, not ended, soonest effective end first, max HAPPENING_NOW_LIMIT.
 * Two queries because Prisma cannot order by coalesce(endsAt, startsAt + 2h). Each query already
 * returns its own soonest-ending events, so the merged top N is contained in their union.
 */
export async function queryHappeningNow(filters: EventFilters, now: Date = new Date()): Promise<EventCardData[]> {
  const where = buildHappeningNowWhere(filters, now);
  if (!where) return [];
  const [multiDay, singleTime] = await Promise.all([
    prisma.event.findMany({
      where: where.multiDay,
      orderBy: { endsAt: 'asc' },
      take: HAPPENING_NOW_LIMIT,
      include: withSources,
    }),
    prisma.event.findMany({
      where: where.singleTime,
      orderBy: { startsAt: 'asc' },
      take: HAPPENING_NOW_LIMIT,
      include: withSources,
    }),
  ]);
  return mergeHappeningNow(multiDay.map(toEventCard), singleTime.map(toEventCard), HAPPENING_NOW_LIMIT);
}

/** Cities that have events not yet over (grid or row), for the city multiselect. */
export async function getCityOptions(now: Date = new Date()): Promise<string[]> {
  const rows = await prisma.event.findMany({
    where: buildVisibleWhere(now),
    distinct: ['city'],
    select: { city: true },
    orderBy: { city: 'asc' },
  });
  return rows.map((r) => r.city);
}
