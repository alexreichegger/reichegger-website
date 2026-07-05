import FitParserModule from "fit-file-parser";

// fit-file-parser ships CJS with a default export; handle both shapes.
const FitParser: any = (FitParserModule as any).default ?? FitParserModule;

export interface FitRecord {
  t: string; // ISO timestamp
  power?: number;
  hr?: number;
  speed?: number; // m/s
  cadence?: number;
  distance?: number; // m
  altitude?: number; // m
}

export interface ParsedFit {
  sport: "BIKE" | "RUN" | "SWIM" | "OTHER";
  startTime: Date;
  elapsedSec: number;
  movingSec?: number;
  distanceM?: number;
  avgPower?: number;
  maxPower?: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  avgSpeedMps?: number;
  elevationGainM?: number;
  calories?: number;
  rawSession: Record<string, unknown>;
  records: FitRecord[];
}

const SPORT_MAP: Record<string, ParsedFit["sport"]> = {
  cycling: "BIKE",
  running: "RUN",
  swimming: "SWIM",
};

export function isFitFile(buf: Buffer): boolean {
  // FIT header: byte 0 = header size, bytes 8-11 = ".FIT"
  return buf.length > 12 && buf.subarray(8, 12).toString("ascii") === ".FIT";
}

function parseRaw(buf: Buffer): Promise<any> {
  const parser = new FitParser({
    force: true,
    speedUnit: "m/s",
    lengthUnit: "m",
    temperatureUnit: "celsius",
    elapsedRecordField: true,
    mode: "both",
  });
  return new Promise((resolve, reject) => {
    parser.parse(buf, (err: string | null, data: any) => {
      if (err) reject(new Error(err));
      else resolve(data);
    });
  });
}

export async function parseFit(buf: Buffer): Promise<ParsedFit> {
  if (!isFitFile(buf)) {
    throw new Error("Not a FIT file (missing .FIT header)");
  }
  const data = await parseRaw(buf);
  const session = data.sessions?.[0] ?? data.activity?.sessions?.[0];
  const rawRecords: any[] = data.records ?? [];

  if (!session && rawRecords.length === 0) {
    throw new Error("FIT file contains no session or record data");
  }

  const records: FitRecord[] = rawRecords
    .filter((r) => r.timestamp)
    .map((r) => {
      const rec: FitRecord = { t: new Date(r.timestamp).toISOString() };
      if (r.power !== undefined) rec.power = r.power;
      if (r.heart_rate !== undefined) rec.hr = r.heart_rate;
      if (r.speed !== undefined) rec.speed = r.speed;
      if (r.cadence !== undefined) rec.cadence = r.cadence;
      if (r.distance !== undefined) rec.distance = r.distance;
      if (r.altitude !== undefined) rec.altitude = r.altitude;
      return rec;
    });

  const startTime = session?.start_time
    ? new Date(session.start_time)
    : new Date(records[0].t);
  const lastRecord = records[records.length - 1];
  const elapsedSec =
    session?.total_elapsed_time ??
    (records.length > 1
      ? (new Date(lastRecord.t).getTime() - startTime.getTime()) / 1000
      : 0);

  return {
    sport: SPORT_MAP[session?.sport] ?? "OTHER",
    startTime,
    elapsedSec,
    movingSec: session?.total_timer_time,
    distanceM: session?.total_distance ?? lastRecord?.distance,
    avgPower: session?.avg_power,
    maxPower: session?.max_power,
    avgHr: session?.avg_heart_rate,
    maxHr: session?.max_heart_rate,
    avgCadence: session?.avg_cadence,
    avgSpeedMps: session?.avg_speed,
    elevationGainM: session?.total_ascent,
    calories: session?.total_calories,
    rawSession: session ?? {},
    records,
  };
}
