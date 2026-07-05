"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PlannedItem {
  id: string;
  date: string;
  slot: "LUNCH" | "EVENING" | "MORNING";
  sport: string;
  title: string;
  intent?: string | null;
  structure?: {
    warmup?: string;
    reps?: { count: number; work: string; target: string; recovery: string }[];
    cooldown?: string;
    fallback?: string;
  } | null;
  durationMin: number;
  estimatedLoad: number;
  stopRule: string;
  isQuality: boolean;
  phase: string;
  status: string;
}

export interface CompletedItem {
  id: string;
  date: string;
  sport: string;
  durationMin: number;
  distanceM: number | null;
  load: number | null;
}

const SPORT_COLOR: Record<string, string> = {
  BIKE: "#d97706",
  SWIM: "#2563eb",
  RUN: "#16a34a",
  OTHER: "#dc2626",
};

const SLOT_LABEL: Record<string, string> = {
  LUNCH: "Lunch",
  EVENING: "Evening",
  MORNING: "Morning",
};

const SLOT_TIME: Record<string, string> = {
  LUNCH: "12:30",
  EVENING: "17:30",
  MORNING: "09:00",
};

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function monday(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h${min % 60 > 0 ? String(min % 60).padStart(2, "0") : ""}` : `${min}m`;
}

export function CalendarClient({
  planned,
  completed,
  view,
  focus,
  today,
}: {
  planned: PlannedItem[];
  completed: CompletedItem[];
  view: "month" | "week" | "day";
  focus: string;
  today: string;
}) {
  const router = useRouter();
  const [dragId, setDragId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function moveSession(sessionId: string, newDate: string, newSlot: string) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/plan/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, newDate, newSlot }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice({
          kind: "error",
          text: json.reasons?.join(" ") ?? json.error ?? "Move rejected",
        });
      } else {
        setNotice({ kind: "ok", text: `Moved to ${newDate} (${SLOT_LABEL[newSlot]}).` });
        router.refresh();
      }
    } catch {
      setNotice({ kind: "error", text: "Move failed — network error." });
    } finally {
      setBusy(false);
    }
  }

  function dropHandlers(date: string, slot: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (dragId) e.preventDefault();
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragId && !busy) moveSession(dragId, date, slot);
        setDragId(null);
      },
    };
  }

  const nav =
    view === "month"
      ? { prev: addDays(focus.slice(0, 8) + "01", -1), next: addDays(focus.slice(0, 8) + "28", 5) }
      : view === "week"
        ? { prev: addDays(focus, -7), next: addDays(focus, 7) }
        : { prev: addDays(focus, -1), next: addDays(focus, 1) };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
        <h1 style={{ marginRight: "auto" }}>Calendar</h1>
        {(["month", "week", "day"] as const).map((v) => (
          <Link
            key={v}
            href={`/calendar?view=${v}&d=${focus}`}
            style={{ fontWeight: v === view ? 700 : 400 }}
          >
            {v}
          </Link>
        ))}
        <Link href={`/calendar?view=${view}&d=${nav.prev}`}>‹ prev</Link>
        <Link href={`/calendar?view=${view}&d=${today}`}>today</Link>
        <Link href={`/calendar?view=${view}&d=${nav.next}`}>next ›</Link>
      </div>

      {notice && (
        <p
          style={{
            padding: "0.5rem 0.8rem",
            borderRadius: 6,
            background: notice.kind === "ok" ? "#dcfce7" : "#fee2e2",
          }}
        >
          {notice.kind === "error" ? "Guardrails: " : ""}
          {notice.text}
        </p>
      )}

      {view === "month" && (
        <MonthView {...{ planned, completed, focus, today, setDragId, dropHandlers }} />
      )}
      {view === "week" && (
        <WeekView {...{ planned, completed, focus, today, setDragId, dropHandlers }} />
      )}
      {view === "day" && <DayView {...{ planned, completed, focus }} />}

      <p style={{ color: "#666", fontSize: "0.9em" }}>
        Outlined = planned, filled = completed, red border = race. Drag a planned
        session onto a day (week view: onto a slot) to reschedule — moves are
        validated by the safety guardrails.
      </p>
    </div>
  );
}

function Chip({
  s,
  draggable,
  onDragStart,
  filled,
}: {
  s: { sport: string; title: string; durationMin?: number };
  draggable?: boolean;
  onDragStart?: () => void;
  filled?: boolean;
}) {
  const color = SPORT_COLOR[s.sport] ?? "#555";
  const race = s.title.startsWith("RACE");
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      title={s.title}
      style={{
        border: `2px solid ${race ? "#dc2626" : color}`,
        background: filled ? color : "transparent",
        color: filled ? "#fff" : undefined,
        borderRadius: 5,
        padding: "1px 4px",
        fontSize: "0.72em",
        marginTop: 2,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        cursor: draggable ? "grab" : "default",
      }}
    >
      {s.title}
      {s.durationMin ? ` · ${fmtDur(s.durationMin)}` : ""}
    </div>
  );
}

type DropFn = (date: string, slot: string) => {
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};

function MonthView({
  planned,
  completed,
  focus,
  today,
  setDragId,
  dropHandlers,
}: {
  planned: PlannedItem[];
  completed: CompletedItem[];
  focus: string;
  today: string;
  setDragId: (id: string | null) => void;
  dropHandlers: DropFn;
}) {
  const first = focus.slice(0, 8) + "01";
  const gridStart = monday(first);
  const weeks: string[][] = [];
  for (let w = 0; ; w++) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(gridStart, w * 7 + i));
    if (days[0].slice(0, 7) > focus.slice(0, 7)) break;
    weeks.push(days);
    if (w > 6) break;
  }

  return (
    <div>
      <h2 style={{ marginBottom: "0.4rem" }}>{focus.slice(0, 7)}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} style={{ fontWeight: 600, fontSize: "0.8em" }}>
            {d}
          </div>
        ))}
        {weeks.flat().map((date) => {
          const inMonth = date.slice(0, 7) === focus.slice(0, 7);
          const dayPlanned = planned.filter((s) => s.date === date && s.status === "PLANNED");
          const dayDone = completed.filter((c) => c.date === date);
          return (
            <div
              key={date}
              {...dropHandlers(date, isoWeekday(date) >= 6 ? "MORNING" : "EVENING")}
              style={{
                minHeight: 74,
                border: "1px solid #ddd",
                borderRadius: 6,
                padding: 3,
                opacity: inMonth ? 1 : 0.35,
                background: date === today ? "#eff6ff" : undefined,
              }}
            >
              <Link
                href={`/calendar?view=day&d=${date}`}
                style={{ fontSize: "0.75em", color: "#555", textDecoration: "none" }}
              >
                {Number(date.slice(8))}
              </Link>
              {dayDone.map((c) => (
                <Chip
                  key={c.id}
                  filled
                  s={{ sport: c.sport, title: c.sport, durationMin: c.durationMin }}
                />
              ))}
              {dayPlanned.map((s) => (
                <Chip key={s.id} s={s} draggable onDragStart={() => setDragId(s.id)} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  planned,
  completed,
  focus,
  today,
  setDragId,
  dropHandlers,
}: {
  planned: PlannedItem[];
  completed: CompletedItem[];
  focus: string;
  today: string;
  setDragId: (id: string | null) => void;
  dropHandlers: DropFn;
}) {
  const start = monday(focus);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
      {days.map((date) => {
        const weekend = isoWeekday(date) >= 6;
        // Friday evening is never available (lunch long-run anchor day).
        const slots = weekend
          ? ["MORNING"]
          : isoWeekday(date) === 5
            ? ["LUNCH"]
            : ["LUNCH", "EVENING"];
        const dayDone = completed.filter((c) => c.date === date);
        return (
          <div key={date} style={{ minHeight: 260 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: "0.85em",
                background: date === today ? "#eff6ff" : undefined,
              }}
            >
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][isoWeekday(date) - 1]}{" "}
              <Link href={`/calendar?view=day&d=${date}`}>{date.slice(5)}</Link>
            </div>
            {dayDone.map((c) => (
              <div
                key={c.id}
                style={{
                  background: SPORT_COLOR[c.sport],
                  color: "#fff",
                  borderRadius: 6,
                  padding: "3px 6px",
                  fontSize: "0.75em",
                  marginTop: 4,
                }}
              >
                ✓ {c.sport} {fmtDur(c.durationMin)}
                {c.load != null && ` · ${Math.round(c.load)}`}
              </div>
            ))}
            {slots.map((slot) => {
              const items = planned.filter(
                (s) => s.date === date && s.slot === slot && s.status === "PLANNED"
              );
              return (
                <div
                  key={slot}
                  {...dropHandlers(date, slot)}
                  style={{
                    border: "1px dashed #ccc",
                    borderRadius: 6,
                    minHeight: 70,
                    marginTop: 4,
                    padding: 3,
                  }}
                >
                  <div style={{ fontSize: "0.7em", color: "#888" }}>
                    {SLOT_LABEL[slot]} {SLOT_TIME[slot]}
                  </div>
                  {items.map((s) => (
                    <div
                      key={s.id}
                      draggable
                      onDragStart={() => setDragId(s.id)}
                      style={{
                        border: `2px solid ${s.title.startsWith("RACE") ? "#dc2626" : SPORT_COLOR[s.sport]}`,
                        borderRadius: 6,
                        padding: "3px 6px",
                        fontSize: "0.75em",
                        marginTop: 3,
                        cursor: "grab",
                        background: "#fff",
                      }}
                    >
                      <strong>{s.title}</strong>
                      <div>
                        {fmtDur(s.durationMin)} · ~{Math.round(s.estimatedLoad)} load
                        {s.isQuality ? " · hard" : ""}
                      </div>
                      {s.structure?.reps?.map((r, i) => (
                        <div key={i} style={{ color: "#555" }}>
                          {r.count}×{r.work} @ {r.target}
                        </div>
                      ))}
                      {s.intent && <div style={{ color: "#555" }}>{s.intent}</div>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function DayView({
  planned,
  completed,
  focus,
}: {
  planned: PlannedItem[];
  completed: CompletedItem[];
  focus: string;
}) {
  const dayPlanned = planned.filter((s) => s.date === focus);
  const dayDone = completed.filter((c) => c.date === focus);
  if (dayPlanned.length === 0 && dayDone.length === 0) {
    return (
      <p>
        <strong>{focus}</strong> — rest day. Nothing planned.
      </p>
    );
  }
  return (
    <div>
      <h2>{focus}</h2>
      {dayDone.map((c) => (
        <div
          key={c.id}
          style={{
            borderLeft: `6px solid ${SPORT_COLOR[c.sport]}`,
            background: "#f6f6f6",
            borderRadius: 6,
            padding: "0.6rem 0.8rem",
            marginBottom: "0.6rem",
          }}
        >
          <strong>✓ Completed {c.sport}</strong> — {fmtDur(c.durationMin)}
          {c.distanceM != null && `, ${(c.distanceM / 1000).toFixed(1)} km`}
          {c.load != null && `, load ${Math.round(c.load)}`}
        </div>
      ))}
      {dayPlanned.map((s) => (
        <div
          key={s.id}
          style={{
            border: `2px solid ${s.title.startsWith("RACE") ? "#dc2626" : SPORT_COLOR[s.sport]}`,
            borderRadius: 8,
            padding: "0.6rem 0.8rem",
            marginBottom: "0.6rem",
            opacity: s.status === "PLANNED" ? 1 : 0.6,
          }}
        >
          <strong>{s.title}</strong> — {SLOT_LABEL[s.slot]} {SLOT_TIME[s.slot]},{" "}
          {fmtDur(s.durationMin)}, ~{Math.round(s.estimatedLoad)} load
          <span style={{ color: "#888" }}> · {s.phase}</span>
          {s.status !== "PLANNED" && <em> ({s.status.toLowerCase()})</em>}
          {s.structure && (
            <div style={{ marginTop: 4 }}>
              {s.structure.warmup && <div>Warmup: {s.structure.warmup}</div>}
              {s.structure.reps?.map((r, i) => (
                <div key={i}>
                  <strong>
                    {r.count} × {r.work}
                  </strong>{" "}
                  @ {r.target}, recovery {r.recovery}
                </div>
              ))}
              {s.structure.cooldown && <div>Cooldown: {s.structure.cooldown}</div>}
              {s.structure.fallback && (
                <div style={{ color: "#92400e" }}>Fallback: {s.structure.fallback}</div>
              )}
            </div>
          )}
          {s.intent && <div style={{ marginTop: 4 }}>{s.intent}</div>}
          <div style={{ marginTop: 4, color: "#b91c1c", fontSize: "0.85em" }}>
            ⛔ {s.stopRule}
          </div>
        </div>
      ))}
    </div>
  );
}
