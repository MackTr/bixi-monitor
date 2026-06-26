// Dev-only: generate ~14 days of plausible on-change history for station 345 so
// the local dashboard can be exercised before real data accumulates. Prints SQL
// to stdout. Usage: node scripts/seed.mjs > /tmp/seed.sql
const TZ = "America/Toronto";
const CAP = 19,
  DISABLED = 1,
  MAXB = CAP - DISABLED; // 18 usable docks
const DAYS = 14;
const now = Math.floor(Date.now() / 1000);
const start = now - DAYS * 86400;

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  hour12: false,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});
function local(epoch) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(epoch * 1000)).map((x) => [x.type, x.value]));
  return { hour: +p.hour % 24, minute: +p.minute, weekend: p.weekday === "Sat" || p.weekday === "Sun" };
}

// Hourly anchor bike counts. Residential station: full overnight, drains hard in
// the morning commute (empty ~8am), refills midday/evening.
const WEEKDAY = [16, 16, 17, 17, 16, 14, 11, 6, 1, 0, 1, 3, 5, 6, 7, 9, 11, 13, 15, 16, 17, 16, 16, 16];
const WEEKEND = [15, 15, 16, 16, 15, 14, 13, 12, 10, 8, 7, 6, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 15];
function target(epoch) {
  const { hour, minute, weekend } = local(epoch);
  const a = weekend ? WEEKEND : WEEKDAY;
  return a[hour] + (a[(hour + 1) % 24] - a[hour]) * (minute / 60);
}

let cur = 16,
  curE = 0;
const rows = [];
let lb = null,
  le = null,
  ld = null;
for (let t = start; t <= now; t += 60) {
  const tg = target(t);
  const drift = tg - cur;
  if (Math.random() < Math.min(0.9, Math.abs(drift) * 0.3 + 0.05)) {
    cur += Math.sign(drift) * (Math.random() < 0.85 ? 1 : 2);
  }
  if (Math.random() < 0.07) cur += Math.random() < 0.5 ? -1 : 1;
  cur = Math.max(0, Math.min(MAXB, Math.round(cur)));
  if (Math.random() < 0.04) curE = cur > 0 ? Math.min(cur, Math.floor(Math.random() * 3)) : 0;
  curE = Math.min(curE, cur);
  const docks = MAXB - cur;
  if (cur !== lb || curE !== le || docks !== ld) {
    rows.push([t, cur, curE, docks]);
    lb = cur;
    le = curE;
    ld = docks;
  }
}

const COLS =
  "(ts,station_id,last_reported,bikes,ebikes,docks,bikes_disabled,docks_disabled,is_renting,is_returning,is_installed,changed)";
let sql = "DELETE FROM observations;\n";
for (let i = 0; i < rows.length; i += 400) {
  const chunk = rows
    .slice(i, i + 400)
    .map(([ts, b, e, d]) => `(${ts},'345',${ts},${b},${e},${d},1,0,1,1,1,1)`)
    .join(",");
  sql += `INSERT INTO observations ${COLS} VALUES ${chunk};\n`;
}
process.stdout.write(sql);
process.stderr.write(`generated ${rows.length} rows over ${DAYS} days\n`);
