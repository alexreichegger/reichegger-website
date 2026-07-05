import { NextResponse } from "next/server";
import { validateOps, type PlanOp } from "@/lib/guardrails";
import { getGuardrailContext } from "@/lib/plan-context";
import { prisma } from "@/lib/prisma";

// Drag-to-reschedule. The same guardrail validation the chat will use.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { sessionId, newDate, newSlot } = body ?? {};
  if (
    typeof sessionId !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(newDate ?? "") ||
    !["LUNCH", "EVENING", "MORNING"].includes(newSlot)
  ) {
    return NextResponse.json({ error: "Invalid move request" }, { status: 400 });
  }

  const ctx = await getGuardrailContext();
  if (newDate < ctx.today) {
    return NextResponse.json(
      { error: "Cannot move a session into the past" },
      { status: 422 }
    );
  }

  const op: PlanOp = { type: "move", sessionId, newDate, newSlot };
  const { results } = validateOps([op], ctx);
  const result = results[0];
  if (!result.ok) {
    return NextResponse.json({ error: "Rejected by guardrails", reasons: result.reasons }, { status: 422 });
  }

  const updated = await prisma.plannedSession.update({
    where: { id: sessionId },
    data: { date: newDate, slot: newSlot },
  });
  return NextResponse.json({ ok: true, session: { id: updated.id, date: updated.date, slot: updated.slot } });
}
