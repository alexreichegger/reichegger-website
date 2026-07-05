import { NextResponse } from "next/server";
import { localDate } from "@/lib/load";
import { generateBlock } from "@/lib/plan";
import { getAppState, getCompletedByDay } from "@/lib/plan-context";
import { prisma } from "@/lib/prisma";

// Regenerate the planned block from today to the next race. Replaces
// future PLANNED sessions only — completed/missed history is untouched.
export async function POST() {
  const today = localDate(new Date());
  const [state, completedByDay] = await Promise.all([
    getAppState(),
    getCompletedByDay(),
  ]);

  const sessions = generateBlock({ today, completedByDay, state });
  if (sessions.length === 0) {
    return NextResponse.json({ error: "No upcoming race to plan toward" }, { status: 422 });
  }

  const [, created] = await prisma.$transaction([
    prisma.plannedSession.deleteMany({
      where: { status: "PLANNED", date: { gte: today } },
    }),
    prisma.plannedSession.createMany({ data: sessions }),
  ]);

  const dates = sessions.map((s) => s.date).sort();
  return NextResponse.json({
    created: created.count,
    from: dates[0],
    to: dates.at(-1),
    mode: state.mode,
  });
}
