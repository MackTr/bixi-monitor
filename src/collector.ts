import type { Env } from "./worker";
import { STATIONS } from "./stations";

const FEED_URL = "https://gbfs.velobixi.com/gbfs/en/station_status.json";
const HEARTBEAT_SECONDS = 15 * 60;

// Fields whose change makes an observation worth storing.
const TRACKED = [
  "bikes",
  "ebikes",
  "docks",
  "bikes_disabled",
  "docks_disabled",
  "is_renting",
  "is_returning",
  "is_installed",
] as const;

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

// Poll the feed and store station state for every monitored station, but only
// when something changed (or a heartbeat is due). Returns one result per station.
export async function collect(env: Env): Promise<CollectResult[]> {
  const res = await fetch(FEED_URL, {
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
        (ts, station_id, last_reported, bikes, ebikes, docks,
         bikes_disabled, docks_disabled, is_renting, is_returning, is_installed, changed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        obs.ts,
        id,
        obs.last_reported,
        obs.bikes,
        obs.ebikes,
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
