"use client";

import { useEffect, useRef, useState } from "react";

interface MutationResult {
  rationale: string;
  applied: { type: string; summary: string }[];
  rejected: { type: string; summary: string; reasons: string[] }[];
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  mutation?: MutationResult | null;
}

function MutationCard({ m }: { m: MutationResult }) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: "0.5rem 0.7rem",
        marginTop: 6,
        fontSize: "0.85em",
        background: "#fafafa",
      }}
    >
      <div style={{ color: "#555" }}>Plan change: {m.rationale}</div>
      {m.applied.map((a, i) => (
        <div key={i} style={{ color: "#166534" }}>
          ✓ {a.summary}
        </div>
      ))}
      {m.rejected.map((r, i) => (
        <div key={i} style={{ color: "#b91c1c" }}>
          ✗ {r.summary} — {r.reasons.join(" ")}
        </div>
      ))}
    </div>
  );
}

export function ChatClient() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await fetch("/api/chat");
    const json = await res.json();
    setMessages(json.messages ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content: text }]);
    setInput("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = await res.json();
      if (res.ok) {
        setMessages((m) => [
          ...m,
          { id: `a-${Date.now()}`, role: "assistant", content: json.text, mutation: json.mutation },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          { id: `e-${Date.now()}`, role: "assistant", content: `Error: ${json.error}` },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  // .fit upload inside the chat flow: upload, then tell the coach about it.
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body });
    const json = await res.json();
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) {
      setMessages((m) => [
        ...m,
        { id: `u-${Date.now()}`, role: "assistant", content: `Upload failed: ${json.error}` },
      ]);
      return;
    }
    const s = json.session;
    const km = s.distanceM != null ? `, ${(s.distanceM / 1000).toFixed(1)} km` : "";
    const load = s.load != null ? `, load ${Math.round(s.load)}` : "";
    await send(
      `Uploaded ${s.sport} session from ${s.startTime.slice(0, 10)}: ${Math.round(s.elapsedSec / 60)} min${km}${load}.`
    );
  }

  return (
    <div>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: "0.8rem",
          height: 480,
          overflowY: "auto",
          background: "#fff",
        }}
      >
        {messages.length === 0 && <p style={{ color: "#888" }}>Loading…</p>}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              margin: "0.5rem 0",
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "0.5rem 0.8rem",
                borderRadius: 10,
                background: m.role === "user" ? "#2563eb" : "#f1f5f9",
                color: m.role === "user" ? "#fff" : "#111",
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
              {m.mutation && <MutationCard m={m.mutation} />}
            </div>
          </div>
        ))}
        {busy && <p style={{ color: "#888" }}>Coach is thinking…</p>}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        style={{ display: "flex", gap: 8, marginTop: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Check in, report pain/conditions, ask for changes…"
          style={{ flex: 1, padding: "0.5rem 0.7rem", borderRadius: 8, border: "1px solid #ccc" }}
        />
        <button type="submit" disabled={busy}>
          Send
        </button>
        <label
          style={{
            border: "1px solid #ccc",
            borderRadius: 8,
            padding: "0.5rem 0.7rem",
            cursor: "pointer",
            fontSize: "0.9em",
          }}
        >
          + .fit
          <input ref={fileRef} type="file" accept=".fit" onChange={onUpload} hidden />
        </label>
      </form>
    </div>
  );
}
