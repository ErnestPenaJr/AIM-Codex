# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                  # install deps
npx prisma generate          # generate Prisma client (required after schema change)
npm run db:push              # create/update SQLite schema at prisma/dev.db
npm run db:seed              # import bsa_mock_data_500.csv into SQLite (wipes + reseeds)
npm run dev                  # start Express server (default http://127.0.0.1:3000)
```

`PORT` and `HOST` env vars override the listen address. There is no test suite, no linter, and no build step.

## Architecture

This repo has **two independent runtimes** that share the same `public/` frontend — be aware of which one you are changing:

1. **Express + Prisma + SQLite** (`server.js`, `prisma/`, `scripts/import.js`)
   - `server.js` serves `public/` statically and exposes `/api/summary`, `/api/risk-amounts`, `/api/subject-rankings`, `/api/filters`, `/api/subject-details`, `/api/records`, `/healthz`.
   - All endpoints funnel query params through `buildWhere()` which whitelists a fixed set of filter fields (`subjectName`, `riskLevel`, `transactionType`, `residenceState`→`subjectState`, `activityState`→`institutionState`). Add new filters in both `buildWhere` and the frontend.
   - `scripts/import.js` parses the CSV, derives `riskLevel` from `amountTotal` (LOW <5k, MODERATE <20k, HIGH <50k, TOP ≥50k) and `zip3` from `Subject EIN/SSN`. These derived fields do not exist in the source CSV — regenerate the DB via `db:seed` whenever classification rules change.
   - `subject-rankings` hard-codes `linkId` to `DEMO01` (ranks 1–4) and `DEMO02` (ranks 5–8) to drive the frontend's "linked subjects" demo; real link IDs are a hash of `subjectState + zip3 + subjectName`.

2. **Static Netlify deploy** (`netlify.toml`, `public/`)
   - `netlify.toml` publishes `public/` with an SPA catch-all. In this mode there is no API — `public/app.js` loads `bsa_mock_data_500.csv` directly (see `DATA_SOURCE` constant) and computes everything client-side with jQuery + Chart.js + Bootstrap 5.
   - Consequence: the CSV under `public/bsa_mock_data_500.csv` must be kept in sync with the root CSV used by the importer, and frontend filter/aggregation logic is duplicated with the server. Changes to risk classification or filter semantics need to land in **both** `scripts/import.js` and `public/app.js`.

## Notes

- `AGENTS.md` in the repo root is unrelated (it is Homebrew's contributor guide and was committed by mistake) — ignore it.
- `prisma/dev.db` is gitignored; a fresh clone needs `db:push` + `db:seed` before the server returns data.
- Frontend is vanilla jQuery (not a framework) — `$(document).ready` in `public/app.js` is the entry point.
