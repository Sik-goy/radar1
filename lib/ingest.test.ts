import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeRaw } from '@/lib/normalize';
import type { RawEvent } from '@/lib/types';

const { findManySources, transaction } = vi.hoisted(() => ({
  findManySources: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { source: { findMany: findManySources }, $transaction: transaction },
}));

import { ingestOne, upsertRawEvents } from '@/lib/ingest';

const raw = (over: Partial<RawEvent> = {}): RawEvent => ({
  source: 'goout',
  sourceUrl: 'https://goout.net/e/1',
  title: 'Jazz Night',
  venue: 'Club',
  city: 'Praha',
  startsAt: new Date('2026-10-10T18:00:00Z'),
  ...over,
});

beforeEach(() => {
  findManySources.mockReset().mockResolvedValue([{ slug: 'goout', id: 's1' }]);
  transaction.mockReset();
});

describe('upsertRawEvents', () => {
  it('skips garbage items with a reason and never touches the DB for them', async () => {
    const stats = await upsertRawEvents([
      raw({ title: '🎉' }),
      raw({ startsAt: new Date('nope') }),
      raw({ city: 'Nowhereville' }),
      raw({ source: 'nope' }),
    ]);
    expect(transaction).not.toHaveBeenCalled();
    expect(stats.created + stats.updated + stats.merged).toBe(0);
    expect(stats.skipped.map((s) => s.reason)).toEqual([
      'empty title',
      'invalid startsAt',
      expect.stringMatching(/unknown country/),
      expect.stringMatching(/unknown source/),
    ]);
  });

  it('contains a DB error to the one item and keeps going', async () => {
    transaction.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('created');
    const stats = await upsertRawEvents([raw({ sourceUrl: 'https://goout.net/e/1' }), raw({ sourceUrl: 'https://goout.net/e/2' })]);
    expect(stats.created).toBe(1);
    expect(stats.skipped).toEqual([{ url: 'https://goout.net/e/1', reason: 'boom' }]);
  });

  it('gives each item transaction enough time for a remote database', async () => {
    transaction.mockResolvedValueOnce('created');
    await upsertRawEvents([raw()]);
    expect(transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ maxWait: expect.any(Number), timeout: expect.any(Number) }),
    );
    const options = transaction.mock.calls[0][1] as { maxWait: number; timeout: number };
    expect(options.maxWait).toBeGreaterThanOrEqual(10_000);
    expect(options.timeout).toBeGreaterThanOrEqual(30_000);
  });

  it('retries once as a merge on a unique-constraint race', async () => {
    const race = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    transaction.mockRejectedValueOnce(race).mockResolvedValueOnce('merged');
    const stats = await upsertRawEvents([raw()]);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(stats.merged).toBe(1);
    expect(stats.skipped).toEqual([]);
  });
});

describe('ingestOne: re-scrape of a known EventSource url', () => {
  const existingEvent = {
    id: 'ev1',
    title: 'Jazz Night',
    venue: 'Old Club',
    city: 'Praha',
    country: 'CZ',
    startsAt: new Date('2026-10-10T18:00:00Z'),
    endsAt: null,
    imageUrl: null,
    currency: 'CZK',
    fingerprint: 'jazz night|old club|2026-10-10',
  };

  function fakeTx(opts: {
    otherSources?: number;
    collision?: { id: string } | null;
    sources?: { priceFrom: { toNumber(): number } | null; currency: string }[];
  } = {}) {
    return {
      eventSource: {
        findUnique: vi.fn().mockResolvedValue({ id: 'src1', eventId: existingEvent.id, event: existingEvent }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(opts.otherSources ?? 0),
        findMany: vi.fn().mockResolvedValue(opts.sources ?? []),
      },
      event: {
        findUnique: vi.fn().mockResolvedValue(opts.collision ?? null),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  const incomingRaw = (over: Partial<RawEvent> = {}): RawEvent => ({
    source: 'goout',
    sourceUrl: 'https://goout.net/e/1',
    title: 'Jazz Night Reloaded',
    venue: 'New Club',
    city: 'Praha',
    startsAt: new Date('2026-10-11T19:00:00Z'),
    endsAt: new Date('2026-10-11T21:00:00Z'),
    ...over,
  });

  it('a single-source event fully trusts the new scrape and reports "updated"', async () => {
    const tx = fakeTx({ otherSources: 0 });
    const n = normalizeRaw(incomingRaw());
    const outcome = await ingestOne(tx, n, 's1', new Date());
    expect(outcome).toBe('updated');
    const data = tx.event.update.mock.calls[0][0].data;
    expect(data.title).toBe('Jazz Night Reloaded');
    expect(data.venue).toBe('New Club');
    expect(data.startsAt).toEqual(n.startsAt);
    expect(data.endsAt).toEqual(n.endsAt);
    expect(data.fingerprint).toBe(n.fingerprint);
    expect(tx.event.delete).not.toHaveBeenCalled();
  });

  it('merges into the colliding event when the rewritten fingerprint matches one', async () => {
    const collisionEvent = { ...existingEvent, id: 'ev2', title: 'Jazz Night Reloaded' };
    const tx = fakeTx({ otherSources: 0, collision: collisionEvent });
    const n = normalizeRaw(incomingRaw());
    const outcome = await ingestOne(tx, n, 's1', new Date());
    expect(outcome).toBe('merged');
    expect(tx.eventSource.update).toHaveBeenCalledWith({ where: { id: 'src1' }, data: { eventId: 'ev2' } });
    expect(tx.event.delete).toHaveBeenCalledWith({ where: { id: 'ev1' } });
    expect(tx.event.update.mock.calls[0][0].where).toEqual({ id: 'ev2' });
  });

  it('a multi-source event ignores a small startsAt drift and leaves title/venue untouched', async () => {
    const tx = fakeTx({ otherSources: 1 });
    const n = normalizeRaw(incomingRaw({ startsAt: new Date(existingEvent.startsAt.getTime() + 30 * 60_000) }));
    const outcome = await ingestOne(tx, n, 's1', new Date());
    expect(outcome).toBe('updated');
    const data = tx.event.update.mock.calls[0][0].data;
    expect(data.title).toBeUndefined();
    expect(data.venue).toBeUndefined();
    expect(data.startsAt).toBeUndefined();
    expect(data.fingerprint).toBeUndefined();
  });

  it('a multi-source event accepts a startsAt change past the fuzzy window as a reschedule', async () => {
    const tx = fakeTx({ otherSources: 2 });
    const newStart = new Date(existingEvent.startsAt.getTime() + 4 * 60 * 60_000);
    const n = normalizeRaw(incomingRaw({ startsAt: newStart, endsAt: null }));
    const outcome = await ingestOne(tx, n, 's1', new Date());
    expect(outcome).toBe('updated');
    const data = tx.event.update.mock.calls[0][0].data;
    expect(data.startsAt).toEqual(newStart);
    expect(data.title).toBeUndefined();
    expect(data.fingerprint).toBeUndefined();
  });
});
