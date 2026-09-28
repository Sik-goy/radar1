# Radar — Design Spec

Aggregated event feed for Slovakia and Czech Republic. Scrapes ticketing sites, normalizes and dedupes into one feed, lets signed-in users favorite events and receive a weekly digest.

## Stack

- Next.js 15 (App Router, TypeScript, Tailwind), React 19
- Postgres on Neon via Prisma. Prod = Neon main branch, local = separate Neon dev branch. No Docker (macOS + Windows). `DATABASE_URL` (pooled) + `DIRECT_URL` (migrations).
- Scrapers: `fetch` + `cheerio` (Playwright only if a page needs JS)
- Auth (plan 2): Auth.js / NextAuth email magic link, Prisma adapter, database sessions
- Email (plan 6): Resend
- Tests: Vitest. Scripts: npm + `tsx` only, no bash-only steps.
- Dates: `date-fns` + `@date-fns/tz`, all calendar logic in `Europe/Prague`.

## Phases

Each plan gets its own written plan and implementation cycle.

1. **Foundation**: schema, migrations, normalizer, dedupe/ingest, mock seed, UI, unit tests.
2. NextAuth magic link + favorites.
3. goout scraper + `/api/cron/scrape` (`CRON_SECRET`) + `vercel.json` cron `0 */6 * * *`.
4. predpredaj scraper.
5. ticketportal scraper.
6. Weekly digest (Resend).

Every scraper: check robots.txt, delay between requests, fixture-based tests, one live smoke run.

## Data model

```prisma
enum Genre    { concert electronic theatre exhibition standup sport other }
enum Country  { SK CZ }
enum Currency { EUR CZK }

model Event {
  id          String   @id @default(cuid())
  title       String
  venue       String
  city        String            // canonical local name, e.g. "Praha"
  country     Country
  startsAt    DateTime
  endsAt      DateTime?         // exhibitions, festivals
  priceFrom   Decimal? @db.Decimal(10, 2) // min over sources in `currency` only; 0 = free, null = unknown
  currency    Currency          // derived from country: SK=EUR, CZ=CZK
  startDay    DateTime @db.Date // Prague calendar date of startsAt; denormalized for sorting
  priceKnown  Boolean           // priceFrom != null; denormalized for sorting
  genre       Genre
  imageUrl    String?
  fingerprint String   @unique
  sources     EventSource[]
  favorites   Favorite[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([startDay, priceKnown, startsAt])
  @@index([startsAt])
  @@index([endsAt])
  @@index([city])
  @@index([genre])
}

model Source {
  id            String   @id @default(cuid())
  slug          String   @unique      // "goout"
  name          String                // "GoOut" — used in "buy on X"
  baseUrl       String                // for robots.txt
  lastScrapedAt DateTime?
  events        EventSource[]
}

model EventSource {
  id         String   @id @default(cuid())
  eventId    String
  sourceId   String
  url        String   @unique         // canonicalized listing URL
  priceFrom  Decimal? @db.Decimal(10, 2)
  currency   Currency
  lastSeenAt DateTime
  event      Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  source     Source   @relation(fields: [sourceId], references: [id])

  @@index([eventId])
  @@index([sourceId])
}

model Favorite {
  userId  String
  eventId String
  createdAt DateTime @default(now())
  user    User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  event   Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@id([userId, eventId])
}

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  emailVerified DateTime?
  digestOptOut  Boolean  @default(false)
  favorites     Favorite[]
  sessions      Session[]
}
// Session + VerificationToken: standard Auth.js Prisma adapter models.
```

Notes:
- `Event.priceFrom` = min of `EventSource.priceFrom` where `EventSource.currency == Event.currency`. Other currencies are never compared. Recomputed on every ingest touching the event.
- Card label = `EventSource.source.name`. No hostname matching.
- `lastSeenAt` is written on every scrape. A later change may hide sources not seen in 2 scrapes; out of scope now.
- Verify Prisma's current config style at install time (`directUrl` in schema vs `prisma.config.ts`) and follow the installed version.

## Pure modules (no DB, unit-tested)

`RawEvent` (scraper output): `source` (slug), `sourceUrl`, `title`, `venue`, `city`, `country?`, `startsAt`, `endsAt?`, `priceFrom?`, `currency?`, `rawGenre?`, `imageUrl?`.

`lib/normalize`
- `normalizeGenre(raw)`: keyword table (SK/CZ/EN) to the 7 genres, `other` fallback.
- `normalizeCity(raw)`: alias table to canonical local name (`BA`/`Bratislava` -> Bratislava, `Prague`/`Praha` -> Praha, Brno, Košice, ...). Unknown cities pass through title-cased. `countryForCity` infers country when missing.
- `normalizeText(s)`: lowercase, strip diacritics, strip punctuation, collapse whitespace.
- `canonicalizeUrl(url)`: strip fragment and tracking params (`utm_*`, `fbclid`, ...), lowercase host. Needed because `EventSource.url` is unique.
- `fingerprint(title, venue, startsAt)`: `normalizeText(title)|normalizeText(venue)|YYYY-MM-DD` (Europe/Prague date).

`lib/dedupe`
- `levenshtein(a, b)`, `titleDistance(a, b)` = edit distance of normalized titles / length of the longer one.
- `pickFuzzyMatch(raw, candidates)`: candidates are already filtered by the DB query (same city, `|startsAt diff| <= 3h`). Returns the candidate with the lowest `titleDistance` below `0.2`, else null. Venue is not compared.
- `computeEventPrice(sources, currency)`: min over same-currency, non-null prices.

`lib/dates`
- `resolveRange(when, now)` returns `{ start, end }` in Europe/Prague.
  - `today`: now to end of today
  - `week`: now to now + 7d
  - `month`: now to now + 30d
  - `weekend`: Friday 18:00 to Sunday end of day. If `now` is already inside that window, start = `now`. If the weekend has passed, use the upcoming one.
  - none: `{ start: now, end: null }`

## Ingest (`lib/ingest.upsertRawEvents(raw[])`)

Processed sequentially (later items in a batch can match earlier ones). For each `RawEvent`, after normalization:

1. **URL match**: `EventSource` by canonical `url`. Hit means a re-scrape of a known listing: update `priceFrom`, `currency`, `lastSeenAt`; fill blank Event fields (`imageUrl`, `endsAt`); recompute `Event.priceFrom`. Done.
2. **Fingerprint match**: `Event` by `fingerprint`. Hit: create `EventSource` on that event, merge, recompute price.
3. **Fuzzy match**: query events with same `city` and `startsAt` within +/-3h, then `pickFuzzyMatch`. Hit: create `EventSource` on that event, merge, recompute price.
4. **Insert**: create `Event` + `EventSource`.

Merge policy: existing Event fields win; only blanks (`imageUrl`, `endsAt`) are filled. A fuzzy-merged event keeps its original fingerprint.

Race: on unique violation (P2002) for `fingerprint` or `url`, retry the flow once as a merge.

Event `currency` derives from `country`. An `EventSource` in a different currency is stored but excluded from `Event.priceFrom`.

## Filtering and visibility

- Effective end = `coalesce(endsAt, startsAt + 2h)`. Single-time events count as lasting 2 hours, so an event that started 30 minutes ago still shows.
- Feed never shows fully-ended events. Base range start = `now`.
- Overlap filter for date ranges: `startsAt <= rangeEnd AND effectiveEnd >= rangeStart`. In Prisma: `startsAt <= end` AND (`endsAt >= start` OR (`endsAt` null AND `startsAt >= start - 2h`)).
- Price semantics: `priceFrom = 0` is free, `priceFrom = null` is unknown.
- `maxPrice` filter: show events with `priceFrom <= maxPrice` OR `priceFrom` null. Unknown-price events show the label "price TBA" (see i18n). A "hide unknown price" checkbox is out of scope for plan 1.
- `maxPrice` is in EUR. Because `priceFrom` is stored in the event's own currency, CZK events are compared against `maxPrice * CZK_PER_EUR`, a fixed constant in config (initial value 25). The match is: (`currency = EUR` AND `priceFrom <= maxPrice`) OR (`currency = CZK` AND `priceFrom <= maxPrice * CZK_PER_EUR`) OR `priceFrom` null.
- Other filters: `city` in set, `genre` in set.
- Order: `startDay` ascending, then priced before unknown-price (`priceKnown` desc), then `startsAt` ascending. So unknown-price events sort after priced ones within the same day. Prisma cannot order by an expression, so `Event.startDay` (Prague calendar date) and `Event.priceKnown` are denormalized columns, refreshed by ingest whenever `startsAt` or prices change (`deriveSortFields(event)`, pure and unit-tested).
- 24 per page, "load more" via `page` param.
- Decimals are converted to numbers in the query layer, never passed raw to client components.

## UI (plan 1)

- `/` server component reads `city[]`, `genre[]`, `when`, `maxPrice`, `page` from search params and queries Prisma directly.
- `FilterBar` (client, sticky): city multiselect, genre chips, date segmented control (today/weekend/week/month), max-price slider (debounced). Updates URL via `router.replace`.
- `EventCard`: image (gradient fallback), title, venue, date (range for multi-day), price ("from X", "free" when 0, "price TBA" when null), one "buy on {Source.name}" link per `EventSource`, cheapest first, showing that source's price when known.
- Images: plain `<img>` until scrapers reveal hosts for `next/image` `remotePatterns`.
- Header: SK/CZ/EN toggle.
- No favorite heart in plan 1 (needs auth, plan 2).

## i18n

`lang` cookie (default from `Accept-Language`, fallback `sk`), typed dictionary for `sk`/`cs`/`en` (about 60 strings), toggle is a server action that sets the cookie. Price labels: null = "cena neuvedená" (sk) / "cena neuvedena" (cs) / "price TBA" (en); 0 = "zadarmo" / "zdarma" / "free". Only UI chrome is translated; event content stays in its original language. Locale code for Czech is `cs`, displayed as "CZ".

## Seed

`prisma/seed.ts` (run via `tsx`): creates `Source` rows, then pushes about 60 mock `RawEvent`s through `upsertRawEvents`, so it exercises the real pipeline.
- Cities: Bratislava, Praha, Brno, Košice. All 7 genres.
- Dates spread over the next 6 weeks, relative to run time.
- Some events with 2-3 sources, including one duplicate with a slightly different title and venue name (fuzzy path) and one with a different-currency source.
- A few multi-day events with `endsAt` (exhibitions, festival), and one already ended to prove it is hidden.
- Some free events (`priceFrom = 0`), some unknown-price events (null), and one single-time event that started 30 minutes before seeding, to prove the 2h effective end.

## Testing (plan 1)

Vitest unit tests, no DB or network:
- `normalize`: genre map (SK/CZ/EN keywords, fallback), city aliases (`BA`, `Prague`, unknown passthrough), `normalizeText`, `canonicalizeUrl`, fingerprint stability across casing, diacritics, punctuation, and Prague-date boundaries.
- `dedupe`: `levenshtein`, `titleDistance` thresholds around 0.2, `pickFuzzyMatch` (picks lowest distance, rejects >= 0.2, empty candidates), `computeEventPrice` (min, same-currency only, all-null).
- `dates`: `resolveRange` for each `when`, including the weekend edge cases (mid-weekend, after Sunday).
- `events/query`: pure where-clause builder: effective-end overlap (2h default), `maxPrice` with currency conversion and null-price inclusion, `0` treated as a real price. `deriveSortFields`: `startDay` at Prague day boundaries, `priceKnown` for 0 vs null.

Ingest DB flow is verified by running the seed against the Neon dev branch and inspecting the result, not by automated tests, in plan 1.

## Later plans (design fixed here, detail in their own plans)

- **Cron**: `GET /api/cron/scrape`, `Authorization: Bearer $CRON_SECRET`, runs all scrapers sequentially, `upsertRawEvents`, updates `Source.lastScrapedAt`.
- **Digest**: weekly, per user without `digestOptOut`.
  - (a) favorited events overlapping the next 7 days.
  - (b) events created in the last 7 days, still upcoming, with city in the favorites' city set AND genre in the favorites' genre set.
  - Dedupe by event id, (a) wins. Sent via Resend.

## Assumptions

- "Genre chi" = genre chips.
- "Levenshtein < 0.2" = normalized distance (edit distance / longer title length).
- Digest matching uses favorites' city and genre sets, not per-event follow.
