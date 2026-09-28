import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawEvent } from '@/lib/types';

const { findManySources, transaction } = vi.hoisted(() => ({
  findManySources: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { source: { findMany: findManySources }, $transaction: transaction },
}));

import { upsertRawEvents } from '@/lib/ingest';

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
