import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runScrape } = vi.hoisted(() => ({ runScrape: vi.fn() }));
vi.mock('@/lib/scrapers/run-scrape', () => ({ runScrape }));

import { GET } from '@/app/api/cron/scrape/route';

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, { headers });

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret';
  runScrape.mockReset().mockResolvedValue({ created: 1, updated: 0, merged: 0, skipped: [] });
});

describe('GET /api/cron/scrape', () => {
  it('rejects a request without the right bearer token', async () => {
    const res = await GET(request('/api/cron/scrape', { authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    expect(runScrape).not.toHaveBeenCalled();
  });

  it('rejects an invalid category', async () => {
    const res = await GET(request('/api/cron/scrape?category=bogus', { authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(400);
    expect(runScrape).not.toHaveBeenCalled();
  });

  it('runs every category when none is given, and returns the stats', async () => {
    const res = await GET(request('/api/cron/scrape', { authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 1, updated: 0, merged: 0, skipped: [] });
    expect(runScrape).toHaveBeenCalledWith({ source: 'predpredaj', categories: undefined, maxEventsPerCategory: undefined });
  });

  it('runs just the given category with an explicit maxEvents override', async () => {
    await GET(request('/api/cron/scrape?category=sport&maxEvents=5', { authorization: 'Bearer test-secret' }));
    expect(runScrape).toHaveBeenCalledWith({ source: 'predpredaj', categories: ['sport'], maxEventsPerCategory: 5 });
  });
});
