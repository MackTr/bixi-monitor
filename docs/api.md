# BIXI Monitor API — `/api/v1`

Read-only JSON over HTTPS. **CORS open** (`Access-Control-Allow-Origin: *`), so any app
(web or mobile) can consume it directly. Timestamps are ISO-8601 UTC. The station id is in the
path, so more stations can be added without breaking this contract.

Base URL: `https://<your-worker>.workers.dev/api/v1` (or `http://localhost:8787/api/v1` in dev).

## Endpoints

### `GET /health`
Collector liveness. `ok` is false if the last write is older than 10 minutes.
```json
{ "ok": true, "lastWriteAt": "2026-06-26T15:01:00Z", "lastWriteAgeSeconds": 42,
  "totalObservations": 1234, "serverTime": "2026-06-26T15:01:42Z" }
```

### `GET /stations`
```json
{ "stations": [ { "id": "345", "name": "Regina / de Verdun", "capacity": 19, "lat": 45.4673, "lon": -73.5708 } ] }
```

### `GET /stations/{id}/now`
Latest observation + derived status. `status` ∈ `empty | low | full | ok` (empty = 0 bikes,
full = 0 docks, low = ≤3 bikes). `mechanical = bikes − ebikes − trailer`. `Cache-Control: max-age=15`.
```json
{ "station": { "id": "345", "name": "Regina / de Verdun", "capacity": 19 },
  "observedAt": "2026-06-26T15:01:00Z", "ageSeconds": 30, "stale": false,
  "status": "ok", "bikes": 18, "ebikes": 1, "trailer": 1, "mechanical": 16,
  "docksAvailable": 0, "bikesDisabled": 1, "isRenting": true, "isReturning": true, "isInstalled": true }
```

### `GET /stations/{id}/observations?from&to&limit`
Raw series for charts. `from`/`to` accept ISO-8601 or epoch (s or ms); default = last 24h.
`limit` default 5000, max 20000. Returned ascending by time.
```json
{ "station": "345", "capacity": 19, "from": "...", "to": "...", "count": 120,
  "observations": [ { "t": "2026-06-26T14:00:00Z", "ts": 1782484800, "bikes": 3,
    "ebikes": 1, "trailer": 0, "mechanical": 2, "docks": 16, "status": "ok" } ] }
```

### `GET /stations/{id}/episodes?type&days`
Maximal empty/full runs. `type` ∈ `empty | full` (default `empty`). `days` 1–365 (default 30).
Most recent first; an open episode has `end: null, ongoing: true`.
```json
{ "station": "345", "type": "empty", "days": 30, "count": 8,
  "episodes": [ { "start": "...", "end": "...", "ongoing": false, "minutes": 93 } ] }
```

### `GET /stations/{id}/stats?days&tz`
Heatmap + weekday-morning behaviour. `tz` default `America/Toronto`. Heatmap grids are
`[weekday 0=Sun..6=Sat][hour 0..23]`; `avgBikes`/`pctEmpty` may be `null` where there's no coverage.
`morning.runoutByDow[0..6]` is the **average time bikes run out** (first had-bikes→zero transition)
for each weekday, as minutes-since-midnight + `"HH:MM"`, with the day count (`null` if it never did).
`morning.runoutAvg` is the single weekday-wide average of that (drives the dotted reference line).
`morning.pctEmptyByTarget` is the share of weekday mornings where bikes hit 0 **at any point**
between the window start and `targetTime` — not a snapshot at the target instant.
All aggregates **exclude Quebec statutory holidays** (computed server-side from the local date —
a holiday Wednesday isn't a typical Wednesday); the excluded dates that had data in the window
are listed in `excludedHolidays`. Episodes and raw observations are unaffected.
```json
{ "station": "345", "days": 30, "tz": "America/Toronto", "capacity": 19,
  "heatmap": { "days": ["Sun","Mon",...], "avgBikes": [[...24]], "pctEmpty": [[...24]], "coverageSeconds": [[...24]] },
  "morning": { "window": ["06:00","11:00"], "targetTime": "08:30",
    "typicalFirstEmpty": "08:12", "sampleDays": 9, "pctEmptyByTarget": 0.67, "mornings": 12,
    "runoutByDow": [ { "minutes": null, "time": null, "days": 0 }, { "minutes": 486, "time": "08:06", "days": 8 } ],
    "runoutAvg": { "minutes": 486, "time": "08:06", "days": 10 } },
  "excludedHolidays": [ { "date": "2026-07-01", "name": "Canada Day" } ],
  "longestEmptyMinutes": 214 }
```

## Notes
- Data comes from the GBFS **2-2** feed, which exposes `vehicle_types` + a per-station
  `vehicle_types_available` breakdown. `num_bikes_available` **includes** ebikes and trailer bikes,
  so **`mechanical = bikes − ebikes − trailer`**. `trailer` = bikes with `form_factor: cargo_bicycle`
  (GBFS's term; `vehicle_type_id 14`), which the legacy feed silently folded into the plain count.
- Observations are stored **on change** (+ a ≥15-min heartbeat), so charts should **step-hold** the
  last value forward — that's the true station behaviour, not interpolation.
