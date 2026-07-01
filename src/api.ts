import type { Env } from "./worker";
import { STATIONS, publicStation, type Station } from "./stations";
import { computeEpisodes, computeStats, deriveStatus, type ObsRow } from "./analytics";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}
const fail = (status: number, message: string) => json({ error: message }, { status });
const iso = (epoch: number | null) => (epoch == null ? null : new Date(epoch * 1000).toISOString());

function parseTime(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) {
    const n = +v;
    return n > 1e12 ? Math.floor(n / 1000) : n; // tolerate ms or seconds
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}
function clampDays(v: string | null, def: number): number {
  const n = parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, 1), 365);
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "GET") return fail(405, "method not allowed");

  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean); // ["api","v1",...]
  if (parts[0] !== "api" || parts[1] !== "v1") return fail(404, "unknown api version");
  const seg = parts.slice(2);

  try {
    if (seg.length === 1 && seg[0] === "health") return await health(env);
    if (seg.length === 1 && seg[0] === "stations") {
      return json({ stations: Object.values(STATIONS).map(publicStation) });
    }
    if (seg[0] === "stations" && seg[1]) {
      const station = STATIONS[seg[1]];
      if (!station) return fail(404, `unknown station ${seg[1]}`);
      const sub = seg[2] ?? "now";
      if (sub === "now") return await now(env, station);
      if (sub === "observations") return await observations(env, station, url);
      if (sub === "episodes") return await episodes(env, station, url);
      if (sub === "stats") return await stats(env, station, url);
      return fail(404, `unknown resource ${sub}`);
    }
    return fail(404, "not found");
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "internal error");
  }
}

// ---------- row loading ----------

const ROW_COLS = "ts, bikes, ebikes, cargo, docks, is_renting, is_returning, is_installed";

// Rows in [from, to] plus the one immediately before `from` (clamped to `from`)
// so the step function has a correct value at the window's left edge.
async function loadRows(env: Env, stationId: string, from: number, to: number): Promise<ObsRow[]> {
  const prior = await env.DB.prepare(
    `SELECT ${ROW_COLS} FROM observations WHERE station_id = ? AND ts < ? ORDER BY ts DESC LIMIT 1`,
  )
    .bind(stationId, from)
    .first<ObsRow>();
  const within = await env.DB.prepare(
    `SELECT ${ROW_COLS} FROM observations WHERE station_id = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC`,
  )
    .bind(stationId, from, to)
    .all<ObsRow>();
  const rows = within.results ?? [];
  if (prior) rows.unshift({ ...prior, ts: from });
  return rows;
}

// ---------- endpoints ----------

async function now(env: Env, station: Station): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ts, last_reported, bikes, ebikes, cargo, docks, bikes_disabled, docks_disabled,
            is_renting, is_returning, is_installed
       FROM observations WHERE station_id = ? ORDER BY ts DESC LIMIT 1`,
  )
    .bind(station.id)
    .first<Record<string, number | null>>();

  if (!row) {
    return json({ station: publicStation(station), observation: null, note: "no data yet — collecting" });
  }
  const ts = row.ts as number;
  const bikes = row.bikes as number;
  const docks = row.docks as number;
  const ebikes = row.ebikes as number;
  const trailer = (row.cargo as number) ?? 0; // DB column `cargo` (GBFS cargo_bicycle), surfaced as "trailer"
  const age = Math.floor(Date.now() / 1000) - ts;
  return json(
    {
      station: publicStation(station),
      observedAt: iso(ts),
      ageSeconds: age,
      stale: age > 180,
      status: deriveStatus(bikes, docks),
      bikes,
      ebikes,
      trailer,
      mechanical: bikes - ebikes - trailer,
      docksAvailable: docks,
      bikesDisabled: row.bikes_disabled,
      docksDisabled: row.docks_disabled,
      isRenting: !!row.is_renting,
      isReturning: !!row.is_returning,
      isInstalled: !!row.is_installed,
    },
    { headers: { "Cache-Control": "public, max-age=15" } },
  );
}

async function observations(env: Env, station: Station, url: URL): Promise<Response> {
  const t = Math.floor(Date.now() / 1000);
  const from = parseTime(url.searchParams.get("from")) ?? t - 24 * 3600;
  const to = parseTime(url.searchParams.get("to")) ?? t;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "5000", 10) || 5000, 20000);

  const res = await env.DB.prepare(
    `SELECT ${ROW_COLS} FROM observations
       WHERE station_id = ? AND ts >= ? AND ts <= ?
       ORDER BY ts ASC LIMIT ?`,
  )
    .bind(station.id, from, to, limit)
    .all<ObsRow>();

  const data = (res.results ?? []).map((r) => ({
    t: iso(r.ts),
    ts: r.ts,
    bikes: r.bikes,
    ebikes: r.ebikes,
    trailer: r.cargo ?? 0,
    mechanical: r.bikes - r.ebikes - (r.cargo ?? 0),
    docks: r.docks,
    status: deriveStatus(r.bikes, r.docks),
  }));
  return json({
    station: station.id,
    capacity: station.capacity,
    from: iso(from),
    to: iso(to),
    count: data.length,
    observations: data,
  });
}

async function episodes(env: Env, station: Station, url: URL): Promise<Response> {
  const type = url.searchParams.get("type") === "full" ? "full" : "empty";
  const days = clampDays(url.searchParams.get("days"), 30);
  const t = Math.floor(Date.now() / 1000);
  const rows = await loadRows(env, station.id, t - days * 86400, t);
  const eps = computeEpisodes(rows, type, t);
  return json({
    station: station.id,
    type,
    days,
    count: eps.length,
    episodes: eps.map((e) => ({
      start: iso(e.start),
      end: e.end ? iso(e.end) : null,
      ongoing: e.ongoing,
      minutes: Math.round(e.seconds / 60),
    })),
  });
}

async function stats(env: Env, station: Station, url: URL): Promise<Response> {
  const days = clampDays(url.searchParams.get("days"), 30);
  const tz = url.searchParams.get("tz") || "America/Toronto";
  const t = Math.floor(Date.now() / 1000);
  const rows = await loadRows(env, station.id, t - days * 86400, t);
  const out = computeStats(rows, {
    tz,
    now: t,
    windowStartHour: 6,
    windowEndHour: 11,
    targetTime: "08:30",
  });
  return json({ station: station.id, days, tz, capacity: station.capacity, ...out });
}

async function health(env: Env): Promise<Response> {
  const last = await env.DB.prepare("SELECT ts FROM observations ORDER BY ts DESC LIMIT 1").first<{ ts: number }>();
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM observations").first<{ c: number }>();
  const t = Math.floor(Date.now() / 1000);
  const lastTs = last?.ts ?? null;
  const age = lastTs ? t - lastTs : null;
  return json({
    ok: age != null && age < 600,
    lastWriteAt: iso(lastTs),
    lastWriteAgeSeconds: age,
    totalObservations: count?.c ?? 0,
    serverTime: iso(t),
  });
}
