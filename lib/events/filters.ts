import type { Prisma } from '@prisma/client';
import { CZK_PER_EUR, MAX_PAGE, SINGLE_EVENT_DURATION_MS } from '@/lib/config';
import { resolveRange, WHEN_VALUES, type When } from '@/lib/dates';
import { GENRES, type Genre } from '@/lib/types';

export type RawParams = Record<string, string | string[] | undefined>;

export interface EventFilters {
  cities: string[];
  genres: Genre[];
  when?: When;
  maxPrice?: number;
  page: number;
}

const all = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const first = (v: string | string[] | undefined): string | undefined => all(v)[0];

export function parseFilters(params: RawParams): EventFilters {
  const cities = [...new Set(all(params.city).map((c) => c.trim()).filter(Boolean))].slice(0, 20);
  const genres = [...new Set(all(params.genre))].filter((g): g is Genre => (GENRES as readonly string[]).includes(g));

  const whenRaw = first(params.when);
  const when = (WHEN_VALUES as readonly string[]).includes(whenRaw ?? '') ? (whenRaw as When) : undefined;

  const priceRaw = first(params.maxPrice);
  // Plain decimal only: no hex (0x10), exponential (1e2) or leading +/- notation Number() would accept.
  const priceNum = priceRaw && /^\d+(\.\d+)?$/.test(priceRaw) ? Number(priceRaw) : Number.NaN;
  // The CZK bound is maxPrice * CZK_PER_EUR, which must stay finite too or Prisma rejects the query.
  const maxPrice = Number.isFinite(priceNum * CZK_PER_EUR) ? priceNum : undefined;

  const pageNum = Math.floor(Number(first(params.page)));
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, MAX_PAGE) : 1;

  return { cities, genres, when, maxPrice, page };
}

/** City, genre and price filters, shared by the main grid and the Happening now row. */
function commonClauses(filters: EventFilters): Prisma.EventWhereInput[] {
  const clauses: Prisma.EventWhereInput[] = [];
  if (filters.cities.length) clauses.push({ city: { in: filters.cities } });
  if (filters.genres.length) clauses.push({ genre: { in: filters.genres } });
  if (filters.maxPrice !== undefined) {
    clauses.push({
      OR: [
        { priceFrom: null },
        { currency: 'EUR', priceFrom: { lte: filters.maxPrice } },
        { currency: 'CZK', priceFrom: { lte: filters.maxPrice * CZK_PER_EUR } },
      ],
    });
  }
  return clauses;
}

/** Main grid: events that have not started yet, inside the selected range. */
export function buildWhere(filters: EventFilters, now: Date): Prisma.EventWhereInput {
  const { start, end } = resolveRange(filters.when, now);
  const and: Prisma.EventWhereInput[] = [{ startsAt: { gte: start } }];
  if (end) and.push({ startsAt: { lte: end } });
  and.push(...commonClauses(filters));
  return { AND: and };
}

export interface HappeningNowWhere {
  multiDay: Prisma.EventWhereInput;
  singleTime: Prisma.EventWhereInput;
}

/**
 * Events that started before now and are not over: multi-day events by `endsAt`, single-time events
 * within the 2h window. Null (row hidden) when the selected range has not begun yet (future weekend).
 * Together with buildWhere this partitions upcoming vs ongoing at `now`.
 */
export function buildHappeningNowWhere(filters: EventFilters, now: Date): HappeningNowWhere | null {
  if (resolveRange(filters.when, now).start.getTime() > now.getTime()) return null;
  const common = commonClauses(filters);
  return {
    multiDay: { AND: [{ startsAt: { lt: now } }, { endsAt: { gte: now } }, ...common] },
    singleTime: {
      AND: [
        { endsAt: null },
        { startsAt: { lt: now } },
        { startsAt: { gte: new Date(now.getTime() - SINGLE_EVENT_DURATION_MS) } },
        ...common,
      ],
    },
  };
}

/** Events that are not over yet, started or not. Feeds the city dropdown. */
export function buildVisibleWhere(now: Date): Prisma.EventWhereInput {
  return {
    OR: [
      { endsAt: { gte: now } },
      { endsAt: null, startsAt: { gte: new Date(now.getTime() - SINGLE_EVENT_DURATION_MS) } },
    ],
  };
}

/** The inverse of a URLSearchParams string: repeated keys become arrays, single ones stay strings. */
export function rawParamsFromSearch(search: string): RawParams {
  const query = new URLSearchParams(search);
  const raw: RawParams = {};
  for (const key of new Set(query.keys())) {
    const values = query.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }
  return raw;
}

/** MAX_PAGE clamps `page` itself, so "load more" must stop offering a next page once it's reached. */
export function hasNextPage(hasMore: boolean, page: number): boolean {
  return hasMore && page < MAX_PAGE;
}

export function withPage(params: RawParams, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'page' || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  query.set('page', String(page));
  return `?${query.toString()}`;
}
