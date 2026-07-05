// Hard safety guardrails. Every plan mutation — chat, drag-to-move,
// generator output — passes through validateOps. Non-negotiable; the
// coach model cannot override anything here. Caps live in config.ts.

import { config } from "./config";
import { dailyMetrics } from "./load";

export interface PlannedLike {
  id: string;
  date: string; // YYYY-MM-DD
  slot: "LUNCH" | "EVENING" | "MORNING";
  sport: "BIKE" | "RUN" | "SWIM" | "OTHER";
  title: string;
  intent?: string | null;
  durationMin: number;
  estimatedLoad: number;
  isQuality: boolean;
  status: string;
  phase: string; // "RACE" sessions are excluded from the ramp simulation
}

export interface AppStateLike {
  mode: "RETURN" | "BUILD";
  runningCleared: boolean;
  swimPullOnly: boolean;
}

export type PlanOp =
  | { type: "move"; sessionId: string; newDate: string; newSlot: PlannedLike["slot"] }
  | { type: "modify"; sessionId: string; changes: Partial<Omit<PlannedLike, "id">> }
  | { type: "add"; session: Omit<PlannedLike, "id" | "status"> }
  | { type: "delete"; sessionId: string };

export interface GuardrailContext {
  state: AppStateLike;
  planned: PlannedLike[]; // active (PLANNED) sessions, whole block
  // Completed history for ramp simulation: (day, load) pairs.
  completedByDay: { date: string; load: number }[];
  today: string; // YYYY-MM-DD
}

export interface OpResult {
  op: PlanOp;
  ok: boolean;
  reasons: string[];
}

function isoWeekday(date: string): number {
  // 1 = Monday … 7 = Sunday
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function isWeekend(date: string): boolean {
  return isoWeekday(date) >= 6;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Slot/availability rules for a single session placement. */
export function slotViolations(
  date: string,
  slot: PlannedLike["slot"],
  durationMin: number
): string[] {
  const out: string[] = [];
  const a = config.availability;
  if (isWeekend(date)) return out; // weekends: open, no caps

  if (slot === "MORNING") {
    out.push("Weekday mornings are not an available slot.");
  }
  if (slot === "LUNCH" && durationMin > a.lunch.maxMin) {
    out.push(`Lunch slot is capped at ${a.lunch.maxMin} min (got ${durationMin}).`);
  }
  if (slot === "EVENING") {
    if ((a.noEveningDays as readonly number[]).includes(isoWeekday(date))) {
      out.push("No evening sessions on Friday.");
    }
    if (durationMin > a.evening.maxMin) {
      out.push(`Weekday evening sessions are capped at ${a.evening.maxMin} min.`);
    }
    if (minutes(a.evening.start) + durationMin > minutes(a.evening.latestEnd)) {
      out.push(`Evening session would end after ${a.evening.latestEnd}.`);
    }
  }
  return out;
}

/** Per-session rules that don't depend on the rest of the plan. */
function sessionViolations(
  s: Pick<PlannedLike, "date" | "slot" | "sport" | "title" | "intent" | "durationMin">,
  state: AppStateLike
): string[] {
  const out = slotViolations(s.date, s.slot, s.durationMin);
  if (s.sport === "RUN" && !state.runningCleared) {
    out.push("No running until you confirm you're cleared to run.");
  }
  if (s.sport === "SWIM" && state.swimPullOnly) {
    const text = `${s.title} ${s.intent ?? ""}`.toLowerCase();
    if (!text.includes("pull")) {
      out.push("Swims must be pull-buoy only until that restriction is lifted.");
    }
  }
  return out;
}

/** Whole-plan rules evaluated on a candidate plan (today onwards). */
function planViolations(
  planned: PlannedLike[],
  completedByDay: { date: string; load: number }[],
  state: AppStateLike,
  today: string
): string[] {
  const out: string[] = [];
  const future = planned.filter((s) => s.status === "PLANNED" && s.date >= today);
  if (future.length === 0) return out;

  // 1. No two hard (quality) sessions on consecutive days.
  const hardDays = [...new Set(future.filter((s) => s.isQuality).map((s) => s.date))].sort();
  for (let i = 1; i < hardDays.length; i++) {
    if (dayDiff(hardDays[i - 1], hardDays[i]) === 1) {
      out.push(`Two hard sessions on consecutive days: ${hardDays[i - 1]} → ${hardDays[i]}.`);
    }
  }

  // 2. ≥ N easy/rest days in every 7-day window of the plan.
  // Easy/rest day = no quality session and < 90 planned minutes.
  const byDay = new Map<string, PlannedLike[]>();
  for (const s of future) {
    byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  }
  const lastDate = future.map((s) => s.date).sort().at(-1)!;
  const minEasy = config.guardrails.minEasyOrRestDaysPer7;
  for (let d = today; dayDiff(d, lastDate) >= 6; d = addDays(d, 1)) {
    let easyOrRest = 0;
    for (let i = 0; i < 7; i++) {
      const day = addDays(d, i);
      const sessions = byDay.get(day) ?? [];
      const hasQuality = sessions.some((s) => s.isQuality);
      const totalMin = sessions.reduce((a, s) => a + s.durationMin, 0);
      if (!hasQuality && totalMin < 90) easyOrRest++;
    }
    if (easyOrRest < minEasy) {
      out.push(`Week starting ${d} has only ${easyOrRest} easy/rest day(s); minimum is ${minEasy}.`);
    }
  }

  // 3. CTL ramp cap by mode, simulated over completed history + planned loads.
  // Per the spec, rampRate is the WEEK-over-week CTL change, measured at
  // week boundaries (Sundays) — moving sessions within a week is neutral.
  const cap = config.guardrails.rampCapPerWeek[state.mode];
  const sim = [
    ...completedByDay.map((c) => ({ startTime: new Date(`${c.date}T12:00:00Z`), load: c.load })),
    ...future
      .filter((s) => s.phase !== "RACE") // a race is a planned overload
      .map((s) => ({ startTime: new Date(`${s.date}T12:00:00Z`), load: s.estimatedLoad })),
  ];
  const series = dailyMetrics(sim, lastDate);
  const byDate = new Map(series.map((r) => [r.date, r.ctl]));
  const firstSunday = addDays(today, 7 - isoWeekday(today));
  for (let d = addDays(firstSunday, 7); d <= lastDate; d = addDays(d, 7)) {
    const now = byDate.get(d);
    const weekAgo = byDate.get(addDays(d, -7));
    if (now !== undefined && weekAgo !== undefined && now - weekAgo > cap + 0.05) {
      out.push(
        `CTL ramp of +${(now - weekAgo).toFixed(1)} in the week ending ${d} exceeds the ${state.mode} cap of +${cap}.`
      );
      break; // one ramp violation is enough detail
    }
  }

  return out;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400_000);
}

/**
 * Validate ops sequentially against a working copy of the plan.
 * Each op is accepted only if its own rules pass AND the resulting plan
 * introduces no NEW whole-plan violations (an already-at-cap plan can
 * still be rearranged as long as it doesn't get worse).
 * Returns per-op results plus the plan state after applying accepted ops.
 */
export function validateOps(
  ops: PlanOp[],
  ctx: GuardrailContext
): { results: OpResult[]; plan: PlannedLike[] } {
  let plan = [...ctx.planned];
  const baseline = new Set(
    planViolations(plan, ctx.completedByDay, ctx.state, ctx.today)
  );
  const results: OpResult[] = [];

  for (const op of ops) {
    const reasons: string[] = [];
    let candidate = plan;

    if (op.type === "add") {
      reasons.push(...sessionViolations(op.session, ctx.state));
      candidate = [
        ...plan,
        { ...op.session, id: `new-${results.length}`, status: "PLANNED" },
      ];
    } else {
      const target = plan.find((s) => s.id === op.sessionId);
      if (!target) {
        results.push({ op, ok: false, reasons: [`Unknown session ${op.sessionId}.`] });
        continue;
      }
      if (op.type === "delete") {
        candidate = plan.filter((s) => s.id !== op.sessionId);
      } else {
        const changed: PlannedLike =
          op.type === "move"
            ? { ...target, date: op.newDate, slot: op.newSlot }
            : { ...target, ...op.changes };
        reasons.push(...sessionViolations(changed, ctx.state));
        candidate = plan.map((s) => (s.id === op.sessionId ? changed : s));
      }
    }

    if (reasons.length === 0) {
      for (const v of planViolations(candidate, ctx.completedByDay, ctx.state, ctx.today)) {
        if (!baseline.has(v)) reasons.push(v);
      }
    }

    if (reasons.length === 0) {
      plan = candidate;
      results.push({ op, ok: true, reasons: [] });
    } else {
      results.push({ op, ok: false, reasons });
    }
  }

  return { results, plan };
}
