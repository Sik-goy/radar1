import { Prisma, type Event as EventRow } from '@prisma/client';
import { FUZZY_WINDOW_MS } from '@/lib/config';
import { prisma } from '@/lib/db';
import { blankFills, computeEventPrice, pickFuzzyMatch, reconcileRescrape } from '@/lib/dedupe';
import { deriveSortFields } from '@/lib/events/derive';
import { normalizeRaw, type NormalizedEvent } from '@/lib/normalize';
import type { RawEvent } from '@/lib/types';

type Tx = Prisma.TransactionClient;
type Outcome = 'created' | 'updated' | 'merged';

export interface IngestStats {
  created: number;
  updated: number;
  merged: number;
  skipped: { url: string; reason: string }[];
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function upsertRawEvents(raws: RawEvent[], now: Date = new Date()): Promise<IngestStats> {
  const stats: IngestStats = { created: 0, updated: 0, merged: 0, skipped: [] };
  const sourceIds = new Map((await prisma.source.findMany()).map((s) => [s.slug, s.id]));

  // Sequential on purpose: later items in a batch can match earlier ones.
  for (const raw of raws) {
    let normalized: NormalizedEvent;
    try {
      normalized = normalizeRaw(raw);
    } catch (e) {
      stats.skipped.push({ url: raw.sourceUrl, reason: messageOf(e) });
      continue;
    }
    const sourceId = sourceIds.get(normalized.sourceSlug);
    if (!sourceId) {
      stats.skipped.push({ url: raw.sourceUrl, reason: `unknown source "${normalized.sourceSlug}"` });
      continue;
    }
    try {
      stats[await ingestWithRetry(normalized, sourceId, now)] += 1;
    } catch (e) {
      stats.skipped.push({ url: raw.sourceUrl, reason: messageOf(e) });
    }
  }
  return stats;
}

// Prisma's defaults (2s to start, 5s to finish) are too tight for a remote pooled Neon database:
// each item runs ~8 sequential queries.
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

async function ingestWithRetry(n: NormalizedEvent, sourceId: string, now: Date): Promise<Outcome> {
  try {
    return await prisma.$transaction((tx) => ingestOne(tx, n, sourceId, now), TX_OPTIONS);
  } catch (e) {
    // Unique violation on fingerprint or url: another writer got there first. Redo as a merge.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return prisma.$transaction((tx) => ingestOne(tx, n, sourceId, now), TX_OPTIONS);
    }
    throw e;
  }
}

export async function ingestOne(tx: Tx, n: NormalizedEvent, sourceId: string, now: Date): Promise<Outcome> {
  // 1. Known listing URL: a re-scrape.
  const known = await tx.eventSource.findUnique({ where: { url: n.url }, include: { event: true } });
  if (known) {
    await tx.eventSource.update({
      where: { id: known.id },
      data: { priceFrom: n.price, currency: n.priceCurrency, lastSeenAt: now, lastDetailFetchedAt: now },
    });

    // A single-source event has nothing else vouching for its data, so the fresh scrape fully
    // replaces it. A multi-source event only accepts a startsAt drift past the fuzzy window.
    const otherSources = await tx.eventSource.count({ where: { eventId: known.eventId, id: { not: known.id } } });
    const fields = reconcileRescrape(known.event, n, otherSources > 0);

    if (fields.startsAt && fields.startsAt.getTime() !== known.event.startsAt.getTime()) {
      console.log(
        `[ingest] reschedule: "${known.event.title}" ${known.event.startsAt.toISOString()} -> ${fields.startsAt.toISOString()}`,
      );
    }

    if (fields.fingerprint && fields.fingerprint !== known.event.fingerprint) {
      // The rewritten fingerprint may now collide with an event we already track separately.
      const collision = await tx.event.findUnique({ where: { fingerprint: fields.fingerprint } });
      if (collision && collision.id !== known.eventId) {
        await tx.eventSource.update({ where: { id: known.id }, data: { eventId: collision.id } });
        await tx.event.delete({ where: { id: known.eventId } });
        await fillAndRefresh(tx, collision, n);
        return 'merged';
      }
    }

    await fillAndRefresh(tx, known.event, n, fields);
    return 'updated';
  }

  // 2. Same fingerprint, then 3. fuzzy (same city, +/-3h, similar title).
  const target = (await tx.event.findUnique({ where: { fingerprint: n.fingerprint } })) ?? (await findFuzzy(tx, n));
  if (target) {
    await tx.eventSource.create({
      data: {
        eventId: target.id,
        sourceId,
        url: n.url,
        priceFrom: n.price,
        currency: n.priceCurrency,
        lastSeenAt: now,
        lastDetailFetchedAt: now,
      },
    });
    await fillAndRefresh(tx, target, n);
    return 'merged';
  }

  // 4. New event.
  const priceFrom = n.priceCurrency === n.currency ? n.price : null;
  await tx.event.create({
    data: {
      title: n.title,
      venue: n.venue,
      city: n.city,
      country: n.country,
      startsAt: n.startsAt,
      endsAt: n.endsAt,
      currency: n.currency,
      genre: n.genre,
      imageUrl: n.imageUrl,
      fingerprint: n.fingerprint,
      priceFrom,
      ...deriveSortFields({ startsAt: n.startsAt, priceFrom }),
      sources: {
        create: { sourceId, url: n.url, priceFrom: n.price, currency: n.priceCurrency, lastSeenAt: now, lastDetailFetchedAt: now },
      },
    },
  });
  return 'created';
}

async function findFuzzy(tx: Tx, n: NormalizedEvent): Promise<EventRow | null> {
  const candidates = await tx.event.findMany({
    where: {
      city: n.city,
      startsAt: {
        gte: new Date(n.startsAt.getTime() - FUZZY_WINDOW_MS),
        lte: new Date(n.startsAt.getTime() + FUZZY_WINDOW_MS),
      },
    },
  });
  return pickFuzzyMatch(n.title, candidates);
}

/**
 * Fill blank fields from the incoming listing and recompute price + sort columns from all sources.
 * `overrides` (from `reconcileRescrape`) are applied as absolute values ahead of the blank-fill pass,
 * which then becomes a no-op for any field an override already set.
 */
async function fillAndRefresh(
  tx: Tx,
  event: EventRow,
  n: NormalizedEvent,
  overrides: Partial<Pick<EventRow, 'startsAt' | 'title' | 'venue' | 'endsAt' | 'fingerprint'>> = {},
): Promise<void> {
  const merged = { ...event, ...overrides };
  const sources = await tx.eventSource.findMany({
    where: { eventId: event.id },
    select: { priceFrom: true, currency: true },
  });
  const priceFrom = computeEventPrice(
    sources.map((s) => ({ priceFrom: s.priceFrom ? s.priceFrom.toNumber() : null, currency: s.currency })),
    event.currency,
  );
  await tx.event.update({
    where: { id: event.id },
    data: {
      ...overrides,
      ...blankFills(merged, n),
      priceFrom,
      ...deriveSortFields({ startsAt: merged.startsAt, priceFrom }),
    },
  });
}
