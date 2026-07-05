# Load engine

Deterministic, code-only (`lib/load.ts`). The coach model never computes
load. Every constant below lives in `lib/config.ts`; after tuning any of
them run `npm run recompute-load` to rebuild stored scores.

## Per-session load score

Resolution order — first applicable method wins (`loadMethod` on each
session records which one was used):

1. **TSS (power)** — used whenever power data exists (any sport).

   - Normalized Power `NP` = fourth root of the mean of the 30-second
     rolling average power raised to the 4th power, computed over the
     per-record power stream (time-based window; recording gaps count as
     coasting). Falls back to session average power if the stream is
     missing.
   - `IF = NP / FTP` (FTP: `anchors.ftpWatts`, currently 272 W)
   - `TSS = durationHours × IF² × 100`
     (equivalent to the standard `(sec × NP × IF) / (FTP × 3600) × 100`)
   - 1 hour at FTP = 100.

2. **rTSS (run pace)** — runs without power.

   - `IF = avgSpeed / thresholdSpeed`
     (threshold: `anchors.runThresholdSecPerKm`, currently 4:05 /km)
   - `rTSS = durationHours × IF² × 100`
   - Simplification: session average speed, no grade adjustment (no NGP).
     Fine for now; revisit if hilly runs start skewing scores.

3. **TRIMP (heart rate)** — sessions with HR but no power/pace (e.g.
   swims with an HR strap).

   - Banister TRIMP: `durationMin × HRr × 0.64 × e^(1.92 × HRr)` where
     `HRr = (avgHR − restHR) / (maxHR − restHR)`
   - Scaled into TSS-comparable units by `heart.trimpScale` (0.6, chosen
     so ~1 h at 80 % HRr ≈ 85 load).
   - **`heart.maxHr` (185) and `heart.restHr` (45) are unmeasured
     defaults — tune them.**

4. **Duration fallback** — no power, pace or HR (typical pool swim).
   `load = hours × fallbackLoadPerHour[sport]` (bike 50, run 60, swim 50,
   other 40).

Duration = moving time where the file provides it, else elapsed time.

## Fitness metrics

Daily load = sum of session loads per calendar day in `Europe/Berlin`.
Days without training count as 0 — decay happens.

- **CTL** (fitness): `CTL_t = CTL_{t−1} + (load_t − CTL_{t−1}) / 42`
- **ATL** (fatigue): same with time constant 7
- **TSB** (form): `CTL_{t−1} − ATL_{t−1}` — the value shown for a day is
  computed *before* that day's load lands (TrainingPeaks convention)
- **rampRate**: `CTL_today − CTL_{7 days ago}` (week-over-week CTL
  change; the guardrail caps in Phase 4 act on this number)

CTL/ATL seed at `load.ctlSeed` (0) on the first stored session's day.
Once real history accumulates this stops mattering; if scores look
depressed in week 1, set a realistic seed instead of waiting.
