import { TZDate } from '@date-fns/tz';
import { addDays, endOfDay, format, set } from 'date-fns';

export const TZ = 'Europe/Prague';
export const WHEN_VALUES = ['today', 'weekend', 'week', 'month'] as const;
export type When = (typeof WHEN_VALUES)[number];

export interface DateRange {
  start: Date;
  end: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const plain = (d: Date) => new Date(d.getTime());

export function pragueDateString(date: Date): string {
  return format(new TZDate(date, TZ), 'yyyy-MM-dd');
}

export function pragueDay(date: Date): Date {
  return new Date(`${pragueDateString(date)}T00:00:00.000Z`);
}

export function isMultiDay(startsAt: Date, endsAt: Date | null | undefined): boolean {
  return !!endsAt && pragueDateString(startsAt) !== pragueDateString(endsAt);
}

export function resolveRange(when: When | undefined, now: Date): DateRange {
  const local = new TZDate(now, TZ);
  switch (when) {
    case 'today':
      return { start: now, end: plain(endOfDay(local)) };
    case 'week':
      return { start: now, end: new Date(now.getTime() + 7 * DAY_MS) };
    case 'month':
      return { start: now, end: new Date(now.getTime() + 30 * DAY_MS) };
    case 'weekend': {
      const sunday = addDays(local, (7 - local.getDay()) % 7);
      const friday18 = set(addDays(sunday, -2), { hours: 18, minutes: 0, seconds: 0, milliseconds: 0 });
      const start = plain(friday18);
      return { start: start > now ? start : now, end: plain(endOfDay(sunday)) };
    }
    default:
      return { start: now, end: null };
  }
}
