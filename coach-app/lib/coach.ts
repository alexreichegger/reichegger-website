// Coach chat — the ONLY place a model runs. The model never does training
// math: it proposes PlanMutations; guardrails validate; code applies.
// Model: claude-sonnet-5 (per spec), server-side only.

import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";
import { validateOps, type PlanOp, type PlannedLike } from "./guardrails";
import { dailyMetrics, fitnessSnapshot, localDate } from "./load";
import { getGuardrailContext } from "./plan-context";
import { prisma } from "./prisma";

export const COACH_MODEL = "claude-sonnet-5";

// ---------------------------------------------------------------------------
// Deterministic load estimate for coach-proposed sessions (code, not model).
// ---------------------------------------------------------------------------
export function estimateLoad(
  sport: string,
  durationMin: number,
  isQuality: boolean
): number {
  if (sport === "SWIM") {
    return Math.round((durationMin / 60) * config.load.fallbackLoadPerHour.SWIM * 10) / 10;
  }
  const intensity = isQuality
    ? config.plan.estIf.quality
    : sport === "RUN"
      ? 0.7
      : config.plan.estIf.easy;
  return Math.round((durationMin / 60) * intensity * intensity * 100 * 10) / 10;
}

// ---------------------------------------------------------------------------
// Context sent every turn — the model has no memory.
// ---------------------------------------------------------------------------
export async function buildCoachContext(): Promise<string> {
  const today = localDate(new Date());
  const [state, completed, planned, daily] = await Promise.all([
    prisma.appState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    prisma.completedSession.findMany({
      orderBy: { startTime: "desc" },
      take: 7,
      omit: { rawSession: true, records: true },
    }),
    prisma.plannedSession.findMany({
      where: { status: { in: ["PLANNED", "MISSED"] } },
      orderBy: { date: "asc" },
    }),
    prisma.dailyContext.findMany({ orderBy: { date: "desc" }, take: 7 }),
  ]);

  const allCompleted = await prisma.completedSession.findMany({
    select: { startTime: true, load: true },
  });
  const fitness = fitnessSnapshot(
    dailyMetrics(allCompleted.map((s) => ({ startTime: s.startTime, load: s.load })))
  );

  const horizon = new Date(Date.parse(`${today}T12:00:00Z`) + 14 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const upcoming = planned.filter(
    (s) => s.status === "PLANNED" && s.date >= today && s.date <= horizon
  );
  const missed = planned.filter((s) => s.status === "MISSED");

  const races = config.races
    .filter((r) => r.date >= today)
    .map((r) => {
      const days = Math.round((Date.parse(r.date) - Date.parse(today)) / 86400_000);
      return `- ${r.name} (${r.priority}): ${r.date}, in ${days} days`;
    })
    .join("\n");

  const fmtPlanned = (s: (typeof planned)[number]) =>
    `- [${s.id}] ${s.date} ${s.slot} ${s.sport} "${s.title}" ${s.durationMin}min ~${Math.round(s.estimatedLoad)} load${s.isQuality ? " HARD" : ""} (${s.phase})`;

  return `TODAY: ${today}
MODE: ${state.mode} | running cleared: ${state.runningCleared} | swim pull-only: ${state.swimPullOnly}

FITNESS: CTL ${fitness?.ctl ?? 0}, ATL ${fitness?.atl ?? 0}, TSB ${fitness?.tsb ?? 0}, ramp ${fitness?.rampRate ?? 0} CTL/week (cap: RETURN +${config.guardrails.rampCapPerWeek.RETURN}, BUILD +${config.guardrails.rampCapPerWeek.BUILD})

RACES:
${races || "- none upcoming"}
GATE STATUS: ${state.runningCleared ? "running resumed" : "NOT running yet — Erkner 70.3 run leg at risk until running resumes; flag plainly if the timeline gets tight"}

AVAILABILITY (sessions may only be scheduled in these slots):
- Weekday LUNCH: max ${config.availability.lunch.maxMin} min
- Weekday EVENING: from ${config.availability.evening.start}, must end by ${config.availability.evening.latestEnd}, max ${config.availability.evening.maxMin} min, NEVER Friday
- Weekends (MORNING): open, no caps
ANCHORS: Tue = key run day (dormant until running cleared); Fri lunch = long run (dormant); long ride Sat or Sun; midweek bike quality Wed evening; swims flexible.

UPCOMING PLANNED SESSIONS (next 14 days):
${upcoming.map(fmtPlanned).join("\n") || "- none"}

MISSED SESSIONS AWAITING MY DECISION (present options: drop / move / compress / swap — never silently reshuffle):
${missed.map(fmtPlanned).join("\n") || "- none"}

RECENT COMPLETED SESSIONS:
${
  completed
    .map(
      (s) =>
        `- ${localDate(s.startTime)} ${s.sport} ${Math.round(s.elapsedSec / 60)}min${s.distanceM ? ` ${(s.distanceM / 1000).toFixed(1)}km` : ""}${s.load ? ` load ${Math.round(s.load)}` : ""}`
    )
    .join("\n") || "- none"
}

RECENT CHECK-INS:
${
  daily
    .map(
      (d) =>
        `- ${d.date}: sleep ${d.sleepH ?? "?"}h, pain ${d.pain ?? "?"}/10, feel ${d.feel ?? "?"}/5${d.notes ? `, "${d.notes}"` : ""}`
    )
    .join("\n") || "- none yet"
}`;
}

const SYSTEM_PROMPT = `You are the athlete's endurance coach. One athlete, returning from injury (proximal soleus + tibial bone stress reaction), building toward Ironman Klagenfurt June 2027 with Erkner 70.3 (Sep 2026) as the next target.

Tone: direct, practical, no cheerleading. Flag risk plainly.

Hard rules:
- You NEVER do training math. Load, ramp and periodisation are computed by code. You propose plan changes ONLY via the propose_plan_mutation tool; code validates every op against safety guardrails and applies what passes. Rejected ops come back with reasons — relay them honestly, don't retry the same op.
- No running until the athlete confirms cleared (a settings gate — you cannot toggle it; point them to the health-gates panel on the home page). Same for swim pull-only and RETURN/BUILD mode.
- Missed sessions: ASK. Present options (drop / move / compress / swap) and let the athlete choose. Never silently reshuffle.
- If the athlete reports pain or feeling off: ALWAYS propose a concrete adjustment via propose_plan_mutation in the same reply (reduce, move, or drop) — don't just note it.
- Weather/conditions are reactive only: the athlete tells you ("hot today", "windy"); respond with a proposed adjustment or a plain warning. Never assume a forecast.
- Check-ins: keep them short. Sleep, pain 0-10, feel 1-5, notes. Do NOT ask for HRV.
- After a .fit upload appears in chat, ask how it felt vs. planned. Before a key (HARD) session, do a quick readiness check.
- Log every check-in answer with log_daily_context — one row per day; update rather than re-ask.
- Session IDs in [brackets] in the context are what you pass as sessionId in ops.
- When adding sessions: quality sessions need full structure (warmup, reps with exact targets, cooldown, fallback); easy sessions need intent only (duration + zone). Every session needs a stop rule. Swims must be pull-buoy ("pull" in the title or intent) while the gate is on.
- Do not invent estimated load numbers — code computes them.

Keep replies compact. Lead with what matters.`;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_plan_mutation",
    description:
      "Propose changes to the training plan. Every op is validated against hard safety guardrails (slot availability, no consecutive hard days, easy/rest day minimums, CTL ramp caps, running/swim gates); invalid ops are rejected with reasons and NOT applied. Returns per-op results.",
    input_schema: {
      type: "object",
      properties: {
        rationale: { type: "string", description: "Why this change, in one or two sentences." },
        ops: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["move", "modify", "add", "delete"] },
              sessionId: { type: "string", description: "Required for move/modify/delete." },
              newDate: { type: "string", description: "move: YYYY-MM-DD" },
              newSlot: { type: "string", enum: ["LUNCH", "EVENING", "MORNING"] },
              changes: {
                type: "object",
                description:
                  "modify: any of title, intent, durationMin, date, slot, stopRule, structure.",
              },
              session: {
                type: "object",
                description: "add: the new session.",
                properties: {
                  date: { type: "string" },
                  slot: { type: "string", enum: ["LUNCH", "EVENING", "MORNING"] },
                  sport: { type: "string", enum: ["BIKE", "RUN", "SWIM", "OTHER"] },
                  title: { type: "string" },
                  intent: { type: "string" },
                  structure: { type: "object" },
                  durationMin: { type: "number" },
                  isQuality: { type: "boolean" },
                  stopRule: { type: "string" },
                },
                required: ["date", "slot", "sport", "title", "durationMin"],
              },
            },
            required: ["type"],
          },
        },
      },
      required: ["rationale", "ops"],
    },
  },
  {
    name: "log_daily_context",
    description:
      "Record or update today's (or a given day's) check-in: sleep hours, pain 0-10, feel 1-5, free notes. One row per date — logging again updates it.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; defaults to today." },
        sleepH: { type: "number" },
        pain: { type: "integer", minimum: 0, maximum: 10 },
        feel: { type: "integer", minimum: 1, maximum: 5 },
        notes: { type: "string" },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Mutation execution: model proposal → guardrails → DB.
// ---------------------------------------------------------------------------
export interface MutationResult {
  rationale: string;
  applied: { type: string; summary: string }[];
  rejected: { type: string; summary: string; reasons: string[] }[];
}

interface RawOp {
  type: "move" | "modify" | "add" | "delete";
  sessionId?: string;
  newDate?: string;
  newSlot?: "LUNCH" | "EVENING" | "MORNING";
  changes?: Record<string, unknown>;
  session?: {
    date: string;
    slot: "LUNCH" | "EVENING" | "MORNING";
    sport: "BIKE" | "RUN" | "SWIM" | "OTHER";
    title: string;
    intent?: string;
    structure?: object;
    durationMin: number;
    isQuality?: boolean;
    stopRule?: string;
  };
}

function toPlanOp(raw: RawOp): PlanOp | { error: string } {
  switch (raw.type) {
    case "move":
      if (!raw.sessionId || !raw.newDate || !raw.newSlot) return { error: "move needs sessionId, newDate, newSlot" };
      return { type: "move", sessionId: raw.sessionId, newDate: raw.newDate, newSlot: raw.newSlot };
    case "delete":
      if (!raw.sessionId) return { error: "delete needs sessionId" };
      return { type: "delete", sessionId: raw.sessionId };
    case "modify": {
      if (!raw.sessionId || !raw.changes) return { error: "modify needs sessionId and changes" };
      const allowed = ["title", "intent", "durationMin", "date", "slot", "stopRule", "structure"];
      const changes: Record<string, unknown> = {};
      for (const k of allowed) if (raw.changes[k] !== undefined) changes[k] = raw.changes[k];
      return { type: "modify", sessionId: raw.sessionId, changes: changes as Partial<Omit<PlannedLike, "id">> };
    }
    case "add": {
      const s = raw.session;
      if (!s) return { error: "add needs session" };
      return {
        type: "add",
        session: {
          date: s.date,
          slot: s.slot,
          sport: s.sport,
          title: s.title,
          intent: s.intent ?? null,
          durationMin: s.durationMin,
          estimatedLoad: estimateLoad(s.sport, s.durationMin, s.isQuality ?? false),
          isQuality: s.isQuality ?? false,
          phase: "COACH",
        },
      };
    }
  }
}

function opSummary(op: PlanOp): string {
  switch (op.type) {
    case "move":
      return `move ${op.sessionId} → ${op.newDate} ${op.newSlot}`;
    case "modify":
      return `modify ${op.sessionId}: ${Object.keys(op.changes).join(", ")}`;
    case "add":
      return `add ${op.session.date} ${op.session.slot} ${op.session.sport} "${op.session.title}" ${op.session.durationMin}min`;
    case "delete":
      return `delete ${op.sessionId}`;
  }
}

export async function executeMutation(
  rationale: string,
  rawOps: RawOp[]
): Promise<MutationResult> {
  const result: MutationResult = { rationale, applied: [], rejected: [] };
  const ctx = await getGuardrailContext();

  const ops: PlanOp[] = [];
  const rawByIndex: RawOp[] = [];
  for (const raw of rawOps) {
    const op = toPlanOp(raw);
    if ("error" in op) {
      result.rejected.push({ type: raw.type, summary: raw.type, reasons: [op.error] });
    } else {
      ops.push(op);
      rawByIndex.push(raw);
    }
  }

  const { results } = validateOps(ops, ctx);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const op = r.op;
    if (!r.ok) {
      result.rejected.push({ type: op.type, summary: opSummary(op), reasons: r.reasons });
      continue;
    }
    switch (op.type) {
      case "move":
        // Moving a MISSED session revives it.
        await prisma.plannedSession.update({
          where: { id: op.sessionId },
          data: { date: op.newDate, slot: op.newSlot, status: "PLANNED" },
        });
        break;
      case "modify": {
        const raw = rawByIndex[i];
        const c = op.changes;
        const data: Record<string, unknown> = { ...c };
        if (typeof c.durationMin === "number") {
          const target = ctx.planned.find((s) => s.id === op.sessionId);
          data.estimatedLoad = estimateLoad(
            target?.sport ?? "BIKE",
            c.durationMin,
            target?.isQuality ?? false
          );
        }
        if (raw.changes?.structure !== undefined) data.structure = raw.changes.structure as object;
        await prisma.plannedSession.update({ where: { id: op.sessionId }, data });
        break;
      }
      case "add": {
        const raw = rawByIndex[i];
        await prisma.plannedSession.create({
          data: {
            date: op.session.date,
            slot: op.session.slot,
            sport: op.session.sport,
            title: op.session.title,
            intent: op.session.intent,
            structure: (raw.session?.structure as object) ?? undefined,
            durationMin: op.session.durationMin,
            estimatedLoad: op.session.estimatedLoad,
            stopRule: raw.session?.stopRule ?? config.guardrails.defaultStopRule,
            isQuality: op.session.isQuality,
            phase: "COACH",
          },
        });
        break;
      }
      case "delete":
        await prisma.plannedSession.update({
          where: { id: op.sessionId },
          data: { status: "CANCELLED" },
        });
        break;
    }
    result.applied.push({ type: op.type, summary: opSummary(op) });
  }

  return result;
}

async function logDailyContext(input: {
  date?: string;
  sleepH?: number;
  pain?: number;
  feel?: number;
  notes?: string;
}): Promise<string> {
  const date = input.date ?? localDate(new Date());
  const data = {
    sleepH: input.sleepH,
    pain: input.pain,
    feel: input.feel,
    notes: input.notes,
  };
  await prisma.dailyContext.upsert({
    where: { date },
    update: data,
    create: { date, ...data },
  });
  return `Logged check-in for ${date}.`;
}

// ---------------------------------------------------------------------------
// The chat turn: manual tool-use loop (each op must pass guardrails before
// the model gets the result back).
// ---------------------------------------------------------------------------
export async function runCoachTurn(userText: string): Promise<{
  text: string;
  mutation: MutationResult | null;
}> {
  await prisma.chatMessage.create({ data: { role: "user", content: userText } });

  if (!process.env.ANTHROPIC_API_KEY) {
    const text =
      "Coach offline: ANTHROPIC_API_KEY is not configured on the server. Set it and try again.";
    await prisma.chatMessage.create({ data: { role: "assistant", content: text } });
    return { text, mutation: null };
  }

  const client = new Anthropic();
  const context = await buildCoachContext();
  const history = await prisma.chatMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const messages: Anthropic.MessageParam[] = history
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  // Fresh state goes with the latest user turn (model has no memory).
  messages[messages.length - 1] = {
    role: "user",
    content: `<current_state>\n${context}\n</current_state>\n\n${userText}`,
  };

  let mutation: MutationResult | null = null;
  const textParts: string[] = [];

  for (let iteration = 0; iteration < 5; iteration++) {
    const response = await client.messages.create({
      model: COACH_MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) textParts.push(block.text);
    }

    if (response.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      let resultText: string;
      try {
        if (block.name === "propose_plan_mutation") {
          const input = block.input as { rationale: string; ops: RawOp[] };
          const res = await executeMutation(input.rationale ?? "", input.ops ?? []);
          mutation = mutation
            ? {
                rationale: [mutation.rationale, res.rationale].filter(Boolean).join(" | "),
                applied: [...mutation.applied, ...res.applied],
                rejected: [...mutation.rejected, ...res.rejected],
              }
            : res;
          resultText = JSON.stringify(res);
        } else if (block.name === "log_daily_context") {
          resultText = await logDailyContext(block.input as Parameters<typeof logDailyContext>[0]);
        } else {
          resultText = `Unknown tool ${block.name}`;
        }
      } catch (e) {
        resultText = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  const text = textParts.join("\n\n") || "(no reply)";
  await prisma.chatMessage.create({
    data: { role: "assistant", content: text, mutation: mutation as object | null ?? undefined },
  });
  return { text, mutation };
}

// ---------------------------------------------------------------------------
// Deterministic check-in bootstrap (no model call): morning check, missed
// session detection, pre-key-session readiness. Called when the chat loads.
// ---------------------------------------------------------------------------
export async function bootstrapCheckIns(): Promise<void> {
  const today = localDate(new Date());

  // Mark overdue planned sessions as missed — the coach will ask, not reshuffle.
  await prisma.plannedSession.updateMany({
    where: { status: "PLANNED", date: { lt: today } },
    data: { status: "MISSED" },
  });

  // One morning check-in per day.
  const start = new Date(`${today}T00:00:00Z`);
  const existing = await prisma.chatMessage.findFirst({
    where: { role: "assistant", createdAt: { gte: start }, content: { startsWith: "Morning check" } },
  });
  if (existing) return;

  const [missed, todaySessions, tomorrowSessions] = await Promise.all([
    prisma.plannedSession.findMany({ where: { status: "MISSED" }, orderBy: { date: "asc" } }),
    prisma.plannedSession.findMany({ where: { status: "PLANNED", date: today } }),
    prisma.plannedSession.findMany({
      where: {
        status: "PLANNED",
        date: new Date(Date.parse(`${today}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10),
      },
    }),
  ]);

  const lines = [
    "Morning check — how did you sleep (hours), any pain (0-10), how do you feel (1-5)?",
  ];
  const todayPlan = todaySessions
    .map((s) => `${s.slot.toLowerCase()}: ${s.title} (${s.durationMin}min)`)
    .join("; ");
  if (todayPlan) lines.push(`Today: ${todayPlan}.`);
  const keySoon = [...todaySessions, ...tomorrowSessions].find((s) => s.isQuality);
  if (keySoon) {
    lines.push(
      `Key session ${keySoon.date === today ? "today" : "tomorrow"}: "${keySoon.title}" — up for it, or should I scale it?`
    );
  }
  if (missed.length > 0) {
    lines.push(
      `Missed: ${missed.map((s) => `"${s.title}" (${s.date})`).join(", ")}. Options: drop, move, compress, or swap — your call.`
    );
  }

  await prisma.chatMessage.create({
    data: { role: "assistant", content: lines.join("\n") },
  });
}
