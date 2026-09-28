import { describe, expect, it } from 'vitest';
import { deriveSortFields } from '@/lib/events/derive';

describe('deriveSortFields', () => {
  it('startDay is the Prague date at UTC midnight', () => {
    const r = deriveSortFields({ startsAt: new Date('2026-09-30T22:30:00Z'), priceFrom: 10 });
    expect(r.startDay.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('priceKnown is true for free (0) and false for unknown (null)', () => {
    const startsAt = new Date('2026-10-10T16:00:00Z');
    expect(deriveSortFields({ startsAt, priceFrom: 0 }).priceKnown).toBe(true);
    expect(deriveSortFields({ startsAt, priceFrom: 12.5 }).priceKnown).toBe(true);
    expect(deriveSortFields({ startsAt, priceFrom: null }).priceKnown).toBe(false);
  });
});
