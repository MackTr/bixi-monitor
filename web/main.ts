// Dashboard = first client of the /api/v1 contract. Zero deps; charts are SVG.
const STATION = "345";
const TZ = "America/Toronto";
const api = (path: string) => fetch(`/api/v1/stations/${STATION}/${path}`).then((r) => r.json());

const $ = (id: string) => document.getElementById(id)!;

// ---------- formatting ----------
const pad = (n: number) => String(n).padStart(2, "0");
function relTime(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} d ago`;
}
function clockLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-CA", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function durLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${pad(mins % 60)}m`;
}
const STATUS_LABEL: Record<string, string> = { empty: "Empty", low: "Low", full: "Full", ok: "Available" };

// ---------- colormaps ----------
type Stops = [number, number, number][];
function lerpStops(stops: Stops, t: number): string {
  t = Math.max(0, Math.min(1, t));
  const x = t * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  const c = (k: number) => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}
// magma — perceptually uniform, colorblind/grayscale safe. Used for "avg bikes".
const MAGMA: Stops = [
  [0, 0, 4],
  [28, 16, 68],
  [79, 18, 123],
  [129, 37, 129],
  [181, 54, 122],
  [229, 80, 100],
  [251, 135, 97],
  [254, 194, 135],
  [252, 253, 191],
];
const magma = (t: number) => lerpStops(MAGMA, t);
// emptiness ramp — recedes (dark) when bikes are usually present, glows hot red
// when the station is chronically empty, so "no bikes" pops off the page.
const EMPTY_RAMP: Stops = [
  [25, 32, 48],
  [90, 40, 54],
  [156, 48, 58],
  [212, 66, 66],
  [240, 96, 80],
  [255, 138, 104],
];
const emptyColor = (t: number) => lerpStops(EMPTY_RAMP, t);

// ---------- NOW (hero) ----------
function renderHero(n: any) {
  $("stationName").textContent = n.station?.name ?? "BIXI";
  if (!n || !n.observedAt) {
    $("hero").innerHTML = `<div class="empty-note">No data yet — the collector just started. Check back in a minute.</div>`;
    return;
  }
  const cap = n.station.capacity as number;
  const mech = n.mechanical as number;
  const ebikes = n.ebikes as number;
  const trailer = (n.trailer as number) ?? 0;
  const docks = n.docksAvailable as number;
  const unavail = (n.docksDisabled as number) ?? 0; // docks out of service
  const broken = (n.bikesDisabled as number) ?? 0; // bikes out of service
  const pct = (v: number) => `${(Math.max(0, v) / cap) * 100}%`;
  const st = n.status as string;

  // Bar spans all capacity slots: usable bikes + broken bikes + unavailable docks
  // are explicit segments; the remaining track is free (returnable) docks.
  $("hero").innerHTML = `
    <div class="hero__top">
      <div class="bignum"><b>${n.bikes}</b><span>bike${n.bikes === 1 ? "" : "s"} of ${cap}</span></div>
      <span class="pill pill--${st}"><i></i>${STATUS_LABEL[st] ?? st}</span>
    </div>
    <div class="occ">
      <div class="occ__bar" role="img" aria-label="${mech} mechanical, ${ebikes} ebikes, ${trailer} trailer, ${docks} free docks, ${unavail} unavailable docks, ${broken} out-of-service bikes">
        <div class="occ__seg mech" style="width:${pct(mech)}"></div>
        <div class="occ__seg ebike" style="width:${pct(ebikes)}"></div>
        <div class="occ__seg trailer" style="width:${pct(trailer)}"></div>
        <div class="occ__seg broken" style="width:${pct(broken)}"></div>
        <div class="occ__div" role="separator" aria-label="bikes to the left, docks to the right"></div>
        <div class="occ__seg unavail" style="width:${pct(unavail)}"></div>
      </div>
      <div class="occ__legend">
        <div class="occ__row">
          <span class="occ__group">bikes</span>
          <div class="occ__items">
            <span><i style="background:var(--bike)"></i><b>${mech}</b> mechanical</span>
            <span><i style="background:var(--ebike)"></i><b>${ebikes}</b> ebike${ebikes === 1 ? "" : "s"}</span>
            <span class="occ__aside"><i style="background:var(--trailer)"></i><b>${trailer}</b> trailer${trailer === 1 ? "" : "s"} <em>· not counted</em></span>
            ${broken ? `<span class="occ__aside"><i class="sw-broken"></i><b>${broken}</b> broken bike${broken === 1 ? "" : "s"}</span>` : ""}
          </div>
        </div>
        <div class="occ__row">
          <span class="occ__group">docks</span>
          <div class="occ__items">
            <span><i class="sw-free"></i><b>${docks}</b> free dock${docks === 1 ? "" : "s"}</span>
            ${unavail ? `<span class="occ__aside"><i class="sw-unavail"></i><b>${unavail}</b> unavailable dock${unavail === 1 ? "" : "s"}</span>` : ""}
          </div>
        </div>
      </div>
    </div>`;

  const dot = $("liveDot");
  dot.className = "dot " + (n.stale ? "stale" : "live");
  $("updated").textContent = `updated ${relTime(n.ageSeconds)}`;
}

// ---------- TODAY (SVG, focus on the scarce window or full 24h) ----------
let lastToday: any = null;
let todayView: "focus" | "full" = "focus";

function renderToday() {
  const res = lastToday;
  const el = $("today");
  const obs: any[] = res?.observations ?? [];
  const cap = res?.capacity ?? 19;
  if (obs.length < 2) {
    el.innerHTML = `<div class="empty-note">Collecting… the chart fills in as data arrives.</div>`;
    $("todayRange").textContent = "";
    return;
  }
  const dataFrom = obs[0].ts;
  const dataTo = Math.floor(Date.now() / 1000);
  const ivAll = obs.map((o, i) => ({ t0: o.ts, t1: i + 1 < obs.length ? obs[i + 1].ts : dataTo, bikes: o.bikes, docks: o.docks }));

  // the "scarce" span = where bikes ran out (fall back to low ≤2 if never empty)
  const spanOf = (pred: (s: any) => boolean): [number, number] | null => {
    let lo = Infinity, hi = -Infinity;
    for (const s of ivAll) if (pred(s)) { lo = Math.min(lo, s.t0); hi = Math.max(hi, s.t1); }
    return hi > lo ? [lo, hi] : null;
  };
  const scarce = spanOf((s) => s.bikes <= 0) ?? spanOf((s) => s.bikes <= 2);
  const focusing = todayView === "focus" && !!scarce;

  let winFrom = dataFrom, winTo = dataTo;
  if (focusing && scarce) {
    winFrom = Math.max(dataFrom, scarce[0] - 90 * 60); // show the run-down before
    winTo = Math.min(dataTo, scarce[1] + 60 * 60); // …and the recovery after
  }
  const span = Math.max(60, winTo - winFrom);

  // toggle availability + labels
  const focusBtn = document.querySelector('#todayToggle button[data-view="focus"]') as HTMLButtonElement | null;
  if (focusBtn) focusBtn.disabled = !scarce;
  $("todayTitle").textContent = focusing ? "When bikes run out" : "Last 24 hours";
  $("todayRange").textContent = focusing
    ? `${clockLabel(new Date(winFrom * 1000).toISOString())}–${clockLabel(new Date(winTo * 1000).toISOString())}`
    : "last 24 h";

  const W = 720, H = 220, padL = 28, padR = 12, padT = 14, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x = (ts: number) => padL + ((ts - winFrom) / span) * plotW;
  const y = (v: number) => padT + (1 - Math.max(0, Math.min(cap, v)) / cap) * plotH;

  // clip intervals to the visible window
  const iv = ivAll
    .filter((s) => s.t1 > winFrom && s.t0 < winTo)
    .map((s) => ({ t0: Math.max(s.t0, winFrom), t1: Math.min(s.t1, winTo), bikes: s.bikes, docks: s.docks }));
  if (!iv.length) {
    el.innerHTML = `<div class="empty-note">No data in this window.</div>`;
    return;
  }

  const band = (cond: (s: any) => boolean, color: string) =>
    iv
      .filter(cond)
      .map((s) => `<rect x="${x(s.t0).toFixed(1)}" y="${padT}" width="${Math.max(0.6, x(s.t1) - x(s.t0)).toFixed(1)}" height="${plotH}" fill="${color}"/>`)
      .join("");

  let d = `M ${x(iv[0].t0).toFixed(1)} ${y(iv[0].bikes).toFixed(1)}`;
  for (const s of iv) d += ` L ${x(s.t0).toFixed(1)} ${y(s.bikes).toFixed(1)} L ${x(s.t1).toFixed(1)} ${y(s.bikes).toFixed(1)}`;
  const area = `${d} L ${x(winTo).toFixed(1)} ${y(0).toFixed(1)} L ${x(winFrom).toFixed(1)} ${y(0).toFixed(1)} Z`;

  // adaptive x ticks: tighter window -> finer ticks
  const stepH = span <= 5 * 3600 ? 1 : span <= 10 * 3600 ? 2 : span <= 18 * 3600 ? 3 : 4;
  const step = stepH * 3600;
  let ticks = "";
  for (let t = Math.ceil(winFrom / step) * step; t <= winTo; t += step) {
    ticks += `<line x1="${x(t).toFixed(1)}" y1="${padT}" x2="${x(t).toFixed(1)}" y2="${padT + plotH}" stroke="var(--border-soft)"/>
      <text x="${x(t).toFixed(1)}" y="${H - 6}" fill="var(--ink-faint)" font-size="10" text-anchor="middle">${clockLabel(new Date(t * 1000).toISOString())}</text>`;
  }

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="bikes available, ${focusing ? "zoomed to when bikes run out" : "over the last 24 hours"}">
    <line x1="${padL}" y1="${y(cap)}" x2="${W - padR}" y2="${y(cap)}" stroke="var(--border-soft)"/>
    <line x1="${padL}" y1="${y(0)}" x2="${W - padR}" y2="${y(0)}" stroke="var(--border)"/>
    <text x="2" y="${y(cap) + 3}" fill="var(--ink-faint)" font-size="10">${cap}</text>
    <text x="2" y="${y(0) + 3}" fill="var(--ink-faint)" font-size="10">0</text>
    ${ticks}
    ${band((s) => s.bikes <= 0, "color-mix(in srgb, var(--empty) 30%, transparent)")}
    ${band((s) => s.docks <= 0, "color-mix(in srgb, var(--full) 24%, transparent)")}
    <path d="${area}" fill="color-mix(in srgb, var(--bike) 12%, transparent)"/>
    <path d="${d}" fill="none" stroke="var(--bike)" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;
}

// ---------- PATTERNS (heatmap SVG) ----------
let lastStats: any = null;
let heatMetric: "avgBikes" | "pctEmpty" = "pctEmpty";
let heatWindow: "focus" | "full" = "focus";
function renderHeatmap() {
  const el = $("heatmap");
  if (!lastStats?.heatmap) {
    el.innerHTML = `<div class="empty-note">Collecting… the heatmap gets meaningful after ~1–2 weeks of data.</div>`;
    return;
  }
  const cap = lastStats.capacity ?? 19;
  const srcDays: string[] = lastStats.heatmap.days; // Sun..Sat
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon-first
  const grid = lastStats.heatmap[heatMetric] as (number | null)[][];
  const isEmpty = heatMetric === "pctEmpty";

  const W = 720, gutter = 34, top = 24, cellH = 24;
  const rowsH = order.length * cellH;
  const H = top + rowsH + 46;

  // run-out hour window: zoom to the hours the station is ever empty (focus), else full day
  const pe = lastStats.heatmap.pctEmpty as (number | null)[][];
  let loH = 24, hiH = -1;
  for (let h = 0; h < 24; h++) {
    let maxE = 0;
    for (let dw = 0; dw < 7; dw++) {
      const v = pe[dw][h];
      if (v != null) maxE = Math.max(maxE, v);
    }
    if (maxE >= 0.05) { loH = Math.min(loH, h); hiH = Math.max(hiH, h); }
  }
  const hasWindow = hiH >= loH;
  const focusing = heatWindow === "focus" && hasWindow;
  const startH = focusing ? Math.max(0, loH - 1) : 0;
  const endH = focusing ? Math.min(23, hiH + 1) : 23;
  const nCols = endH - startH + 1;
  const cellW = (W - gutter) / nCols;
  const colX = (h: number) => gutter + (h - startH) * cellW; // left edge of hour h
  const hx = (mins: number) => gutter + (mins / 60 - startH) * cellW; // x at minutes-of-day
  const inWin = (mins: number) => mins / 60 >= startH && mins / 60 <= endH + 1;

  const winBtn = document.querySelector('#heatWindow button[data-hwin="focus"]') as HTMLButtonElement | null;
  if (winBtn) winBtn.disabled = !hasWindow;

  const color = (v: number | null) =>
    v == null ? "url(#nodata)" : isEmpty ? emptyColor(v) : magma(v / cap);
  const valLabel = (v: number | null) =>
    v == null
      ? "no data yet"
      : isEmpty
        ? `no bikes ${Math.round(v * 100)}% of the time`
        : `${v.toFixed(1)} bikes on average`;

  const runout = lastStats.morning?.runoutByDow as { minutes: number | null; time: string | null; days: number }[] | undefined;
  let cells = "";
  order.forEach((dow, row) => {
    const ry = top + row * cellH;
    const cy = ry + cellH / 2;
    let cellRects = "";
    for (let h = startH; h <= endH; h++) {
      const v = grid[dow][h];
      cellRects += `<rect x="${colX(h).toFixed(1)}" y="${ry}" width="${cellW.toFixed(1)}" height="${cellH - 2}" rx="2" fill="${color(v)}"><title>${srcDays[dow]} ${pad(h)}:00 · ${valLabel(v)}</title></rect>`;
    }

    // per-day run-out: a small always-visible marker + a time pill revealed on hover
    const ro = runout?.[dow];
    let dot = "", reveal = "";
    if (ro && ro.minutes != null && inWin(ro.minutes)) {
      const mx = hx(ro.minutes);
      dot = `<polygon class="hrow__dot" points="${(mx - 2.6).toFixed(1)},${ry + 1} ${(mx + 2.6).toFixed(1)},${ry + 1} ${mx.toFixed(1)},${ry + 5}" fill="rgba(255,255,255,.8)"/>`;
      const pw = 38, ph = 15;
      let px = mx + 6;
      if (px + pw > W - 2) px = mx - 6 - pw;
      reveal =
        `<line x1="${mx.toFixed(1)}" y1="${ry}" x2="${mx.toFixed(1)}" y2="${(ry + cellH - 2).toFixed(1)}" stroke="#0b0e16" stroke-width="3"/>` +
        `<line x1="${mx.toFixed(1)}" y1="${ry}" x2="${mx.toFixed(1)}" y2="${(ry + cellH - 2).toFixed(1)}" stroke="#fff" stroke-width="1.4"/>` +
        `<rect x="${px.toFixed(1)}" y="${(cy - ph / 2).toFixed(1)}" width="${pw}" height="${ph}" rx="4" fill="#0b0e16" stroke="rgba(255,255,255,.3)"/>` +
        `<text x="${(px + pw / 2).toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="#fff">${ro.time}</text>`;
    } else {
      reveal = `<text x="${((gutter + W) / 2).toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--ink-dim)">rarely runs out</text>`;
    }

    cells +=
      `<g class="hrow">` +
      `<rect class="hrow__bg" x="0" y="${ry}" width="${W}" height="${cellH - 2}" rx="3"/>` +
      `<text x="${gutter - 8}" y="${(cy + 3).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--ink-dim)">${srcDays[dow]}</text>` +
      cellRects +
      dot +
      `<g class="hrow__ro">${reveal}</g>` +
      `</g>`;
  });

  // dotted reference line down the weekday-average run-out time
  const avgRo = lastStats.morning?.runoutAvg as { minutes: number | null; time: string | null; days: number } | undefined;
  let avgLine = "";
  if (avgRo && avgRo.minutes != null && inWin(avgRo.minutes)) {
    const mx = hx(avgRo.minutes);
    const y1 = top - 2, y2 = top + 5 * cellH - 2; // span the weekday rows (Mon–Fri) only
    avgLine =
      `<line x1="${mx.toFixed(1)}" y1="${y1}" x2="${mx.toFixed(1)}" y2="${y2}" stroke="#0b0e16" stroke-width="3" stroke-dasharray="2 3"/>` +
      `<line x1="${mx.toFixed(1)}" y1="${y1}" x2="${mx.toFixed(1)}" y2="${y2}" stroke="rgba(255,255,255,.92)" stroke-width="1.4" stroke-dasharray="2 3"><title>weekday average: bikes run out ~${avgRo.time}</title></line>` +
      `<text x="${mx.toFixed(1)}" y="${top - 8}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#fff">runs out ~${avgRo.time}</text>`;
  }

  const hStep = nCols <= 8 ? 1 : nCols <= 14 ? 2 : nCols <= 18 ? 3 : 6;
  let hours = "";
  for (let h = startH; h <= endH + 1; h += hStep) {
    hours += `<text x="${colX(h).toFixed(1)}" y="${top + rowsH + 14}" font-size="10" fill="var(--ink-faint)" text-anchor="middle">${pad(h % 24)}h</text>`;
  }

  let stops = "";
  for (let i = 0; i <= 10; i++) stops += `<stop offset="${i * 10}%" stop-color="${isEmpty ? emptyColor(i / 10) : magma(i / 10)}"/>`;
  const ly = top + rowsH + 28;
  const legend = `
    <defs>
      <linearGradient id="heatGrad" x1="0" x2="1">${stops}</linearGradient>
      <pattern id="nodata" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#141b2b"/><line x1="0" y1="0" x2="0" y2="6" stroke="#2c3654" stroke-width="2"/>
      </pattern>
    </defs>
    <rect x="${gutter}" y="${ly}" width="13" height="9" rx="2" fill="url(#nodata)"/>
    <text x="${gutter + 19}" y="${ly + 8}" font-size="10" fill="var(--ink-faint)">no data</text>
    <text x="${W - 192}" y="${ly + 8}" font-size="10" fill="var(--ink-faint)" text-anchor="end">${isEmpty ? "always has bikes" : "0"}</text>
    <rect x="${W - 188}" y="${ly}" width="118" height="9" rx="2" fill="url(#heatGrad)"/>
    <text x="${W - 66}" y="${ly + 8}" font-size="10" fill="var(--ink-faint)">${isEmpty ? "always empty" : cap}</text>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${isEmpty ? "share of time with no bikes" : "average bikes available"} by hour and weekday, with a dotted line at the weekday-average bike run-out time">${cells}${avgLine}${hours}${legend}</svg>`;
}

// ---------- STATS ----------
function renderStats() {
  const m = lastStats?.morning;
  const tile = (val: string, label: string) => `<div class="stat"><b>${val}</b><small>${label}</small></div>`;
  if (!m) {
    $("stats").innerHTML = `<div class="empty-note">Collecting weekday-morning stats…</div>`;
    return;
  }
  const pctEmpty = m.pctEmptyAtTarget == null ? "—" : `${Math.round(m.pctEmptyAtTarget * 100)}%`;
  $("stats").innerHTML =
    tile(m.typicalFirstEmpty ?? "—", `typical first-empty (${m.window[0]}–${m.window[1]})`) +
    tile(pctEmpty, `empty by ${m.targetTime} · ${m.mornings} mornings`) +
    tile(durLabel(lastStats.longestEmptyMinutes ?? 0), "longest empty streak") +
    tile(String(m.sampleDays ?? 0), "mornings it ran dry");
}

// ---------- EPISODES ----------
function renderEpisodes(empty: any, full: any) {
  const list = [
    ...(empty.episodes ?? []).map((e: any) => ({ ...e, type: "empty" })),
    ...(full.episodes ?? []).map((e: any) => ({ ...e, type: "full" })),
  ]
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())
    .slice(0, 14);

  if (!list.length) {
    $("episodes").innerHTML = `<div class="empty-note">No empty or full episodes recorded yet.</div>`;
    return;
  }
  $("episodes").innerHTML = list
    .map((e) => {
      const day = new Date(e.start).toLocaleDateString("en-CA", { timeZone: TZ, month: "short", day: "numeric" });
      const range = e.ongoing
        ? `${clockLabel(e.start)} → <span class="ongoing">now</span>`
        : `${clockLabel(e.start)}–${clockLabel(e.end)}`;
      return `<div class="ep"><i class="${e.type}"></i><span class="when">${e.type === "empty" ? "Empty" : "Full"} · ${day} ${range}</span><span class="dur">${durLabel(e.minutes)}</span></div>`;
    })
    .join("");
}

// ---------- orchestration ----------
async function refreshNow() {
  try {
    renderHero(await api("now"));
  } catch {
    /* keep last good render */
  }
}
async function refreshAll() {
  const [n, today, stats, epEmpty, epFull] = await Promise.all([
    api("now"),
    api("observations?from=" + (Math.floor(Date.now() / 1000) - 86400)),
    api("stats?days=30"),
    api("episodes?type=empty&days=30"),
    api("episodes?type=full&days=30"),
  ]);
  renderHero(n);
  lastToday = today;
  renderToday();
  lastStats = stats;
  renderHeatmap();
  renderStats();
  renderEpisodes(epEmpty, epFull);
}

$("heatToggle").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  heatMetric = b.dataset.metric as any;
  $("heatToggle")
    .querySelectorAll("button")
    .forEach((x) => x.classList.toggle("is-active", x === b));
  renderHeatmap();
});

$("heatWindow").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (!b || b.disabled) return;
  heatWindow = b.dataset.hwin as any;
  $("heatWindow")
    .querySelectorAll("button")
    .forEach((x) => x.classList.toggle("is-active", x === b));
  renderHeatmap();
});

// Touch devices have no hover — let a tap on a heatmap row reveal that day's
// run-out time (desktop keeps the hover reveal via CSS). One row open at a time.
$("heatmap").addEventListener("click", (e) => {
  const row = (e.target as Element).closest(".hrow");
  if (!row) return;
  const wasOpen = row.classList.contains("is-open");
  $("heatmap")
    .querySelectorAll(".hrow.is-open")
    .forEach((r) => r.classList.remove("is-open"));
  if (!wasOpen) row.classList.add("is-open");
});

$("todayToggle").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (!b || b.disabled) return;
  todayView = b.dataset.view as any;
  $("todayToggle")
    .querySelectorAll("button")
    .forEach((x) => x.classList.toggle("is-active", x === b));
  renderToday();
});

refreshAll().catch((e) => console.error(e));
setInterval(refreshNow, 30_000);
setInterval(() => refreshAll().catch(() => {}), 300_000);
