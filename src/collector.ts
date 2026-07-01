import type { Env } from "./worker";
import { STATIONS } from "./stations";

// GBFS 2-2 feed — richer than the legacy feed: it exposes vehicle_types plus a
// per-station vehicle_types_available breakdown, so cargo/trailer bikes can be
// separated from regular + e-bikes (the legacy feed folded them all into
// num_bikes_available, inflating the "mechanical" count).
const STATUS_URL = "https://gbfs.velobixi.com/gbfs/2-2/en/station_status.json";
const VEHICLE_TYPES_URL = "https://gbfs.velobixi.com/gbfs/2-2/en/vehicle_types.json";
const HEARTBEAT_SECONDS = 15 * 60;
// Fallback if the vehicle_types feed can't be fetched (as of 2026: 14 = cargo).
const FALLBACK_CARGO_IDS = new Set(["14"]);

// Fields whose change makes an observation worth storing.
const TRACKED = [
  "bikes",
  "ebikes",
  "cargo",
  "docks",
  "bikes_disabled",
  "docks_disabled",
  "is_renting",
  "is_returning",
  "is_installed",
] as const;

interface VehicleTypeCount {
  vehicle_type_id: string;
  count: number;
}
interface FeedStation {
  station_id: string;
  num_bikes_available: number;
  num_ebikes_available?: number;
  num_bikes_disabled?: number;
  num_docks_available: number;
  num_docks_disabled?: number;
  is_renting?: number;
  is_returning?: number;
  is_installed?: number;
  last_reported?: number;
  vehicle_types_available?: VehicleTypeCount[];
}

type Obs = Record<(typeof TRACKED)[number], number | null> & {
  ts: number;
  last_reported: number | null;
};

export interface CollectResult {
  inserted: boolean;
  reason: "changed" | "heartbeat" | "no-change" | "station-missing";
  stationId: string;
}

// Set of vehicle_type_ids that are cargo bikes. Edge-cached ~6h since this feed
// barely changes; falls back to the known id if the fetch fails.
async function loadCargoIds(): Promise<Set<string>> {
  try {
    const res = await fetch(VEHICLE_TYPES_URL, { cf: { cacheTtl: 21600 } });
    if (!res.ok) throw new Error(`vehicle_types ${res.status}`);
    const body = (await res.json()) as {
      data?: { vehicle_types?: { vehicle_type_id: string; form_factor: string }[] };
    };
    const ids = new Set<string>();
    for (const vt of body?.data?.vehicle_types ?? []) {
      if (vt.form_factor === "cargo_bicycle") ids.add(String(vt.vehicle_type_id));
    }
    return ids.size ? ids : FALLBACK_CARGO_IDS;
  } catch {
    return FALLBACK_CARGO_IDS;
  }
}

function cargoCount(s: FeedStation, cargoIds: Set<string>): number {
  let n = 0;
  for (const v of s.vehicle_types_available ?? []) {
    if (cargoIds.has(String(v.vehicle_type_id))) n += v.count ?? 0;
  }
  return n;
}

// Poll the feed and store station state for every monitored station, but only
// when something changed (or a heartbeat is due). Returns one result per station.
export async function collect(env: Env): Promise<CollectResult[]> {
  const cargoIds = await loadCargoIds();
  const res = await fetch(STATUS_URL, {
    headers: { "User-Agent": "bixi-monitor (personal)" },
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) throw new Error(`feed responded ${res.status}`);
  const body = (await res.json()) as { data?: { stations?: FeedStation[] } };
  const feed = body?.data?.stations ?? [];
  const now = Math.floor(Date.now() / 1000);

  const results: CollectResult[] = [];
  for (const id of Object.keys(STATIONS)) {
    const s = feed.find((x) => x.station_id === id);
    if (!s) {
      results.push({ inserted: false, reason: "station-missing", stationId: id });
      continue;
    }
    const obs: Obs = {
      ts: now,
      last_reported: s.last_reported ?? null,
      bikes: s.num_bikes_available,
      ebikes: s.num_ebikes_available ?? 0,
      cargo: cargoCount(s, cargoIds),
      docks: s.num_docks_available,
      bikes_disabled: s.num_bikes_disabled ?? null,
      docks_disabled: s.num_docks_disabled ?? null,
      is_renting: s.is_renting ?? null,
      is_returning: s.is_returning ?? null,
      is_installed: s.is_installed ?? null,
    };

    const last = await env.DB.prepare(
      `SELECT ts, ${TRACKED.join(", ")} FROM observations
       WHERE station_id = ? ORDER BY ts DESC LIMIT 1`,
    )
      .bind(id)
      .first<Record<string, number | null>>();

    const changed =
      !last || TRACKED.some((k) => (last[k] ?? null) !== (obs[k] ?? null));

    if (!changed && last && now - (last.ts as number) < HEARTBEAT_SECONDS) {
      results.push({ inserted: false, reason: "no-change", stationId: id });
      continue;
    }

    await env.DB.prepare(
      `INSERT INTO observations
        (ts, station_id, last_reported, bikes, ebikes, cargo, docks,
         bikes_disabled, docks_disabled, is_renting, is_returning, is_installed, changed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        obs.ts,
        id,
        obs.last_reported,
        obs.bikes,
        obs.ebikes,
        obs.cargo,
        obs.docks,
        obs.bikes_disabled,
        obs.docks_disabled,
        obs.is_renting,
        obs.is_returning,
        obs.is_installed,
        changed ? 1 : 0,
      )
      .run();

    results.push({
      inserted: true,
      reason: changed ? "changed" : "heartbeat",
      stationId: id,
    });
  }
  return results;
}
