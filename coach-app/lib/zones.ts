// Zone tables derived from the anchors in config.ts.
// Presented for confirmation before any planned session uses them.

import { config } from "./config";

export interface ZoneRow {
  name: string;
  range: string; // human-readable, metric units
  detail: string; // the % rule that produced it
}

export function fmtPace(secPerUnit: number): string {
  const s = Math.round(secPerUnit);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Run pace zones from threshold pace (min/km). Higher % = slower. */
export function runZones(): ZoneRow[] {
  const thr = config.anchors.runThresholdSecPerKm;
  return config.zones.runPctOfThresholdPace.map((z) => {
    const slow = z.from != null ? fmtPace(thr * z.from) : null;
    const fast = z.to != null ? fmtPace(thr * z.to) : null;
    return {
      name: z.name,
      range:
        slow && fast
          ? `${fast}–${slow} /km`
          : slow
            ? `slower than ${slow} /km`
            : `faster than ${fast} /km`,
      detail:
        z.from != null && z.to != null
          ? `${Math.round(z.from * 100)}–${Math.round(z.to * 100)}% of threshold pace`
          : z.from != null
            ? `>${Math.round(z.from * 100)}% of threshold pace`
            : `<${Math.round(z.to! * 100)}% of threshold pace`,
    };
  });
}

/** Coggan power zones from FTP (watts). */
export function bikeZones(): ZoneRow[] {
  const ftp = config.anchors.ftpWatts;
  return config.zones.bikePctOfFtp.map((z) => {
    const lo = z.from != null ? Math.round(ftp * z.from) : null;
    const hi = z.to != null ? Math.round(ftp * z.to) : null;
    return {
      name: z.name,
      range:
        lo != null && hi != null
          ? `${lo}–${hi} W`
          : lo != null
            ? `above ${lo} W`
            : `below ${hi} W`,
      detail:
        z.from != null && z.to != null
          ? `${Math.round(z.from * 100)}–${Math.round(z.to * 100)}% FTP`
          : z.from != null
            ? `>${Math.round(z.from * 100)}% FTP`
            : `<${Math.round(z.to! * 100)}% FTP`,
    };
  });
}

/** Swim pace bands from the easy anchor (min/100m). Higher % = slower. */
export function swimZones(): ZoneRow[] {
  const easy = config.anchors.swimEasySecPer100m;
  return config.zones.swimPctOfEasyPace.map((z) => {
    const slow = z.from != null ? fmtPace(easy * z.from) : null;
    const fast = z.to != null ? fmtPace(easy * z.to) : null;
    return {
      name: z.name,
      range:
        slow && fast
          ? `${fast}–${slow} /100m`
          : slow
            ? `${slow} /100m and slower`
            : `faster than ${fast} /100m`,
      detail:
        z.from != null && z.to != null
          ? `${Math.round(z.from * 100)}–${Math.round(z.to * 100)}% of easy pace`
          : z.from != null
            ? `≥${Math.round(z.from * 100)}% of easy pace`
            : `<${Math.round(z.to! * 100)}% of easy pace`,
    };
  });
}
