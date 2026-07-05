// Recompute load for every stored session — run after tuning config.ts.
// Usage: npm run recompute-load
import "dotenv/config";
import type { FitRecord } from "../lib/fit";
import { sessionLoad } from "../lib/load";
import { prisma } from "../lib/prisma";

async function main() {
  const sessions = await prisma.completedSession.findMany();
  for (const s of sessions) {
    const { load, method } = sessionLoad({
      sport: s.sport,
      elapsedSec: s.elapsedSec,
      movingSec: s.movingSec,
      avgPower: s.avgPower,
      avgSpeedMps: s.avgSpeedMps,
      avgHr: s.avgHr,
      records: s.records as unknown as FitRecord[],
    });
    await prisma.completedSession.update({
      where: { id: s.id },
      data: { load, loadMethod: method },
    });
    console.log(
      `${s.startTime.toISOString().slice(0, 10)} ${s.sport} → ${load} (${method})`
    );
  }
  console.log(`Recomputed ${sessions.length} session(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
