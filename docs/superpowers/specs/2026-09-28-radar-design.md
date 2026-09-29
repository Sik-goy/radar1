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
3. ~~goout scraper~~ — **on hold** (2026-09-29): goout.net's terms of use forbid publishing/redistributing site content without written consent (see "Plan C investigation" below). Outreach sent (`docs/outreach/goout.md`); revisit if they consent or offer a partner feed.
4. **predpredaj scraper** (plan C′, pulled forward ahead of goout/ticketportal — see addendum below) + `/api/cron/scrape` (`CRON_SECRET`) + `vercel.json` cron `0 */6 * * *`.
5. ticketportal scraper (same corporate owner as goout — PLG — so carries the same ToS risk; deprioritized until goout is resolved one way or the other).
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

1. **URL match**: `EventSource` by canonical `url`. Hit means a re-scrape of a known listing: update `priceFrom`, `currency`, `lastSeenAt`. Then reconcile the Event itself against the fresh scrape:
   - **Single-source event** (no other `EventSource` rows): nothing else vouches for its data, so the scrape fully replaces `title`, `venue`, `startsAt`, `endsAt` and the recomputed `fingerprint`. If the new fingerprint collides with a different existing `Event`, merge into it instead — move this `EventSource` there, delete the now-empty original `Event`, recompute price.
   - **Multi-source event**: other sources still back the current `startsAt`, so only a drift past the fuzzy window (> 3h) is accepted as a genuine reschedule (logged); anything smaller is ignored. `title`, `venue` and `fingerprint` are never touched by a re-scrape while another source backs them.
   - Either way, blank Event fields (`imageUrl`, `endsAt`) are filled from the scrape where still unset, and `Event.priceFrom` is recomputed. Done.
2. **Fingerprint match**: `Event` by `fingerprint`. Hit: create `EventSource` on that event, merge, recompute price.
3. **Fuzzy match**: query events with same `city` and `startsAt` within +/-3h, then `pickFuzzyMatch`. Hit: create `EventSource` on that event, merge, recompute price.
4. **Insert**: create `Event` + `EventSource`.

Merge policy: existing Event fields win; only blanks (`imageUrl`, `endsAt`) are filled, and never with an `endsAt` that would land before the existing `startsAt`. A fuzzy-merged event keeps its original fingerprint.

Race: on unique violation (P2002) for `fingerprint` or `url`, retry the flow once as a merge.

Event `currency` derives from `country`. An `EventSource` in a different currency is stored but excluded from `Event.priceFrom`.

## Filtering and visibility

- Effective end = `coalesce(endsAt, startsAt + 2h)`. Single-time events count as lasting 2 hours.
- **Main grid**: events with `startsAt >= rangeStart` (and `startsAt <= rangeEnd` when the range has an end). Base range start = `now`. Events that already started never appear in the grid, so long-running events never pin to the top of it.
- **Happening now row**: events with `startsAt < now` and effective end `>= now`, max 12, sorted by effective end ascending (ending soonest first). The same city, genre and price filters apply. It is shown only when the selected range starts at now (every range except a weekend that has not begun yet) and hidden otherwise. An event starting exactly at `now` is in the grid, not the row. An event that started 30 minutes ago shows in the row.
- Fully ended events (effective end before now) appear nowhere.
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
- "Happening now" row above the grid: horizontal scroll of `EventCard`s, hidden when empty. Label: "Práve prebieha" (sk) / "Právě probíhá" (cs) / "Happening now" (en).
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
- A few multi-day events with `endsAt` (exhibitions, festival), and one already ended to prove it is hidden. Ongoing exhibitions appear in the Happening now row.
- Some free events (`priceFrom = 0`), some unknown-price events (null), and one single-time event that started 30 minutes before seeding (in the Happening now row) and one that started 3 hours before (hidden), to prove the 2h effective end.

## Testing (plan 1)

Vitest unit tests, no DB or network:
- `normalize`: genre map (SK/CZ/EN keywords, fallback), city aliases (`BA`, `Prague`, unknown passthrough), `normalizeText`, `canonicalizeUrl`, fingerprint stability across casing, diacritics, punctuation, and Prague-date boundaries.
- `dedupe`: `levenshtein`, `titleDistance` thresholds around 0.2, `pickFuzzyMatch` (picks lowest distance, rejects >= 0.2, empty candidates), `computeEventPrice` (min, same-currency only, all-null).
- `dates`: `resolveRange` for each `when`, including the weekend edge cases (mid-weekend, after Sunday).
- `events/filters`: pure where-clause builders. Main grid (`startsAt >= rangeStart`), Happening now (started, not ended, 2h default for single-time events, hidden for a future weekend, same city/genre/price filters), `maxPrice` with currency conversion and null-price inclusion, `0` treated as a real price. `events/happening`: `effectiveEnd` and the merge/sort/limit of the row. `deriveSortFields`: `startDay` at Prague day boundaries, `priceKnown` for 0 vs null.

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

## Addendum (2026-09-29): source investigation and the predpredaj scraper (plan C′)

### Sources investigated, and why predpredaj is next

- **goout.net**: technically excellent (a clean public JSON endpoint,
  `services/entities/v1/schedules`, no scraping needed) but its terms of use
  explicitly restrict publishing/redistributing site content without written
  consent (private-use-only otherwise). Put on hold; outreach email drafted
  and sent, see `docs/outreach/goout.md`.
- **ticketportal.sk**: same corporate owner as goout (PLG group, confirmed via
  shared footer links) — same ToS risk, deprioritized alongside it.
- **Ticketmaster Discovery API**: legally the cleanest (a real third-party API
  license built for display+deep-link use), but live-tested and rejected on
  coverage: **zero events in Slovakia**, and Czech coverage (188 events over
  60 days) is ~93% concentrated in Prague, almost entirely major international
  arena tours at O2 Arena/Forum Karlín (each show often double-listed as a
  separate "Fast Track"/VIP entry), no exhibitions, and **zero events carry
  `priceRanges`**. Not usable as a source; kept as a possible later
  secondary source for big Prague arena shows only, if a title filter is
  added to collapse the Fast Track duplicates.
- **eventim.cz / eventim.sk**: blocked by Akamai bot protection at the TLS
  layer — even a real headless browser got `ERR_HTTP2_PROTOCOL_ERROR`.
  Dropped.
- **predpredaj.zoznam.sk** (predpredaj.sk redirects here): owned by Zoznam.sk,
  *not* PLG. `robots.txt` only disallows five specific stale 2020 event URLs,
  no blanket restriction. Read their ticket-purchase terms (VOP) PDF in full
  — no scraping/redistribution/copyright clause found (it covers ticket
  delivery mechanics, not content usage). Server-rendered, real event data
  in the raw HTML. **Chosen as the next scraper.**

### predpredaj.zoznam.sk: site facts

- **SK only.** No `/cz/` path (404); `/en/` exists but is an English UI over
  the same Slovak inventory, not Czech events. `robots.txt`'s five disallowed
  slugs happen to be 2020 Brno/Praha events, confirming a Czech-city event
  can occasionally appear (cross-border tours, historically), but the region
  filter today lists only Slovak regions plus "Austria" and "Svet" (World).
  Country is derived the normal way (`countryForCity`, defaulting through
  `normalizeCity`) — nothing SK-specific needs hardcoding.
- **Category pages**, footer nav (7): `/sk/kategoria/{koncert,sport,show,
  divadlo,festival,pre-deti,ostatne}/`. No pagination markers found on the
  concert category (~79 event links on one page, no `?page=`/"load more");
  treat categories as effectively single-page but cap at a defensible page
  count defensively in case a busier category (e.g. `sport`) does paginate.
  A finer 15-value subcategory tag list also exists in the sidebar filter
  (Divadlo, Festival, Gastro, Hudba, Koncert, Konferencia, **Kultúra**, Kurz,
  Online event, Ostatné, Pre deti, Prednáška, Show, Šport, Workshop) — prefer
  it over the 7-value nav category when present, since it disambiguates
  exhibitions (`Kultúra`) from concerts, which the 7-value list cannot.
- **Event pages** (`/sk/listky/{slug}/`) come in two shapes:
  - **Single-date**: one header line — title, `DD.MM.YYYY HH:MM`, then a
    comma-separated venue address (`<venue name>, <street>, <postal code +
    city>` — the postal code prefix, `^\d{3}\s?\d{2}\s+`, is stripped before
    the last segment goes to `normalizeCity`; the street segment is
    discarded, `RawEvent` has no address field).
  - **Tour pages** (recurring acts, e.g. a Christmas concert series): the
    same header line repeated once per stop, each with its own date, time
    and venue, and a location suffix in the title when a city repeats
    twice (`Nitra`, `Nitra 2`). Each stop is its own `RawEvent`; the page's
    own `sourceUrl` is shared across stops (deep-link target for all of
    them, since predpredaj doesn't give each stop its own URL) — this is
    fine, `EventSource.url` uniqueness is scoped to the *ingested* event,
    not to the page, and the first stop to be ingested wins the URL,
    later stops fall through to fingerprint/fuzzy match and get created
    as their own events with their own (synthetic, non-navigable-to-a-
    single-stop) `sourceUrl` collision — **note for the plan**: this needs
    a decision (append a stable per-stop query param to the shared URL,
    e.g. `?date=DD.MM.YYYY`, so each stop gets a distinct, real,
    deep-linkable `EventSource.url` back to the same page).
  - One observed page had a **stale slug vs. live date** (URL says
    `-2026-09-06`, the rendered page says `02.09.2027` — a reschedule the
    site never renamed the URL for). A pinning test should cover trusting
    the rendered date over anything inferred from the URL.
  - **Price**: a list of ticket tiers, each `Cena X,XX €` (comma
    decimal, narrow-space thousands where relevant); `priceFrom` = the
    minimum across tiers. No free (`0,00 €`) example was seen live, but the
    format implies it renders the same way as any other tier — treat it as
    a real free price, not absence. A page with no tiers rendered (not yet
    on sale) means unknown price (`null`), not a crawl failure.
  - Currency is always EUR (Slovakia).
  - Images: hotlink predpredaj's own image URL directly, matching plan 1's
    "plain `<img>` until scrapers reveal hosts for `next/image`
    `remotePatterns`" — do not rehost. Descriptions are not scraped at all
    (deep-link to predpredaj's own page for anyone who wants one), per the
    same "why redistribute what we can link to" reasoning as the outreach
    email.
- **Category → genre** (prefer the 15-value subcategory tag when the page
  has one, else the 7-value nav category):

  | predpredaj | Genre |
  |---|---|
  | Koncert, Hudba | `concert` |
  | Šport | `sport` |
  | Divadlo | `theatre` |
  | Kultúra, Gastro | `exhibition` (closest fit; "Gastro" is a stretch but
    there is no food/tasting genre in our 7 — same call plan 1 already
    made for goout's mock `gastronomy` rows, mapped to `other` there;
    predpredaj's `Kultúra` is closer to real exhibitions so gets its own
    line, `Gastro` still falls to `other` unless it's clearly an exhibit) |
  | Show | `other` (talk shows, galas — not clearly standup; a `standup`
    match only fires on an explicit "stand-up"/"comedy" keyword hit via the
    existing `normalizeGenre` keyword table, which predpredaj's tags don't
    supply — direct-mapped categories bypass `normalizeGenre` entirely, see
    below) |
  | Festival | `concert`, multi-day (`endsAt` set) when the page shows a
    date range instead of one date |
  | Pre deti | `other` |
  | Konferencia, Kurz, Workshop, Prednáška, Online event | `other` |
  | Ostatné | `other` |

  Map directly in the scraper adapter (`lib/scrapers/predpredaj.ts`) to a
  `Genre`, bypassing `normalizeGenre`'s keyword matching — predpredaj's
  categories are a small fixed enum, not free text, so a direct lookup is
  more precise (this mirrors the same call made for goout's category enum
  in the Task 5/6 self-review, never implemented since goout is on hold).

### Ingest and cron

- `lib/scrapers/predpredaj.ts` exports `scrapePredpredaj(): Promise<RawEvent[]>`
  (fetch + cheerio, no Playwright — the pages are server-rendered).
  Sequential category crawl, 1–2s delay between requests (`setTimeout`
  between fetches, not `Promise.all`), custom `User-Agent` naming the
  project and a contact email, and a `robots.txt`-aware check before the
  first request (hardcode the five known disallowed slugs plus a live
  robots.txt fetch, so a future addition to the disallow list is honored
  without a code change).
- `/api/cron/scrape`: `Authorization: Bearer $CRON_SECRET`, calls
  `scrapePredpredaj()`, then `upsertRawEvents`, updates
  `Source.lastScrapedAt`, returns `{ created, updated, merged, skipped }`.
  Same route will grow a second scraper call when goout/ticketportal
  unblock; keep it structured as a list of scrapers run in sequence, not a
  single hardcoded call, so that addition is a one-line change.
  Time budget: category crawl (7 pages) + one detail-page fetch per event
  (~80–150 events across categories, some shared) at 1–2s delay is close to
  Vercel's default function timeout on the Hobby tier; the plan chunks by
  category if a single run risks it (route accepts an optional
  `?category=` param the cron config can call multiple times, or the
  function reports partial progress and a second cron tick catches up —
  decided in the plan, not here).
- `vercel.json`: `0 */6 * * *`, same as originally scoped for goout.

### Outreach

Same pitch as goout (deep-link only, no description copying, attribution
shown, ask for consent or a partner feed), drafted in Slovak at
`docs/outreach/predpredaj.md`, addressed to Zoznam (predpredaj's operator).

## Open questions (dedupe tuning, deferred to the scraper plan)

Real scraper data will show whether these matter; both are left as-is for plan 1, pinned by tests that document the current behavior rather than changing it.

- **Same title, venue and day collapses to one event.** The fingerprint is `title|venue|Prague-date`, so two distinct shows at the same venue on the same day (e.g. an 18:00 and a 21:00 stand-up set) merge into a single `Event`, and the later time is lost from the card. A fix needs a real design decision (time in the fingerprint? a distinct-showtimes model on one Event?), not a one-line change.
- **Fuzzy match tolerates a bare number suffix.** `pickFuzzyMatch`'s number-conflict guard only fires when *both* titles contain a number sequence and they differ (`"Jazz Night 1"` vs `"Jazz Night 2"` correctly does not merge). `"Jazz Night"` vs `"Jazz Night 2"` still merges, since only one side has a number. Rare in practice (most recurring-event scrapers number every instance), but worth a second look once real listings are in.
