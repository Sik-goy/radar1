import { describe, expect, it } from 'vitest';
import { isMultiDay, pragueDateString, pragueDay, resolveRange } from '@/lib/dates';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('pragueDateString / pragueDay', () => {
  it('uses the Prague calendar date, not UTC', () => {
    expect(pragueDateString(new Date('2026-09-30T21:59:00Z'))).toBe('2026-09-30');
    expect(pragueDateString(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01');
  });

  it('handles the winter offset', () => {
    expect(pragueDateString(new Date('2026-12-31T22:30:00Z'))).toBe('2026-12-31');
    expect(pragueDateString(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });

  it('pragueDay returns UTC midnight of the Prague date', () => {
    expect(pragueDay(new Date('2026-09-30T22:30:00Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('isMultiDay', () => {
  it('is false without endsAt or on the same Prague day', () => {
    const start = new Date('2026-10-10T16:00:00Z');
    expect(isMultiDay(start, null)).toBe(false);
    expect(isMultiDay(start, undefined)).toBe(false);
    expect(isMultiDay(start, new Date('2026-10-10T20:00:00Z'))).toBe(false);
  });

  it('is true when the end falls on a later Prague day', () => {
    const start = new Date('2026-10-10T16:00:00Z');
    expect(isMultiDay(start, new Date('2026-10-10T22:30:00Z'))).toBe(true);
    expect(isMultiDay(start, new Date('2026-10-12T10:00:00Z'))).toBe(true);
  });
});

describe('resolveRange', () => {
  const wed = new Date('2026-09-30T10:00:00Z');

  it('no filter: from now, open-ended', () => {
    const r = resolveRange(undefined, wed);
    expect(iso(r.start)).toBe(wed.toISOString());
    expect(r.end).toBeNull();
  });

  it('today: now to end of the Prague day', () => {
    const r = resolveRange('today', wed);
    expect(iso(r.start)).toBe(wed.toISOString());
    expect(iso(r.end)).toBe('2026-09-30T21:59:59.999Z');
  });

  it('today just after Prague midnight uses the new Prague day', () => {
    const r = resolveRange('today', new Date('2026-09-30T22:30:00Z'));
    expect(iso(r.end)).toBe('2026-10-01T21:59:59.999Z');
  });

  it('week: now + 7 days', () => {
    const r = resolveRange('week', wed);
    expect(iso(r.end)).toBe('2026-10-07T10:00:00.000Z');
  });

  it('month: now + 30 days', () => {
    const r = resolveRange('month', wed);
    expect(iso(r.end)).toBe('2026-10-30T10:00:00.000Z');
  });

  it('weekend from midweek: Fri 18:00 to Sun end of day', () => {
    const r = resolveRange('weekend', wed);
    expect(iso(r.start)).toBe('2026-10-02T16:00:00.000Z');
    expect(iso(r.end)).toBe('2026-10-04T21:59:59.999Z');
  });

  it('weekend on Friday before 18:00 starts at 18:00', () => {
    const r = resolveRange('weekend', new Date('2026-10-02T15:00:00Z'));
    expect(iso(r.start)).toBe('2026-10-02T16:00:00.000Z');
  });

  it('weekend on Friday after 18:00 starts now', () => {
    const now = new Date('2026-10-02T17:00:00Z');
    const r = resolveRange('weekend', now);
    expect(iso(r.start)).toBe(now.toISOString());
    expect(iso(r.end)).toBe('2026-10-04T21:59:59.999Z');
  });

  it('weekend on Saturday starts now', () => {
    const now = new Date('2026-10-03T10:00:00Z');
    const r = resolveRange('weekend', now);
    expect(iso(r.start)).toBe(now.toISOString());
    expect(iso(r.end)).toBe('2026-10-04T21:59:59.999Z');
  });

  it('weekend on Sunday evening starts now and ends at Prague midnight', () => {
    const now = new Date('2026-10-04T20:00:00Z');
    const r = resolveRange('weekend', now);
    expect(iso(r.start)).toBe(now.toISOString());
    expect(iso(r.end)).toBe('2026-10-04T21:59:59.999Z');
  });

  it('weekend on Monday jumps to the next weekend', () => {
    const r = resolveRange('weekend', new Date('2026-10-05T08:00:00Z'));
    expect(iso(r.start)).toBe('2026-10-09T16:00:00.000Z');
    expect(iso(r.end)).toBe('2026-10-11T21:59:59.999Z');
  });

  it('weekend spanning the DST change keeps Prague wall-clock times', () => {
    const r = resolveRange('weekend', new Date('2026-10-21T10:00:00Z'));
    expect(iso(r.start)).toBe('2026-10-23T16:00:00.000Z');
    expect(iso(r.end)).toBe('2026-10-25T22:59:59.999Z');
  });
});
