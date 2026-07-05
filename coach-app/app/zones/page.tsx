import Link from "next/link";
import { config } from "@/lib/config";
import { bikeZones, fmtPace, runZones, swimZones, type ZoneRow } from "@/lib/zones";

function ZoneTable({ title, anchor, rows }: { title: string; anchor: string; rows: ZoneRow[] }) {
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2>{title}</h2>
      <p style={{ color: "#555", marginTop: 0 }}>Anchor: {anchor}</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
            <th style={{ padding: "0.4rem" }}>Zone</th>
            <th>Range</th>
            <th>Rule</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((z) => (
            <tr key={z.name} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "0.4rem" }}>{z.name}</td>
              <td>{z.range}</td>
              <td style={{ color: "#555" }}>{z.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function ZonesPage() {
  const a = config.anchors;
  return (
    <main>
      <p>
        <Link href="/">← Back</Link>
      </p>
      <h1>Training zones</h1>
      <p style={{ background: "#fff6d6", padding: "0.6rem", borderRadius: 6 }}>
        Derived from your anchors — <strong>pending your confirmation</strong>.
        No planned session will use them until you confirm. Edit percentages in{" "}
        <code>lib/config.ts</code>.
      </p>
      <ZoneTable
        title="Run (pace)"
        anchor={`threshold ${fmtPace(a.runThresholdSecPerKm)} /km`}
        rows={runZones()}
      />
      <ZoneTable
        title="Bike (power, Coggan)"
        anchor={`FTP ${a.ftpWatts} W`}
        rows={bikeZones()}
      />
      <ZoneTable
        title="Swim (pace) — pull-buoy only for now"
        anchor={`easy ${fmtPace(a.swimEasySecPer100m)} /100m`}
        rows={swimZones()}
      />
    </main>
  );
}
