// Stations we monitor. v1 is just 345, but the API carries the id in the path
// so adding more later is non-breaking. Capacity is the nominal dock count.
export interface Station {
  id: string;
  name: string;
  capacity: number;
  lat: number;
  lon: number;
}

export const STATIONS: Record<string, Station> = {
  "345": {
    id: "345",
    name: "Regina / de Verdun",
    capacity: 19,
    lat: 45.46734390596128,
    lon: -73.57078850269318,
  },
};

export const DEFAULT_STATION = STATIONS["345"];

// Public-safe view of a station (everything here is already public data).
export function publicStation(s: Station) {
  return { id: s.id, name: s.name, capacity: s.capacity, lat: s.lat, lon: s.lon };
}
