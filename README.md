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

## Scraping

`npm run scrape -- --source predpredaj [--category <koncert|sport|show|divadlo|festival|pre-deti|ostatne>] [--max-pages N]`
scrapes predpredaj.zoznam.sk and ingests the result. `.github/workflows/scrape.yml` runs this
on a schedule (every 6 hours) and via a manual "Run workflow" button; `DATABASE_URL` and
`DIRECT_URL` are set as GitHub Actions secrets, not committed.

`GET /api/cron/scrape` (optionally `?category=...&maxEvents=...`), with
`Authorization: Bearer $CRON_SECRET`, runs the same thing over HTTP for manual triggering.

Design: `docs/superpowers/specs/2026-09-28-radar-design.md`
