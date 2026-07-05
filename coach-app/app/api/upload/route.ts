import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { parseFit } from "@/lib/fit";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buf).digest("hex");

  const existing = await prisma.completedSession.findUnique({
    where: { fileSha256: sha256 },
    select: { id: true, fileName: true, startTime: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Already uploaded", session: existing },
      { status: 409 }
    );
  }

  let parsed;
  try {
    parsed = await parseFit(buf);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to parse FIT file" },
      { status: 422 }
    );
  }

  const { rawSession, records, ...summary } = parsed;
  const session = await prisma.completedSession.create({
    data: {
      ...summary,
      fileName: file.name,
      fileSha256: sha256,
      rawSession: rawSession as object,
      records: records as unknown as object[],
    },
    omit: { rawSession: true, records: true },
  });

  return NextResponse.json({ session, recordCount: records.length });
}
