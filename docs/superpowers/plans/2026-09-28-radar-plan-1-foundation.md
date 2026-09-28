# Radar Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Radar feed: Prisma schema on Neon, pure normalize/dedupe/date modules with unit tests, an ingest pipeline, a mock seed, and a filterable, translated event grid.

**Architecture:** Pure, DB-free modules (`lib/normalize`, `lib/dedupe`, `lib/dates`, `lib/events/filters`) hold all decision logic and carry the unit tests. `lib/ingest.ts` is the only writer: URL match, then fingerprint, then fuzzy, then insert. The home page is a server component that reads filters from URL search params and queries Prisma directly for two lists: the main grid (events that have not started yet) and a "Happening now" row (started, not yet ended). The filter bar is a client component that only rewrites the URL.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind CSS v4, Prisma 6 on Neon Postgres, date-fns v4 + `@date-fns/tz`, Vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-09-28-radar-design.md`

**Human prerequisite (Task 2):** a Neon dev branch and its two connection strings. If they are not available when Task 2 starts, stop and ask.

## Global Constraints

- Node 20+. Scripts are npm + `tsx` only; no bash-only steps (must run on macOS and Windows).
- Next.js 15 App Router, React 19, TypeScript `strict`, Tailwind. Import alias `@/*` maps to the repo root.
- Prisma is pinned to major 6 (`prisma@^6`, `@prisma/client@^6`). Do not upgrade to 7 in this plan.
- Env: `DATABASE_URL` (Neon pooled, needs `pgbouncer=true`) and `DIRECT_URL` (Neon direct, used by migrations). `.env*` is git-ignored except `.env.example`.
- Genres are exactly: `concert, electronic, theatre, exhibition, standup, sport, other`. Countries: `SK, CZ`. Currencies: `EUR, CZK` (SK=EUR, CZ=CZK).
- Canonical city names are local names with diacritics (`Bratislava`, `Praha`, `Košice`, ...).
- All calendar logic uses `Europe/Prague`.
- Fingerprint = `normalizeText(title) | normalizeText(venue) | YYYY-MM-DD` (Prague date).
- Fuzzy match: same city AND `|startsAt diff| <= 3h` AND normalized title distance `< 0.2` (edit distance / longer normalized title). Venue is not compared.
- Ingest order: `EventSource.url` (canonicalized) first, then fingerprint, then fuzzy, then insert.
- `Event.priceFrom` = min of `EventSource.priceFrom` where `EventSource.currency == Event.currency`. `0` = free, `null` = unknown. Currencies are never compared.
- Effective end = `coalesce(endsAt, startsAt + 2h)`. Events whose effective end is before now appear nowhere.
- Main grid = events with `startsAt >= rangeStart` (and `startsAt <= rangeEnd` when the range has an end), sorted by `startsAt`. Events that already started never appear in the grid, so ongoing events never pin to its top.
- "Happening now" row (labels "Práve prebieha" / "Právě probíhá" / "Happening now") = events with `startsAt < now` and effective end `>= now`, max 12 (`HAPPENING_NOW_LIMIT`), sorted by effective end ascending. Same city/genre/maxPrice filters apply. Hidden when the range start is in the future (a weekend that has not begun); shown for every other range. Horizontal scroll, hidden when empty.
- Date ranges: `today` = now to end of Prague day; `week` = now + 7d; `month` = now + 30d; `weekend` = Fri 18:00 to Sun end of day (start = now if already inside; next weekend if past).
- `maxPrice` is in EUR. CZK events compare against `maxPrice * CZK_PER_EUR` (constant `25`). Events with `priceFrom = null` always pass the filter.
- Main grid sort: `startDay` asc, `priceKnown` desc, `startsAt` asc (denormalized columns `startDay`, `priceKnown`), so priced events come first within a day.
- Page size 24. "Load more" re-renders the first `page * 24` events.
- Price labels: null = "cena neuvedená" (sk) / "cena neuvedena" (cs) / "price TBA" (en); 0 = "zadarmo" / "zdarma" / "free".
- Language via `lang` cookie (default from `Accept-Language`, fallback `sk`). Locale codes `sk`, `cs`, `en`; the `cs` toggle is labelled "CZ".
- Browsing the running app is done with the `/browse` skill only.
- Commits: conventional-commit subject, and end the message with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but does not spell out. Each has a pinning test in the task named.

1. Two different events whose titles differ only by a number (`Jazz Night 1` vs `Jazz Night 2`, `Tour 2026` vs `Tour 2027`) must NOT be merged by fuzzy match, even though edit distance is under 0.2. Guard: if both titles contain numbers and the number sequences differ, no match. (Task 6)
2. `maxPrice=0` must filter to free + unknown-price events, not be treated as "unset". An empty `maxPrice=`, `abc`, negative or infinite value is ignored. (Task 7)
3. Scraper garbage must skip the one item, not crash the batch: title that normalizes to empty (emoji-only), invalid `startsAt`, unknown city with no country, unknown source slug, a DB error on one item. (Tasks 5 and 8)
4. Malformed URL params: single vs repeated `city`, unknown `genre` values, bogus `when`, `page=0`/`-3`/`abc`/huge. Must yield safe defaults. (Task 7)
5. Prices from scrapers: negative, `NaN`, missing become unknown (null); `0` stays free; a source in the other currency never affects `Event.priceFrom`. (Tasks 5 and 6)
6. The boundary between the grid and the Happening now row: an event starting exactly at `now` is in the grid (`startsAt >= now`), not the row (`startsAt < now`); a single-time event exactly 2h old still counts as happening; the row is hidden under a future-weekend filter but shown once now is inside the weekend; row ordering ties (same effective end) break by earlier `startsAt`. (Task 7)

---

## File Structure

```
package.json, tsconfig.json, next.config.ts, postcss.config.mjs, vitest.config.ts
.env.example, README.md
prisma/schema.prisma, prisma/seed.ts, prisma/migrations/...
app/layout.tsx, app/globals.css, app/page.tsx
components/Header.tsx, components/FilterBar.tsx, components/EventCard.tsx, components/HappeningNow.tsx
lib/types.ts            shared unions + RawEvent
lib/config.ts           constants (page size, thresholds, CZK_PER_EUR)
lib/db.ts               Prisma singleton
lib/dates.ts            Prague-time helpers + resolveRange
lib/format.ts           Intl date/money formatting
lib/normalize/          text.ts url.ts fingerprint.ts city.ts genre.ts index.ts (normalizeRaw)
lib/dedupe.ts           levenshtein, titleDistance, pickFuzzyMatch, computeEventPrice, blankFills
lib/events/derive.ts    deriveSortFields
lib/events/filters.ts   parseFilters, buildWhere, buildHappeningNowWhere, buildVisibleWhere, withPage (pure)
lib/events/happening.ts effectiveEnd, mergeHappeningNow (pure)
lib/events/card.ts      toEventCard (pure row -> view mapper)
lib/events/query.ts     queryEvents, queryHappeningNow, getCityOptions (DB)
lib/ingest.ts           upsertRawEvents (DB)
lib/mock-events.ts      buildMockEvents(now)
lib/i18n/               dictionaries.ts pick.ts server.ts actions.ts
```

Tests sit next to the code as `*.test.ts`.

---

### Task 1: Scaffold Next.js, Tailwind, Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`

**Interfaces:**
- Produces: working `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`; alias `@/` resolves in Next, tsc, Vitest and tsx.

The repo already has `.gitignore` and `docs/`. Scaffold by hand: `create-next-app` refuses non-empty directories.

- [ ] **Step 1: Confirm repo state**

Run: `git status --short && git log --oneline -1`
Expected: a git repo exists and the spec commit is present. If not, stop and ask.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "radar",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install next@^15 react@^19 react-dom@^19 date-fns@^4 @date-fns/tz@^1
npm install -D typescript @types/node @types/react@^19 @types/react-dom@^19 tailwindcss@^4 @tailwindcss/postcss@^4 postcss vitest tsx dotenv
```

- [ ] **Step 4: Write config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

export default nextConfig;
```

`postcss.config.mjs`:
```js
const config = { plugins: { '@tailwindcss/postcss': {} } };

export default config;
```

`vitest.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: root }] },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
});
```

`app/globals.css`:
```css
@import 'tailwindcss';
```

`app/layout.tsx` (replaced in Task 10):
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Radar' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx` (replaced in Task 11):
```tsx
export default function HomePage() {
  return <main className="p-8 text-2xl font-semibold">Radar</main>;
}
```

- [ ] **Step 5: Verify build and typecheck**

Run: `npm run build && npm run typecheck`
Expected: both succeed; build output lists route `/`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs vitest.config.ts app
git commit -m "chore: scaffold Next.js 15, Tailwind 4, Vitest"
```

---

### Task 2: Prisma schema, migration, DB client, env, README

**Files:**
- Create: `prisma/schema.prisma`, `lib/db.ts`, `.env.example`, `README.md`
- Modify: `package.json` (scripts, prisma seed config)

**Interfaces:**
- Produces: generated `@prisma/client` with models `Event`, `Source`, `EventSource`, `Favorite`, `User`, `Session`, `VerificationToken`; `prisma` singleton exported from `@/lib/db`; scripts `db:migrate`, `db:deploy`, `db:seed`.

**Human prerequisite:** in the Neon console, create a branch named `dev` from the main branch. Copy its **pooled** connection string (host contains `-pooler`) and its **direct** connection string. Put them in a local `.env` (never committed).

- [ ] **Step 1: Install Prisma 6**

```bash
npm install @prisma/client@^6
npm install -D prisma@^6
npm pkg set scripts.postinstall="prisma generate"
npm pkg set scripts.build="prisma generate && next build"
npm pkg set scripts.db:migrate="prisma migrate dev"
npm pkg set scripts.db:deploy="prisma migrate deploy"
npm pkg set scripts.db:seed="prisma db seed"
npm pkg set prisma.seed="tsx prisma/seed.ts"
```

- [ ] **Step 2: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

enum Genre {
  concert
  electronic
  theatre
  exhibition
  standup
  sport
  other
}

enum Country {
  SK
  CZ
}

enum Currency {
  EUR
  CZK
}

model Event {
  id          String        @id @default(cuid())
  title       String
  venue       String
  city        String
  country     Country
  startsAt    DateTime
  endsAt      DateTime?
  priceFrom   Decimal?      @db.Decimal(10, 2)
  currency    Currency
  startDay    DateTime      @db.Date
  priceKnown  Boolean
  genre       Genre
  imageUrl    String?
  fingerprint String        @unique
  sources     EventSource[]
  favorites   Favorite[]
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@index([startDay, priceKnown, startsAt])
  @@index([startsAt])
  @@index([endsAt])
  @@index([city])
  @@index([genre])
}

model Source {
  id            String        @id @default(cuid())
  slug          String        @unique
  name          String
  baseUrl       String
  lastScrapedAt DateTime?
  events        EventSource[]
}

model EventSource {
  id         String   @id @default(cuid())
  eventId    String
  sourceId   String
  url        String   @unique
  priceFrom  Decimal? @db.Decimal(10, 2)
  currency   Currency
  lastSeenAt DateTime
  event      Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  source     Source   @relation(fields: [sourceId], references: [id])

  @@index([eventId])
  @@index([sourceId])
}

model Favorite {
  userId    String
  eventId   String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  event     Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@id([userId, eventId])
}

// Auth.js Prisma adapter models. An Account model is not needed for email magic link.
model User {
  id            String     @id @default(cuid())
  email         String     @unique
  emailVerified DateTime?
  digestOptOut  Boolean    @default(false)
  favorites     Favorite[]
  sessions      Session[]
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

- [ ] **Step 3: Write `.env.example`**

```
# Neon pooled connection (host contains "-pooler"). pgbouncer=true is required by Prisma with the pooler.
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require&pgbouncer=true"

# Neon direct connection (no "-pooler"). Used by `prisma migrate`.
DIRECT_URL="postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require"
```

- [ ] **Step 4: Create local `.env` and verify it is ignored**

Copy `.env.example` to `.env` and paste the two real Neon dev-branch strings.
Run: `git check-ignore .env && git check-ignore -v .env.example`
Expected: first command prints `.env`; second prints nothing (the example is NOT ignored; a non-zero exit is correct there).

- [ ] **Step 5: Write `lib/db.ts`**

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

- [ ] **Step 6: Write `README.md`**

````markdown
# Radar

Aggregated event feed for Slovakia and Czech Republic.

## Setup

1. Node 20+, then `npm install`.
2. Create a Neon **dev** branch. Copy `.env.example` to `.env` and fill `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
3. `npm run db:migrate` (creates tables on the dev branch).
4. `npm run db:seed` (wipes and reloads mock events; never point `.env` at production).
5. `npm run dev`, open http://localhost:3000.

## Scripts

- `npm test` unit tests (no DB or network)
- `npm run typecheck`
- `npm run build`

Design: `docs/superpowers/specs/2026-09-28-radar-design.md`
````

- [ ] **Step 7: Migrate and verify**

Run: `npx prisma validate && npx prisma migrate dev --name init && npx prisma migrate status`
Expected: validate passes; migrate reports the database is in sync; status says "Database schema is up to date!". A folder `prisma/migrations/<timestamp>_init` exists.

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add prisma lib/db.ts .env.example README.md package.json package-lock.json
git commit -m "feat: add Prisma schema, initial migration, db client"
```

---

### Task 3: Dates, config, sort-field derivation

**Files:**
- Create: `lib/config.ts`, `lib/dates.ts`, `lib/events/derive.ts`
- Test: `lib/dates.test.ts`, `lib/events/derive.test.ts`

**Interfaces:**
- Produces:
  - `lib/config.ts`: `CZK_PER_EUR = 25`, `PAGE_SIZE = 24`, `MAX_PAGE = 50`, `HAPPENING_NOW_LIMIT = 12`, `SINGLE_EVENT_DURATION_MS`, `FUZZY_WINDOW_MS`, `FUZZY_THRESHOLD = 0.2`
  - `lib/dates.ts`: `TZ`, `WHEN_VALUES`, `type When`, `interface DateRange { start: Date; end: Date | null }`, `pragueDateString(d: Date): string`, `pragueDay(d: Date): Date`, `isMultiDay(startsAt: Date, endsAt: Date | null | undefined): boolean`, `resolveRange(when: When | undefined, now: Date): DateRange`
  - `lib/events/derive.ts`: `deriveSortFields(input: { startsAt: Date; priceFrom: number | null }): { startDay: Date; priceKnown: boolean }`

All date maths run on `TZDate` in Europe/Prague and never depend on the machine time zone. Reference dates: 2026-09-30 is a Wednesday; Prague is UTC+2 until 2026-10-25, then UTC+1.

- [ ] **Step 1: Write `lib/config.ts`**

```ts
export const CZK_PER_EUR = 25;
export const PAGE_SIZE = 24;
export const MAX_PAGE = 50;
export const HAPPENING_NOW_LIMIT = 12;
export const SINGLE_EVENT_DURATION_MS = 2 * 60 * 60 * 1000;
export const FUZZY_WINDOW_MS = 3 * 60 * 60 * 1000;
export const FUZZY_THRESHOLD = 0.2;
```

- [ ] **Step 2: Write the failing tests**

`lib/dates.test.ts`:
```ts
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
```

`lib/events/derive.test.ts`:
```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/dates.test.ts lib/events/derive.test.ts`
Expected: FAIL, cannot resolve `@/lib/dates` / `@/lib/events/derive`.

- [ ] **Step 4: Implement**

`lib/dates.ts`:
```ts
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
```

`lib/events/derive.ts`:
```ts
import { pragueDay } from '@/lib/dates';

export function deriveSortFields(input: { startsAt: Date; priceFrom: number | null }): {
  startDay: Date;
  priceKnown: boolean;
} {
  return { startDay: pragueDay(input.startsAt), priceKnown: input.priceFrom !== null };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/dates.test.ts lib/events/derive.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add lib/config.ts lib/dates.ts lib/dates.test.ts lib/events/derive.ts lib/events/derive.test.ts
git commit -m "feat: add Prague date ranges and sort-field derivation"
```

---

### Task 4: Types, text normalization, URL canonicalization, fingerprint

**Files:**
- Create: `lib/types.ts`, `lib/normalize/text.ts`, `lib/normalize/url.ts`, `lib/normalize/fingerprint.ts`
- Test: `lib/normalize/text.test.ts`, `lib/normalize/url.test.ts`, `lib/normalize/fingerprint.test.ts`

**Interfaces:**
- Consumes: `pragueDateString` from `@/lib/dates`.
- Produces:
  - `lib/types.ts`: `GENRES`, `type Genre`, `COUNTRIES`, `type Country`, `CURRENCIES`, `type Currency`, `CURRENCY_BY_COUNTRY: Record<Country, Currency>`, `interface RawEvent { source: string; sourceUrl: string; title: string; venue: string; city: string; country?: Country; startsAt: Date; endsAt?: Date | null; priceFrom?: number | null; currency?: Currency; rawGenre?: string | null; imageUrl?: string | null }`
  - `normalizeText(input: string): string`
  - `canonicalizeUrl(input: string): string` (throws `TypeError` on an invalid URL)
  - `fingerprint(title: string, venue: string, startsAt: Date): string`

- [ ] **Step 1: Write `lib/types.ts`**

```ts
export const GENRES = ['concert', 'electronic', 'theatre', 'exhibition', 'standup', 'sport', 'other'] as const;
export type Genre = (typeof GENRES)[number];

export const COUNTRIES = ['SK', 'CZ'] as const;
export type Country = (typeof COUNTRIES)[number];

export const CURRENCIES = ['EUR', 'CZK'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_BY_COUNTRY: Record<Country, Currency> = { SK: 'EUR', CZ: 'CZK' };

/** What a scraper returns. Everything is untrusted until normalizeRaw() has run. */
export interface RawEvent {
  source: string;
  sourceUrl: string;
  title: string;
  venue: string;
  city: string;
  country?: Country;
  startsAt: Date;
  endsAt?: Date | null;
  priceFrom?: number | null;
  currency?: Currency;
  rawGenre?: string | null;
  imageUrl?: string | null;
}
```

- [ ] **Step 2: Write the failing tests**

`lib/normalize/text.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { normalizeText } from '@/lib/normalize/text';

describe('normalizeText', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeText('Košice')).toBe('kosice');
    expect(normalizeText('  Ľudia   Žijú ')).toBe('ludia ziju');
  });

  it('turns punctuation into single spaces', () => {
    expect(normalizeText('Nočný Jazz – LIVE!')).toBe('nocny jazz live');
    expect(normalizeText('AC/DC')).toBe('ac dc');
  });

  it('keeps digits', () => {
    expect(normalizeText('Tour 2026')).toBe('tour 2026');
  });

  it('collapses zero-width characters', () => {
    expect(normalizeText('a​b')).toBe('a b');
  });

  it('returns an empty string for punctuation- or emoji-only input', () => {
    expect(normalizeText('!!!')).toBe('');
    expect(normalizeText('🎉🎉')).toBe('');
  });
});
```

`lib/normalize/url.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from '@/lib/normalize/url';

describe('canonicalizeUrl', () => {
  it('lowercases host, drops fragment and tracking params, sorts the rest, trims trailing slash', () => {
    expect(canonicalizeUrl('HTTPS://GoOut.net/en/event/123/?utm_source=x&b=2&a=1&fbclid=z#tickets')).toBe(
      'https://goout.net/en/event/123?a=1&b=2',
    );
  });

  it('keeps meaningful params and the scheme', () => {
    expect(canonicalizeUrl('http://example.com/e?id=7')).toBe('http://example.com/e?id=7');
  });

  it('keeps the root path', () => {
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('trims whitespace around the input', () => {
    expect(canonicalizeUrl('  https://example.com/e/1  ')).toBe('https://example.com/e/1');
  });

  it('throws on an invalid URL', () => {
    expect(() => canonicalizeUrl('not a url')).toThrow();
  });
});
```

`lib/normalize/fingerprint.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fingerprint } from '@/lib/normalize/fingerprint';

describe('fingerprint', () => {
  const start = new Date('2026-10-10T18:00:00Z');

  it('has the shape title|venue|prague-date', () => {
    expect(fingerprint('Nočný Jazz – LIVE!', 'Sk8 Klub', new Date('2026-09-30T22:30:00Z'))).toBe(
      'nocny jazz live|sk8 klub|2026-10-01',
    );
  });

  it('is stable across casing, diacritics and punctuation', () => {
    expect(fingerprint('Nočný Jazz – LIVE!', 'Sk8 Klub', start)).toBe(fingerprint('nocny jazz live', 'SK8 klub', start));
  });

  it('differs when the Prague calendar date differs', () => {
    const before = new Date('2026-09-30T21:30:00Z');
    const after = new Date('2026-09-30T22:30:00Z');
    expect(fingerprint('A', 'B', before)).not.toBe(fingerprint('A', 'B', after));
  });

  it('differs when the venue differs', () => {
    expect(fingerprint('A', 'Roxy', start)).not.toBe(fingerprint('A', 'Lucerna', start));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/normalize`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`lib/normalize/text.ts`:
```ts
/** Lowercase, strip diacritics and punctuation, collapse whitespace. Digits and letters (any script) are kept. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

`lib/normalize/url.ts`:
```ts
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_)/i;

/** Stable form of a listing URL. EventSource.url is unique, so this must be deterministic. */
export function canonicalizeUrl(input: string): string {
  const url = new URL(input.trim());
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}
```

`lib/normalize/fingerprint.ts`:
```ts
import { pragueDateString } from '@/lib/dates';
import { normalizeText } from '@/lib/normalize/text';

export function fingerprint(title: string, venue: string, startsAt: Date): string {
  return [normalizeText(title), normalizeText(venue), pragueDateString(startsAt)].join('|');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/normalize`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/normalize
git commit -m "feat: add shared types, text/url normalization, fingerprint"
```

---

### Task 5: City and genre normalization, `normalizeRaw`

**Files:**
- Create: `lib/normalize/city.ts`, `lib/normalize/genre.ts`, `lib/normalize/index.ts`
- Test: `lib/normalize/city.test.ts`, `lib/normalize/genre.test.ts`, `lib/normalize/index.test.ts`

**Interfaces:**
- Consumes: `normalizeText`, `canonicalizeUrl`, `fingerprint`, `RawEvent`, `CURRENCY_BY_COUNTRY`, types.
- Produces:
  - `normalizeCity(raw: string): string`, `countryForCity(city: string): Country | null`
  - `normalizeGenre(raw: string | null | undefined): Genre`
  - `interface NormalizedEvent { sourceSlug: string; url: string; title: string; venue: string; city: string; country: Country; currency: Currency; genre: Genre; startsAt: Date; endsAt: Date | null; imageUrl: string | null; fingerprint: string; price: number | null; priceCurrency: Currency }`
  - `normalizeRaw(raw: RawEvent): NormalizedEvent`, throws `Error` with message `empty title`, `invalid startsAt`, `empty city`, or `unknown country for city "X"`; propagates `TypeError` for an invalid `sourceUrl`.

- [ ] **Step 1: Write the failing tests**

`lib/normalize/city.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { countryForCity, normalizeCity } from '@/lib/normalize/city';

describe('normalizeCity', () => {
  it('maps aliases to canonical local names', () => {
    expect(normalizeCity('BA')).toBe('Bratislava');
    expect(normalizeCity('bratislava')).toBe('Bratislava');
    expect(normalizeCity('Prague')).toBe('Praha');
    expect(normalizeCity('PRAHA')).toBe('Praha');
    expect(normalizeCity('Kosice')).toBe('Košice');
    expect(normalizeCity('Pilsen')).toBe('Plzeň');
  });

  it('strips district suffixes', () => {
    expect(normalizeCity('Praha 7')).toBe('Praha');
    expect(normalizeCity('Bratislava - Petržalka')).toBe('Bratislava');
    expect(normalizeCity('Brno-střed')).toBe('Brno');
  });

  it('passes unknown cities through title-cased', () => {
    expect(normalizeCity('nové mesto nad váhom')).toBe('Nové Mesto Nad Váhom');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeCity('   ')).toBe('');
  });
});

describe('countryForCity', () => {
  it('knows canonical cities', () => {
    expect(countryForCity('Praha')).toBe('CZ');
    expect(countryForCity('Košice')).toBe('SK');
  });

  it('returns null for unknown cities', () => {
    expect(countryForCity('Nowhere')).toBeNull();
  });
});
```

`lib/normalize/genre.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { normalizeGenre } from '@/lib/normalize/genre';

describe('normalizeGenre', () => {
  it.each([
    ['Koncerty', 'concert'],
    ['Festival', 'concert'],
    ['Klasická hudba', 'concert'],
    ['Hip hop', 'concert'],
    ['Concert', 'concert'],
    ['Elektronická hudba', 'electronic'],
    ['Electronic music', 'electronic'],
    ['Electronic festival', 'electronic'],
    ['DJ set', 'electronic'],
    ['Divadlo', 'theatre'],
    ['Hudobné divadlo', 'theatre'],
    ['Divadlo Komédia', 'theatre'],
    ['Detské divadlo', 'theatre'],
    ['Theatre', 'theatre'],
    ['Výstavy', 'exhibition'],
    ['Exhibition', 'exhibition'],
    ['Stand-up', 'standup'],
    ['Stand-up comedy', 'standup'],
    ['Šport', 'sport'],
    ['Sportovní', 'sport'],
    ['Hokej', 'sport'],
    ['Sports', 'sport'],
    ['Maraton', 'sport'],
    ['Deti a rodina', 'other'],
    ['Popularna veda', 'other'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeGenre(raw)).toBe(expected);
  });

  it('falls back to other for empty input', () => {
    expect(normalizeGenre('')).toBe('other');
    expect(normalizeGenre(null)).toBe('other');
    expect(normalizeGenre(undefined)).toBe('other');
  });
});
```

`lib/normalize/index.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { normalizeRaw } from '@/lib/normalize';
import type { RawEvent } from '@/lib/types';

const base: RawEvent = {
  source: 'goout',
  sourceUrl: 'https://goout.net/en/e/1/?utm_source=x',
  title: '  Nočný   Jazz – LIVE!  ',
  venue: 'Majestic Music Club',
  city: 'BA',
  startsAt: new Date('2026-10-10T18:00:00Z'),
  priceFrom: 12,
  rawGenre: 'Koncerty',
  imageUrl: 'https://img.example/x.jpg',
};

describe('normalizeRaw', () => {
  it('normalizes a Slovak event end to end', () => {
    const n = normalizeRaw(base);
    expect(n).toEqual({
      sourceSlug: 'goout',
      url: 'https://goout.net/en/e/1',
      title: 'Nočný Jazz – LIVE!',
      venue: 'Majestic Music Club',
      city: 'Bratislava',
      country: 'SK',
      currency: 'EUR',
      genre: 'concert',
      startsAt: base.startsAt,
      endsAt: null,
      imageUrl: 'https://img.example/x.jpg',
      fingerprint: 'nocny jazz live|majestic music club|2026-10-10',
      price: 12,
      priceCurrency: 'EUR',
    });
  });

  it('maps Prague to Praha / CZ / CZK', () => {
    const n = normalizeRaw({ ...base, city: 'Prague' });
    expect(n.city).toBe('Praha');
    expect(n.country).toBe('CZ');
    expect(n.currency).toBe('CZK');
    expect(n.priceCurrency).toBe('CZK');
  });

  it('trusts a known city over a conflicting raw country', () => {
    expect(normalizeRaw({ ...base, city: 'Praha', country: 'SK' }).country).toBe('CZ');
  });

  it('uses raw.country for an unknown city', () => {
    const n = normalizeRaw({ ...base, city: 'Poprad', country: 'SK' });
    expect(n.city).toBe('Poprad');
    expect(n.country).toBe('SK');
  });

  it('keeps a source currency that differs from the event currency', () => {
    const n = normalizeRaw({ ...base, city: 'Praha', currency: 'EUR', priceFrom: 35 });
    expect(n.currency).toBe('CZK');
    expect(n.priceCurrency).toBe('EUR');
  });

  it('treats free as 0 and missing/invalid prices as unknown', () => {
    expect(normalizeRaw({ ...base, priceFrom: 0 }).price).toBe(0);
    expect(normalizeRaw({ ...base, priceFrom: 12.5 }).price).toBe(12.5);
    expect(normalizeRaw({ ...base, priceFrom: undefined }).price).toBeNull();
    expect(normalizeRaw({ ...base, priceFrom: null }).price).toBeNull();
    expect(normalizeRaw({ ...base, priceFrom: -5 }).price).toBeNull();
    expect(normalizeRaw({ ...base, priceFrom: Number.NaN }).price).toBeNull();
    expect(normalizeRaw({ ...base, priceFrom: Number.POSITIVE_INFINITY }).price).toBeNull();
  });

  it('keeps a valid endsAt and drops an invalid or earlier one', () => {
    const later = new Date('2026-10-12T18:00:00Z');
    expect(normalizeRaw({ ...base, endsAt: later }).endsAt).toEqual(later);
    expect(normalizeRaw({ ...base, endsAt: new Date('2026-10-10T10:00:00Z') }).endsAt).toBeNull();
    expect(normalizeRaw({ ...base, endsAt: new Date('nope') }).endsAt).toBeNull();
  });

  it('accepts only http(s) image URLs', () => {
    expect(normalizeRaw({ ...base, imageUrl: 'not a url' }).imageUrl).toBeNull();
    expect(normalizeRaw({ ...base, imageUrl: '' }).imageUrl).toBeNull();
    expect(normalizeRaw({ ...base, imageUrl: 'data:image/png;base64,AAAA' }).imageUrl).toBeNull();
    expect(normalizeRaw({ ...base, imageUrl: null }).imageUrl).toBeNull();
  });

  it('rejects titles that normalize to nothing', () => {
    expect(() => normalizeRaw({ ...base, title: '🎉🎉' })).toThrow('empty title');
    expect(() => normalizeRaw({ ...base, title: '!!!' })).toThrow('empty title');
    expect(() => normalizeRaw({ ...base, title: '   ' })).toThrow('empty title');
  });

  it('rejects an invalid startsAt', () => {
    expect(() => normalizeRaw({ ...base, startsAt: new Date('nope') })).toThrow('invalid startsAt');
  });

  it('rejects a blank city and an unknown city without country', () => {
    expect(() => normalizeRaw({ ...base, city: '  ' })).toThrow('empty city');
    expect(() => normalizeRaw({ ...base, city: 'Nowhereville' })).toThrow(/unknown country/);
  });

  it('propagates an invalid source URL', () => {
    expect(() => normalizeRaw({ ...base, sourceUrl: 'nope' })).toThrow();
  });

  it('allows an empty venue', () => {
    expect(normalizeRaw({ ...base, venue: '' }).venue).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/normalize`
Expected: FAIL for the three new files (modules not found); earlier normalize tests still pass.

- [ ] **Step 3: Implement `lib/normalize/city.ts`**

```ts
import type { Country } from '@/lib/types';
import { normalizeText } from '@/lib/normalize/text';

interface City {
  name: string;
  country: Country;
  aliases?: string[];
}

const CITIES: City[] = [
  { name: 'Bratislava', country: 'SK', aliases: ['ba', 'pressburg'] },
  { name: 'Košice', country: 'SK', aliases: ['ke'] },
  { name: 'Prešov', country: 'SK' },
  { name: 'Žilina', country: 'SK' },
  { name: 'Banská Bystrica', country: 'SK', aliases: ['bb'] },
  { name: 'Nitra', country: 'SK' },
  { name: 'Trnava', country: 'SK' },
  { name: 'Trenčín', country: 'SK' },
  { name: 'Praha', country: 'CZ', aliases: ['prague', 'prag'] },
  { name: 'Brno', country: 'CZ' },
  { name: 'Ostrava', country: 'CZ' },
  { name: 'Plzeň', country: 'CZ', aliases: ['pilsen'] },
  { name: 'Olomouc', country: 'CZ' },
  { name: 'Liberec', country: 'CZ' },
  { name: 'České Budějovice', country: 'CZ' },
  { name: 'Hradec Králové', country: 'CZ' },
  { name: 'Pardubice', country: 'CZ' },
];

const ALIASES = new Map<string, City>();
for (const city of CITIES) {
  for (const alias of [city.name, ...(city.aliases ?? [])]) ALIASES.set(normalizeText(alias), city);
}
// Longer aliases also match as a prefix ("praha 7", "bratislava petrzalka"); short ones ("ba") must match exactly.
const PREFIX_ALIASES = [...ALIASES.entries()].filter(([alias]) => alias.length >= 4);

function titleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase())
    .join(' ');
}

export function normalizeCity(raw: string): string {
  const key = normalizeText(raw);
  if (!key) return '';
  const exact = ALIASES.get(key);
  if (exact) return exact.name;
  const prefixed = PREFIX_ALIASES.find(([alias]) => key.startsWith(`${alias} `));
  if (prefixed) return prefixed[1].name;
  return titleCase(raw);
}

export function countryForCity(city: string): Country | null {
  return CITIES.find((c) => c.name === city)?.country ?? null;
}
```

- [ ] **Step 4: Implement `lib/normalize/genre.ts`**

```ts
import type { Genre } from '@/lib/types';
import { normalizeText } from '@/lib/normalize/text';

// Keywords are matched against normalizeText(raw) at word starts. A leading "=" means whole-word match.
// Order matters: the first genre with a hit wins, so specific genres come before "concert".
const RULES: ReadonlyArray<readonly [Genre, readonly string[]]> = [
  ['theatre', ['divadl', 'theatre', 'theater', 'muzikal', 'musical', 'opera', 'balet', 'ballet', 'cinohra', 'tanec', 'loutk']],
  ['standup', ['stand up', 'standup', 'komedi', 'comedy']],
  ['exhibition', ['vystav', 'exhibition', 'galeri', 'muzeum', 'museum', 'expozic']],
  ['sport', ['sport', 'futbal', 'fotbal', 'football', 'hokej', 'hockey', 'basket', 'tenis', 'tennis', 'zapas', 'maraton', 'marathon']],
  ['electronic', ['electro', 'elektron', 'techno', 'house', 'trance', 'drum and bass', 'rave', 'klub', 'club', '=dj', '=dnb', '=edm']],
  [
    'concert',
    ['koncert', 'concert', 'festival', 'hudba', 'hudob', 'music', 'rock', 'jazz', 'hip hop', 'metal', 'folk', 'klasick', 'classical', 'orchestr', 'live', '=pop', '=rap'],
  ],
];

export function normalizeGenre(raw: string | null | undefined): Genre {
  const text = normalizeText(raw ?? '');
  if (!text) return 'other';
  const padded = ` ${text} `;
  for (const [genre, keywords] of RULES) {
    for (const keyword of keywords) {
      const hit = keyword.startsWith('=') ? padded.includes(` ${keyword.slice(1)} `) : padded.includes(` ${keyword}`);
      if (hit) return genre;
    }
  }
  return 'other';
}
```

- [ ] **Step 5: Implement `lib/normalize/index.ts`**

```ts
import { CURRENCY_BY_COUNTRY, type Country, type Currency, type Genre, type RawEvent } from '@/lib/types';
import { countryForCity, normalizeCity } from '@/lib/normalize/city';
import { fingerprint } from '@/lib/normalize/fingerprint';
import { normalizeGenre } from '@/lib/normalize/genre';
import { normalizeText } from '@/lib/normalize/text';
import { canonicalizeUrl } from '@/lib/normalize/url';

export interface NormalizedEvent {
  sourceSlug: string;
  url: string;
  title: string;
  venue: string;
  city: string;
  country: Country;
  currency: Currency;
  genre: Genre;
  startsAt: Date;
  endsAt: Date | null;
  imageUrl: string | null;
  fingerprint: string;
  price: number | null;
  priceCurrency: Currency;
}

const isValidDate = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

export function normalizeRaw(raw: RawEvent): NormalizedEvent {
  const title = raw.title.replace(/\s+/g, ' ').trim();
  if (!normalizeText(title)) throw new Error('empty title');
  if (!isValidDate(raw.startsAt)) throw new Error('invalid startsAt');

  const city = normalizeCity(raw.city);
  if (!city) throw new Error('empty city');
  const country = countryForCity(city) ?? raw.country;
  if (!country) throw new Error(`unknown country for city "${city}"`);

  const currency = CURRENCY_BY_COUNTRY[country];
  const venue = raw.venue.replace(/\s+/g, ' ').trim();
  const price =
    typeof raw.priceFrom === 'number' && Number.isFinite(raw.priceFrom) && raw.priceFrom >= 0
      ? Math.round(raw.priceFrom * 100) / 100
      : null;
  const endsAt = isValidDate(raw.endsAt) && raw.endsAt > raw.startsAt ? raw.endsAt : null;
  const imageUrl = raw.imageUrl && /^https?:\/\//i.test(raw.imageUrl.trim()) ? raw.imageUrl.trim() : null;

  return {
    sourceSlug: raw.source,
    url: canonicalizeUrl(raw.sourceUrl),
    title,
    venue,
    city,
    country,
    currency,
    genre: normalizeGenre(raw.rawGenre),
    startsAt: raw.startsAt,
    endsAt,
    imageUrl,
    fingerprint: fingerprint(title, venue, raw.startsAt),
    price,
    priceCurrency: raw.currency ?? currency,
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/normalize`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/normalize
git commit -m "feat: add city and genre normalization and normalizeRaw"
```

---

### Task 6: Dedupe helpers

**Files:**
- Create: `lib/dedupe.ts`
- Test: `lib/dedupe.test.ts`

**Interfaces:**
- Consumes: `normalizeText`, `FUZZY_THRESHOLD`, `Currency`.
- Produces:
  - `levenshtein(a: string, b: string): number`
  - `titleDistance(a: string, b: string): number` (0 identical, 1 unrelated; both-empty returns 1)
  - `pickFuzzyMatch<T extends { title: string }>(title: string, candidates: T[], threshold?: number): T | null`
  - `computeEventPrice(sources: { priceFrom: number | null; currency: Currency }[], currency: Currency): number | null`
  - `blankFills(existing: { imageUrl: string | null; endsAt: Date | null }, incoming: { imageUrl: string | null; endsAt: Date | null }): { imageUrl?: string; endsAt?: Date }`

- [ ] **Step 1: Write the failing tests**

`lib/dedupe.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { blankFills, computeEventPrice, levenshtein, pickFuzzyMatch, titleDistance } from '@/lib/dedupe';

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
});

describe('titleDistance', () => {
  it('ignores case, diacritics and punctuation', () => {
    expect(titleDistance('Aurora Bloom – Tour 2026', 'aurora bloom tour 2026')).toBe(0);
  });

  it('is edit distance over the longer normalized title', () => {
    expect(titleDistance('abcdefghij', 'abcdefghix')).toBeCloseTo(0.1);
    expect(titleDistance('abcdefghij', 'abcdefghxy')).toBeCloseTo(0.2);
  });

  it('never matches two empty titles', () => {
    expect(titleDistance('!!!', '???')).toBe(1);
  });
});

describe('pickFuzzyMatch', () => {
  it('accepts a distance below 0.2 and rejects exactly 0.2', () => {
    expect(pickFuzzyMatch('abcdefghij', [{ id: 'ok', title: 'abcdefghix' }])?.id).toBe('ok');
    expect(pickFuzzyMatch('abcdefghij', [{ id: 'edge', title: 'abcdefghxy' }])).toBeNull();
  });

  it('picks the lowest distance', () => {
    const picked = pickFuzzyMatch('Jazz Night Live', [
      { id: 'a', title: 'Jazz Night Liv' },
      { id: 'b', title: 'Jazz Night Live' },
    ]);
    expect(picked?.id).toBe('b');
  });

  it('returns null without candidates', () => {
    expect(pickFuzzyMatch('Anything', [])).toBeNull();
  });

  it('does not merge titles that differ only by a number', () => {
    expect(pickFuzzyMatch('Jazz Night 1', [{ id: 'x', title: 'Jazz Night 2' }])).toBeNull();
    expect(pickFuzzyMatch('Aurora Bloom Tour 2026', [{ id: 'x', title: 'Aurora Bloom Tour 2027' }])).toBeNull();
  });

  it('still merges when the numbers are equal or only one title has a number', () => {
    expect(pickFuzzyMatch('Aurora Bloom Tour 2026', [{ id: 'x', title: 'Aurora Bloom – Tour 2026' }])?.id).toBe('x');
    expect(pickFuzzyMatch('Jazz Night', [{ id: 'x', title: 'Jazz Night 2' }])?.id).toBe('x');
  });
});

describe('computeEventPrice', () => {
  it('takes the minimum in the event currency', () => {
    expect(
      computeEventPrice(
        [
          { priceFrom: 20, currency: 'EUR' },
          { priceFrom: 15, currency: 'EUR' },
          { priceFrom: 10, currency: 'CZK' },
        ],
        'EUR',
      ),
    ).toBe(15);
  });

  it('treats 0 as a real (free) price', () => {
    expect(
      computeEventPrice(
        [
          { priceFrom: 0, currency: 'EUR' },
          { priceFrom: 20, currency: 'EUR' },
        ],
        'EUR',
      ),
    ).toBe(0);
  });

  it('is null when nothing is known in the event currency', () => {
    expect(computeEventPrice([], 'EUR')).toBeNull();
    expect(computeEventPrice([{ priceFrom: null, currency: 'EUR' }], 'EUR')).toBeNull();
    expect(computeEventPrice([{ priceFrom: 35, currency: 'EUR' }], 'CZK')).toBeNull();
  });

  it('ignores unknown-price sources when another has a price', () => {
    expect(
      computeEventPrice(
        [
          { priceFrom: null, currency: 'CZK' },
          { priceFrom: 890, currency: 'CZK' },
          { priceFrom: 35, currency: 'EUR' },
        ],
        'CZK',
      ),
    ).toBe(890);
  });
});

describe('blankFills', () => {
  const when = new Date('2026-10-12T18:00:00Z');

  it('fills blank fields from the incoming event', () => {
    expect(blankFills({ imageUrl: null, endsAt: null }, { imageUrl: 'https://i/x.jpg', endsAt: when })).toEqual({
      imageUrl: 'https://i/x.jpg',
      endsAt: when,
    });
  });

  it('never overwrites existing values', () => {
    expect(blankFills({ imageUrl: 'https://i/a.jpg', endsAt: when }, { imageUrl: 'https://i/b.jpg', endsAt: null })).toEqual({});
  });

  it('returns nothing when the incoming event has nothing to add', () => {
    expect(blankFills({ imageUrl: null, endsAt: null }, { imageUrl: null, endsAt: null })).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/dedupe.test.ts`
Expected: FAIL, cannot resolve `@/lib/dedupe`.

- [ ] **Step 3: Implement `lib/dedupe.ts`**

```ts
import { FUZZY_THRESHOLD } from '@/lib/config';
import { normalizeText } from '@/lib/normalize/text';
import type { Currency } from '@/lib/types';

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

export function titleDistance(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  const longest = Math.max(na.length, nb.length);
  if (longest === 0) return 1;
  return levenshtein(na, nb) / longest;
}

const numbersIn = (title: string): string => (normalizeText(title).match(/\d+/g) ?? []).join(',');

/** "Vol. 1" vs "Vol. 2" are different events even though the edit distance is tiny. */
function numbersConflict(a: string, b: string): boolean {
  const na = numbersIn(a);
  const nb = numbersIn(b);
  return na !== '' && nb !== '' && na !== nb;
}

/** Candidates are pre-filtered by the DB (same city, within the time window). Venue is not compared. */
export function pickFuzzyMatch<T extends { title: string }>(
  title: string,
  candidates: T[],
  threshold: number = FUZZY_THRESHOLD,
): T | null {
  let best: T | null = null;
  let bestDistance = threshold;
  for (const candidate of candidates) {
    if (numbersConflict(title, candidate.title)) continue;
    const distance = titleDistance(title, candidate.title);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function computeEventPrice(
  sources: { priceFrom: number | null; currency: Currency }[],
  currency: Currency,
): number | null {
  let min: number | null = null;
  for (const source of sources) {
    if (source.currency !== currency || source.priceFrom === null) continue;
    if (min === null || source.priceFrom < min) min = source.priceFrom;
  }
  return min;
}

export function blankFills(
  existing: { imageUrl: string | null; endsAt: Date | null },
  incoming: { imageUrl: string | null; endsAt: Date | null },
): { imageUrl?: string; endsAt?: Date } {
  const fills: { imageUrl?: string; endsAt?: Date } = {};
  if (!existing.imageUrl && incoming.imageUrl) fills.imageUrl = incoming.imageUrl;
  if (!existing.endsAt && incoming.endsAt) fills.endsAt = incoming.endsAt;
  return fills;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/dedupe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dedupe.ts lib/dedupe.test.ts
git commit -m "feat: add fuzzy dedupe helpers and event price computation"
```

---

### Task 7: Event filters, where-builders, happening-now merge, card mapper, DB queries

**Files:**
- Create: `lib/events/filters.ts`, `lib/events/happening.ts`, `lib/events/card.ts`, `lib/events/query.ts`
- Test: `lib/events/filters.test.ts`, `lib/events/happening.test.ts`, `lib/events/card.test.ts`

**Interfaces:**
- Consumes: `resolveRange`, `WHEN_VALUES`, `When`, `GENRES`, `Genre`, `CZK_PER_EUR`, `MAX_PAGE`, `PAGE_SIZE`, `HAPPENING_NOW_LIMIT`, `SINGLE_EVENT_DURATION_MS`, `prisma`.
- Produces:
  - `type RawParams = Record<string, string | string[] | undefined>`
  - `interface EventFilters { cities: string[]; genres: Genre[]; when?: When; maxPrice?: number; page: number }`
  - `parseFilters(params: RawParams): EventFilters`
  - `buildWhere(filters: EventFilters, now: Date): Prisma.EventWhereInput` (main grid: not started yet)
  - `interface HappeningNowWhere { multiDay: Prisma.EventWhereInput; singleTime: Prisma.EventWhereInput }`
  - `buildHappeningNowWhere(filters: EventFilters, now: Date): HappeningNowWhere | null` (null = row hidden)
  - `buildVisibleWhere(now: Date): Prisma.EventWhereInput` (not ended yet; feeds the city dropdown)
  - `withPage(params: RawParams, page: number): string` (returns `?…`)
  - `interface Timed { startsAt: Date; endsAt: Date | null }`, `effectiveEnd(e: Timed): Date`, `mergeHappeningNow<T extends Timed>(multiDay: T[], singleTime: T[], limit: number): T[]`
  - `toEventCard(row: EventRow): EventCardData`; types `EventRow`, `EventSourceView`, `EventCardData`
  - `queryEvents(filters: EventFilters, now?: Date): Promise<{ events: EventCardData[]; hasMore: boolean }>`
  - `queryHappeningNow(filters: EventFilters, now?: Date): Promise<EventCardData[]>`
  - `getCityOptions(now?: Date): Promise<string[]>`

`page` is cumulative: `queryEvents` returns the first `page * PAGE_SIZE` events, so "load more" re-renders a longer list. `page` does not affect the Happening now row.

Ongoing events are split from upcoming ones at `now`: the grid takes `startsAt >= now`, the row takes `startsAt < now` with effective end `>= now`. The row is fetched with two queries (multi-day events ordered by `endsAt`, single-time events ordered by `startsAt`, which orders them by effective end too) and merged in memory, because Prisma cannot order by `coalesce(endsAt, startsAt + 2h)`.

- [ ] **Step 1: Write the failing tests**

`lib/events/filters.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildHappeningNowWhere, buildVisibleWhere, buildWhere, parseFilters, withPage } from '@/lib/events/filters';

describe('parseFilters', () => {
  it('returns safe defaults for empty params', () => {
    expect(parseFilters({})).toEqual({ cities: [], genres: [], page: 1 });
  });

  it('accepts a single or repeated city, trimmed and de-duplicated', () => {
    expect(parseFilters({ city: 'Praha' }).cities).toEqual(['Praha']);
    expect(parseFilters({ city: [' Praha ', 'Brno', 'Praha', ''] }).cities).toEqual(['Praha', 'Brno']);
  });

  it('drops unknown genres', () => {
    expect(parseFilters({ genre: ['concert', 'bogus', 'sport'] }).genres).toEqual(['concert', 'sport']);
    expect(parseFilters({ genre: 'bogus' }).genres).toEqual([]);
  });

  it('accepts a known when and ignores a bogus one', () => {
    expect(parseFilters({ when: 'weekend' }).when).toBe('weekend');
    expect(parseFilters({ when: 'bogus' }).when).toBeUndefined();
    expect(parseFilters({ when: ['today', 'week'] }).when).toBe('today');
  });

  it('keeps maxPrice=0 and rejects unusable values', () => {
    expect(parseFilters({ maxPrice: '0' }).maxPrice).toBe(0);
    expect(parseFilters({ maxPrice: '30' }).maxPrice).toBe(30);
    expect(parseFilters({ maxPrice: '12.5' }).maxPrice).toBe(12.5);
    expect(parseFilters({ maxPrice: '' }).maxPrice).toBeUndefined();
    expect(parseFilters({ maxPrice: '   ' }).maxPrice).toBeUndefined();
    expect(parseFilters({ maxPrice: 'abc' }).maxPrice).toBeUndefined();
    expect(parseFilters({ maxPrice: '-5' }).maxPrice).toBeUndefined();
    expect(parseFilters({ maxPrice: 'Infinity' }).maxPrice).toBeUndefined();
  });

  it('clamps page to 1..50', () => {
    expect(parseFilters({ page: '3' }).page).toBe(3);
    expect(parseFilters({ page: '0' }).page).toBe(1);
    expect(parseFilters({ page: '-3' }).page).toBe(1);
    expect(parseFilters({ page: 'abc' }).page).toBe(1);
    expect(parseFilters({ page: '2.7' }).page).toBe(2);
    expect(parseFilters({ page: '999' }).page).toBe(50);
  });
});

const now = new Date('2026-09-30T10:00:00Z'); // a Wednesday
const twoHoursAgo = new Date('2026-09-30T08:00:00Z');
const filters = { cities: [], genres: [], page: 1 };
const priceClause = (max: number, maxCzk: number) => ({
  OR: [
    { priceFrom: null },
    { currency: 'EUR', priceFrom: { lte: max } },
    { currency: 'CZK', priceFrom: { lte: maxCzk } },
  ],
});

describe('buildWhere (main grid)', () => {
  it('by default lists only events that have not started yet', () => {
    expect(buildWhere(filters, now)).toEqual({ AND: [{ startsAt: { gte: now } }] });
  });

  it('adds the range end for today', () => {
    expect(buildWhere({ ...filters, when: 'today' }, now)).toEqual({
      AND: [{ startsAt: { gte: now } }, { startsAt: { lte: new Date('2026-09-30T21:59:59.999Z') } }],
    });
  });

  it('uses the weekend window when when=weekend', () => {
    expect(buildWhere({ ...filters, when: 'weekend' }, now)).toEqual({
      AND: [
        { startsAt: { gte: new Date('2026-10-02T16:00:00Z') } },
        { startsAt: { lte: new Date('2026-10-04T21:59:59.999Z') } },
      ],
    });
  });

  it('adds city and genre membership', () => {
    expect(buildWhere({ ...filters, cities: ['Praha', 'Brno'], genres: ['concert'] }, now)).toEqual({
      AND: [{ startsAt: { gte: now } }, { city: { in: ['Praha', 'Brno'] } }, { genre: { in: ['concert'] } }],
    });
  });

  it('maxPrice passes unknown prices and converts EUR to CZK', () => {
    expect(buildWhere({ ...filters, maxPrice: 30 }, now)).toEqual({
      AND: [{ startsAt: { gte: now } }, priceClause(30, 750)],
    });
  });

  it('maxPrice=0 is a real filter (free + unknown), not "unset"', () => {
    expect(buildWhere({ ...filters, maxPrice: 0 }, now)).toEqual({
      AND: [{ startsAt: { gte: now } }, priceClause(0, 0)],
    });
  });
});

describe('buildHappeningNowWhere', () => {
  it('selects started, not-ended events: multi-day by endsAt, single-time within the 2h window', () => {
    expect(buildHappeningNowWhere(filters, now)).toEqual({
      multiDay: { AND: [{ startsAt: { lt: now } }, { endsAt: { gte: now } }] },
      singleTime: { AND: [{ endsAt: null }, { startsAt: { lt: now } }, { startsAt: { gte: twoHoursAgo } }] },
    });
  });

  it('partitions with the grid at now: grid is startsAt >= now, row is startsAt < now', () => {
    const grid = buildWhere(filters, now);
    const row = buildHappeningNowWhere(filters, now);
    const startedBeforeNow = { AND: expect.arrayContaining([{ startsAt: { lt: now } }]) };
    expect(grid).toEqual({ AND: [{ startsAt: { gte: now } }] });
    expect(row?.multiDay).toEqual(startedBeforeNow);
    expect(row?.singleTime).toEqual(startedBeforeNow);
  });

  it('applies city, genre and maxPrice filters to both queries', () => {
    const common = [{ city: { in: ['Praha'] } }, { genre: { in: ['concert'] } }, priceClause(0, 0)];
    const row = buildHappeningNowWhere({ ...filters, cities: ['Praha'], genres: ['concert'], maxPrice: 0 }, now);
    expect(row?.multiDay).toEqual({ AND: [{ startsAt: { lt: now } }, { endsAt: { gte: now } }, ...common] });
    expect(row?.singleTime).toEqual({
      AND: [{ endsAt: null }, { startsAt: { lt: now } }, { startsAt: { gte: twoHoursAgo } }, ...common],
    });
  });

  it.each(['today', 'week', 'month'] as const)('is available for when=%s and ignores the range end', (when) => {
    expect(buildHappeningNowWhere({ ...filters, when }, now)).toEqual(buildHappeningNowWhere(filters, now));
  });

  it('is hidden when the weekend has not begun yet', () => {
    expect(buildHappeningNowWhere({ ...filters, when: 'weekend' }, now)).toBeNull();
  });

  it('is shown once now is inside the weekend', () => {
    const saturday = new Date('2026-10-03T10:00:00Z');
    expect(buildHappeningNowWhere({ ...filters, when: 'weekend' }, saturday)).not.toBeNull();
  });
});

describe('buildVisibleWhere', () => {
  it('matches events whose effective end is not before now', () => {
    expect(buildVisibleWhere(now)).toEqual({
      OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: twoHoursAgo } }],
    });
  });
});

describe('withPage', () => {
  it('keeps repeated params and replaces page', () => {
    expect(withPage({ city: ['Praha', 'Brno'], when: 'today', page: '2' }, 3)).toBe('?city=Praha&city=Brno&when=today&page=3');
  });

  it('works without existing params', () => {
    expect(withPage({}, 2)).toBe('?page=2');
  });
});
```

`lib/events/card.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { toEventCard, type EventRow } from '@/lib/events/card';

const dec = (n: number) => ({ toNumber: () => n });

const row: EventRow = {
  id: 'e1',
  title: 'Aurora Bloom',
  venue: 'O2 arena',
  city: 'Praha',
  country: 'CZ',
  startsAt: new Date('2026-10-10T18:00:00Z'),
  endsAt: null,
  priceFrom: dec(300),
  currency: 'CZK',
  genre: 'concert',
  imageUrl: null,
  sources: [
    { id: 's1', url: 'https://g/1', priceFrom: dec(25), currency: 'EUR', source: { name: 'Gamma' } },
    { id: 's2', url: 'https://g/2', priceFrom: dec(500), currency: 'CZK', source: { name: 'Zeta' } },
    { id: 's3', url: 'https://g/3', priceFrom: null, currency: 'CZK', source: { name: 'Alpha' } },
    { id: 's4', url: 'https://g/4', priceFrom: dec(300), currency: 'CZK', source: { name: 'Beta' } },
  ],
};

describe('toEventCard', () => {
  it('converts decimals to numbers', () => {
    const card = toEventCard(row);
    expect(card.priceFrom).toBe(300);
    expect(card.sources.find((s) => s.sourceName === 'Zeta')?.priceFrom).toBe(500);
    expect(card.sources.find((s) => s.sourceName === 'Alpha')?.priceFrom).toBeNull();
  });

  it('orders sources: event currency first, priced before unknown, cheapest first', () => {
    expect(toEventCard(row).sources.map((s) => s.sourceName)).toEqual(['Beta', 'Zeta', 'Alpha', 'Gamma']);
  });

  it('keeps null event price null and free as 0', () => {
    expect(toEventCard({ ...row, priceFrom: null }).priceFrom).toBeNull();
    expect(toEventCard({ ...row, priceFrom: dec(0) }).priceFrom).toBe(0);
  });
});
```

`lib/events/happening.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { effectiveEnd, mergeHappeningNow } from '@/lib/events/happening';

const ev = (id: string, startsAt: string, endsAt: string | null) => ({
  id,
  startsAt: new Date(startsAt),
  endsAt: endsAt ? new Date(endsAt) : null,
});

describe('effectiveEnd', () => {
  it('is endsAt when present', () => {
    expect(effectiveEnd(ev('a', '2026-09-20T10:00:00Z', '2026-10-30T18:00:00Z')).toISOString()).toBe('2026-10-30T18:00:00.000Z');
  });

  it('is startsAt + 2h for single-time events', () => {
    expect(effectiveEnd(ev('b', '2026-09-30T09:00:00Z', null)).toISOString()).toBe('2026-09-30T11:00:00.000Z');
  });
});

describe('mergeHappeningNow', () => {
  const a = ev('a', '2026-09-20T10:00:00Z', '2026-10-30T18:00:00Z');
  const b = ev('b', '2026-09-30T09:00:00Z', null); // ends 11:00
  const c = ev('c', '2026-09-29T10:00:00Z', '2026-09-30T20:00:00Z');
  const d = ev('d', '2026-09-30T08:30:00Z', null); // ends 10:30

  it('sorts both lists together by effective end, soonest first', () => {
    expect(mergeHappeningNow([a, c], [b, d], 12).map((e) => e.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('keeps only the first `limit` after sorting', () => {
    expect(mergeHappeningNow([a, c], [b, d], 2).map((e) => e.id)).toEqual(['d', 'b']);
  });

  it('breaks ties on the earlier startsAt', () => {
    const earlier = ev('early', '2026-09-30T05:00:00Z', '2026-09-30T11:00:00Z');
    expect(mergeHappeningNow([earlier], [b], 12).map((e) => e.id)).toEqual(['early', 'b']);
  });

  it('handles empty inputs', () => {
    expect(mergeHappeningNow([], [], 12)).toEqual([]);
    expect(mergeHappeningNow([a], [], 12).map((e) => e.id)).toEqual(['a']);
  });

  it('does not mutate its inputs', () => {
    const multi = [a, c];
    mergeHappeningNow(multi, [b, d], 12);
    expect(multi.map((e) => e.id)).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/events`
Expected: FAIL for `filters`, `happening` and `card` (modules not found); `derive.test.ts` still passes.

- [ ] **Step 3: Implement `lib/events/filters.ts`**

```ts
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

  const priceRaw = first(params.maxPrice)?.trim();
  const priceNum = priceRaw ? Number(priceRaw) : Number.NaN;
  const maxPrice = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : undefined;

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

export function withPage(params: RawParams, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'page' || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  query.set('page', String(page));
  return `?${query.toString()}`;
}
```

- [ ] **Step 4: Implement `lib/events/card.ts`**

```ts
import type { Country, Currency, Genre } from '@/lib/types';

type DecimalLike = { toNumber(): number };

export interface EventRow {
  id: string;
  title: string;
  venue: string;
  city: string;
  country: Country;
  startsAt: Date;
  endsAt: Date | null;
  priceFrom: DecimalLike | null;
  currency: Currency;
  genre: Genre;
  imageUrl: string | null;
  sources: {
    id: string;
    url: string;
    priceFrom: DecimalLike | null;
    currency: Currency;
    source: { name: string };
  }[];
}

export interface EventSourceView {
  id: string;
  sourceName: string;
  url: string;
  priceFrom: number | null;
  currency: Currency;
}

export interface EventCardData extends Omit<EventRow, 'priceFrom' | 'sources'> {
  priceFrom: number | null;
  sources: EventSourceView[];
}

function compareSources(currency: Currency) {
  return (a: EventSourceView, b: EventSourceView): number =>
    Number(a.currency !== currency) - Number(b.currency !== currency) ||
    Number(a.priceFrom === null) - Number(b.priceFrom === null) ||
    (a.priceFrom ?? 0) - (b.priceFrom ?? 0) ||
    a.sourceName.localeCompare(b.sourceName);
}

export function toEventCard(row: EventRow): EventCardData {
  return {
    id: row.id,
    title: row.title,
    venue: row.venue,
    city: row.city,
    country: row.country,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    priceFrom: row.priceFrom ? row.priceFrom.toNumber() : null,
    currency: row.currency,
    genre: row.genre,
    imageUrl: row.imageUrl,
    sources: row.sources
      .map((s) => ({
        id: s.id,
        sourceName: s.source.name,
        url: s.url,
        priceFrom: s.priceFrom ? s.priceFrom.toNumber() : null,
        currency: s.currency,
      }))
      .sort(compareSources(row.currency)),
  };
}
```

- [ ] **Step 5: Implement `lib/events/happening.ts`**

```ts
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
```

- [ ] **Step 6: Implement `lib/events/query.ts`**

```ts
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
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run lib/events && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add lib/events
git commit -m "feat: add event filters, grid and happening-now queries, card mapper"
```

---

### Task 8: Ingest pipeline

**Files:**
- Create: `lib/ingest.ts`
- Test: `lib/ingest.test.ts`

**Interfaces:**
- Consumes: `prisma`, `normalizeRaw`, `NormalizedEvent`, `pickFuzzyMatch`, `computeEventPrice`, `blankFills`, `deriveSortFields`, `FUZZY_WINDOW_MS`.
- Produces:
  - `interface IngestStats { created: number; updated: number; merged: number; skipped: { url: string; reason: string }[] }`
  - `upsertRawEvents(raws: RawEvent[], now?: Date): Promise<IngestStats>`. Requires `Source` rows to exist for each `raw.source` slug. One bad item is skipped and reported; it never aborts the batch.

Outcomes per item: `updated` (known `EventSource.url`), `merged` (new `EventSource` attached to an existing event by fingerprint or fuzzy), `created` (new event).

The unit test mocks the DB and covers only the skip/retry logic. The match/merge DB flow is verified by the seed in Task 9.

- [ ] **Step 1: Write the failing test**

`lib/ingest.test.ts`:
```ts
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

  it('retries once as a merge on a unique-constraint race', async () => {
    const race = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    transaction.mockRejectedValueOnce(race).mockResolvedValueOnce('merged');
    const stats = await upsertRawEvents([raw()]);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(stats.merged).toBe(1);
    expect(stats.skipped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ingest.test.ts`
Expected: FAIL, cannot resolve `@/lib/ingest`.

- [ ] **Step 3: Implement `lib/ingest.ts`**

```ts
import { Prisma, type Event as EventRow } from '@prisma/client';
import { FUZZY_WINDOW_MS } from '@/lib/config';
import { prisma } from '@/lib/db';
import { blankFills, computeEventPrice, pickFuzzyMatch } from '@/lib/dedupe';
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

async function ingestWithRetry(n: NormalizedEvent, sourceId: string, now: Date): Promise<Outcome> {
  try {
    return await prisma.$transaction((tx) => ingestOne(tx, n, sourceId, now));
  } catch (e) {
    // Unique violation on fingerprint or url: another writer got there first. Redo as a merge.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return prisma.$transaction((tx) => ingestOne(tx, n, sourceId, now));
    }
    throw e;
  }
}

async function ingestOne(tx: Tx, n: NormalizedEvent, sourceId: string, now: Date): Promise<Outcome> {
  // 1. Known listing URL: a re-scrape.
  const known = await tx.eventSource.findUnique({ where: { url: n.url }, include: { event: true } });
  if (known) {
    await tx.eventSource.update({
      where: { id: known.id },
      data: { priceFrom: n.price, currency: n.priceCurrency, lastSeenAt: now },
    });
    await fillAndRefresh(tx, known.event, n);
    return 'updated';
  }

  // 2. Same fingerprint, then 3. fuzzy (same city, +/-3h, similar title).
  const target = (await tx.event.findUnique({ where: { fingerprint: n.fingerprint } })) ?? (await findFuzzy(tx, n));
  if (target) {
    await tx.eventSource.create({
      data: { eventId: target.id, sourceId, url: n.url, priceFrom: n.price, currency: n.priceCurrency, lastSeenAt: now },
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
        create: { sourceId, url: n.url, priceFrom: n.price, currency: n.priceCurrency, lastSeenAt: now },
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

/** Fill blank fields from the incoming listing and recompute price + sort columns from all sources. */
async function fillAndRefresh(tx: Tx, event: EventRow, n: NormalizedEvent): Promise<void> {
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
      ...blankFills(event, n),
      priceFrom,
      ...deriveSortFields({ startsAt: event.startsAt, priceFrom }),
    },
  });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run lib/ingest.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ingest.ts lib/ingest.test.ts
git commit -m "feat: add ingest pipeline (url, fingerprint, fuzzy, insert)"
```

---

### Task 9: Mock events and seed script

**Files:**
- Create: `lib/mock-events.ts`, `prisma/seed.ts`
- Test: `lib/mock-events.test.ts`

**Interfaces:**
- Consumes: `RawEvent`, `TZ`, `upsertRawEvents`, `prisma`.
- Produces: `buildMockEvents(now: Date): RawEvent[]` (all dates relative to `now`, all acts fictional); `npm run db:seed`.

- [ ] **Step 1: Write the failing test**

`lib/mock-events.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildMockEvents } from '@/lib/mock-events';
import { normalizeRaw } from '@/lib/normalize';
import { GENRES } from '@/lib/types';

const now = new Date('2026-09-30T10:00:00Z');
const raws = buildMockEvents(now);
const normalized = raws.map(normalizeRaw);

describe('buildMockEvents', () => {
  it('is big enough to exercise the feed', () => {
    expect(raws.length).toBeGreaterThanOrEqual(60);
  });

  it('every raw event normalizes without throwing (checked above) and covers all genres', () => {
    expect(new Set(normalized.map((n) => n.genre))).toEqual(new Set(GENRES));
  });

  it('covers the four cities', () => {
    const cities = new Set(normalized.map((n) => n.city));
    for (const city of ['Bratislava', 'Praha', 'Brno', 'Košice']) expect(cities.has(city)).toBe(true);
  });

  it('includes free, unknown-price, multi-day and other-currency listings', () => {
    expect(normalized.some((n) => n.price === 0)).toBe(true);
    expect(normalized.some((n) => n.price === null)).toBe(true);
    expect(normalized.filter((n) => n.endsAt !== null).length).toBeGreaterThanOrEqual(4);
    expect(normalized.some((n) => n.country === 'CZ' && n.priceCurrency === 'EUR')).toBe(true);
  });

  it('has exactly one repeated URL, to exercise the re-scrape path', () => {
    const urls = normalized.map((n) => n.url);
    expect(new Set(urls).size).toBe(urls.length - 1);
  });

  it('includes an event that started 30 minutes ago and one that started 3 hours ago', () => {
    const starts = normalized.map((n) => now.getTime() - n.startsAt.getTime());
    expect(starts.some((ms) => ms === 30 * 60_000)).toBe(true);
    expect(starts.some((ms) => ms === 180 * 60_000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/mock-events.test.ts`
Expected: FAIL, cannot resolve `@/lib/mock-events`.

- [ ] **Step 3: Implement `lib/mock-events.ts`**

```ts
import { TZDate } from '@date-fns/tz';
import { addDays, set } from 'date-fns';
import { TZ } from '@/lib/dates';
import type { RawEvent } from '@/lib/types';

type Src = 'goout' | 'predpredaj' | 'ticketportal';

const HOSTS: Record<Src, string> = {
  goout: 'https://goout.net/mock',
  predpredaj: 'https://www.predpredaj.sk/mock',
  ticketportal: 'https://www.ticketportal.sk/mock',
};

/** Prague wall-clock time `dayOffset` days from `now`. */
function at(now: Date, dayOffset: number, hour: number, minute = 0): Date {
  const day = addDays(new TZDate(now, TZ), dayOffset);
  return new Date(set(day, { hours: hour, minutes: minute, seconds: 0, milliseconds: 0 }).getTime());
}

const image = (id: string) => `https://picsum.photos/seed/${id}/640/360`;

type Row = [
  id: string,
  title: string,
  venue: string,
  city: string,
  genre: string,
  day: number,
  hour: number,
  price: number | null,
  sources: Src[],
];

const ROWS: Row[] = [
  // Bratislava
  ['b01', 'Jazz pod hviezdami', 'Majestic Music Club', 'Bratislava', 'Koncerty', 1, 20, 12, ['goout']],
  ['b02', 'Techno Wave: Sub Level', 'Nová Cvernovka', 'BA', 'Elektronická hudba', 2, 22, 10, ['goout', 'predpredaj']],
  ['b03', 'Hamlet', 'Slovenské národné divadlo', 'Bratislava', 'Divadlo', 3, 19, 18, ['ticketportal', 'predpredaj']],
  ['b04', 'Stand-up Night Vol. 7', 'Nová Cvernovka', 'Bratislava', 'Stand-up', 4, 20, 15, ['goout']],
  ['b05', 'Derby: Modrí vs. Bieli', 'Tehelné pole', 'Bratislava', 'Futbal', 5, 18, 9, ['predpredaj']],
  ['b06', 'Rockový piatok', 'Majestic Music Club', 'BA', 'Rock', 6, 21, null, ['goout']],
  ['b07', 'Komorný orchester: Baroko', 'Reduta', 'Bratislava', 'Klasická hudba', 7, 19, 20, ['ticketportal']],
  ['b08', 'Drum & Bass Session', 'Subclub', 'Bratislava', 'Elektronická hudba', 9, 22, 8, ['goout', 'ticketportal']],
  ['b09', 'Rodinné divadlo: Snehulienka', 'Divadlo Aréna', 'Bratislava', 'Detské divadlo', 10, 15, 6, ['predpredaj']],
  ['b10', 'Indie Open Air', 'Incheba Open Air', 'Bratislava', 'Festival', 13, 17, 25, ['goout', 'predpredaj']],
  ['b12', 'Hokej: Slovan – Košice', 'Ondrej Nepela Arena', 'Bratislava', 'Hokej', 8, 17, 14, ['predpredaj', 'ticketportal']],
  ['b13', 'Hip-hop Live', 'Majestic Music Club', 'Bratislava', 'Hip hop', 16, 21, 18, ['goout']],
  ['b14', 'Open Mic Comedy', 'Kaffee Mayer', 'Bratislava', 'Stand-up comedy', 12, 19, 0, ['goout']],
  ['b15', 'Elektronická nedeľa', 'Nová Cvernovka', 'BA', 'Elektronická hudba', 20, 16, null, ['goout']],
  ['b16', 'Rodinný deň v ZOO', 'ZOO Bratislava', 'Bratislava', 'Rodina a deti', 15, 10, 8, ['predpredaj']],
  // Praha
  ['p01', 'Noční jazz', 'Lucerna Music Bar', 'Praha', 'Koncerty', 1, 20, 390, ['goout', 'ticketportal']],
  ['p02', 'Techno Night Praha', 'Roxy', 'Prague', 'Elektronická hudba', 2, 23, 250, ['goout']],
  ['p03', 'Hamlet', 'Národní divadlo', 'Praha', 'Divadlo', 4, 19, 450, ['ticketportal']],
  ['p04', 'Stand-up Special', 'Kulturní dům Ládví', 'Praha', 'Stand-up', 5, 20, 350, ['goout']],
  ['p05', 'Derby: Rudí vs. Bílí', 'Fotbalový stadion', 'Praha', 'Fotbal', 6, 18, null, ['ticketportal']],
  ['p06', 'Indie večer', 'MeetFactory', 'Praha', 'Rock', 7, 20, 300, ['goout']],
  ['p07', 'Symfonický orchestr', 'Rudolfinum', 'Praha', 'Klasická hudba', 8, 19, 590, ['ticketportal']],
  ['p08', 'Bass Culture', 'Fuchs2', 'Praha', 'Elektronická hudba', 10, 22, 200, ['goout']],
  ['p09', 'Hip-hop Jam', 'Lucerna Music Bar', 'Praha', 'Hip hop', 11, 21, 320, ['goout', 'ticketportal']],
  ['p10', 'Festival světla', 'Náměstí Republiky', 'Praha', 'Festival', 14, 18, 0, ['goout']],
  ['p11', 'Loutkové divadlo pro děti', 'Divadlo Hurvínek', 'Praha', 'Divadlo', 9, 15, 180, ['ticketportal']],
  ['p12', 'Metalová noc', 'Rock Café', 'Praha', 'Metal', 15, 20, 280, ['goout']],
  ['p14', 'Pražský maraton: Expo', 'Výstaviště', 'Praha', 'Maraton', 17, 10, null, ['ticketportal']],
  ['p15', 'Comedy Club Live', 'Comedy Club', 'Praha', 'Stand-up comedy', 18, 20, 290, ['goout']],
  ['p16', 'Elektro brunch', 'Vnitroblock', 'Praha', 'Elektronická hudba', 3, 12, 0, ['goout']],
  // Brno
  ['r01', 'Brněnský jazz', 'Sono Centrum', 'Brno', 'Koncerty', 2, 20, 260, ['goout']],
  ['r02', 'Techno Brno', 'Fléda', 'Brno', 'Elektronická hudba', 4, 23, 180, ['goout']],
  ['r03', 'Divadelní večer: Cyrano', 'Národní divadlo Brno', 'Brno', 'Divadlo', 6, 19, 320, ['ticketportal']],
  ['r04', 'Stand-up Brno', 'Kabaret Kiosek', 'Brno', 'Stand-up', 9, 20, 220, ['goout']],
  ['r05', 'Zbrojovka – Sigma', 'Stadion Lužánky', 'Brno', 'Fotbal', 12, 17, 150, ['ticketportal']],
  ['r06', 'Indie Rock Brno', 'Fléda', 'Brno', 'Rock', 14, 20, null, ['goout']],
  ['r07', 'Barokní koncert', 'Besední dům', 'Brno', 'Klasická hudba', 18, 19, 350, ['ticketportal']],
  ['r08', 'Rave v Brně', 'Sono Centrum', 'Brno', 'Elektronická hudba', 22, 22, 250, ['goout', 'ticketportal']],
  // Košice
  ['k01', 'Jazz Košice', 'Kulturpark', 'Košice', 'Koncerty', 3, 20, 10, ['goout', 'predpredaj']],
  ['k02', 'Elektro noc', 'Collosseum Club', 'Košice', 'Elektronická hudba', 5, 22, 8, ['goout']],
  ['k03', 'Divadlo: Kráľ Lear', 'Štátne divadlo Košice', 'Košice', 'Divadlo', 7, 19, 16, ['predpredaj']],
  ['k04', 'Stand-up Východ', 'Tabačka Kulturfabrik', 'Košice', 'Stand-up', 10, 20, 12, ['goout']],
  ['k05', 'HC Košice – Poprad', 'Steel Aréna', 'Košice', 'Hokej', 11, 17, 11, ['predpredaj']],
  ['k06', 'Folk na nádvorí', 'Kasárne Kulturpark', 'Košice', 'Folk', 19, 18, 0, ['goout']],
];

const IMAGELESS = new Set(['b06', 'p05', 'r06', 'k05']);

function fromRow(now: Date, [id, title, venue, city, genre, day, hour, price, sources]: Row): RawEvent[] {
  return sources.map((source, i) => ({
    source,
    sourceUrl: `${HOSTS[source]}/${id}`,
    // Uppercased title on later sources: different text, same fingerprint.
    title: i === 0 ? title : title.toUpperCase(),
    venue,
    city,
    startsAt: at(now, day, hour),
    priceFrom: price === null ? null : Math.round(price * (1 + i * 0.05)),
    rawGenre: genre,
    imageUrl: IMAGELESS.has(id) ? null : image(id),
  }));
}

function specials(now: Date): RawEvent[] {
  const minutesFromNow = (m: number) => new Date(now.getTime() + m * 60_000);
  return [
    // Fuzzy merge: same city, 30 min apart, venue spelled differently, title punctuation differs.
    { source: 'goout', sourceUrl: `${HOSTS.goout}/s-fuzzy-1`, title: 'Aurora Bloom – Tour 2026', venue: 'O2 arena', city: 'Praha', startsAt: at(now, 4, 19, 30), priceFrom: 990, rawGenre: 'Koncerty', imageUrl: image('s-fuzzy') },
    { source: 'ticketportal', sourceUrl: `${HOSTS.ticketportal}/s-fuzzy-2`, title: 'Aurora Bloom Tour 2026', venue: 'O2 arena Praha', city: 'Praha', startsAt: at(now, 4, 20, 0), priceFrom: 1010, rawGenre: 'Koncerty', imageUrl: null },
    // Currency mix: the EUR listing must not affect the CZK event price (expect 890).
    { source: 'goout', sourceUrl: `${HOSTS.goout}/s-cur-1`, title: 'Metal Tribute Night', venue: 'Rock Café', city: 'Praha', startsAt: at(now, 9, 21), priceFrom: 890, rawGenre: 'Metal', imageUrl: image('s-cur') },
    { source: 'ticketportal', sourceUrl: `${HOSTS.ticketportal}/s-cur-2`, title: 'Metal Tribute Night', venue: 'Rock Café', city: 'Praha', startsAt: at(now, 9, 21), priceFrom: 35, currency: 'EUR', rawGenre: 'Metal', imageUrl: null },
    // Multi-day: exhibitions and festivals.
    { source: 'goout', sourceUrl: `${HOSTS.goout}/s-exh-1`, title: 'Výstava: Světlo a stín', venue: 'Galerie hlavního města Prahy', city: 'Praha', startsAt: at(now, -10, 10), endsAt: at(now, 30, 18), priceFrom: 250, rawGenre: 'Výstavy', imageUrl: image('s-exh-1') },
    { source: 'goout', sourceUrl: `${HOSTS.goout}/s-exh-2`, title: 'Nové smery: Súčasné umenie', venue: 'Galéria Dunaj', city: 'Bratislava', startsAt: at(now, -5, 10), endsAt: at(now, 40, 18), priceFrom: 0, rawGenre: 'Výstavy', imageUrl: image('s-exh-2') },
    { source: 'goout', sourceUrl: `${HOSTS.goout}/s-fest-1`, title: 'Letný festival Slnovrat', venue: 'Areál Zlatý piesok', city: 'Trenčín', startsAt: at(now, 20, 14), endsAt: at(now, 22, 23), priceFrom: 89, rawGenre: 'Festival', imageUrl: image('s-fest') },
    { source: 'predpredaj', sourceUrl: `${HOSTS.predpredaj}/s-fest-2`, title: 'Letný festival Slnovrat', venue: 'Areál Zlatý piesok', city: 'Trenčín', startsAt: at(now, 20, 14), endsAt: at(now, 22, 23), priceFrom: 92, rawGenre: 'Festival', imageUrl: null },
    { source: 'ticketportal', sourceUrl: `${HOSTS.ticketportal}/s-fest-3`, title: 'Hudební festival Barvy', venue: 'Areál Dolní oblast', city: 'Ostrava', startsAt: at(now, 12, 14), endsAt: at(now, 14, 23), priceFrom: 1490, rawGenre: 'Festival', imageUrl: image('s-fest-3') },
    // Must be hidden: fully ended.
    { source: 'goout', sourceUrl: `${HOSTS.goout}/s-ended-1`, title: 'Skončená výstava', venue: 'Dům umění', city: 'Brno', startsAt: at(now, -20, 10), endsAt: at(now, -2, 18), priceFrom: 100, rawGenre: 'Výstavy', imageUrl: null },
    { source: 'goout', sourceUrl: `${HOSTS.goout}/s-ended-2`, title: 'Včerajší koncert', venue: 'Majestic Music Club', city: 'Bratislava', startsAt: at(now, -1, 20), priceFrom: 12, rawGenre: 'Koncerty', imageUrl: null },
    // 2h effective end: 30 min ago shows in the Happening now row, 3h ago is hidden.
    { source: 'goout', sourceUrl: `${HOSTS.goout}/s-live-1`, title: 'Práve začína: klubová noc', venue: 'Subclub', city: 'Bratislava', startsAt: minutesFromNow(-30), priceFrom: 5, rawGenre: 'Elektronická hudba', imageUrl: null },
    { source: 'goout', sourceUrl: `${HOSTS.goout}/s-live-2`, title: 'Už skončilo: popoludňajší koncert', venue: 'Reduta', city: 'Bratislava', startsAt: minutesFromNow(-180), priceFrom: 5, rawGenre: 'Koncerty', imageUrl: null },
  ];
}

export function buildMockEvents(now: Date): RawEvent[] {
  const base = [...ROWS.flatMap((row) => fromRow(now, row)), ...specials(now)];
  // Re-scrape of a known listing (same URL, new price): exercises the "updated" path.
  const first = base[0];
  return [...base, { ...first, priceFrom: (first.priceFrom ?? 0) + 1 }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/mock-events.test.ts`
Expected: PASS. If a genre or city assertion fails, fix the row data, not the assertion.

- [ ] **Step 5: Write `prisma/seed.ts`**

```ts
import 'dotenv/config';
import { prisma } from '@/lib/db';
import { upsertRawEvents } from '@/lib/ingest';
import { buildMockEvents } from '@/lib/mock-events';

const SOURCES = [
  { slug: 'goout', name: 'GoOut', baseUrl: 'https://goout.net' },
  { slug: 'predpredaj', name: 'Predpredaj', baseUrl: 'https://www.predpredaj.sk' },
  { slug: 'ticketportal', name: 'Ticketportal', baseUrl: 'https://www.ticketportal.sk' },
];

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error('Refusing to seed in production: the seed wipes all events.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');

  console.log(`Seeding ${new URL(process.env.DATABASE_URL).host} (wipes Event + EventSource)`);
  await prisma.eventSource.deleteMany();
  await prisma.event.deleteMany();

  for (const source of SOURCES) {
    await prisma.source.upsert({
      where: { slug: source.slug },
      update: { name: source.name, baseUrl: source.baseUrl },
      create: source,
    });
  }

  const stats = await upsertRawEvents(buildMockEvents(new Date()));
  console.log({ created: stats.created, updated: stats.updated, merged: stats.merged, skipped: stats.skipped });

  const total = await prisma.event.count();
  console.log(`events in DB: ${total} (expect ${stats.created})`);

  const aurora = await prisma.event.findFirst({ where: { title: { contains: 'Aurora Bloom' } }, include: { sources: true } });
  console.log(`fuzzy merge: ${aurora?.sources.length} sources (expect 2)`);

  const tribute = await prisma.event.findFirst({ where: { title: { contains: 'Metal Tribute' } }, include: { sources: true } });
  console.log(`currency mix: priceFrom ${tribute?.priceFrom?.toString()}, ${tribute?.sources.length} sources (expect 890, 2)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Run the seed against the Neon dev branch and verify**

Run: `npm run db:seed`
Expected output (numbers other than the stated ones may differ slightly):
- `skipped: []`
- `updated: 1`
- `merged` greater than 0
- `events in DB: N (expect N)` with the same number twice
- `fuzzy merge: 2 sources (expect 2)`
- `currency mix: priceFrom 890, 2 sources (expect 890, 2)`

Run it a second time: it must produce the same numbers (the seed wipes first, so it is repeatable).

- [ ] **Step 7: Commit**

```bash
git add lib/mock-events.ts lib/mock-events.test.ts prisma/seed.ts
git commit -m "feat: add mock events and seed script"
```

---

### Task 10: i18n and app shell

**Files:**
- Create: `lib/i18n/dictionaries.ts`, `lib/i18n/pick.ts`, `lib/i18n/server.ts`, `lib/i18n/actions.ts`, `components/Header.tsx`
- Modify: `app/layout.tsx`
- Test: `lib/i18n/dictionaries.test.ts`, `lib/i18n/pick.test.ts`

**Interfaces:**
- Consumes: `Genre`, `When`.
- Produces:
  - `LANGS`, `type Lang`, `DEFAULT_LANG`, `LANG_LABELS`, `LOCALES`, `interface Dictionary`, `DICTIONARIES: Record<Lang, Dictionary>`, `fill(template: string, vars: Record<string, string | number>): string`
  - `isLang(v: unknown): v is Lang`, `pickLang(cookie: string | undefined, acceptLanguage: string | null | undefined): Lang`
  - `getLang(): Promise<Lang>` (server only)
  - `setLang(lang: Lang): Promise<void>` (server action)

- [ ] **Step 1: Write the failing tests**

`lib/i18n/pick.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isLang, pickLang } from '@/lib/i18n/pick';

describe('isLang', () => {
  it('accepts only known languages', () => {
    expect(isLang('sk')).toBe(true);
    expect(isLang('cs')).toBe(true);
    expect(isLang('en')).toBe(true);
    expect(isLang('de')).toBe(false);
    expect(isLang(undefined)).toBe(false);
    expect(isLang(42)).toBe(false);
  });
});

describe('pickLang', () => {
  it('a valid cookie wins over the header', () => {
    expect(pickLang('en', 'cs-CZ,cs;q=0.9')).toBe('en');
  });

  it('an invalid cookie falls back to the header', () => {
    expect(pickLang('xx', 'cs-CZ,cs;q=0.9,en;q=0.8')).toBe('cs');
  });

  it('takes the first supported language in the header', () => {
    expect(pickLang(undefined, 'de,en;q=0.5')).toBe('en');
    expect(pickLang(undefined, 'en-US')).toBe('en');
    expect(pickLang(undefined, 'sk-SK,sk;q=0.9')).toBe('sk');
  });

  it('falls back to sk', () => {
    expect(pickLang(undefined, 'de')).toBe('sk');
    expect(pickLang(undefined, undefined)).toBe('sk');
    expect(pickLang(undefined, null)).toBe('sk');
    expect(pickLang(undefined, ';;;')).toBe('sk');
  });
});
```

`lib/i18n/dictionaries.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, fill, LANGS } from '@/lib/i18n/dictionaries';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? { ...acc, [path]: value } : { ...acc, ...flatten(value, path) };
  }, {});
}

const flat = Object.fromEntries(LANGS.map((lang) => [lang, flatten(DICTIONARIES[lang] as unknown as Tree)]));
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('dictionaries', () => {
  it('have the same keys in every language', () => {
    const keys = Object.keys(flat.sk).sort();
    for (const lang of LANGS) expect(Object.keys(flat[lang]).sort()).toEqual(keys);
  });

  it('have no empty strings', () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(flat[lang])) expect(value.trim(), `${lang}.${key}`).not.toBe('');
    }
  });

  it('use the same placeholders in every language', () => {
    for (const key of Object.keys(flat.sk)) {
      for (const lang of LANGS) expect(placeholders(flat[lang][key]), `${lang}.${key}`).toBe(placeholders(flat.sk[key]));
    }
  });

  it('carry the required price labels', () => {
    expect(DICTIONARIES.sk.priceTba).toBe('cena neuvedená');
    expect(DICTIONARIES.cs.priceTba).toBe('cena neuvedena');
    expect(DICTIONARIES.en.priceTba).toBe('price TBA');
    expect(DICTIONARIES.sk.priceFree).toBe('zadarmo');
    expect(DICTIONARIES.cs.priceFree).toBe('zdarma');
    expect(DICTIONARIES.en.priceFree).toBe('free');
  });

  it('carry the happening-now labels', () => {
    expect(DICTIONARIES.sk.happeningNow).toBe('Práve prebieha');
    expect(DICTIONARIES.cs.happeningNow).toBe('Právě probíhá');
    expect(DICTIONARIES.en.happeningNow).toBe('Happening now');
  });
});

describe('fill', () => {
  it('replaces placeholders and blanks unknown ones', () => {
    expect(fill('Buy on {source}', { source: 'GoOut' })).toBe('Buy on GoOut');
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and ');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/i18n`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `lib/i18n/dictionaries.ts`**

```ts
import type { When } from '@/lib/dates';
import type { Genre } from '@/lib/types';

export const LANGS = ['sk', 'cs', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'sk';
export const LANG_LABELS: Record<Lang, string> = { sk: 'SK', cs: 'CZ', en: 'EN' };
export const LOCALES: Record<Lang, string> = { sk: 'sk-SK', cs: 'cs-CZ', en: 'en-GB' };

export interface Dictionary {
  appName: string;
  tagline: string;
  language: string;
  cities: string;
  allCities: string;
  citiesSelected: string;
  date: string;
  maxPrice: string;
  anyPrice: string;
  maxPriceValue: string;
  clearFilters: string;
  when: Record<'any' | When, string>;
  genre: Record<Genre, string>;
  priceFrom: string;
  priceFree: string;
  priceTba: string;
  buyOn: string;
  noEvents: string;
  loadMore: string;
  happeningNow: string;
}

const sk: Dictionary = {
  appName: 'Radar',
  tagline: 'Eventy zo Slovenska a Česka na jednom mieste',
  language: 'Jazyk',
  cities: 'Mestá',
  allCities: 'Všetky mestá',
  citiesSelected: 'Vybrané: {count}',
  date: 'Dátum',
  maxPrice: 'Max. cena',
  anyPrice: 'Bez limitu',
  maxPriceValue: 'do {price}',
  clearFilters: 'Zrušiť filtre',
  when: { any: 'Kedykoľvek', today: 'Dnes', weekend: 'Víkend', week: 'Týždeň', month: 'Mesiac' },
  genre: {
    concert: 'Koncert',
    electronic: 'Elektronika',
    theatre: 'Divadlo',
    exhibition: 'Výstava',
    standup: 'Stand-up',
    sport: 'Šport',
    other: 'Iné',
  },
  priceFrom: 'od {price}',
  priceFree: 'zadarmo',
  priceTba: 'cena neuvedená',
  buyOn: 'Kúpiť na {source}',
  noEvents: 'Nenašli sa žiadne udalosti. Skús upraviť filtre.',
  loadMore: 'Zobraziť viac',
  happeningNow: 'Práve prebieha',
};

const cs: Dictionary = {
  appName: 'Radar',
  tagline: 'Události z Česka a Slovenska na jednom místě',
  language: 'Jazyk',
  cities: 'Města',
  allCities: 'Všechna města',
  citiesSelected: 'Vybráno: {count}',
  date: 'Datum',
  maxPrice: 'Max. cena',
  anyPrice: 'Bez limitu',
  maxPriceValue: 'do {price}',
  clearFilters: 'Zrušit filtry',
  when: { any: 'Kdykoli', today: 'Dnes', weekend: 'Víkend', week: 'Týden', month: 'Měsíc' },
  genre: {
    concert: 'Koncert',
    electronic: 'Elektronika',
    theatre: 'Divadlo',
    exhibition: 'Výstava',
    standup: 'Stand-up',
    sport: 'Sport',
    other: 'Ostatní',
  },
  priceFrom: 'od {price}',
  priceFree: 'zdarma',
  priceTba: 'cena neuvedena',
  buyOn: 'Koupit na {source}',
  noEvents: 'Žádné události nenalezeny. Zkus upravit filtry.',
  loadMore: 'Zobrazit více',
  happeningNow: 'Právě probíhá',
};

const en: Dictionary = {
  appName: 'Radar',
  tagline: 'Events from Slovakia and Czechia in one place',
  language: 'Language',
  cities: 'Cities',
  allCities: 'All cities',
  citiesSelected: '{count} selected',
  date: 'Date',
  maxPrice: 'Max price',
  anyPrice: 'No limit',
  maxPriceValue: 'up to {price}',
  clearFilters: 'Clear filters',
  when: { any: 'Any time', today: 'Today', weekend: 'Weekend', week: 'Week', month: 'Month' },
  genre: {
    concert: 'Concert',
    electronic: 'Electronic',
    theatre: 'Theatre',
    exhibition: 'Exhibition',
    standup: 'Stand-up',
    sport: 'Sport',
    other: 'Other',
  },
  priceFrom: 'from {price}',
  priceFree: 'free',
  priceTba: 'price TBA',
  buyOn: 'Buy on {source}',
  noEvents: 'No events found. Try adjusting the filters.',
  loadMore: 'Load more',
  happeningNow: 'Happening now',
};

export const DICTIONARIES: Record<Lang, Dictionary> = { sk, cs, en };

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}
```

- [ ] **Step 4: Implement `lib/i18n/pick.ts`, `server.ts`, `actions.ts`**

`lib/i18n/pick.ts`:
```ts
import { DEFAULT_LANG, LANGS, type Lang } from '@/lib/i18n/dictionaries';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

export function pickLang(cookie: string | undefined, acceptLanguage: string | null | undefined): Lang {
  if (isLang(cookie)) return cookie;
  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (isLang(tag)) return tag;
  }
  return DEFAULT_LANG;
}
```

`lib/i18n/server.ts`:
```ts
import { cookies, headers } from 'next/headers';
import type { Lang } from '@/lib/i18n/dictionaries';
import { pickLang } from '@/lib/i18n/pick';

/** Server components and actions only. */
export async function getLang(): Promise<Lang> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return pickLang(cookieStore.get('lang')?.value, headerStore.get('accept-language'));
}
```

`lib/i18n/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type { Lang } from '@/lib/i18n/dictionaries';
import { isLang } from '@/lib/i18n/pick';

export async function setLang(lang: Lang): Promise<void> {
  if (!isLang(lang)) return;
  (await cookies()).set('lang', lang, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}
```

- [ ] **Step 5: Implement `components/Header.tsx` and replace `app/layout.tsx`**

`components/Header.tsx`:
```tsx
import { DICTIONARIES, LANG_LABELS, LANGS, type Lang } from '@/lib/i18n/dictionaries';
import { setLang } from '@/lib/i18n/actions';

export function Header({ lang }: { lang: Lang }) {
  const dict = DICTIONARIES[lang];
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{dict.appName}</h1>
          <p className="text-sm text-zinc-500">{dict.tagline}</p>
        </div>
        <nav aria-label={dict.language} className="flex gap-1">
          {LANGS.map((l) => (
            <form key={l} action={setLang.bind(null, l)}>
              <button
                type="submit"
                aria-pressed={l === lang}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  l === lang ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                {LANG_LABELS[l]}
              </button>
            </form>
          ))}
        </nav>
      </div>
    </header>
  );
}
```

`app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { getLang } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: 'Radar',
  description: 'Events from Slovakia and Czechia in one place',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang}>
      <body className="bg-zinc-50 text-zinc-900 antialiased">
        <Header lang={lang} />
        <main>{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Run tests, typecheck, build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests PASS, no type errors, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/i18n components/Header.tsx app/layout.tsx
git commit -m "feat: add SK/CZ/EN dictionaries, language toggle, app shell"
```

---

### Task 11: Event grid, filter bar, card, and end-to-end check

**Files:**
- Create: `lib/format.ts`, `components/FilterBar.tsx`, `components/EventCard.tsx`, `components/HappeningNow.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `parseFilters`, `withPage`, `queryEvents`, `queryHappeningNow`, `getCityOptions`, `EventCardData`, `DICTIONARIES`, `LOCALES`, `fill`, `getLang`, `isMultiDay`, `TZ`, `WHEN_VALUES`, `GENRES`.
- Produces: the finished home page. No new exports used by later tasks.

- [ ] **Step 1: Write `lib/format.ts`**

```ts
import { isMultiDay, TZ } from '@/lib/dates';
import type { Currency } from '@/lib/types';

export function formatWhen(startsAt: Date, endsAt: Date | null, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  if (endsAt && isMultiDay(startsAt, endsAt)) return `${day.format(startsAt)} – ${day.format(endsAt)}`;
  const time = new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return `${day.format(startsAt)}, ${time.format(startsAt)}`;
}

export function formatMoney(amount: number, currency: Currency, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
```

- [ ] **Step 2: Write `components/EventCard.tsx`**

```tsx
import type { EventCardData } from '@/lib/events/card';
import { formatMoney, formatWhen } from '@/lib/format';
import { fill, LOCALES, type Dictionary, type Lang } from '@/lib/i18n/dictionaries';
import type { Genre } from '@/lib/types';

// Full class strings so Tailwind can detect them.
const GENRE_GRADIENT: Record<Genre, string> = {
  concert: 'from-rose-400 to-orange-300',
  electronic: 'from-violet-500 to-cyan-400',
  theatre: 'from-amber-500 to-red-400',
  exhibition: 'from-emerald-400 to-teal-300',
  standup: 'from-yellow-400 to-lime-300',
  sport: 'from-sky-500 to-blue-400',
  other: 'from-zinc-400 to-zinc-300',
};

export function EventCard({ event, lang, dict }: { event: EventCardData; lang: Lang; dict: Dictionary }) {
  const locale = LOCALES[lang];
  const price =
    event.priceFrom === null
      ? dict.priceTba
      : event.priceFrom === 0
        ? dict.priceFree
        : fill(dict.priceFrom, { price: formatMoney(event.priceFrom, event.currency, locale) });

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="relative aspect-video w-full">
        {event.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className={`h-full w-full bg-linear-to-br ${GENRE_GRADIENT[event.genre]}`} />
        )}
        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium">
          {dict.genre[event.genre]}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h2 className="line-clamp-2 text-base font-semibold leading-snug">{event.title}</h2>
        <p className="text-sm text-zinc-600">{[event.venue, event.city].filter(Boolean).join(' · ')}</p>
        <p className="text-sm text-zinc-600">
          <time dateTime={event.startsAt.toISOString()}>{formatWhen(event.startsAt, event.endsAt, locale)}</time>
        </p>
        <p className="text-sm font-medium">{price}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          {event.sources.map((source) => (
            <a
              key={source.id}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700"
            >
              {fill(dict.buyOn, { source: source.sourceName })}
              {source.priceFrom !== null && source.priceFrom > 0
                ? ` · ${formatMoney(source.priceFrom, source.currency, locale)}`
                : ''}
            </a>
          ))}
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Write `components/HappeningNow.tsx`**

Horizontal scroll row above the grid. Renders nothing when there are no events.

```tsx
import { EventCard } from '@/components/EventCard';
import type { EventCardData } from '@/lib/events/card';
import type { Dictionary, Lang } from '@/lib/i18n/dictionaries';

export function HappeningNow({ events, lang, dict }: { events: EventCardData[]; lang: Lang; dict: Dictionary }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="happening-now" className="mb-8">
      <h2 id="happening-now" className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden="true" />
        {dict.happeningNow}
      </h2>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3">
        {events.map((event) => (
          <li key={event.id} className="w-72 shrink-0 snap-start">
            <EventCard event={event} lang={lang} dict={dict} />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Write `components/FilterBar.tsx`**

```tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { WHEN_VALUES, type When } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { fill, type Dictionary } from '@/lib/i18n/dictionaries';
import { GENRES, type Genre } from '@/lib/types';

const SLIDER_MAX = 100; // EUR; the top of the slider means "no limit"

interface Props {
  cities: string[];
  selected: { cities: string[]; genres: Genre[]; when?: When; maxPrice?: number };
  dict: Dictionary;
  locale: string;
}

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${
    active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
  }`;

export function FilterBar({ cities, selected, dict, locale }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete('page');
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  function toggle(key: 'city' | 'genre', value: string) {
    update((params) => {
      const current = params.getAll(key);
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      params.delete(key);
      next.forEach((v) => params.append(key, v));
    });
  }

  const [price, setPrice] = useState(selected.maxPrice ?? SLIDER_MAX);
  useEffect(() => {
    setPrice(selected.maxPrice ?? SLIDER_MAX);
  }, [selected.maxPrice]);
  useEffect(() => {
    if (price === (selected.maxPrice ?? SLIDER_MAX)) return;
    const id = setTimeout(
      () => update((p) => (price >= SLIDER_MAX ? p.delete('maxPrice') : p.set('maxPrice', String(price)))),
      300,
    );
    return () => clearTimeout(id);
  }, [price]); // eslint-disable-line react-hooks/exhaustive-deps

  const cityOptions = [...new Set([...cities, ...selected.cities])].sort((a, b) => a.localeCompare(b));
  const cityLabel = selected.cities.length
    ? fill(dict.citiesSelected, { count: selected.cities.length })
    : dict.allCities;
  const hasFilters =
    selected.cities.length > 0 || selected.genres.length > 0 || selected.when !== undefined || selected.maxPrice !== undefined;

  return (
    <div className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3" aria-busy={isPending}>
        <details className="relative">
          <summary className={`${chip(selected.cities.length > 0)} cursor-pointer list-none`}>{cityLabel}</summary>
          <div className="absolute left-0 top-full mt-2 max-h-72 w-56 overflow-auto rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
            {cityOptions.map((city) => (
              <label key={city} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-100">
                <input type="checkbox" checked={selected.cities.includes(city)} onChange={() => toggle('city', city)} />
                {city}
              </label>
            ))}
          </div>
        </details>

        <div role="group" aria-label={dict.date} className="flex flex-wrap gap-2">
          {(['any', ...WHEN_VALUES] as const).map((when) => {
            const active = when === 'any' ? selected.when === undefined : selected.when === when;
            return (
              <button
                key={when}
                type="button"
                aria-pressed={active}
                className={chip(active)}
                onClick={() => update((p) => (when === 'any' ? p.delete('when') : p.set('when', when)))}
              >
                {dict.when[when]}
              </button>
            );
          })}
        </div>

        <div role="group" aria-label={dict.cities} className="flex flex-wrap gap-2">
          {GENRES.map((genre) => (
            <button
              key={genre}
              type="button"
              aria-pressed={selected.genres.includes(genre)}
              className={chip(selected.genres.includes(genre))}
              onClick={() => toggle('genre', genre)}
            >
              {dict.genre[genre]}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          {dict.maxPrice}
          <input
            type="range"
            min={0}
            max={SLIDER_MAX}
            step={5}
            value={Math.min(price, SLIDER_MAX)}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
          <span className="w-24 tabular-nums">
            {price >= SLIDER_MAX ? dict.anyPrice : fill(dict.maxPriceValue, { price: formatMoney(price, 'EUR', locale) })}
          </span>
        </label>

        {hasFilters && (
          <button
            type="button"
            className="text-sm text-zinc-600 underline"
            onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
          >
            {dict.clearFilters}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace `app/page.tsx`**

```tsx
import Link from 'next/link';
import { EventCard } from '@/components/EventCard';
import { FilterBar } from '@/components/FilterBar';
import { HappeningNow } from '@/components/HappeningNow';
import { getCityOptions, queryEvents, queryHappeningNow } from '@/lib/events/query';
import { parseFilters, withPage, type RawParams } from '@/lib/events/filters';
import { DICTIONARIES, LOCALES } from '@/lib/i18n/dictionaries';
import { getLang } from '@/lib/i18n/server';

export default async function HomePage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const [params, lang] = await Promise.all([searchParams, getLang()]);
  const dict = DICTIONARIES[lang];
  const filters = parseFilters(params);
  const now = new Date();
  const [{ events, hasMore }, happeningNow, cityOptions] = await Promise.all([
    queryEvents(filters, now),
    queryHappeningNow(filters, now),
    getCityOptions(now),
  ]);

  return (
    <>
      <FilterBar
        cities={cityOptions}
        selected={{ cities: filters.cities, genres: filters.genres, when: filters.when, maxPrice: filters.maxPrice }}
        dict={dict}
        locale={LOCALES[lang]}
      />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <HappeningNow events={happeningNow} lang={lang} dict={dict} />
        {events.length === 0 ? (
          happeningNow.length === 0 && <p className="py-16 text-center text-zinc-500">{dict.noEvents}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {events.map((event) => (
              <li key={event.id}>
                <EventCard event={event} lang={lang} dict={dict} />
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <div className="mt-8 text-center">
            <Link
              href={withPage(params, filters.page + 1)}
              scroll={false}
              className="rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-medium hover:bg-zinc-100"
            >
              {dict.loadMore}
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 6: Static checks**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS; build lists `/` as a dynamic route.

- [ ] **Step 7: Verify in the browser with the `/browse` skill**

Start the app in the background: `npm run dev` (port 3000). Make sure the dev DB is seeded (`npm run db:seed`). Then, using the `/browse` skill only (never other browser tools), open `http://localhost:3000` and check each item, taking a screenshot and reading console errors at the end:

1. Grid renders with cards; genre gradient shows on cards without images; no console errors.
2. Absent everywhere (grid and row): "Včerajší koncert", "Skončená výstava", "Už skončilo: popoludňajší koncert".
3. A "Práve prebieha" row sits above the grid and scrolls horizontally. In this order (soonest effective end first) it holds "Práve začína: klubová noc" (started 30 min ago, ends in about 90 min), "Výstava: Světlo a stín", "Nové smery: Súčasné umenie". The exhibitions show a date range, the club night shows a single time. None of the three appear in the main grid, and the grid is not headed by ongoing events.
4. Row and filters: with `city=Praha` the row keeps only "Výstava: Světlo a stín"; with genre "Koncert" the row is empty and disappears; with `maxPrice=0` the row keeps only "Nové smery: Súčasné umenie" (free). Click "Dnes" and the row stays. Unless now is inside Fri 18:00 to Sun, click "Víkend" and the row disappears.
5. City filter: open the city dropdown, tick Praha. URL gets `?city=Praha`, and only Praha events remain in the grid. Tick Brno too: URL has two `city=` params.
6. Genre chips: click "Elektronika". URL gets `genre=electronic`; the grid narrows.
7. Date control: click "Dnes". Only events today remain in the grid (or the empty-state message shows if the grid and the row are both empty). Click "Kedykoľvek" and the `when` param disappears.
8. Max price: drag the slider to 0. After about 300 ms the URL has `maxPrice=0`; only free and price-unknown events remain, and unknown ones read "cena neuvedená". Drag to the right end and `maxPrice` disappears.
9. Within one day, priced events come before "cena neuvedená" events (compare two events on the same date).
10. "Metal Tribute Night" shows "od 890 Kč" (not 35 €) and two buy links; "Aurora Bloom – Tour 2026" shows two buy links (fuzzy merge).
11. Language toggle: click CZ, then EN. UI strings, price labels, the row heading ("Právě probíhá", "Happening now") and the `<html lang>` change; event titles do not. Reload keeps the language (cookie).
12. Load more: if the grid is capped at 24, the "Zobraziť viac" link adds `page=2` and the list grows without jumping to the top; the row is unchanged.
13. "Clear filters" resets to `/`.

Fix any failure by editing the relevant task's file, re-running the static checks, and re-checking the affected items. Stop the dev server when done.

- [ ] **Step 8: Commit**

```bash
git add lib/format.ts components app/page.tsx
git commit -m "feat: add event grid, happening-now row, filter bar, event card"
```

---

## Self-Review (done while writing)

**Spec coverage:** Schema with `EventSource`, `endsAt`, `startDay`, `priceKnown` (Task 2). Normalizer: genre, city, text, URL, fingerprint (Tasks 4, 5). Dedupe: fuzzy, price, blank fills (Task 6). Ingest order URL, fingerprint, fuzzy, insert with P2002 retry (Task 8). Date ranges including weekend edge cases (Task 3). Grid vs Happening now split at `now`, effective-end (2h) handling, price filters, sort order, cumulative paging (Tasks 3, 7, 11). Seed with fuzzy, currency, free, unknown, multi-day, ended and 30-min/3h cases (Task 9). i18n and price labels (Task 10). UI grid, filter bar, card (Task 11). Unit tests for normalizer, dedupe, dates, filters (Tasks 3 to 7). Digest, auth and scrapers are later plans, as specified.

**Type consistency:** `NormalizedEvent` fields (`url`, `price`, `priceCurrency`, `sourceSlug`) are defined in Task 5 and used the same way in Task 8. `EventFilters`, `RawParams`, `EventRow`, `EventCardData` are defined in Task 7 and used in Task 11. `Dictionary`, `Lang`, `LOCALES`, `fill` are defined in Task 10 and used in Task 11.

**Placeholders:** none.
