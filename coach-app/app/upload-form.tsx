"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function UploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setBusy(true);
    setStatus(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${json.error}`);
      } else {
        setStatus(
          `Saved ${json.session.sport} session (${json.recordCount} records).`
        );
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch (err) {
      setStatus(`Upload failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input ref={fileRef} type="file" accept=".fit" required />
      <button type="submit" disabled={busy} style={{ marginLeft: "0.5rem" }}>
        {busy ? "Uploading…" : "Upload"}
      </button>
      {status && <p>{status}</p>}
    </form>
  );
}
