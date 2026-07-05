// Every tunable constant lives here. Edit values, then run
// `npm run recompute-load` to rebuild load scores for stored sessions.

export const config = {
  // Local timezone used to bucket sessions into days for CTL/ATL.
  timezone: "Europe/Berlin",

  // Athlete anchors (source of truth for zones and load).
  anchors: {
    runThresholdSecPerKm: 245, // 4:05 /km
    ftpWatts: 272,
    swimEasySecPer100m: 130, // 2:10 /100m
  },

  heart: {
    // TUNE ME: defaults, not measured values. Used only by the TRIMP
    // fallback when a session has HR but no power/pace.
    maxHr: 185,
    restHr: 45,
    // Scales Banister TRIMP into TSS-comparable units (see LOAD.md).
    trimpScale: 0.6,
  },

  // Real time slots — sessions may only be scheduled into these.
  availability: {
    lunch: { start: "12:30", maxMin: 90 }, // the "1:30" lunch break
    evening: { start: "17:30", latestEnd: "21:00", maxMin: 90 },
    weekendMorning: { start: "09:00" }, // no cap
    noEveningDays: [5], // ISO weekday: 5 = Friday (lunch long run day)
  },

  // Race arc (periodise backwards from these).
  races: [
    { name: "Erkner 70.3", date: "2026-09-13", priority: "B" },
    { name: "Turin Half Marathon (unconfirmed)", date: "2026-11-29", priority: "C" },
    { name: "Jesolo 70.3", date: "2027-05-02", priority: "B" },
    { name: "Ironman Klagenfurt", date: "2027-06-27", priority: "A" },
  ],

  guardrails: {
    rampCapPerWeek: { RETURN: 5, BUILD: 7 }, // max CTL gain per week
    runVolumeIncreaseCap: 0.1, // +10% w/w once running resumes
    minEasyOrRestDaysPer7: 2,
    defaultStopRule:
      "Stop if calf/shin pain > 3/10, pain that changes gait, or sharp pain of any kind.",
  },

  plan: {
    taperDays: 10, // volume reduction window before the target race
    easyWeeks: 2, // opening RETURN weeks: everything easy
    weeklyGrowth: 1.07, // volume growth before the ramp cap clamps it
    firstWeekBikeMin: 200, // total bike minutes in week 1
    maxWeekBikeMin: 480,
    swimMinPerSession: 45,
    // Estimated intensity factors for planned session load (IF² model).
    estIf: { easy: 0.62, longRide: 0.68, quality: 0.82, openWater: 0.7 },
  },

  load: {
    npRollingWindowSec: 30, // normalized power window
    // Last-resort load per hour when a session has no power, pace or HR.
    fallbackLoadPerHour: { BIKE: 50, RUN: 60, SWIM: 50, OTHER: 40 } as Record<
      string,
      number
    >,
    ctlDays: 42, // CTL EWMA time constant
    atlDays: 7, // ATL EWMA time constant
    ctlSeed: 0, // starting CTL before the first stored session
    rampWindowDays: 7, // rampRate = CTL(today) - CTL(today - window)
  },

  zones: {
    // Run zones as % of threshold pace (time per km; higher % = slower).
    // Contiguous bands, TrainingPeaks-style defaults.
    runPctOfThresholdPace: [
      { name: "Z1 Recovery", from: 1.29, to: null },
      { name: "Z2 Endurance", from: 1.14, to: 1.29 },
      { name: "Z3 Tempo", from: 1.06, to: 1.14 },
      { name: "Z4 Threshold", from: 0.99, to: 1.06 },
      { name: "Z5 VO2max", from: 0.9, to: 0.99 },
      { name: "Z6 Anaerobic", from: null, to: 0.9 },
    ],
    // Coggan power zones as % of FTP (contiguous boundaries).
    bikePctOfFtp: [
      { name: "Z1 Active Recovery", from: null, to: 0.55 },
      { name: "Z2 Endurance", from: 0.55, to: 0.75 },
      { name: "Z3 Tempo", from: 0.75, to: 0.9 },
      { name: "Z4 Threshold", from: 0.9, to: 1.05 },
      { name: "Z5 VO2max", from: 1.05, to: 1.2 },
      { name: "Z6 Anaerobic", from: 1.2, to: 1.5 },
      { name: "Z7 Neuromuscular", from: 1.5, to: null },
    ],
    // Swim bands as % of the EASY anchor pace (time per 100m).
    // Confirmed 2026-07: shifted 7% faster than the original derivation.
    swimPctOfEasyPace: [
      { name: "Easy (pull)", from: 0.93, to: null },
      { name: "Steady", from: 0.88, to: 0.93 },
      { name: "Threshold", from: 0.83, to: 0.88 },
      { name: "Fast / VO2", from: 0.77, to: 0.83 },
      { name: "Sprint", from: null, to: 0.77 },
    ],
  },
} as const;
