# Radar

Aggregated event feed for Slovakia and Czech Republic.

## Setup

1. Node 20+, then `npm install`.
2. Create a Neon **dev** branch. Copy `.env.example` to `.env` and fill `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
3. `npm run db:migrate` (creates tables on the dev branch).
4. `npm run db:seed` (wipes and reloads mock events under a dedicated `mock` Source, never a real
   scraper's slug; never point `.env` at production).
5. `npm run dev`, open http://localhost:3000.

## Scripts

- `npm test` unit tests (no DB or network)
- `npm run typecheck`
- `npm run build`
- `npm run db:clear-mock` deletes only the `mock`-sourced demo events, leaving real scraped data alone

## Scraping

`npm run scrape -- --source predpredaj [--category <koncert|sport|show|divadlo|festival|pre-deti|ostatne>] [--max-pages N]`
scrapes predpredaj.zoznam.sk and ingests the result. Category listing pages (predpredaj has no
pagination — confirmed live, `?strana=2` returns the same content as page 1) are always fetched in
full, every run. Each listing card's own detail page is skipped if it was fetched within the last
`PREDPREDAJ_REFETCH_INTERVAL_MS` (3 days) plus a deterministic per-URL jitter of up to 24h (so refetches
spread across runs instead of all landing on the same day) — only `EventSource.lastSeenAt` is bumped
from the listing in that case. Freshness itself is tracked per scraped page in `ScrapedPage`, not
`EventSource`: a multi-city tour's own card URL never becomes an `EventSource.url` (only each of its
stops' URLs do), so `EventSource` alone can't carry a tour card's freshness. Each run logs
`Pages: N listing(s) fetched, N new, N due refetch(es), N fresh (skipped)`.
`.github/workflows/scrape.yml` runs this twice daily (`17 5,17 * * *`) and via a manual "Run workflow"
button, running `prisma migrate deploy` first; `DATABASE_URL` and `DIRECT_URL` are set as GitHub Actions
secrets, not committed.

`GET /api/cron/scrape` (optionally `?category=...&maxEvents=...`), with
`Authorization: Bearer $CRON_SECRET`, runs the same thing over HTTP for manual triggering.

Design: `docs/superpowers/specs/2026-09-28-radar-design.md`

## Deployment

**Neon branches:** the **dev** branch (used above) is for local development and is never pointed at by
production. **Production uses Neon's `main` branch** — a separate `DATABASE_URL`/`DIRECT_URL` pair,
never the dev branch's. Keep the two branches' credentials in separate places (GitHub Actions secrets
for the scrape workflow, Vercel project env vars for the web app) — never reuse one branch's connection
string for the other's purpose.

**Env vars the web app needs in production** (Vercel project settings): just
- `DATABASE_URL` — prod Neon `main` branch, pooled connection (`-pooler` host, `pgbouncer=true`).
- `DIRECT_URL` — prod Neon `main` branch, direct connection. Not read at runtime by the deployed app
  (only `prisma migrate`/`db push` use it), but `prisma generate` reads the schema that references it,
  so set it anyway to avoid surprises if a future step needs it.

No `NEXTAUTH_*` or `RESEND_*` vars exist yet — there's no auth or email code in the app (`User`/
`Session`/`Favorite` are schema-only, unused by any route). `npm run build` (`prisma generate && next
build`) was confirmed to succeed with only these two vars set. `CRON_SECRET` is only needed if you also
want `/api/cron/scrape` reachable over HTTP; the scheduled scrape itself runs via GitHub Actions and
doesn't touch that route.

**Migrations in production:** never run `prisma migrate dev` against `main`. Either run
`npm run db:deploy` (`prisma migrate deploy`) by hand against the prod `DATABASE_URL`/`DIRECT_URL`
before first deploy, or point `.github/workflows/scrape.yml`'s secrets at prod once that's the
intended target — its `prisma migrate deploy` step keeps the schema in sync on every scheduled run.
