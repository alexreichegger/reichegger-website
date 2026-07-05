// Deterministic block generator. Periodises from today to the next race
// using the weekly anchors and availability slots, then clamps weekly
// volume so the simulated CTL ramp stays inside the guardrail cap.
// No model involvement — the coach chat can only propose ops on top.

import { config } from "./config";
import { addDays, type AppStateLike } from "./guardrails";
import { dailyMetrics } from "./load";
import { fmtPace } from "./zones";

export interface GeneratedSession {
  date: string;
  slot: "LUNCH" | "EVENING" | "MORNING";
  sport: "BIKE" | "RUN" | "SWIM" | "OTHER";
  title: string;
  intent?: string;
  structure?: object;
  durationMin: number;
  estimatedLoad: number;
  stopRule: string;
  isQuality: boolean;
  phase: string;
}

function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function mondayOnOrAfter(date: string): string {
  const wd = isoWeekday(date);
  return wd === 1 ? date : addDays(date, 8 - wd);
}

function bikeLoad(durationMin: number, kind: keyof typeof config.plan.estIf): number {
  const intensity = config.plan.estIf[kind];
  return Math.round((durationMin / 60) * intensity * intensity * 100 * 10) / 10;
}

function swimLoad(durationMin: number): number {
  return Math.round((durationMin / 60) * config.load.fallbackLoadPerHour.SWIM * 10) / 10;
}

const STOP = config.guardrails.defaultStopRule;
const SWIM_STOP = `${STOP} Pull buoy only — no push-offs, no kick.`;

function z2Range(): string {
  const ftp = config.anchors.ftpWatts;
  return `${Math.round(ftp * 0.55)}–${Math.round(ftp * 0.75)} W`;
}

function swimEasyBand(): string {
  const easy = config.anchors.swimEasySecPer100m;
  return `${fmtPace(easy * 0.93)}/100m or slower`;
}

function swimSteadyBand(): string {
  const easy = config.anchors.swimEasySecPer100m;
  return `${fmtPace(easy * 0.93)}–${fmtPace(easy * 0.88)}/100m`;
}

/** Sweet-spot bike quality session; q = 0-based progression index. */
function qualityBike(date: string, q: number, phase: string): GeneratedSession {
  const ftp = config.anchors.ftpWatts;
  const lo = Math.round(ftp * 0.86);
  const hi = Math.round(ftp * 0.92);
  const steps = [
    { reps: 2, min: 12 },
    { reps: 3, min: 10 },
    { reps: 3, min: 12 },
    { reps: 2, min: 16 },
    { reps: 3, min: 14 },
    { reps: 2, min: 20 },
  ];
  const step = steps[Math.min(q, steps.length - 1)];
  const durationMin = Math.min(
    config.availability.evening.maxMin,
    15 + step.reps * step.min + (step.reps - 1) * 5 + 10
  );
  return {
    date,
    slot: "EVENING",
    sport: "BIKE",
    title: `Bike sweet spot ${step.reps}×${step.min} min`,
    structure: {
      warmup: "15 min Z1→Z2, include 3×30 s high cadence",
      reps: [
        {
          count: step.reps,
          work: `${step.min} min`,
          target: `${lo}–${hi} W (sweet spot)`,
          recovery: "5 min Z1 easy spin",
        },
      ],
      cooldown: "10 min Z1",
      fallback: `Flat day: ${step.reps}×${Math.max(6, step.min - 4)} min at ${Math.round(ftp * 0.8)} W, full recoveries.`,
    },
    durationMin,
    estimatedLoad: bikeLoad(durationMin, "quality"),
    stopRule: STOP,
    isQuality: true,
    phase,
  };
}

function easySession(
  date: string,
  slot: GeneratedSession["slot"],
  sport: "BIKE" | "SWIM",
  durationMin: number,
  phase: string,
  variant: "easy" | "longRide" | "spin" | "steadySwim" = "easy"
): GeneratedSession {
  if (sport === "SWIM") {
    const steady = variant === "steadySwim";
    return {
      date,
      slot,
      sport,
      title: steady ? "Pull swim — steady" : "Pull swim — easy",
      intent: steady
        ? `${durationMin} min pull buoy, main set steady (${swimSteadyBand()}), relaxed push-off-free turns`
        : `${durationMin} min pull buoy, easy (${swimEasyBand()}), technique focus`,
      durationMin,
      estimatedLoad: swimLoad(durationMin),
      stopRule: SWIM_STOP,
      isQuality: false,
      phase,
    };
  }
  if (variant === "longRide") {
    return {
      date,
      slot,
      sport,
      title: "Long ride Z2",
      intent: `${durationMin} min steady Z2 (${z2Range()}), conversational; eat every 45 min`,
      durationMin,
      estimatedLoad: bikeLoad(durationMin, "longRide"),
      stopRule: STOP,
      isQuality: false,
      phase,
    };
  }
  return {
    date,
    slot,
    sport,
    title: variant === "spin" ? "Recovery spin" : "Easy ride",
    intent: `${durationMin} min ${variant === "spin" ? "Z1–low Z2 recovery spin" : "easy Z2"} (${z2Range()}), keep it genuinely easy`,
    durationMin,
    estimatedLoad: bikeLoad(durationMin, "easy"),
    stopRule: STOP,
    isQuality: false,
    phase,
  };
}

export interface GenerateInput {
  today: string;
  completedByDay: { date: string; load: number }[];
  state: AppStateLike;
}

export function generateBlock(input: GenerateInput): GeneratedSession[] {
  const race = config.races.find((r) => r.date > input.today);
  if (!race) return [];
  const raceDate = race.date;
  const firstMonday = mondayOnOrAfter(addDays(input.today, 1));
  const cap = config.guardrails.rampCapPerWeek[input.state.mode];
  const p = config.plan;

  const all: GeneratedSession[] = [];
  // Daily loads for the ramp simulation: completed history + accepted weeks.
  const simLoads = [...input.completedByDay];
  let qualityIndex = 0;
  let weekBikeMin: number = p.firstWeekBikeMin;

  for (let w = 0; ; w++) {
    const monday = addDays(firstMonday, w * 7);
    if (monday > raceDate) break;
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const daysToRace = Math.round(
      (Date.parse(raceDate) - Date.parse(monday)) / 86400_000
    );

    const taper = daysToRace <= p.taperDays;
    const raceWeek = daysToRace < 7;
    const easyPhase = w < p.easyWeeks && !taper;
    const phase = raceWeek
      ? "RACE-WEEK"
      : taper
        ? "SHARPEN"
        : easyPhase
          ? "RETURN-EASY"
          : "RETURN-BUILD";

    // Weekly bike volume with taper reduction, then ramp-cap clamp below.
    let bikeMin = Math.min(weekBikeMin, p.maxWeekBikeMin);
    if (raceWeek) bikeMin *= 0.4;
    else if (taper) bikeMin *= 0.65;

    let week: GeneratedSession[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      week = buildWeek(days, Math.round(bikeMin), {
        phase,
        easyPhase,
        raceWeek,
        qualityIndex,
        raceDate,
        raceName: race.name,
        today: input.today,
      });
      const candidate = [
        ...simLoads,
        ...week
          .filter((s) => s.phase !== "RACE")
          .map((s) => ({ date: s.date, load: s.estimatedLoad })),
      ];
      // Clamp to 90% of the cap: leaves headroom so rescheduling a session
      // within the week can't tip a 7-day window over the hard limit.
      const ramp = maxWeeklyRamp(candidate, days[0], days[6]);
      if (ramp <= cap * 0.9 || bikeMin <= 120) break;
      bikeMin *= 0.9; // trim volume until the simulated ramp fits the cap
    }

    all.push(...week);
    simLoads.push(
      ...week
        .filter((s) => s.phase !== "RACE")
        .map((s) => ({ date: s.date, load: s.estimatedLoad }))
    );
    if (!easyPhase && !taper) qualityIndex++;
    weekBikeMin = Math.min(weekBikeMin * p.weeklyGrowth, p.maxWeekBikeMin);
  }

  return all.filter((s) => s.date >= input.today);
}

interface WeekOpts {
  phase: string;
  easyPhase: boolean;
  raceWeek: boolean;
  qualityIndex: number;
  raceDate: string;
  raceName: string;
  today: string;
}

function buildWeek(days: string[], bikeMin: number, o: WeekOpts): GeneratedSession[] {
  const [mon, tue, wed, thu, fri, sat, sun] = days;
  void mon;
  void fri; // rest days: Monday + Friday (Friday lunch = dormant long-run anchor)
  const out: GeneratedSession[] = [];
  const swimMin = Math.min(60, config.plan.swimMinPerSession + Math.floor(bikeMin / 100) * 5);

  // Tuesday lunch swim (Tuesday run anchor is dormant until running resumes).
  out.push(easySession(tue, "LUNCH", "SWIM", swimMin, o.phase));

  // Midweek bike quality (Wednesday evening) — the current main intensity.
  const wedMin = Math.min(config.availability.evening.maxMin, Math.round(bikeMin * 0.3 / 5) * 5);
  if (o.easyPhase || o.raceWeek) {
    out.push(easySession(wed, "EVENING", "BIKE", Math.min(75, wedMin), o.phase));
  } else {
    out.push(qualityBike(wed, o.qualityIndex, o.phase));
  }

  // Thursday lunch swim.
  out.push(easySession(thu, "LUNCH", "SWIM", swimMin, o.phase, "steadySwim"));

  if (o.raceWeek) {
    // Openers Saturday, race Sunday.
    out.push({
      ...easySession(sat, "MORNING", "BIKE", 60, o.phase, "spin"),
      title: "Openers ride",
      intent: `60 min easy with 3×1 min at race effort (${Math.round(config.anchors.ftpWatts * 0.8)} W), long recoveries`,
    });
    out.push({
      date: o.raceDate,
      slot: "MORNING",
      sport: "OTHER",
      title: `RACE — ${o.raceName}`,
      intent: "Race day. Conditional on run return — see gate status.",
      durationMin: 330,
      estimatedLoad: 260,
      stopRule: "Race stop rule: any calf/shin pain above 3/10 = walk/withdraw. No hero finishes.",
      isQuality: true,
      phase: "RACE",
    });
    return out;
  }

  // Weekend: long ride Saturday, easy spin or rest Sunday.
  const wedActual = out.find((s) => s.date === wed)!.durationMin;
  const sunMin = Math.min(60, Math.max(40, Math.round(bikeMin * 0.15 / 5) * 5));
  const satMin = Math.max(60, bikeMin - wedActual - sunMin);
  out.push(easySession(sat, "MORNING", "BIKE", satMin, o.phase, "longRide"));
  out.push(easySession(sun, "MORNING", "BIKE", sunMin, o.phase, "spin"));

  return out;
}

/** Week-over-week CTL change for the week ending `to` (a Sunday). */
function maxWeeklyRamp(loads: { date: string; load: number }[], from: string, to: string): number {
  void from;
  const series = dailyMetrics(
    loads.map((l) => ({ startTime: new Date(`${l.date}T12:00:00Z`), load: l.load })),
    to
  );
  const byDate = new Map(series.map((r) => [r.date, r.ctl]));
  const now = byDate.get(to);
  const ago = byDate.get(addDays(to, -7));
  if (now === undefined) return 0;
  return now - (ago ?? config.load.ctlSeed);
}
