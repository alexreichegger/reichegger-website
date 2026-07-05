import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../lib/config";
import {
  checkPlan,
  slotViolations,
  validateOps,
  type AppStateLike,
  type GuardrailContext,
  type PlanOp,
  type PlannedLike,
} from "../lib/guardrails";
import { generateBlock } from "../lib/plan";

const TODAY = "2026-07-06"; // a Monday

const RETURN_STATE: AppStateLike = {
  mode: "RETURN",
  runningCleared: false,
  swimPullOnly: true,
};

let seq = 0;
function mk(p: Partial<PlannedLike>): PlannedLike {
  return {
    id: `s${seq++}`,
    date: "2026-07-11", // Saturday
    slot: "MORNING",
    sport: "BIKE",
    title: "Easy ride",
    intent: "easy",
    durationMin: 60,
    estimatedLoad: 40,
    isQuality: false,
    status: "PLANNED",
    phase: "TEST",
    ...p,
  };
}

function ctx(o: Partial<GuardrailContext> = {}): GuardrailContext {
  return {
    state: RETURN_STATE,
    planned: [],
    completedByDay: [],
    completedRunByDay: [],
    today: TODAY,
    ...o,
  };
}

function addOp(p: Partial<PlannedLike>): PlanOp {
  const { id, status, ...session } = mk(p);
  void id;
  void status;
  return { type: "add", session };
}

// --- running gate -----------------------------------------------------------

test("no running until cleared", () => {
  const { results } = validateOps(
    [addOp({ sport: "RUN", title: "Easy run", durationMin: 30 })],
    ctx()
  );
  assert.equal(results[0].ok, false);
  assert.match(results[0].reasons.join(" "), /No running until/);
});

test("running allowed once cleared, within the starter allowance", () => {
  const cleared = ctx({ state: { ...RETURN_STATE, runningCleared: true } });
  const { results } = validateOps(
    [addOp({ sport: "RUN", title: "Easy run", durationMin: 50, estimatedLoad: 10 })],
    cleared
  );
  assert.equal(results[0].ok, true, results[0].reasons.join(" "));
});

// --- run volume w/w cap -----------------------------------------------------

test("run volume capped at +10% week over week", () => {
  const cleared = ctx({
    state: { ...RETURN_STATE, runningCleared: true },
    completedRunByDay: [{ date: "2026-07-01", min: 100 }], // last week: 100 min
  });
  const tooMuch = validateOps(
    [addOp({ sport: "RUN", title: "Long run", durationMin: 115, estimatedLoad: 10 })],
    cleared
  );
  assert.equal(tooMuch.results[0].ok, false);
  assert.match(tooMuch.results[0].reasons.join(" "), /Run volume .* exceeds/);

  const withinCap = validateOps(
    [addOp({ sport: "RUN", title: "Long run", durationMin: 105, estimatedLoad: 10 })],
    cleared
  );
  assert.equal(withinCap.results[0].ok, true, withinCap.results[0].reasons.join(" "));
});

test("run volume floor allows a starter week from zero", () => {
  const cleared = ctx({ state: { ...RETURN_STATE, runningCleared: true } });
  const over = validateOps(
    [addOp({ sport: "RUN", title: "Run", durationMin: config.guardrails.runStartMinPerWeek + 10, estimatedLoad: 10 })],
    cleared
  );
  assert.equal(over.results[0].ok, false);
});

// --- slot / availability rules ----------------------------------------------

test("slot rules: lunch cap, evening cap, Friday evening, weekday morning", () => {
  assert.equal(slotViolations("2026-07-07", "LUNCH", 90).length, 0);
  assert.match(slotViolations("2026-07-07", "LUNCH", 91)[0], /Lunch slot is capped/);
  assert.equal(slotViolations("2026-07-07", "EVENING", 90).length, 0);
  assert.match(slotViolations("2026-07-07", "EVENING", 95)[0], /capped at 90/);
  assert.match(slotViolations("2026-07-10", "EVENING", 60)[0], /No evening sessions on Friday/);
  assert.match(slotViolations("2026-07-07", "MORNING", 60)[0], /Weekday mornings/);
  // weekends: open, no caps
  assert.equal(slotViolations("2026-07-11", "MORNING", 300).length, 0);
});

test("a very long evening session reports the 21:00 end rule too", () => {
  const v = slotViolations("2026-07-07", "EVENING", 220);
  assert.ok(v.some((r) => /end after 21:00/.test(r)), v.join(" "));
});

// --- consecutive hard days ----------------------------------------------------

test("no two hard sessions on consecutive days", () => {
  const base = [
    mk({ date: "2026-07-08", slot: "EVENING", isQuality: true, title: "SS 3x10" }),
  ];
  const bad = validateOps(
    [addOp({ date: "2026-07-09", slot: "EVENING", isQuality: true, title: "VO2" })],
    ctx({ planned: base })
  );
  assert.equal(bad.results[0].ok, false);
  assert.match(bad.results[0].reasons.join(" "), /consecutive days/);

  const good = validateOps(
    [addOp({ date: "2026-07-10", slot: "LUNCH", isQuality: true, title: "SS", durationMin: 60 })],
    ctx({ planned: base })
  );
  assert.equal(good.results[0].ok, true, good.results[0].reasons.join(" "));
});

// --- easy/rest days per 7-day window ------------------------------------------

test("every 7-day window keeps >=2 easy/rest days", () => {
  // Mon–Sat each 90 min (not easy) + a short Sunday spin (easy)
  // → only 1 easy/rest day in the Mon–Sun window.
  const days = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"];
  const plan = days.map((date, i) =>
    mk({
      date,
      slot: i === 5 ? "MORNING" : "LUNCH",
      durationMin: 90,
      estimatedLoad: 20,
    })
  );
  plan.push(mk({ date: "2026-07-12", slot: "MORNING", durationMin: 30, estimatedLoad: 10 }));
  const violations = checkPlan(plan, ctx());
  assert.ok(violations.some((v) => /easy\/rest day/.test(v)), violations.join(" "));

  // Dropping one of them restores the minimum.
  const { results } = validateOps([{ type: "delete", sessionId: plan[2].id }], ctx({ planned: plan }));
  assert.equal(results[0].ok, true);
});

// --- pull-only swims -----------------------------------------------------------

test("swims must be pull-only until lifted", () => {
  const noPull = validateOps(
    [addOp({ sport: "SWIM", title: "Swim intervals", intent: "hard 100s", slot: "LUNCH", date: "2026-07-07" })],
    ctx()
  );
  assert.equal(noPull.results[0].ok, false);
  assert.match(noPull.results[0].reasons.join(" "), /pull-buoy only/);

  const pull = validateOps(
    [addOp({ sport: "SWIM", title: "Pull swim", intent: "pull buoy easy", slot: "LUNCH", date: "2026-07-07" })],
    ctx()
  );
  assert.equal(pull.results[0].ok, true);

  const lifted = validateOps(
    [addOp({ sport: "SWIM", title: "Swim intervals", intent: "kick + full", slot: "LUNCH", date: "2026-07-07" })],
    ctx({ state: { ...RETURN_STATE, swimPullOnly: false } })
  );
  assert.equal(lifted.results[0].ok, true);
});

// --- CTL ramp caps by mode ------------------------------------------------------

function fourteenDaysAt(load: number): PlannedLike[] {
  const out: PlannedLike[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.parse(`${TODAY}T12:00:00Z`) + i * 86400_000)
      .toISOString()
      .slice(0, 10);
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    out.push(
      mk({
        date: d,
        slot: wd === 0 || wd === 6 ? "MORNING" : "LUNCH",
        durationMin: 60,
        estimatedLoad: load,
      })
    );
  }
  return out;
}

test("CTL ramp: rejected in RETURN (+5), allowed in BUILD (+7)", () => {
  const plan = fourteenDaysAt(40); // first-week ramp ≈ +6.2
  const returnViolations = checkPlan(plan, ctx());
  assert.ok(
    returnViolations.some((v) => /exceeds the RETURN cap/.test(v)),
    returnViolations.join(" ")
  );
  const buildViolations = checkPlan(plan, ctx({ state: { ...RETURN_STATE, mode: "BUILD" } }));
  assert.equal(buildViolations.filter((v) => /cap/.test(v)).length, 0, buildViolations.join(" "));
});

test("CTL ramp under the RETURN cap passes", () => {
  const plan = fourteenDaysAt(30); // first-week ramp ≈ +4.7
  const violations = checkPlan(plan, ctx());
  assert.equal(violations.filter((v) => /CTL ramp/.test(v)).length, 0, violations.join(" "));
});

// --- validateOps mechanics -------------------------------------------------------

test("an already-violating plan can still be rearranged (baseline tolerance)", () => {
  const plan = [
    mk({ date: "2026-07-07", slot: "EVENING", isQuality: true, title: "Q1" }),
    mk({ date: "2026-07-08", slot: "EVENING", isQuality: true, title: "Q2" }), // baseline violation
    mk({ date: "2026-07-11", slot: "MORNING", title: "Easy spin" }),
  ];
  const { results } = validateOps(
    [{ type: "move", sessionId: plan[2].id, newDate: "2026-07-12", newSlot: "MORNING" }],
    ctx({ planned: plan })
  );
  assert.equal(results[0].ok, true, results[0].reasons.join(" "));
});

test("unknown session id is rejected", () => {
  const { results } = validateOps(
    [{ type: "delete", sessionId: "nope" }],
    ctx()
  );
  assert.equal(results[0].ok, false);
  assert.match(results[0].reasons[0], /Unknown session/);
});

test("ops apply sequentially — a later op sees the earlier result", () => {
  const plan = [mk({ date: "2026-07-08", slot: "EVENING", isQuality: true, title: "Q1" })];
  // Move Q1 to Thursday, then add a new quality Wednesday — must be OK
  // because Q1 vacated Wednesday.
  const ops: PlanOp[] = [
    { type: "move", sessionId: plan[0].id, newDate: "2026-07-09", newSlot: "EVENING" },
    addOp({ date: "2026-07-08", slot: "EVENING", isQuality: true, title: "Q2" }),
  ];
  const bad = validateOps(ops, ctx({ planned: plan }));
  // Wed(new Q2) and Thu(moved Q1) are consecutive → second op rejected.
  assert.equal(bad.results[0].ok, true);
  assert.equal(bad.results[1].ok, false);

  const good = validateOps(
    [ops[0], addOp({ date: "2026-07-08", slot: "EVENING", isQuality: false, title: "easy" })],
    ctx({ planned: plan })
  );
  assert.ok(good.results.every((r) => r.ok));
});

// --- generator invariants ---------------------------------------------------------

test("generated block: stop rules everywhere, no runs, pull-only swims, clean plan", () => {
  const state = RETURN_STATE;
  const block = generateBlock({ today: TODAY, completedByDay: [], state });
  assert.ok(block.length > 20, `expected a real block, got ${block.length} sessions`);

  for (const s of block) {
    assert.ok(s.stopRule.length > 10, `missing stop rule on ${s.title}`);
    assert.notEqual(s.sport, "RUN", `run scheduled while not cleared: ${s.date}`);
    if (s.sport === "SWIM") {
      assert.match(`${s.title} ${s.intent}`.toLowerCase(), /pull/);
    }
    if (s.isQuality && s.phase !== "RACE") {
      const st = s.structure as { fallback?: string } | undefined;
      assert.ok(st?.fallback, `quality session without fallback: ${s.title}`);
    }
    assert.equal(slotViolations(s.date, s.slot, s.durationMin).length, 0, `${s.date} ${s.slot}`);
  }

  const asPlanned: PlannedLike[] = block.map((s, i) => ({
    id: `g${i}`,
    date: s.date,
    slot: s.slot,
    sport: s.sport,
    title: s.title,
    intent: s.intent ?? null,
    durationMin: s.durationMin,
    estimatedLoad: s.estimatedLoad,
    isQuality: s.isQuality,
    status: "PLANNED",
    phase: s.phase,
  }));
  const violations = checkPlan(asPlanned, ctx({ state }));
  assert.deepEqual(violations, [], violations.join(" | "));
});
