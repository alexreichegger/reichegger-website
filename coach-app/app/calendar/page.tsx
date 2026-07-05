import Link from "next/link";
import { localDate } from "@/lib/load";
import { prisma } from "@/lib/prisma";
import { CalendarClient, type CompletedItem, type PlannedItem } from "./calendar-client";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; d?: string }>;
}) {
  const params = await searchParams;
  const today = localDate(new Date());
  const view = ["month", "week", "day"].includes(params.view ?? "")
    ? (params.view as "month" | "week" | "day")
    : "month";
  const focus = /^\d{4}-\d{2}-\d{2}$/.test(params.d ?? "") ? params.d! : today;

  const [planned, completed] = await Promise.all([
    prisma.plannedSession.findMany({ orderBy: [{ date: "asc" }, { slot: "asc" }] }),
    prisma.completedSession.findMany({
      omit: { rawSession: true, records: true },
      orderBy: { startTime: "asc" },
    }),
  ]);

  const plannedItems: PlannedItem[] = planned.map((s) => ({
    id: s.id,
    date: s.date,
    slot: s.slot,
    sport: s.sport,
    title: s.title,
    intent: s.intent,
    structure: s.structure as PlannedItem["structure"],
    durationMin: s.durationMin,
    estimatedLoad: s.estimatedLoad,
    stopRule: s.stopRule,
    isQuality: s.isQuality,
    phase: s.phase,
    status: s.status,
  }));

  const completedItems: CompletedItem[] = completed.map((s) => ({
    id: s.id,
    date: localDate(s.startTime),
    sport: s.sport,
    durationMin: Math.round(s.elapsedSec / 60),
    distanceM: s.distanceM,
    load: s.load,
  }));

  return (
    <main>
      <p>
        <Link href="/">← Home</Link>
      </p>
      <CalendarClient
        planned={plannedItems}
        completed={completedItems}
        view={view}
        focus={focus}
        today={today}
      />
    </main>
  );
}
