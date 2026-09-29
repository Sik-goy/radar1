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
- **Category pages**, footer nav (7 values — the only reliable category
  signal, see below): `/sk/kategoria/{koncert,sport,show,divadlo,festival,
  pre-deti,ostatne}/`. No pagination markers found on the concert category
  (~79 event links on one page, no `?page=`/"load more"); treat categories
  as effectively single-page but cap at a defensible count defensively in
  case a busier category paginates. A finer 15-value tag list (Divadlo,
  Festival, Gastro, Hudba, Koncert, Konferencia, Kultúra, Kurz, Online
  event, Ostatné, Pre deti, Prednáška, Show, Šport, Workshop) exists, but
  only as the sidebar *filter widget*'s option list, present verbatim on
  every page — it is **not** a per-event tag. The `.badge` elements that
  appear to carry a finer category on an event's own detail page belong to
  its "recommended events" sidebar cards, not the event itself (confirmed:
  the same four-ish badges recur near-identically across unrelated pages).
  **The category an event was crawled under (the `/sk/kategoria/{slug}/`
  page it came from) is the only category signal we have, and it's
  reliable enough** — use it directly, do not try to read a badge off the
  event page.
- **Category listing markup** (confirmed from the fixture): each card is
  `article.box`, with `h2.box-item-title > span` = title, `img.box-item-
  img[src]` = thumbnail, and the detail link is the `<a class="box-item-
  btn">` inside the desktop (`.box-content.d-none.d-md-block`) variant —
  the mobile variant repeats the same title with no link, so selecting
  `.box-item-btn` alone (not the whole card) avoids a stray duplicate.
- **Event pages** (`/sk/listky/{slug}/`) carry a schema.org `Event`
  JSON-LD block (`<script type="application/ld+json">`) — use it as the
  primary data source instead of parsing visible text; it is far more
  reliable and already does the date/city split for us. Two shapes,
  distinguished by whether its `startDate` is populated:
  - **Single-date** (`startDate` non-empty, e.g. `"2026-11-06 19:00"` —
    `YYYY-MM-DD HH:mm`, a Europe/Prague/Bratislava wall-clock reading,
    both zones share the same offset year-round): `name` = title,
    `location.address` = **already the bare city name** (confirmed
    against both a zip-prefixed address, `"086 31 Bardejov"` → `address:
    "Bardejov"`, and a zip-less one — predpredaj does the stripping for
    us, so `RawEvent.city` needs no postal-code regex), `location.name`
    = the full comma-joined address (`<venue>, <street>, <postal +
    city>`) whose *first* segment is the venue name, `image` = the
    event's own hero image (not the category-card thumbnail — richer
    and always present). JSON-LD string values are themselves
    HTML-entity-escaped (`"Diana Damrau &amp; Slovenská..."` literally,
    not a real `&`) — the whole site does this consistently (same escaping
    shows up in `<title>`/`<meta description>`), so every JSON-LD string
    needs an HTML-entity-decode pass (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
    `&#39;`/`&apos;`, and numeric `&#NNN;`/`&#xHEX;`) before use.
    Price tiers (see below) are parsed separately from the visible page,
    not from JSON-LD (JSON-LD carries no price).
  - **Tour pages** (recurring acts, e.g. a Christmas concert series;
    `startDate` empty, `location.name` a generic `"Slovensko"` or a bare
    comma list of cities): the real per-stop data lives in a `<ul>` of
    `<li class="list-group-item"><a href="/sk/listky/{own-slug}/">`
    — **each stop already has its own real, unique detail page URL**
    (e.g. `…-nitra-1-2026-12-13/`, `…-nitra-2-2026-12-13/`), so there is
    no shared-URL problem to solve. Each such `<li>` carries everything
    needed inline: `<strong>` = that stop's title (already includes a
    location suffix when a city repeats, `Nitra`, `Nitra 2`), `<span
    class="text-readable">` = `DD.MM.YYYY HH:MM - <venue address>` (dash-
    separated here, unlike the single-date page's plain whitespace split
    — confirmed on the fixture; same comma-joined address format, same
    "first segment is the venue" rule, but *without* JSON-LD's free city
    extraction, so this path does need the postal-code strip,
    `^\d{3}\s?\d{2}\s+`, on the address's last comma segment before
    `normalizeCity`). **Beware:** `li.list-group-item` alone is not a
    safe selector — the class name is reused elsewhere on the page (a
    single-date page fixture has 14 unrelated `li.list-group-item`
    elements, zero of which are tour stops); scope to `li.list-group-item
    > a[href^="/sk/listky/"]` and prefer the JSON-LD `startDate`-empty
    check as the primary single-date-vs-tour discriminator, not
    `li.list-group-item`'s mere presence.
    **Scrape each stop directly from this list — do not additionally
    fetch each stop's own page**: the hub page carries zero `Cena`/price
    markup (confirmed on the fixture), so the extra round trip buys
    nothing but load on their server for our purposes. `priceFrom` is
    `null` for every stop scraped this way (a real, legitimate value, not
    a failure). If a future pass wants per-stop pricing, that is a
    second, explicit fetch of each stop's own URL, added as its own task.
    Reuse the tour's own JSON-LD `image` for every stop (each stop's own
    page was not fetched to have a better one).
  - A related fixture (not the tour page itself, a *different*, single-
    date one) showed a **stale slug vs. live date**: URL says
    `-2026-09-06`, JSON-LD `startDate` says `2027-09-02 19:00` — a
    reschedule the site never renamed the URL for. Trusting JSON-LD's
    `startDate` (not the URL) already handles this correctly by
    construction; no special-case code needed, just don't be tempted to
    parse a date out of the slug as a shortcut.
  - **Price** (single-date pages; parsed from the rendered HTML, not
    JSON-LD): each tier is `<small class="color-blue">Cena</small><br>
    X,XX €` (comma decimal, the amount sometimes wrapped in an inner
    `<span>` — select on the label text, then read the *parent* element's
    full text and regex the number out of it, which is robust to either
    shape); `priceFrom` = the minimum across tiers. No free (`0,00 €`)
    example was seen live, but the format implies it renders the same way
    as any other tier — treat it as a real free price, not absence. A
    page with no tiers rendered (not yet on sale) means unknown price
    (`null`), not a crawl failure.
  - Currency is always EUR (Slovakia).
  - **`RawEvent.country` must be set explicitly to `'SK'`** on every event
    this scraper emits. `normalizeCity` only recognizes 8 major Slovak
    cities (`lib/normalize/city.ts`'s `CITIES` table); predpredaj covers
    many smaller towns (`Bardejov`, `Senec`, `Piešťany`, `Nové Zámky`, …)
    that fall through to a title-cased pass-through with no known
    country, and `normalizeRaw` throws `unknown country for city "X"`
    when neither the city table nor `raw.country` supplies one. Every
    other predpredaj-sourced field (venue, city casing) already comes
    pre-formatted from JSON-LD/the page, so this is the one field the
    scraper must not leave to inference.
  - Images: hotlink predpredaj's own image URL directly (JSON-LD `image`
    field, see above), matching plan 1's "plain `<img>` until scrapers
    reveal hosts for `next/image` `remotePatterns`" — do not rehost.
    Descriptions are not scraped at all (JSON-LD's `description` field is
    ignored) — deep-link to predpredaj's own page for anyone who wants
    one, per the same "why redistribute what we can link to" reasoning as
    the outreach email.
- **Category → genre**: the crawled category (the 7-value nav list, see
  above; there is no reliable finer per-event signal) is passed straight
  through as `RawEvent.rawGenre` using its Slovak display name (`Koncert`,
  `Šport`, `Divadlo`, `Festival`, `Show`, `Pre deti`, `Ostatné`) and goes
  through the **existing** `normalizeGenre` keyword table exactly like
  every other source — no bypass, no separate mapping table. Checked each
  of the 7 against the real keyword rules in `lib/normalize/genre.ts`, in
  their matching order, so this is a verified fact, not an assumption:

  | predpredaj category | matches via | → Genre |
  |---|---|---|
  | `Koncert` | `concert` rule's `koncert` keyword | `concert` |
  | `Šport` | `sport` rule's `sport` keyword | `sport` |
  | `Divadlo` | `theatre` rule's `divadl` keyword | `theatre` |
  | `Festival` | `concert` rule's `festival` keyword | `concert` |
  | `Show` | no rule matches | `other` (fallback) |
  | `Pre deti` | no rule matches | `other` (fallback) |
  | `Ostatné` | no rule matches | `other` (fallback) |

  `Festival` events are multi-day (`endsAt` set) when the page shows a
  date range instead of one date. There is no `exhibition`-shaped category
  among the 7 (`Kultúra`, which would fit best, is only ever a
  filter-widget option, never a crawlable `/sk/kategoria/` page or a real
  per-event value) — predpredaj simply doesn't surface exhibitions as a
  first-class category the way GoOut's mock data did. Not a gap to work
  around; there is nothing to map.

### Ingest and cron

- `lib/scrapers/predpredaj.ts` exports `scrapePredpredaj(options?: {
  categories?: PredpredajCategory[]; maxEventsPerCategory?: number }):
  Promise<RawEvent[]>` (fetch + cheerio, no Playwright — the pages are
  server-rendered). Sequential crawl (never `Promise.all` — the delay
  requirement means requests are deliberately serial), 1–2s delay between
  every request including within a category, custom `User-Agent` naming
  the project and a contact email, and a `robots.txt`-aware check before
  the first request (hardcode the five known disallowed slugs plus a live
  `robots.txt` fetch each run, so a future addition to the disallow list
  is honored without a code change).
- **Chunking, decided here (not deferred):** one detail-page fetch per
  listed item (~80 events just in `koncert`, times 7 categories) at 1–2s
  delay would run for minutes — well past any typical serverless function
  budget. `/api/cron/scrape` requires a `?category=<predpredaj-category>`
  param (one of the 7); there is no whole-site mode. `vercel.json` defines
  **seven cron entries**, one per category, staggered by ten minutes each
  (`0 */6 * * *`, `10 */6 * * *`, … `0,10,20,30,40,50` past the hour on
  the six-hourly tick) so they never run concurrently and never overlap
  the next category's own six-hour cycle. Each run also caps at
  `maxEventsPerCategory` (default 30, via `PREDPREDAJ_MAX_EVENTS_PER_
  CATEGORY` — an env var, not a hardcoded constant, so it can be tuned to
  whatever `maxDuration` the deployed function actually allows without a
  redeploy) — 30 events × ~1.5s ≈ 45s, comfortable under a 60s budget
  including the category-listing fetch and DB writes. A category with
  more events than the cap converges over several six-hourly ticks rather
  than all at once; this is an accepted staleness tradeoff for plan C′,
  not a bug — `koncert` (the biggest) fully refreshes roughly every
  3 ticks (18h) at the default cap, everything smaller refreshes every
  tick. Route also accepts `?maxEvents=` to override the cap per call
  (for the live smoke test task, which limits far below 30).
- `/api/cron/scrape`: `Authorization: Bearer $CRON_SECRET`, calls
  `scrapePredpredaj({ categories: [category], maxEventsPerCategory })`,
  then `upsertRawEvents`, updates `Source.lastScrapedAt`, returns
  `{ created, updated, merged, skipped }`. Structured as a list of scraper
  calls (currently just the one), not a single hardcoded call, so a
  second scraper (once goout/ticketportal unblock) is a one-line addition.

### Outreach

Same pitch as goout (deep-link only, no description copying, attribution
shown, ask for consent or a partner feed), drafted in Slovak at
`docs/outreach/predpredaj.md`, addressed to Zoznam (predpredaj's operator).

## Open questions (dedupe tuning, deferred to the scraper plan)

Real scraper data will show whether these matter; both are left as-is for plan 1, pinned by tests that document the current behavior rather than changing it.

- **Same title, venue and day collapses to one event.** The fingerprint is `title|venue|Prague-date`, so two distinct shows at the same venue on the same day (e.g. an 18:00 and a 21:00 stand-up set) merge into a single `Event`, and the later time is lost from the card. A fix needs a real design decision (time in the fingerprint? a distinct-showtimes model on one Event?), not a one-line change.
- **Fuzzy match tolerates a bare number suffix.** `pickFuzzyMatch`'s number-conflict guard only fires when *both* titles contain a number sequence and they differ (`"Jazz Night 1"` vs `"Jazz Night 2"` correctly does not merge). `"Jazz Night"` vs `"Jazz Night 2"` still merges, since only one side has a number. Rare in practice (most recurring-event scrapers number every instance), but worth a second look once real listings are in.
