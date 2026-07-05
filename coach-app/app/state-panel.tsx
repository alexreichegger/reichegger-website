"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StatePanel({
  mode,
  runningCleared,
  swimPullOnly,
}: {
  mode: string;
  runningCleared: boolean;
  swimPullOnly: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  async function patch(body: object) {
    setMsg(null);
    const res = await fetch("/api/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) setMsg(json.error);
    else {
      setMsg(json.note ?? "Updated.");
      router.refresh();
    }
  }

  const btn: React.CSSProperties = { fontSize: "0.8em", padding: "2px 8px" };

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: "0.6rem 0.8rem",
        margin: "0.8rem 0",
        fontSize: "0.9em",
      }}
    >
      <strong>Health gates</strong> — mode <strong>{mode}</strong>, running{" "}
      {runningCleared ? "cleared" : "NOT cleared"}, swim{" "}
      {swimPullOnly ? "pull-only" : "unrestricted"}
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        {!runningCleared ? (
          <button
            style={btn}
            onClick={() =>
              confirm("Confirm: you are cleared to run again?") &&
              patch({ runningCleared: true })
            }
          >
            Mark running cleared
          </button>
        ) : (
          <button style={btn} onClick={() => patch({ runningCleared: false })}>
            Pause running again
          </button>
        )}
        {swimPullOnly ? (
          <button
            style={btn}
            onClick={() =>
              confirm("Confirm: full swimming (kick, push-offs) is OK again?") &&
              patch({ swimPullOnly: false })
            }
          >
            Lift pull-only
          </button>
        ) : (
          <button style={btn} onClick={() => patch({ swimPullOnly: true })}>
            Back to pull-only
          </button>
        )}
        {mode === "RETURN" ? (
          <button
            style={btn}
            onClick={() =>
              confirm("Switch to BUILD? Only if you are 100% healthy.") &&
              patch({ mode: "BUILD", confirmHealthy: true })
            }
          >
            Switch to BUILD
          </button>
        ) : (
          <button style={btn} onClick={() => patch({ mode: "RETURN" })}>
            Back to RETURN
          </button>
        )}
      </div>
      {msg && <p style={{ margin: "6px 0 0", color: "#555" }}>{msg}</p>}
    </div>
  );
}
