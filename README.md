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
