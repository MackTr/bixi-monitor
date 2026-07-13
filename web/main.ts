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

// ---------- holidays ----------
// The QC calendar lives server-side; the stats payload lists the holiday dates it
// excluded from weekday aggregates, and the markers below just surface those.
const dateKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
const holidayOn = (key: string): string | null =>
  ((lastStats?.excludedHolidays ?? []) as { date: string; name: string }[]).find((h) => h.date === key)?.name ?? null;
function shortDate(ds: string): string {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

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
// magma — perceptually uniform, colorblind/grayscale safe. Used for "avg bikes"
// (Mack tried the red scarcity ramp there and found it confusing — keep magma).
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
            <span><i style="background:var(--trailer)"></i><b>${trailer}</b> trailer${trailer === 1 ? "" : "s"}</span>
            ${broken ? `<span><i class="sw-broken"></i><b>${broken}</b> broken bike${broken === 1 ? "" : "s"}</span>` : ""}
          </div>
        </div>
        <div class="occ__row">
          <span class="occ__group">docks</span>
          <div class="occ__items">
            <span><i class="sw-free"></i><b>${docks}</b> free dock${docks === 1 ? "" : "s"}</span>
            ${unavail ? `<span><i class="sw-unavail"></i><b>${unavail}</b> unavailable dock${unavail === 1 ? "" : "s"}</span>` : ""}
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

  // the "scarce" span = where bikes ran out (fall back to low ≤3 if never empty)
  const spanOf = (pred: (s: any) => boolean): [number, number] | null => {
    let lo = Infinity, hi = -Infinity;
    for (const s of ivAll) if (pred(s)) { lo = Math.min(lo, s.t0); hi = Math.max(hi, s.t1); }
    return hi > lo ? [lo, hi] : null;
  };
  const scarce = spanOf((s) => s.bikes <= 0) ?? spanOf((s) => s.bikes <= 3);
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
  const todayHol = holidayOn(dateKey(new Date())); // holidays skew the usual pattern — say so
  $("todayRange").textContent =
    (focusing
      ? `${clockLabel(new Date(winFrom * 1000).toISOString())}–${clockLabel(new Date(winTo * 1000).toISOString())}`
      : "last 24 h") + (todayHol ? ` · ${todayHol}` : "");

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
  const H = top + rowsH + 58;

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
      const box = `x="${colX(h).toFixed(1)}" y="${ry}" width="${cellW.toFixed(1)}" height="${cellH - 2}" rx="2" fill="${color(v)}"`;
      // avg view gets an instant custom hover pill (data-tip); % empty keeps the
      // native title since its hover is owned by the run-out reveal
      cellRects += isEmpty
        ? `<rect ${box}><title>${srcDays[dow]} ${pad(h)}:00 · ${valLabel(v)}</title></rect>`
        : `<rect ${box}${v == null ? "" : ` data-tip="${srcDays[dow]} ${pad(h)}h · ${v.toFixed(1)} bikes"`}/>`;
    }

    // per-day run-out: a small always-visible marker + a time pill revealed on
    // hover — only in the % empty view; run-out chrome is noise on avg bikes
    const ro = runout?.[dow];
    let dot = "", reveal = "";
    if (!isEmpty) {
      // no markers, no reveal
    } else if (ro && ro.minutes != null && inWin(ro.minutes)) {
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
    } else if (isEmpty) {
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

  // dotted reference line down the weekday-average run-out time (% empty only)
  const avgRo = lastStats.morning?.runoutAvg as { minutes: number | null; time: string | null; days: number } | undefined;
  let avgLine = "";
  if (isEmpty && avgRo && avgRo.minutes != null && inWin(avgRo.minutes)) {
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
  const hols = (lastStats.excludedHolidays ?? []) as { date: string; name: string }[];
  const holNote = hols.length
    ? `<text x="${gutter + 80}" y="${ly + 8}" font-size="10" fill="var(--ink-faint)">holidays excluded · ${hols.map((h) => shortDate(h.date)).join(", ")}<title>${hols.map((h) => `${shortDate(h.date)} — ${h.name}`).join("\n")}</title></text>`
    : "";

  // numeric scale under the gradient: % for the empty view, bike counts for avg
  const barX = W - 232, barW = 160;
  const tickVals = isEmpty ? [0, 0.5, 1] : [0, 5, 10, 15, cap];
  let tickMarks = "";
  for (const v of tickVals) {
    const tx = barX + (isEmpty ? v : v / cap) * barW;
    tickMarks +=
      `<line x1="${tx.toFixed(1)}" y1="${ly + 9}" x2="${tx.toFixed(1)}" y2="${ly + 12}" stroke="var(--ink-faint)"/>` +
      `<text x="${tx.toFixed(1)}" y="${ly + 21}" font-size="9" fill="var(--ink-faint)" text-anchor="middle">${isEmpty ? `${Math.round(v * 100)}%` : v}</text>`;
  }
  const legend = `
    <defs>
      <linearGradient id="heatGrad" x1="0" x2="1">${stops}</linearGradient>
      <pattern id="nodata" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#141b2b"/><line x1="0" y1="0" x2="0" y2="6" stroke="#2c3654" stroke-width="2"/>
      </pattern>
    </defs>
    <rect x="${gutter}" y="${ly}" width="13" height="9" rx="2" fill="url(#nodata)"/>
    <text x="${gutter + 19}" y="${ly + 8}" font-size="10" fill="var(--ink-faint)">no data</text>
    ${holNote}
    ${isEmpty ? `<text x="${barX - 6}" y="${ly + 8}" font-size="10" fill="var(--ink-faint)" text-anchor="end">always has bikes</text>` : ""}
    <rect x="${barX}" y="${ly}" width="${barW}" height="9" rx="2" fill="url(#heatGrad)"/>
    ${isEmpty ? `<text x="${barX + barW + 6}" y="${ly + 8}" font-size="10" fill="var(--ink-faint)">always empty</text>` : ""}
    ${tickMarks}`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${isEmpty ? "share of time with no bikes" : "average bikes available"} by hour and weekday${isEmpty ? ", with a dotted line at the weekday-average bike run-out time" : ""}">${cells}${avgLine}${hours}${legend}</svg>`;
}

// ---------- STATS ----------
function renderStats() {
  const m = lastStats?.morning;
  const tile = (val: string, label: string) => `<div class="stat"><b>${val}</b><small>${label}</small></div>`;
  if (!m) {
    $("stats").innerHTML = `<div class="empty-note">Collecting weekday-morning stats…</div>`;
    return;
  }
  const pctEmpty = m.pctEmptyByTarget == null ? "—" : `${Math.round(m.pctEmptyByTarget * 100)}%`;
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
      const hol = holidayOn(dateKey(new Date(e.start)));
      const range = e.ongoing
        ? `${clockLabel(e.start)} → <span class="ongoing">now</span>`
        : `${clockLabel(e.start)}–${clockLabel(e.end)}`;
      return `<div class="ep"><i class="${e.type}"></i><span class="when">${e.type === "empty" ? "Empty" : "Full"} · ${day} ${range}${hol ? ` <span class="hol" title="${hol}">· holiday</span>` : ""}</span><span class="dur">${durLabel(e.minutes)}</span></div>`;
    })
    .join("");
}

// ---------- TOMORROW (prediction from bixi-predictor, client #2's sibling) ----------
const PREDICTOR_API =
  location.hostname === "localhost" ? "http://localhost:8788/api/v1" : "https://bixi-predictor.bixi.workers.dev/api/v1";

async function fetchPrediction(): Promise<any | null> {
  try {
    const r = await fetch(`${PREDICTOR_API}/stations/${STATION}/prediction`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/// Prediction history, official grades and not-yet-graded rows alike (the
/// caller splits them: finalizedAt set = graded by the nightly run; today's
/// unfinalized row can still be graded provisionally from live monitor data).
/// Rows the model refused to call (willRunOut null) can't be graded either
/// way and are skipped. Most recent first.
async function fetchTrackRecord(): Promise<any[]> {
  try {
    const r = await fetch(`${PREDICTOR_API}/stations/${STATION}/predictions?days=20`);
    if (!r.ok) return [];
    const d = (await r.json()) as any;
    return (d.predictions ?? []).filter((p: any) => p.willRunOut != null);
  } catch {
    return [];
  }
}

function friendlyTarget(ds: string): string {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function renderTomorrow(p: any) {
  const el = $("tomorrow");
  if (!p) {
    el.innerHTML = `<div class="empty-note">No prediction yet.</div>`;
    return;
  }
  // The card header tracks the guess's target day: predictions are made once,
  // at the 9pm run, so the latest one is about TODAY for most of the day and
  // only about tomorrow between 9pm and midnight. A stale guess (missed cron)
  // shows its actual date rather than lying.
  const todayKey = dateKey(new Date());
  $("tmrwWord").textContent =
    p.targetDate > todayKey ? "Tomorrow" : p.targetDate === todayKey ? "Today" : shortDate(p.targetDate);
  const prob = p.probability == null ? null : Math.round(p.probability * 100);
  const b = p.basis ?? {};
  const how =
    b.fallbackLevel === 0 ? "day type + weather" : b.fallbackLevel === 1 ? "day type (weather set aside)" : "broad day classes";
  const basisLine = `${friendlyTarget(p.targetDate)} · ~${b.effectiveN != null ? Math.max(1, Math.round(b.effectiveN)) : "?"} similar days weighed · ${how}`;
  if (p.willRunOut == null) {
    el.innerHTML = `<div class="tomorrow__main"><b class="tomorrow__time">too early to say</b>
      <span class="tomorrow__verdict">the model needs a few more days of history</span></div>
      <p class="muted basis">${basisLine}</p>`;
  } else if (!p.willRunOut) {
    el.innerHTML = `<div class="tomorrow__main"><b class="tomorrow__time">bikes all day</b>
      <span class="tomorrow__prob">run-out chance ${prob}%</span></div>
      <p class="muted basis">${basisLine}</p>`;
  } else {
    const win = p.window ? ` · window ${p.window.early}–${p.window.late}` : "";
    el.innerHTML = `<div class="tomorrow__main"><b class="tomorrow__time">${p.predicted.time}</b>
      <span class="tomorrow__verdict">expected empty</span>
      <span class="tomorrow__prob">${prob}%${win}</span></div>
      <p class="muted basis">${basisLine}</p>`;
  }
}

// ---------- notifications (Web Push from the predictor) ----------
function urlBase64ToUint8Array(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ---------- TRACK RECORD (per-day guess vs reality, in the bottom sheet) ----------
type Scored = {
  date: string;
  kind: "graded" | "false-alarm" | "surprise" | "all-clear";
  err: number | null; // predicted − actual, graded days only
  guessed: string | null;
  actual: string | null;
  inWindow: boolean | null;
  provisional?: boolean; // graded live from monitor data, nightly run not in yet
};

const hhmmToMins = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

function scoreRow(p: any): Scored {
  const guessed = p.predicted?.time ?? null;
  const actual = p.actual?.time ?? null;
  const kind = p.willRunOut ? (actual ? "graded" : "false-alarm") : actual ? "surprise" : "all-clear";
  let err: number | null = null;
  let inWindow: boolean | null = null;
  if (kind === "graded") {
    err = p.errorMinutes ?? p.predicted.minutes - p.actual.minutes;
    if (p.window?.early && p.window?.late) {
      inWindow = p.actual.minutes >= hhmmToMins(p.window.early) && p.actual.minutes <= hhmmToMins(p.window.late);
    }
  }
  return { date: p.targetDate, kind, err, guessed, actual, inWindow };
}

/// Grade today's guess the moment the run-out is visible in the monitor's own
/// data, instead of waiting for the predictor's nightly finalize. The first
/// empty episode that STARTED today (local) is exactly the day's first
/// bikes>0→0 transition — the predictor's runout_minutes semantics. No episode
/// yet = nothing to say (could still be a fine guess or a false alarm).
function provisionalToday(raw: any[], epEmpty: any, todayKey: string): Scored | null {
  const p = raw.find((r: any) => r.targetDate === todayKey && r.finalizedAt == null);
  if (!p) return null;
  const todays = ((epEmpty?.episodes ?? []) as any[])
    .filter((e) => dateKey(new Date(e.start)) === todayKey)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  if (!todays.length) return null;
  const actual = clockLabel(todays[0].start);
  const actualMins = hhmmToMins(actual);
  if (!p.willRunOut) {
    return { date: todayKey, kind: "surprise", err: null, guessed: null, actual, inWindow: null, provisional: true };
  }
  return {
    date: todayKey,
    kind: "graded",
    err: p.predicted.minutes - actualMins,
    guessed: p.predicted.time,
    actual,
    inWindow: p.window ? actualMins >= hhmmToMins(p.window.early) && actualMins <= hhmmToMins(p.window.late) : null,
    provisional: true,
  };
}

function recordSummary(rows: Scored[]) {
  const errs = rows
    .filter((r) => r.kind === "graded")
    .map((r) => Math.abs(r.err!))
    .sort((a, b) => a - b);
  const median = errs.length ? Math.round((errs[(errs.length - 1) >> 1] + errs[errs.length >> 1]) / 2) : null;
  const windowed = rows.filter((r) => r.inWindow != null);
  return {
    median,
    gradedN: errs.length,
    winHit: windowed.filter((r) => r.inWindow).length,
    winN: windowed.length,
    // right call = the yes/no verdict matched, regardless of minutes
    right: rows.filter((r) => r.kind === "graded" || r.kind === "all-clear").length,
    total: rows.length,
  };
}

// err = predicted − actual: positive = ran out before the guess ("early").
const missLabel = (e: number) => (e === 0 ? "spot on" : e > 0 ? `${e}m early` : `${-e}m late`);
const missColor = (e: number) => (Math.abs(e) <= 15 ? "var(--ok)" : Math.abs(e) <= 45 ? "var(--low)" : "var(--empty)");

/// One-line summary at the bottom of the Tomorrow card — the sheet's tap target.
function renderRecordLine(rows: Scored[]) {
  const btn = $("recordLine") as HTMLButtonElement;
  btn.hidden = false;
  const s = recordSummary(rows);
  const bits: string[] = [];
  if (s.median != null) bits.push(`guesses land <b>±${s.median} min</b>`);
  if (s.total) bits.push(`right call <b>${s.right}/${s.total} · ${Math.round((s.right / s.total) * 100)}%</b>`);
  btn.innerHTML = `<span>${bits.length ? bits.join(" · ") : "no graded guesses yet"}</span><span class="chev">›</span>`;
}

function renderTrackRecord(rows: Scored[]) {
  const el = $("trackRecord");
  const note = `<p class="track__note">next prediction lands at 9pm — today's guess gets its official grade then too</p>`;
  if (!rows.length) {
    el.innerHTML = `<div class="empty-note">Nothing graded yet — each guess gets scored against the real run-out.</div>` + note;
    return;
  }
  const s = recordSummary(rows);
  const tile = (val: string, label: string) => `<div class="stat"><b>${val}</b><small>${label}</small></div>`;
  const tiles =
    `<div class="stats stats--record">` +
    tile(s.median != null ? `±${s.median}m` : "—", `median miss · ${s.gradedN} graded`) +
    tile(s.winN ? `${s.winHit}/${s.winN}` : "—", "landed in window") +
    tile(`${s.right}/${s.total} · ${Math.round((s.right / s.total) * 100)}%`, "right call, out or not") +
    `</div>`;
  const CHIP: Record<string, [string, string, (r: Scored) => string]> = {
    "all-clear": ["tchip--ok", "✓ right call", () => "said bikes all day · none"],
    "false-alarm": ["tchip--bad", "✕ false alarm", (r) => `guessed ${r.guessed} · never ran out`],
    surprise: ["tchip--bad", "⚠ surprise run-out", (r) => `said all day · out ${r.actual}`],
  };
  const dateCell = (r: Scored) => (r.provisional ? "today" : shortDate(r.date));
  const provTag = (r: Scored) => (r.provisional ? " · unofficial" : "");
  const rowHtml = (r: Scored) => {
    if (r.kind !== "graded") {
      const [cls, label, sub] = CHIP[r.kind];
      return `<div class="trow"><span class="trow__date">${dateCell(r)}</span>
        <span class="trow__chiparea"><span class="tchip ${cls}">${label}</span></span>
        <span class="trow__lbl"><small>${sub(r)}${provTag(r)}</small></span></div>`;
    }
    const e = r.err!;
    // bar grows from the center (= the guess) toward when it really ran out;
    // capped at 42% of the track ≈ a 90-minute miss, so one disaster day
    // doesn't flatten everything else.
    const bar =
      e === 0
        ? `<i class="trow__bar" style="left:calc(50% - 2px);width:4px;background:var(--ok)"></i>`
        : `<i class="trow__bar" style="${e > 0 ? "right" : "left"}:50%;width:${Math.min(42, (Math.abs(e) * 42) / 90).toFixed(1)}%;background:${missColor(e)}"></i>`;
    return `<div class="trow"><span class="trow__date">${dateCell(r)}</span>
      <span class="trow__viz"><i class="trow__mid"></i>${bar}</span>
      <span class="trow__lbl" style="color:${missColor(e)}">${missLabel(e)}<small>guessed ${r.guessed} · out ${r.actual}${provTag(r)}</small></span></div>`;
  };
  el.innerHTML =
    tiles +
    `<div class="track">${rows.map(rowHtml).join("")}</div>
    <div class="track__legend"><span>◀ ran out before the guess · after ▶</span>
      <span style="color:var(--ok)">within 15m</span>
      <span style="color:var(--low)">within 45m</span>
      <span style="color:var(--empty)">45m+</span></div>` +
    note;
}

async function initNotifications() {
  const btn = $("notifBtn") as HTMLButtonElement;
  const hint = $("notifHint");
  if (!("serviceWorker" in navigator)) return;
  // iOS only exposes PushManager to web apps launched from a Home Screen icon —
  // in a plain Safari tab the button simply stays hidden.
  if (!("PushManager" in window)) return;
  const reg = await navigator.serviceWorker.register("/sw.js");
  let subscribed = !!(await reg.pushManager.getSubscription());
  btn.hidden = false;
  const paint = () => {
    btn.textContent = subscribed ? "alerts on · disable" : "enable alerts";
    btn.classList.toggle("is-on", subscribed);
  };
  paint();
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (subscribed) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch(`${PREDICTOR_API}/push/unsubscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          }).catch(() => {});
          await sub.unsubscribe();
        }
        subscribed = false;
      } else {
        // permission must be requested inside the tap on iOS
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          hint.hidden = false;
          hint.textContent = "Notifications are blocked for this app.";
          return;
        }
        const { key } = await (await fetch(`${PREDICTOR_API}/push/vapid-public-key`)).json();
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        });
        const res = await fetch(`${PREDICTOR_API}/push/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        if (!res.ok) throw new Error(`subscribe ${res.status}`);
        subscribed = true;
        hint.hidden = true;
      }
    } catch (e) {
      hint.hidden = false;
      hint.textContent = "Couldn't update notifications — try again.";
      console.error(e);
    } finally {
      btn.disabled = false;
      paint();
    }
  };
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
  const [n, today, stats, epEmpty, epFull, prediction, scored] = await Promise.all([
    api("now"),
    api("observations?from=" + (Math.floor(Date.now() / 1000) - 86400)),
    api("stats?days=30"),
    api("episodes?type=empty&days=30"),
    api("episodes?type=full&days=30"),
    fetchPrediction(), // resolves null on any failure — the card degrades alone
    fetchTrackRecord(), // [] on failure — same deal
  ]);
  // assign both before rendering: today + episodes read lastStats for holiday tags
  lastToday = today;
  lastStats = stats;
  renderHero(n);
  renderToday();
  renderHeatmap();
  renderStats();
  renderEpisodes(epEmpty, epFull);
  renderTomorrow(prediction);
  const todayKey = dateKey(new Date());
  const record = scored.filter((p: any) => p.finalizedAt != null).map(scoreRow);
  const prov = provisionalToday(scored, epEmpty, todayKey);
  if (prov) record.unshift(prov);
  renderRecordLine(record);
  renderTrackRecord(record);
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

// Instant hover pill for avg-bikes cells (the native <title> tooltip is too
// slow). Lives on <body> so re-rendering the heatmap's innerHTML can't wipe it.
const heatTip = document.createElement("div");
heatTip.className = "heattip";
heatTip.hidden = true;
document.body.appendChild(heatTip);
$("heatmap").addEventListener("mousemove", (e) => {
  const tip = (e.target as Element).closest("rect[data-tip]")?.getAttribute("data-tip");
  if (!tip) {
    heatTip.hidden = true;
    return;
  }
  heatTip.textContent = tip;
  heatTip.hidden = false;
  heatTip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - heatTip.offsetWidth - 8)}px`;
  heatTip.style.top = `${e.clientY - 30}px`;
});
$("heatmap").addEventListener("mouseleave", () => (heatTip.hidden = true));

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

// Track-record bottom sheet. Plain divs, no focus trap — it's a one-person
// dashboard; ✕, backdrop tap, and Escape all close it.
const sheetBackdrop = $("sheetBackdrop");
let sheetHideTimer: number | undefined;
function openSheet() {
  clearTimeout(sheetHideTimer);
  sheetBackdrop.hidden = false;
  void sheetBackdrop.offsetHeight; // land the hidden→shown frame, then transition
  sheetBackdrop.classList.add("is-open");
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  sheetBackdrop.classList.remove("is-open");
  document.body.style.overflow = "";
  sheetHideTimer = window.setTimeout(() => (sheetBackdrop.hidden = true), 250);
}
$("recordLine").addEventListener("click", openSheet);
$("sheetClose").addEventListener("click", closeSheet);
sheetBackdrop.addEventListener("click", (e) => {
  if (e.target === sheetBackdrop) closeSheet();
});
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && !sheetBackdrop.hidden) closeSheet();
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
initNotifications().catch((e) => console.error(e));
setInterval(refreshNow, 30_000);
setInterval(() => refreshAll().catch(() => {}), 300_000);
