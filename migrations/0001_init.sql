-- One row per recorded state change (plus a heartbeat at least every 15 min).
-- Counts come straight from GBFS station_status; num_bikes_available INCLUDES
-- ebikes, so mechanical = bikes - ebikes (derived at query time).
CREATE TABLE IF NOT EXISTS observations (
  ts             INTEGER NOT NULL,  -- unix epoch (UTC) when we recorded it
  station_id     TEXT    NOT NULL DEFAULT '345',
  last_reported  INTEGER,           -- station's own last_reported
  bikes          INTEGER NOT NULL,  -- num_bikes_available (INCLUDES ebikes)
  ebikes         INTEGER NOT NULL,  -- num_ebikes_available
  docks          INTEGER NOT NULL,  -- num_docks_available
  bikes_disabled INTEGER,
  docks_disabled INTEGER,
  is_renting     INTEGER,
  is_returning   INTEGER,
  is_installed   INTEGER,
  changed        INTEGER NOT NULL   -- 1 = real change, 0 = heartbeat
);

CREATE INDEX IF NOT EXISTS idx_obs_station_ts ON observations(station_id, ts);
CREATE INDEX IF NOT EXISTS idx_obs_ts ON observations(ts);
