import { NextResponse } from "next/server";
import { bootstrapCheckIns, executeMutation, runCoachTurn } from "@/lib/coach";
import { prisma } from "@/lib/prisma";

export async function GET() {
  await bootstrapCheckIns();
  const messages = await prisma.chatMessage.findMany({
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  // Dev-only escape hatch: exercise the mutation pipeline without a model.
  if (body?.debugMutation && process.env.NODE_ENV !== "production") {
    const res = await executeMutation(
      body.debugMutation.rationale ?? "debug",
      body.debugMutation.ops ?? []
    );
    return NextResponse.json({ debug: true, mutation: res });
  }

  if (typeof body?.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const { text, mutation } = await runCoachTurn(body.message.trim());
  return NextResponse.json({ text, mutation });
}
