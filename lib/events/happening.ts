import { SINGLE_EVENT_DURATION_MS } from '@/lib/config';

export interface Timed {
  startsAt: Date;
  endsAt: Date | null;
}

/** coalesce(endsAt, startsAt + 2h): single-time events count as lasting 2 hours. */
export function effectiveEnd(event: Timed): Date {
  return event.endsAt ?? new Date(event.startsAt.getTime() + SINGLE_EVENT_DURATION_MS);
}

/** Merge the two Happening now queries: soonest effective end first, ties on earlier start, then cut to `limit`. */
export function mergeHappeningNow<T extends Timed>(multiDay: T[], singleTime: T[], limit: number): T[] {
  return [...multiDay, ...singleTime]
    .sort(
      (a, b) =>
        effectiveEnd(a).getTime() - effectiveEnd(b).getTime() || a.startsAt.getTime() - b.startsAt.getTime(),
    )
    .slice(0, limit);
}
