// Pure functions over ordered observations. No DB / no I/O so they're easy to
// reason about and reuse. All wall-clock bucketing is timezone-aware.

export interface ObsRow {
  ts: number;
  bikes: number;
  ebikes: number;
  cargo?: number | null;
  docks: number;
  is_renting?: number | null;
  is_returning?: number | null;
  is_installed?: number | null;
}

export type Status = "empty" | "low" | "full" | "ok";

export function deriveStatus(bikes: number, docks: number): Status {
  if (bikes <= 0) return "empty";
  if (docks <= 0) return "full";
  if (bikes <= 3) return "low";
  return "ok";
}

// ---------- timezone helpers ----------

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun..6=Sat
  dateStr: string; // YYYY-MM-DD (local)
}

// Constructing an Intl.DateTimeFormat costs orders of magnitude more than using
// one — doing it per localParts call blew the Workers CPU budget (1102 errors on
// /stats), so formatters are cached per timezone.
const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = FMT_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour12: false,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    FMT_CACHE.set(tz, f);
  }
  return f;
}

export function localParts(epoch: number, tz: string): LocalParts {
  const fmt = formatterFor(tz);
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(epoch * 1000))) p[part.type] = part.value;
  const hour = parseInt(p.hour, 10) % 24; // some platforms emit "24" at midnight
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour,
    minute: +p.minute,
    second: +p.second,
    weekday: WD.indexOf(p.weekday),
    dateStr: `${p.year}-${p.month}-${p.day}`,
  };
}

// Inverse of localParts: epoch for a given local wall-clock time. Converges in a
// couple of iterations and is DST-correct away from the transition instant.
export function wallToEpoch(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  tz: string,
): number {
  let guess = Math.floor(Date.UTC(y, m - 1, d, hh, mm, 0) / 1000);
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const shown = Math.floor(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000);
    const want = Math.floor(Date.UTC(y, m - 1, d, hh, mm, 0) / 1000);
    guess += want - shown;
  }
  return guess;
}

// Local weekday/hour/date are constant within a quarter-hour (every real UTC
// offset is a multiple of 15 min), so wall-clock boundaries are plain epoch
// arithmetic and the Intl lookup memoizes per bucket. The memo is module-level
// because bucket facts are immutable: a warm isolate serves repeated dashboard
// polls with near-zero Intl work. Cleared if it ever balloons (multi-tz abuse).
const BUCKET_PARTS = new Map<string, LocalParts>();
function bucketParts(epoch: number, tz: string): LocalParts {
  const k = Math.floor(epoch / 900);
  const key = `${tz}:${k}`;
  let p = BUCKET_PARTS.get(key);
  if (!p) {
    if (BUCKET_PARTS.size > 50_000) BUCKET_PARTS.clear();
    p = localParts(k * 900, tz);
    BUCKET_PARTS.set(key, p);
  }
  return p;
}

// ---------- episodes ----------

export interface Episode {
  start: number;
  end: number | null;
  seconds: number;
  ongoing: boolean;
}

export function computeEpisodes(rows: ObsRow[], type: "empty" | "full", now: number): Episode[] {
  const cond = (r: ObsRow) => (type === "empty" ? r.bikes <= 0 : r.docks <= 0);
  const eps: Episode[] = [];
  let start: number | null = null;
  for (const r of rows) {
    if (cond(r)) {
      if (start == null) start = r.ts;
    } else if (start != null) {
      eps.push({ start, end: r.ts, seconds: r.ts - start, ongoing: false });
      start = null;
    }
  }
  if (start != null) eps.push({ start, end: null, seconds: now - start, ongoing: true });
  return eps.reverse(); // most recent first
}

// ---------- step intervals (value held until next change) ----------

interface Interval {
  t0: number;
  t1: number;
  bikes: number;
  docks: number;
}

function toIntervals(rows: ObsRow[], now: number): Interval[] {
  const out: Interval[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const t1 = i + 1 < rows.length ? rows[i + 1].ts : now;
    if (t1 > r.ts) out.push({ t0: r.ts, t1, bikes: r.bikes, docks: r.docks });
  }
  return out;
}

function grid(fill: number | null = 0): (number | null)[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => fill));
}

// ---------- stats (heatmap + morning behaviour) ----------

export interface StatsOptions {
  tz: string;
  now: number;
  windowStartHour: number; // e.g. 6
  windowEndHour: number; // e.g. 11
  targetTime: string; // "HH:MM"
  holidayName?: (dateStr: string) => string | null; // local YYYY-MM-DD -> holiday name
}

export function computeStats(rows: ObsRow[], opt: StatsOptions) {
  const intervals = toIntervals(rows, opt.now);

  // Holidays aren't typical weekdays: any date the checker names is left out of
  // every aggregate below, and reported so clients can mark the exclusion. Only
  // dates that actually carry data end up in `excluded`.
  const excluded = new Map<string, string>();
  const isHoliday = (ds: string): boolean => {
    const name = opt.holidayName?.(ds);
    if (name) excluded.set(ds, name);
    return !!name;
  };

  const partsAt = (t: number): LocalParts => bucketParts(t, opt.tz);

  // Heatmap: duration-weighted, split at local-hour boundaries.
  const dur = grid(0) as number[][];
  const bikeW = grid(0) as number[][];
  const emptyW = grid(0) as number[][];
  for (const iv of intervals) {
    let t = iv.t0;
    while (t < iv.t1) {
      const p = partsAt(t);
      const segEnd = Math.min(iv.t1, (Math.floor(t / 900) + 1) * 900);
      const d = segEnd - t;
      if (d > 0 && p.weekday >= 0 && !isHoliday(p.dateStr)) {
        dur[p.weekday][p.hour] += d;
        bikeW[p.weekday][p.hour] += iv.bikes * d;
        if (iv.bikes <= 0) emptyW[p.weekday][p.hour] += d;
      }
      t = segEnd;
    }
  }
  const avgBikes = grid(null);
  const pctEmpty = grid(null);
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      if (dur[w][h] > 0) {
        avgBikes[w][h] = bikeW[w][h] / dur[w][h];
        pctEmpty[w][h] = emptyW[w][h] / dur[w][h];
      }
    }
  }

  // Value of the step function at an arbitrary epoch (binary search).
  const valueAt = (epoch: number): Interval | null => {
    let lo = 0;
    let hi = intervals.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const iv = intervals[mid];
      if (epoch < iv.t0) hi = mid - 1;
      else if (epoch >= iv.t1) lo = mid + 1;
      else return iv;
    }
    return null;
  };

  // Morning behaviour, weekdays only.
  const [tH, tM] = opt.targetTime.split(":").map(Number);
  const firstEmptyMins: number[] = [];
  let emptyByTarget = 0;
  let targetMornings = 0;

  const dates = new Set<string>();
  for (const iv of intervals) {
    dates.add(partsAt(iv.t0).dateStr);
    dates.add(partsAt(iv.t1 - 1).dateStr);
  }
  for (const ds of dates) {
    const [y, m, d] = ds.split("-").map(Number);
    const dow = localParts(wallToEpoch(y, m, d, 12, 0, opt.tz), opt.tz).weekday;
    if (dow === 0 || dow === 6 || isHoliday(ds)) continue; // weekdays only, holidays out

    const wStart = wallToEpoch(y, m, d, opt.windowStartHour, 0, opt.tz);
    const wEnd = wallToEpoch(y, m, d, opt.windowEndHour, 0, opt.tz);
    let firstEmpty: number | null = null;
    for (const iv of intervals) {
      if (iv.t1 <= wStart || iv.t0 >= wEnd) continue;
      if (iv.bikes <= 0) {
        const s = Math.max(iv.t0, wStart);
        firstEmpty = firstEmpty == null ? s : Math.min(firstEmpty, s);
      }
    }
    if (firstEmpty != null) {
      const p = localParts(firstEmpty, opt.tz);
      firstEmptyMins.push(p.hour * 60 + p.minute);
    }

    // "empty by target" = bikes hit 0 at any point between window start and the
    // target time — not just at the target instant, which reads 0% whenever a
    // single bike happens to be docked right then (firstEmpty is clamped to the
    // window start, so overnight emptiness lasting into the window counts too).
    const target = wallToEpoch(y, m, d, tH, tM, opt.tz);
    if (valueAt(target)) {
      targetMornings++;
      if (firstEmpty != null && firstEmpty <= target) emptyByTarget++;
    }
  }

  // Longest empty streak across the whole range.
  let longest = 0;
  let estart: number | null = null;
  for (const r of rows) {
    if (r.bikes <= 0) {
      if (estart == null) estart = r.ts;
    } else if (estart != null) {
      longest = Math.max(longest, r.ts - estart);
      estart = null;
    }
  }
  if (estart != null) longest = Math.max(longest, opt.now - estart);

  // When do bikes actually run out? First transition (had bikes -> zero) per local
  // day, averaged by weekday — so the heatmap can mark the typical run-out moment.
  const firstRunout = new Map<string, number>(); // local date -> epoch of first runout
  let prevBikes: number | null = null;
  for (const iv of intervals) {
    if (prevBikes != null && prevBikes > 0 && iv.bikes <= 0) {
      const ds = partsAt(iv.t0).dateStr;
      if (!firstRunout.has(ds) && !isHoliday(ds)) firstRunout.set(ds, iv.t0);
    }
    prevBikes = iv.bikes;
  }
  const runAcc = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  for (const epoch of firstRunout.values()) {
    const p = localParts(epoch, opt.tz);
    runAcc[p.weekday].sum += p.hour * 60 + p.minute;
    runAcc[p.weekday].n += 1;
  }
  const runoutByDow = runAcc.map((a) =>
    a.n
      ? { minutes: Math.round(a.sum / a.n), time: minsToHHMM(Math.round(a.sum / a.n)), days: a.n }
      : { minutes: null, time: null, days: 0 },
  );
  // overall weekday average run-out time (for the dotted reference line)
  const wkRunout: number[] = [];
  for (const epoch of firstRunout.values()) {
    const p = localParts(epoch, opt.tz);
    if (p.weekday >= 1 && p.weekday <= 5) wkRunout.push(p.hour * 60 + p.minute);
  }
  const runoutAvg = wkRunout.length
    ? { minutes: Math.round(avg(wkRunout)), time: minsToHHMM(Math.round(avg(wkRunout))), days: wkRunout.length }
    : { minutes: null, time: null, days: 0 };

  return {
    heatmap: { days: WD, avgBikes, pctEmpty, coverageSeconds: dur },
    morning: {
      window: [hhmm(opt.windowStartHour, 0), hhmm(opt.windowEndHour, 0)],
      targetTime: opt.targetTime,
      typicalFirstEmpty: firstEmptyMins.length ? minsToHHMM(Math.round(avg(firstEmptyMins))) : null,
      sampleDays: firstEmptyMins.length,
      pctEmptyByTarget: targetMornings ? emptyByTarget / targetMornings : null,
      mornings: targetMornings,
      runoutByDow, // [dow 0=Sun..6=Sat] { minutes, time, days } — avg time bikes hit 0
      runoutAvg, // weekday-wide average run-out time { minutes, time, days }
    },
    excludedHolidays: [...excluded]
      .map(([date, name]) => ({ date, name }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    longestEmptyMinutes: Math.round(longest / 60),
  };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function minsToHHMM(mins: number): string {
  return hhmm(Math.floor(mins / 60) % 24, mins % 60);
}
