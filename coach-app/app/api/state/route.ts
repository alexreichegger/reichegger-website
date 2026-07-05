import { NextResponse } from "next/server";
import { getAppState } from "@/lib/plan-context";
import { prisma } from "@/lib/prisma";

export async function GET() {
  return NextResponse.json(await getAppState());
}

// Health-gated toggles. Switching to BUILD requires an explicit
// "I am 100% healthy" confirmation — the coach chat sends it only
// after asking; the settings UI shows a confirm dialog.
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const data: { mode?: string; runningCleared?: boolean; swimPullOnly?: boolean } = {};

  if (body.mode !== undefined) {
    if (!["RETURN", "BUILD"].includes(body.mode)) {
      return NextResponse.json({ error: "mode must be RETURN or BUILD" }, { status: 400 });
    }
    if (body.mode === "BUILD" && body.confirmHealthy !== true) {
      return NextResponse.json(
        { error: "BUILD mode requires confirmHealthy: true — only switch when 100% healthy." },
        { status: 422 }
      );
    }
    data.mode = body.mode;
  }
  if (typeof body.runningCleared === "boolean") data.runningCleared = body.runningCleared;
  if (typeof body.swimPullOnly === "boolean") data.swimPullOnly = body.swimPullOnly;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const row = await prisma.appState.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  return NextResponse.json({
    mode: row.mode,
    runningCleared: row.runningCleared,
    swimPullOnly: row.swimPullOnly,
    note: "Regenerate the plan (calendar) for the new state to shape future weeks.",
  });
}
