# Coach app

Single-user endurance training app (see the master build spec). Calendar-first;
built in phases.

## Status

- **Phase 1 (this)**: Prisma schema + `.fit` upload + parser. An uploaded `.fit`
  becomes a `CompletedSession` row with summary fields and per-record streams.
- Phase 2+: load engine (`LOAD.md`), zones, calendar, guardrails, coach chat.

## Stack

Next.js (App Router) + TypeScript, Prisma 7 + Postgres (Supabase in prod),
`fit-file-parser` for `.fit` ingestion.

## Local dev

```bash
npm install
cp .env.example .env   # point DATABASE_URL at a Postgres 16
npm run db:migrate     # apply migrations + generate client
npm run dev            # http://localhost:3000
```

Parse a `.fit` without the DB:

```bash
npm run parse-fit -- path/to/activity.fit
```

A real device-recorded fixture lives at `test/fixtures/cycling.fit`
(from the MIT-licensed fit-file-parser test suite).

## API

`POST /api/upload` — multipart form, field `file` = a `.fit` file.
Dedupes by SHA-256 (409 on re-upload), validates the FIT header,
returns the stored session summary. Parse failures return 422.
