import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../lib/config";
import {
  dailyMetrics,
  fitnessSnapshot,
  normalizedPower,
  powerTss,
  runRTss,
  sessionLoad,
  trimpLoad,
} from "../lib/load";
import type { FitRecord } from "../lib/fit";

const FTP = config.anchors.ftpWatts;

function constantPowerRecords(watts: number, seconds: number): FitRecord[] {
  const start = Date.parse("2026-07-01T10:00:00Z");
  return Array.from({ length: seconds }, (_, i) => ({
    t: new Date(start + i * 1000).toISOString(),
    power: watts,
  }));
}

test("NP of constant power equals that power", () => {
  const np = normalizedPower(constantPowerRecords(200, 600));
  assert.equal(np, 200);
});

test("NP weights surges above average power", () => {
  // alternating 60s blocks of 100W / 300W → avg 200, NP > avg
  const start = Date.parse("2026-07-01T10:00:00Z");
  const recs: FitRecord[] = Array.from({ length: 1200 }, (_, i) => ({
    t: new Date(start + i * 1000).toISOString(),
    power: Math.floor(i / 60) % 2 === 0 ? 100 : 300,
  }));
  const np = normalizedPower(recs)!;
  assert.ok(np > 200, `expected NP > 200, got ${np}`);
});

test("1 hour at FTP = 100 TSS", () => {
  assert.equal(Math.round(powerTss(3600, FTP)), 100);
});

test("1 hour at threshold pace = 100 rTSS", () => {
  const thresholdSpeed = 1000 / config.anchors.runThresholdSecPerKm;
  assert.equal(Math.round(runRTss(3600, thresholdSpeed)), 100);
});

test("TRIMP is positive and increases with HR", () => {
  const low = trimpLoad(3600, 120)!;
  const high = trimpLoad(3600, 160)!;
  assert.ok(low > 0);
  assert.ok(high > low);
});

test("sessionLoad resolution order: power beats pace beats HR", () => {
  const withPower = sessionLoad({
    sport: "BIKE",
    elapsedSec: 3600,
    avgPower: FTP,
  });
  assert.equal(withPower.method, "TSS");
  assert.equal(Math.round(withPower.load), 100);

  const runPace = sessionLoad({
    sport: "RUN",
    elapsedSec: 3600,
    avgSpeedMps: 1000 / config.anchors.runThresholdSecPerKm,
    avgHr: 150,
  });
  assert.equal(runPace.method, "rTSS");

  const hrOnly = sessionLoad({ sport: "SWIM", elapsedSec: 3600, avgHr: 140 });
  assert.equal(hrOnly.method, "TRIMP");

  const nothing = sessionLoad({ sport: "SWIM", elapsedSec: 3600 });
  assert.equal(nothing.method, "FALLBACK");
  assert.equal(nothing.load, config.load.fallbackLoadPerHour.SWIM);
});

test("CTL/ATL converge toward a constant daily load; TSB = CTL - ATL lagged", () => {
  const days = 400;
  const sessions = Array.from({ length: days }, (_, i) => ({
    startTime: new Date(Date.parse("2025-01-01T10:00:00Z") + i * 86400_000),
    load: 100,
  }));
  const today = "2026-02-04"; // within the series
  const series = dailyMetrics(sessions, today);
  const last = series[series.length - 1];
  assert.ok(Math.abs(last.ctl - 100) < 1, `CTL ${last.ctl} should approach 100`);
  assert.ok(Math.abs(last.atl - 100) < 1, `ATL ${last.atl} should approach 100`);
  assert.ok(Math.abs(last.tsb) < 1, `TSB ${last.tsb} should approach 0`);
});

test("rampRate reflects CTL growth over the window", () => {
  const sessions = Array.from({ length: 30 }, (_, i) => ({
    startTime: new Date(Date.parse("2026-06-01T10:00:00Z") + i * 86400_000),
    load: 80,
  }));
  const series = dailyMetrics(sessions, "2026-06-30");
  const snap = fitnessSnapshot(series)!;
  assert.ok(snap.rampRate > 0, "CTL should be ramping up from zero");
  assert.equal(
    snap.rampRate,
    Math.round((series.at(-1)!.ctl - series.at(-8)!.ctl) * 10) / 10
  );
});

test("empty history → no snapshot", () => {
  assert.equal(fitnessSnapshot(dailyMetrics([])), null);
});
