import Link from "next/link";
import { dailyMetrics, fitnessSnapshot } from "@/lib/load";
import { prisma } from "@/lib/prisma";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export default async function Home() {
  const sessions = await prisma.completedSession.findMany({
    orderBy: { startTime: "desc" },
    take: 50,
    omit: { rawSession: true, records: true },
  });
  const fitness = fitnessSnapshot(
    dailyMetrics(
      sessions.map((s) => ({ startTime: s.startTime, load: s.load }))
    )
  );

  return (
    <main>
      <h1>Coach</h1>
      {fitness && (
        <p
          style={{
            display: "flex",
            gap: "1.5rem",
            background: "#f4f4f4",
            padding: "0.6rem 0.8rem",
            borderRadius: 6,
          }}
        >
          <span>
            CTL <strong>{fitness.ctl}</strong>
          </span>
          <span>
            ATL <strong>{fitness.atl}</strong>
          </span>
          <span>
            TSB <strong>{fitness.tsb}</strong>
          </span>
          <span>
            ramp <strong>{fitness.rampRate}</strong> CTL/wk
          </span>
        </p>
      )}
      <p>
        Upload a <code>.fit</code> file to log a completed session. Zone
        tables: <Link href="/zones">/zones</Link>.
      </p>
      <UploadForm />

      <h2 style={{ marginTop: "2rem" }}>Completed sessions</h2>
      {sessions.length === 0 ? (
        <p>No sessions yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
              <th style={{ padding: "0.4rem" }}>Date</th>
              <th>Sport</th>
              <th>Duration</th>
              <th>Distance</th>
              <th>Avg power</th>
              <th>Avg HR</th>
              <th>Load</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.4rem" }}>
                  {s.startTime.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td>{s.sport}</td>
                <td>{fmtDuration(s.elapsedSec)}</td>
                <td>
                  {s.distanceM != null
                    ? `${(s.distanceM / 1000).toFixed(1)} km`
                    : "—"}
                </td>
                <td>{s.avgPower != null ? `${Math.round(s.avgPower)} W` : "—"}</td>
                <td>{s.avgHr != null ? `${Math.round(s.avgHr)} bpm` : "—"}</td>
                <td>
                  {s.load != null ? Math.round(s.load) : "—"}
                  {s.loadMethod && (
                    <span style={{ color: "#888", fontSize: "0.85em" }}>
                      {" "}
                      ({s.loadMethod})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
