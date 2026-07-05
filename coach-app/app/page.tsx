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

  return (
    <main>
      <h1>Coach — Phase 1</h1>
      <p>
        Upload a <code>.fit</code> file to log a completed session.
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
