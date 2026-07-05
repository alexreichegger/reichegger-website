# Coach app

Single-user endurance training app (see the master build spec). Calendar-first;
built in phases.

## Status

- **Phase 1**: Prisma schema + `.fit` upload + parser. An uploaded `.fit`
  becomes a `CompletedSession` row with summary fields and per-record streams.
- **Phase 2 (this)**: deterministic load engine (`LOAD.md`) — TSS/rTSS/TRIMP,
  CTL/ATL/TSB/ramp — and zone tables derived from the anchors (`/zones`,
  pending confirmation). All constants in `lib/config.ts`; after tuning run
  `npm run recompute-load`. Tests: `npm test`.
- **Phase 3 (this)**: the calendar. `POST /api/plan/generate` builds the
  whole block from today to the next race (deterministic `lib/plan.ts`):
  weekly anchors, real availability slots, RETURN-mode progression clamped
  to 90% of the CTL ramp cap, taper + race week. `/calendar` has month /
  week / day views (planned outlined, completed filled) and drag-to-move,
  validated by `lib/guardrails.ts` (`POST /api/plan/move`, 422 + reasons
  on rejection). Guardrails enforce: no running until cleared, slot
  validity, no consecutive hard days, ≥2 easy/rest days per 7-day window,
  pull-only swims, week-over-week CTL ramp caps (RETURN +5 / BUILD +7).
- Phase 4+: guardrail unit tests, coach chat, chat-based logging.

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
