// Shared DB → guardrail-context assembly, used by every mutation path.

import type { AppStateLike, GuardrailContext, PlannedLike } from "./guardrails";
import { localDate } from "./load";
import { prisma } from "./prisma";

export async function getAppState(): Promise<AppStateLike> {
  const row = await prisma.appState.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return {
    mode: row.mode as AppStateLike["mode"],
    runningCleared: row.runningCleared,
    swimPullOnly: row.swimPullOnly,
  };
}

export async function getCompletedByDay(): Promise<{ date: string; load: number }[]> {
  const completed = await prisma.completedSession.findMany({
    select: { startTime: true, load: true },
  });
  const byDay = new Map<string, number>();
  for (const c of completed) {
    const day = localDate(c.startTime);
    byDay.set(day, (byDay.get(day) ?? 0) + (c.load ?? 0));
  }
  return [...byDay.entries()].map(([date, load]) => ({ date, load }));
}

export async function getCompletedRunByDay(): Promise<{ date: string; min: number }[]> {
  const runs = await prisma.completedSession.findMany({
    where: { sport: "RUN" },
    select: { startTime: true, elapsedSec: true },
  });
  const byDay = new Map<string, number>();
  for (const r of runs) {
    const day = localDate(r.startTime);
    byDay.set(day, (byDay.get(day) ?? 0) + r.elapsedSec / 60);
  }
  return [...byDay.entries()].map(([date, min]) => ({ date, min }));
}

export async function getGuardrailContext(): Promise<GuardrailContext> {
  const [state, completedByDay, completedRunByDay, planned] = await Promise.all([
    getAppState(),
    getCompletedByDay(),
    getCompletedRunByDay(),
    prisma.plannedSession.findMany({ where: { status: "PLANNED" } }),
  ]);
  return {
    state,
    completedByDay,
    completedRunByDay,
    planned: planned.map(
      (s): PlannedLike => ({
        id: s.id,
        date: s.date,
        slot: s.slot,
        sport: s.sport,
        title: s.title,
        intent: s.intent,
        durationMin: s.durationMin,
        estimatedLoad: s.estimatedLoad,
        isQuality: s.isQuality,
        status: s.status,
        phase: s.phase,
      })
    ),
    today: localDate(new Date()),
  };
}
