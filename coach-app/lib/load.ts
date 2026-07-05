// Deterministic load engine. No model involvement — see LOAD.md for the
// formulas and the resolution order. All constants come from config.ts.

import { config } from "./config";
import type { FitRecord } from "./fit";

export type LoadMethod = "TSS" | "rTSS" | "TRIMP" | "FALLBACK";

export interface LoadInput {
  sport: string;
  elapsedSec: number;
  movingSec?: number | null;
  avgPower?: number | null;
  avgSpeedMps?: number | null;
  avgHr?: number | null;
  records?: FitRecord[] | null;
}

/**
 * Normalized power: mean of (30s rolling average power)^4, fourth root.
 * Time-based window so variable record rates behave; gaps count as coasting.
 */
export function normalizedPower(records: FitRecord[]): number | null {
  const powered = records.filter((r) => r.power !== undefined);
  if (powered.length < 2) return null;

  const windowSec = config.load.npRollingWindowSec;
  const window: { t: number; power: number }[] = [];
  let windowSum = 0;
  let quartSum = 0;
  let count = 0;

  for (const r of powered) {
    const t = new Date(r.t).getTime() / 1000;
    window.push({ t, power: r.power! });
    windowSum += r.power!;
    while (window.length > 0 && t - window[0].t >= windowSec) {
      windowSum -= window.shift()!.power;
    }
    const avg = windowSum / window.length;
    quartSum += avg ** 4;
    count++;
  }
  return Math.round(Math.pow(quartSum / count, 0.25) * 10) / 10;
}

/** Power-based TSS. 1 hour at FTP = 100. */
export function powerTss(durationSec: number, np: number): number {
  const intensity = np / config.anchors.ftpWatts;
  return (durationSec / 3600) * intensity * intensity * 100;
}

/** Pace-based rTSS for runs. 1 hour at threshold pace = 100. */
export function runRTss(durationSec: number, avgSpeedMps: number): number {
  const thresholdSpeed = 1000 / config.anchors.runThresholdSecPerKm;
  const intensity = avgSpeedMps / thresholdSpeed;
  return (durationSec / 3600) * intensity * intensity * 100;
}

/** Banister TRIMP scaled toward TSS units (config.heart.trimpScale). */
export function trimpLoad(durationSec: number, avgHr: number): number | null {
  const { maxHr, restHr, trimpScale } = config.heart;
  const hrr = (avgHr - restHr) / (maxHr - restHr);
  if (hrr <= 0) return 0;
  const trimp = (durationSec / 60) * hrr * 0.64 * Math.exp(1.92 * hrr);
  return trimp * trimpScale;
}

/**
 * Resolution order (LOAD.md): power → run pace → HR → duration fallback.
 */
export function sessionLoad(input: LoadInput): {
  load: number;
  method: LoadMethod;
} {
  const durationSec = input.movingSec ?? input.elapsedSec;

  const np = input.records ? normalizedPower(input.records) : null;
  const power = np ?? input.avgPower ?? null;
  if (power != null && power > 0) {
    return { load: round1(powerTss(durationSec, power)), method: "TSS" };
  }

  if (input.sport === "RUN" && input.avgSpeedMps) {
    return {
      load: round1(runRTss(durationSec, input.avgSpeedMps)),
      method: "rTSS",
    };
  }

  if (input.avgHr) {
    const load = trimpLoad(durationSec, input.avgHr);
    if (load != null) return { load: round1(load), method: "TRIMP" };
  }

  const perHour =
    config.load.fallbackLoadPerHour[input.sport] ??
    config.load.fallbackLoadPerHour.OTHER;
  return { load: round1((durationSec / 3600) * perHour), method: "FALLBACK" };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Fitness metrics: CTL / ATL / TSB / ramp rate over a daily load series.
// ---------------------------------------------------------------------------

export interface DayMetrics {
  date: string; // YYYY-MM-DD in config.timezone
  load: number;
  ctl: number;
  atl: number;
  tsb: number; // form: yesterday's CTL - yesterday's ATL
}

export function localDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function nextDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Daily CTL/ATL/TSB from session (startTime, load) pairs, from the first
 * session's day through `today` (default: now in config.timezone).
 */
export function dailyMetrics(
  sessions: { startTime: Date; load: number | null }[],
  today: string = localDate(new Date())
): DayMetrics[] {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const day = localDate(s.startTime);
    byDay.set(day, (byDay.get(day) ?? 0) + (s.load ?? 0));
  }
  if (byDay.size === 0) return [];

  const start = [...byDay.keys()].sort()[0];
  const out: DayMetrics[] = [];
  let ctl = config.load.ctlSeed;
  let atl = config.load.ctlSeed;

  for (let day = start; day <= today; day = nextDate(day)) {
    const load = byDay.get(day) ?? 0;
    const tsb = ctl - atl; // uses yesterday's values, computed before update
    ctl = ctl + (load - ctl) / config.load.ctlDays;
    atl = atl + (load - atl) / config.load.atlDays;
    out.push({
      date: day,
      load,
      ctl: round1(ctl),
      atl: round1(atl),
      tsb: round1(tsb),
    });
  }
  return out;
}

export interface FitnessSnapshot {
  ctl: number;
  atl: number;
  tsb: number;
  rampRate: number; // CTL change over the last rampWindowDays
}

export function fitnessSnapshot(series: DayMetrics[]): FitnessSnapshot | null {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const windowAgo = series[series.length - 1 - config.load.rampWindowDays];
  return {
    ctl: last.ctl,
    atl: last.atl,
    tsb: last.tsb,
    rampRate: round1(last.ctl - (windowAgo?.ctl ?? config.load.ctlSeed)),
  };
}
