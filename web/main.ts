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
  // label above, value, qualifier below — the qualifier carries the sample size
  // and the basis so the big number never has to be read with a caveat in mind.
  const tile = (label: string, val: string, note: string) =>
    `<div class="stat"><span class="stat__label">${label}</span><b>${val}</b><small>${note}</small></div>`;
  if (!m) {
    $("statsSub").textContent = "";
    $("stats").innerHTML = `<div class="empty-note">Collecting weekday-morning stats…</div>`;
    return;
  }
  const pctEmpty = m.pctEmptyByTarget == null ? "—" : `${Math.round(m.pctEmptyByTarget * 100)}%`;
  const c = m.commute;
  const pctCommute = c?.pctEmpty == null ? "—" : `${Math.round(c.pctEmpty * 100)}%`;
  $("statsSub").textContent = `over ${m.mornings} weekday morning${m.mornings === 1 ? "" : "s"}`;
  $("stats").innerHTML =
    tile("First empty", m.typicalFirstEmpty ?? "—", `typical, ${m.window[0]}–${m.window[1]}`) +
    tile(`Empty by ${m.targetTime}`, pctEmpty, `${m.mornings} mornings`) +
    tile(
      `Empty ${c?.window[0] ?? "—"}–${c?.window[1] ?? "—"}`,
      pctCommute,
      `share of time, ${c?.mornings ?? 0} mornings`,
    ) +
    tile("Mornings dry", String(m.sampleDays ?? 0), "ran out during the window");
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
  // at the 10pm run, so the latest one is about TODAY for most of the day and
  // only about tomorrow between 10pm and midnight. A stale guess (missed cron)
  // shows its actual date rather than lying.
  const todayKey = dateKey(new Date());
  $("tmrwWord").textContent =
    p.targetDate > todayKey ? "Tomorrow" : p.targetDate === todayKey ? "Today" : shortDate(p.targetDate);
  const prob = p.probability == null ? null : Math.round(p.probability * 100);
  const b = p.basis ?? {};
  const how =
    b.fallbackLevel === 0
      ? "day of week + rain + nudges"
      : b.fallbackLevel === 1
        ? "day of week + rain"
        : "broad day classes";
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

// err = predicted − actual: positive = ran out before the guess ("early").
const MISS_OK_MAX = 10; // green
const MISS_WARN_MAX = 30; // yellow; beyond this a guess is a miss, full stop
const missLabel = (e: number) => (e === 0 ? "spot on" : e > 0 ? `${e}m early` : `${-e}m late`);
const missColor = (e: number) =>
  Math.abs(e) <= MISS_OK_MAX ? "var(--ok)" : Math.abs(e) <= MISS_WARN_MAX ? "var(--low)" : "var(--empty)";

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
    // right call = the verdict matched AND, when a time was guessed, it was
    // close enough to act on (the yellow threshold). At a station that runs
    // out every day, the yes/no verdict alone is a free 100%.
    right: rows.filter(
      (r) => r.kind === "all-clear" || (r.kind === "graded" && Math.abs(r.err!) <= MISS_WARN_MAX),
    ).length,
    total: rows.length,
  };
}

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
  const note = `<p class="track__note">next prediction lands at 10pm — today's guess gets its official grade then too</p>`;
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
    tile(`${s.right}/${s.total} · ${Math.round((s.right / s.total) * 100)}%`, `right call · within ${MISS_WARN_MAX}m`) +
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
      <span style="color:var(--ok)">within ${MISS_OK_MAX}m</span>
      <span style="color:var(--low)">within ${MISS_WARN_MAX}m</span>
      <span style="color:var(--empty)">${MISS_WARN_MAX}m+</span></div>` +
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
        const { key } = (await (await fetch(`${PREDICTOR_API}/push/vapid-public-key`)).json()) as { key: string };
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

// ---------- MODEL RACE (bixi-forecaster, client #3) ----------
//
// A read-only window onto the shadow A/B. This dashboard still shows, and still
// gets notified about, the GAUSSIAN prediction in the Tomorrow card above —
// that arm is the control, and moving push to a challenger mid-window would
// confound the very comparison this card displays. So: look, don't act on it.
//
// Station 345 drains on weekday MORNINGS: the 10pm inventory is the seed and
// every time here is a moment in the following morning's commute. The strip
// therefore runs left-to-right across one morning, not one night.
//
// WHY IT IS DRAWN AS A RACE. The finish line is the truth — the moment the last
// bike actually went — and each arm brakes where it thinks that moment is.
// Braking early is guessing early; sailing past the line is guessing late. Both
// are misses, and the winner is whoever stops nearest. That inversion is the
// point: a bare time axis makes the latest guess look like the leader, which is
// exactly backwards.
//
// Every aggregate below is the forecaster's own /compare, which grades all arms
// with one piece of code against one definition of the actual. A second
// definition of "error" living in the dashboard would eventually disagree with
// the service and be believed anyway. nightWinners() is the one derived thing
// here, and it is careful about it.
const FORECASTER_API =
  location.hostname === "localhost" ? "http://localhost:8789/api/v1" : "https://bixi-forecaster.bixi.workers.dev/api/v1";

// The pre-registered sample size from the forecaster's docs/model.md. Shown as a
// progress count so the card can never be mistaken for a verdict before it is
// entitled to one.
const RACE_TARGET_NIGHTS = 40;

// One fixed hue per arm, never reassigned by rank — the control keeps its colour
// whether it is leading or last, so a change in the standings can never look
// like a change in who is who. Checked for >=3:1 against --card and for
// deuteran/protan separation before being used.
const ARMS: { key: string; label: string; note: string; c: string }[] = [
  { key: "gaussian", label: "Gaussian", note: "the control · this is what alerts you", c: "#e0484d" },
  { key: "ml", label: "ML", note: "trained on 27M trips network-wide", c: "#7a72e8" },
  { key: "blend", label: "Blend", note: "confidence-gated mix of both", c: "#2fa896" },
];

async function fetchRace(): Promise<{ compare: any; preds: any[] } | null> {
  try {
    const [cr, pr] = await Promise.all([
      fetch(`${FORECASTER_API}/compare?days=60`),
      // 60 days rather than 3: the form guide needs the whole shadow window
      // behind it. The strip still only ever draws the latest morning out of it.
      fetch(`${FORECASTER_API}/stations/${STATION}/predictions?days=60&all=1`),
    ]);
    if (!cr.ok) return null;
    const compare = (await cr.json()) as any;
    const preds = pr.ok ? ((await pr.json()) as any).predictions ?? [] : [];
    return { compare, preds };
  } catch {
    return null; // the whole card hides; the rest of the dashboard is unaffected
  }
}

// Strict on purpose. The forecaster's minsToHHMM() formats a negative minute as
// nonsense — `ml` published window.early "-1:-15" for 2026-08-03, meaning a
// bound 15 minutes BEFORE midnight — and a lenient split() reads that as -75,
// which stretches the strip's time axis across the entire day. Anything that is
// not a real wall clock is treated as absent.
const hhmmToMin = (s: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
};

// Always prefer the numeric bound. Forecaster minutes are measured from the
// TARGET day's midnight and go NEGATIVE for the previous evening — simulate.ts
// starts at -120 (22:00 the night before) — and a wall clock cannot carry that:
// "23:45" parses back to 1425 and would sort after a morning it precedes. The
// string is only a fallback for a forecaster deployed before window.*Minutes.
const windowMin = (w: any, side: "early" | "late"): number | null => {
  const n = w?.[`${side}Minutes`];
  return typeof n === "number" ? n : hhmmToMin(w?.[side]);
};

// Minutes-from-target-midnight to a short wall clock. These are commute-hour
// times, so the am/pm suffix is what makes "9:23" unambiguous at a glance.
//
// Minutes go NEGATIVE for the previous evening, and JavaScript's % keeps the
// sign of the dividend — the same trap that made the forecaster publish
// "-1:-15". Floor into range so -15 reads as 11:45p. This is not hypothetical
// here: window bounds routinely land before midnight, and an axis tick can too
// once the low end of the range is negative.
function gpClock(mins: number): string {
  const wrap = (n: number, m: number) => ((n % m) + m) % m;
  const h24 = wrap(Math.floor(mins / 60), 24);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${pad(wrap(mins, 60))}${h24 < 12 ? "a" : "p"}`;
}

// Which arm was closest each morning. /compare publishes only totals, so the
// per-morning marks in the form guide have to be read off the rows — but under
// the server's own rule, not a new one: both arms are measured against a SINGLE
// actual for the date, and a date where the arms disagree about the truth is
// dropped rather than guessed at (the same fault seedMismatches reports). The
// error values themselves are the server's `errorMinutes`, never recomputed.
function nightWinners(byDate: Map<string, any[]>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [d, rows] of byDate) {
    const scored = rows.filter((r: any) => r.finalizedAt != null && r.actual != null && r.errorMinutes != null);
    if (scored.length < 2) continue;
    if (new Set(scored.map((r: any) => r.actual.minutes)).size > 1) continue;
    let bestErr = Infinity;
    let best: string | null = null;
    let tie = false;
    for (const r of scored) {
      const e = Math.abs(r.errorMinutes);
      if (e < bestErr) {
        bestErr = e;
        best = r.variant;
        tie = false;
      } else if (e === bestErr) tie = true;
    }
    out.set(d, tie ? null : best);
  }
  return out;
}

// The finish line, before the forecaster has drawn it.
//
// `actual` is written by the 10pm grading run, so a morning that emptied at 8am
// carries no line for the rest of the day — while the monitor watched the last
// bike go in real time. This reads that same moment off the monitor's own empty
// episodes and drops the line early, marked unofficial until the grade lands.
//
// The rule is provisionalToday()'s, deliberately reused rather than restated:
// the first empty episode that STARTED today is the day's first bikes>0→0
// transition, which is the forecaster's runout_minutes. Two provisional
// gradings on one page that could disagree would be worse than neither. It
// agrees with the official one where both exist — Aug 1 601, Aug 2 707, equal
// to the graded rows to the minute.
//
// Today only, and nothing downstream consumes it: standings, MAE, the form
// guide and the graded count stay the forecaster's. A provisional line can
// change the strip; it can never change the experiment.
function provisionalRunout(date: string): number | null {
  if (date !== dateKey(new Date())) return null;
  const eps = ((lastEpEmpty?.episodes ?? []) as any[])
    .filter((e) => dateKey(new Date(e.start)) === date)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return eps.length ? hhmmToMins(clockLabel(eps[0].start)) : null;
}

// ---------- the strip ----------
// Geometry in viewBox units; the SVG scales to the card. V and DB are the car's
// speed and braking distance — all three cars run at the SAME speed so that the
// only thing the eye tracks is where each one hit the brakes, which is the only
// thing the model actually decided.
// TX/TW are the asphalt; L/R are the span the clock maps onto, inset far enough
// from the left edge to leave every car a run-up longer than its braking
// distance. The gutter left of TX belongs to the lane labels.
const GP = { TOP: 46, LANE: 38, TX: 88, TW: 586, L: 170, R: 650, X0: 96, V: 300, DB: 58 };
const GP_SEEN = "bixi.gp.lastPlayed";
const gpLaneY = (i: number) => GP.TOP + GP.LANE * i + GP.LANE / 2;
const gpReduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const GP_CAR =
  '<g id="gpcar">' +
  '<rect x="-19" y="-7" width="4.5" height="14" rx="1" fill="currentColor"/>' +
  '<rect x="-14.5" y="-10.5" width="9.5" height="6" rx="2" fill="#0a0d14"/>' +
  '<rect x="-14.5" y="4.5" width="9.5" height="6" rx="2" fill="#0a0d14"/>' +
  '<rect x="4" y="-10" width="8.5" height="5.5" rx="2" fill="#0a0d14"/>' +
  '<rect x="4" y="4.5" width="8.5" height="5.5" rx="2" fill="#0a0d14"/>' +
  '<path d="M18 0 L7 -3.5 L-15 -5 L-15 5 L7 3.5 Z" fill="currentColor"/>' +
  '<rect x="-9" y="-7.5" width="13" height="15" rx="3.5" fill="currentColor"/>' +
  '<rect x="15" y="-8" width="3.5" height="16" rx="1" fill="currentColor"/>' +
  '<circle cx="-2.5" cy="0" r="3" fill="#0a0d14" opacity=".55"/></g>';

interface GpLane {
  y: number;
  p: number; // where this car stops
  bp: number; // where it starts braking
  db: number;
  tb: number; // seconds until the brakes come on
  td: number; // seconds spent braking
  a: number; // deceleration
  car: SVGElement;
  brake: SVGElement;
  skid: SVGElement;
  gap: SVGElement | null;
}

let gpPlan: GpLane[] = [];
let gpRaf: number | null = null;
let gpSig = ""; // last-rendered content; keeps the 5-minute poll from restarting a run
let gpFocusX: number | null = null; // centre of the action, in viewBox units
// Which morning the strip is showing, and the payload to redraw from when that
// changes without a refetch. `raceDate` survives the 5-minute poll so a chosen
// morning is not yanked back to the default under the reader.
let raceDate: string | null = null;
// The local date that choice was made under. `raceDate` is sticky by design, so
// without this a dashboard left open overnight — a Home-Screen PWA is left open
// for days — would still be parked on the morning that was current when it was
// opened. Not equal to today = the selection has expired, whoever made it.
let raceDay: string | null = null;
let lastRace: { compare: any; preds: any[] } | null = null;
// The monitor's own empty episodes, for the provisional finish line below. Set
// in refreshAll beside lastToday/lastStats; the strip redraws from it on a tab
// click too, so it has to outlive the render that fetched it.
let lastEpEmpty: any = null;

// Keep the interesting part of the strip in view when it is too wide to fit.
// Called on render and again on resize: a phone rotated from portrait to
// landscape re-lays-out without re-rendering, and the finish line would
// otherwise be left off the right edge where nobody would think to look.
function gpParkScroll() {
  const box = $("raceTrack").parentElement;
  if (!box || gpFocusX == null) return;
  if (box.scrollWidth <= box.clientWidth) {
    box.scrollLeft = 0;
    return;
  }
  box.scrollLeft = Math.max(0, gpFocusX * (box.scrollWidth / 700) - box.clientWidth / 2);
}

const gapLabel = (err: number) => (err === 0 ? "on the line" : err < 0 ? `${-err}m early` : `${err}m late`);

function renderTrack(rows: any[], graded: boolean, prov: number | null) {
  const svg = $("raceTrack");
  const lanes = ARMS.map((arm) => {
    const r = rows.find((x: any) => x.variant === arm.key) ?? null;
    return {
      arm,
      row: r,
      pred: (r?.predicted?.minutes ?? null) as number | null,
      early: windowMin(r?.window, "early"),
      late: windowMin(r?.window, "late"),
      err: typeof r?.errorMinutes === "number" ? (r.errorMinutes as number) : null,
    };
  });

  // One actual for the whole morning. Arms that were graded against different
  // truths are a fault in the experiment, not a result — draw no line at all
  // rather than pick one of them to believe. The monitor's own sighting fills in
  // only where the forecaster has said nothing yet; it is not a casting vote in
  // a disagreement, so a mismatch still draws nothing.
  const truths = new Set(rows.filter((r: any) => r.actual != null).map((r: any) => r.actual.minutes as number));
  const unofficial = truths.size === 0 && prov != null;
  const actual = truths.size === 1 ? [...truths][0] : unofficial ? prov : null;

  // The server's errorMinutes is exactly predicted − actual (checked against the
  // graded rows: gaussian 617 − 707 = −90), so a provisional line can be scored
  // with the server's own subtraction rather than a second definition of error.
  // Negative = braked early, which is what gapLabel below reads. NOTE this is
  // the opposite sign convention from missLabel/scoreRow in the track record,
  // which is about when the bikes went, not about where the car stopped.
  if (unofficial) for (const l of lanes) if (l.pred != null) l.err = l.pred - actual!;

  // Anchor the clock on the things that are certainly times — the point
  // forecasts and the actual — then let windows widen it only if they land
  // within a morning's reach of that core. One malformed bound upstream should
  // cost the strip a shaded band, not its whole axis.
  const core: number[] = [];
  for (const l of lanes) if (l.pred != null) core.push(l.pred);
  if (actual != null) core.push(actual);
  if (!core.length) {
    svg.innerHTML = "";
    $("raceGuesses").innerHTML = "";
    gpPlan = [];
    return;
  }
  let lo = Math.min(...core);
  let hi = Math.max(...core);
  for (const l of lanes)
    for (const v of [l.early, l.late])
      if (v != null && v > lo - 180 && v < hi + 180) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  const margin = Math.max(18, (hi - lo) * 0.14);
  lo -= margin;
  hi += margin;
  if (hi - lo < 100) {
    const mid = (lo + hi) / 2;
    lo = mid - 50;
    hi = mid + 50;
  }
  const xOf = (m: number) => GP.L + ((m - lo) / (hi - lo)) * (GP.R - GP.L);
  const H = GP.LANE * ARMS.length;
  const BOT = GP.TOP + H;

  // Asphalt sits DARKER than the card so the track reads as a recess and the
  // arm colours have something to pop against. Kerbs and lane shading are
  // clipped to the rounded rect so nothing squares off the corners.
  let s =
    `<defs>${GP_CAR}<clipPath id="gptrack"><rect x="${GP.TX}" y="${GP.TOP}" width="${GP.TW}" height="${H}" rx="7"/></clipPath></defs>` +
    `<rect x="${GP.TX}" y="${GP.TOP}" width="${GP.TW}" height="${H}" rx="7" fill="#0c1017"/>` +
    `<g clip-path="url(#gptrack)">`;
  // Alternate lanes get a breath of light, so which lane a car is in is legible
  // without tracing back to the label.
  for (let k = 0; k < ARMS.length; k += 2)
    s += `<rect x="${GP.TX}" y="${GP.TOP + GP.LANE * k}" width="${GP.TW}" height="${GP.LANE}" fill="#8fa0c4" opacity=".045"/>`;
  const KERB = GP.TW / 26;
  for (let i = 0; i < 26; i++) {
    const kx = (GP.TX + i * KERB).toFixed(1);
    s += `<rect x="${kx}" y="${GP.TOP}" width="${KERB.toFixed(1)}" height="5" fill="${i % 2 ? "#e0484d" : "#dfe4ee"}" opacity=".55"/>`;
    s += `<rect x="${kx}" y="${BOT - 5}" width="${KERB.toFixed(1)}" height="5" fill="${i % 2 ? "#dfe4ee" : "#e0484d"}" opacity=".55"/>`;
  }
  for (let k = 1; k < ARMS.length; k++)
    s += `<line x1="${GP.TX + 6}" y1="${GP.TOP + GP.LANE * k}" x2="${GP.TX + GP.TW - 6}" y2="${GP.TOP + GP.LANE * k}" stroke="#39445c" stroke-dasharray="10 12"/>`;
  s += `</g>`;

  const step = hi - lo > 150 ? 60 : 30;
  for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) {
    s += `<line x1="${xOf(m).toFixed(1)}" y1="${BOT}" x2="${xOf(m).toFixed(1)}" y2="${BOT + 5}" stroke="#232c42"/>`;
    s += `<text x="${xOf(m).toFixed(1)}" y="${BOT + 19}" fill="#69728c" font-size="10.5" text-anchor="middle">${gpClock(m)}</text>`;
  }

  // The line goes down FIRST, before any car moves. Everything after it is three
  // attempts to stop on a target the viewer can already see.
  //
  // A provisional line is the same line, ghosted: the run-out is a fact either
  // way, and washing the chequer out is enough to say the grade behind it is not
  // in yet without inventing a second kind of finish line.
  if (actual != null) {
    const fx = xOf(actual);
    const cell = H / 14;
    s += `<g opacity="${unofficial ? ".55" : "1"}">`;
    for (let r = 0; r < 14; r++)
      for (let c = 0; c < 2; c++)
        s += `<rect x="${(fx - 6 + c * 6).toFixed(1)}" y="${(GP.TOP + r * cell).toFixed(1)}" width="6" height="${cell.toFixed(2)}" fill="${(r + c) % 2 ? "#0a0d14" : "#f2f5fb"}"/>`;
    s += `</g>`;
    // Stacked, not "11:53a · unofficial" on one line: the line sits near the
    // right of the strip, which on a phone is scrolled almost to the edge of the
    // window, and the wider single line carried the TIME out of view. Two short
    // lines stay inside it.
    s += `<text x="${fx.toFixed(1)}" y="${GP.TOP - (unofficial ? 21 : 10)}" fill="${unofficial ? "#9aa6c0" : "#f2f5fb"}" font-size="10.5" font-weight="700" text-anchor="middle">ran out ${gpClock(actual)}</text>`;
    if (unofficial)
      s += `<text x="${fx.toFixed(1)}" y="${GP.TOP - 10}" fill="#69728c" font-size="9" text-anchor="middle">unofficial</text>`;
  }

  const geo: { i: number; y: number; p: number; bp: number; db: number }[] = [];
  lanes.forEach((l, i) => {
    const y = gpLaneY(i);
    // Lane label sits in the gutter left of the asphalt, vertically centred on
    // its own lane rather than floating above the kerb.
    s += `<text x="8" y="${y + 3.5}" fill="${l.arm.c}" font-size="9.5" font-weight="700">${l.arm.label.toUpperCase()}</text>`;
    if (l.pred == null) {
      s += `<text x="${GP.L}" y="${y + 4}" fill="#69728c" font-size="11">${l.row ? "says it won't run out" : "no row"}</text>`;
      return;
    }
    // A window can legitimately run past the ends of the axis; clip it to the
    // asphalt instead of letting the band spill off the track.
    if (l.early != null && l.late != null) {
      const w0 = Math.max(GP.TX + 4, xOf(l.early));
      const w1 = Math.min(GP.TX + GP.TW - 4, xOf(l.late));
      if (w1 > w0)
        s += `<rect x="${w0.toFixed(1)}" y="${y - 13}" width="${(w1 - w0).toFixed(1)}" height="26" rx="4" fill="${l.arm.c}" opacity=".12"/>`;
    }
    const p = xOf(l.pred);
    const db = Math.min(GP.DB, Math.max(10, p - GP.X0 - 6));
    geo.push({ i, y, p, bp: p - db, db });
    s += `<rect data-skid="${i}" x="${(p - db).toFixed(1)}" y="${y - 9}" width="0" height="18" fill="#0a0d14" opacity=".45"/>`;
    s += `<g data-car="${i}" style="color:${l.arm.c}" transform="translate(${GP.X0},${y})"><rect data-brake="${i}" x="-24" y="-7" width="4.5" height="14" rx="2" fill="#ff5d5d" opacity="0"/><use href="#gpcar" transform="scale(1.12)"/></g>`;
    if (actual != null && l.err != null) {
      // Sits on the far side of the car from the line, vertically centred in its
      // own lane — above the car it would land on the kerb.
      const left = l.err < 0;
      s += `<g data-gap="${i}" opacity="0"><text x="${(left ? p - 30 : p + 30).toFixed(1)}" y="${y + 3.5}" fill="${l.arm.c}" font-size="10.5" font-weight="700" text-anchor="${left ? "end" : "start"}">${gapLabel(l.err)}</text></g>`;
    }
  });

  // Keyed on the line, not on the grade: "graded" alone could not say the one
  // thing that is now possible — a real line with no official grade behind it.
  const caption =
    actual != null
      ? unofficial
        ? "drawn live from the station — tonight's grade makes it official"
        : "the line is when the bikes actually ran out — closest to it wins"
      : graded
        ? "nobody ran out this morning — there was no line to aim at"
        : "no line yet — it drops where the last bike goes";
  s += `<text x="350" y="${BOT + 40}" fill="#69728c" font-size="10.5" text-anchor="middle">${caption}</text>`;
  svg.innerHTML = s;

  // Each arm's guess spelled out, in lane order so it cross-reads with the
  // track above. The window is worth showing next to it: a band clipped at the
  // edge of the asphalt tells you it runs past the view but not how far.
  // The run-out itself leads the guesses it is measured against — same reason
  // the guesses are out here and not in the SVG. The strip parks near the finish
  // line, and a morning where every arm braked hours early is wide enough that
  // the phone's scroll window carries the in-SVG label off the edge. This is the
  // one number the whole card is about; it does not get to scroll away. Four
  // cells like every other row, empty <em> included, or the grid shifts.
  const lineEntry =
    actual == null
      ? ""
      : `<span class="gp-g-line${unofficial ? " gp-g-line--prov" : ""}"><i class="gp-g-flag"></i>` +
        `<span class="gp-g-name">Ran out</span><b>${gpClock(actual)}</b><em>${unofficial ? "unofficial" : ""}</em></span>`;
  $("raceGuesses").innerHTML =
    lineEntry +
    lanes
      .map((l) => {
        const t = !l.row ? "no row" : l.pred == null ? "says it won't run out" : gpClock(l.pred);
        const w = l.pred != null && l.early != null && l.late != null ? `${gpClock(l.early)}–${gpClock(l.late)}` : "";
        // Every row emits all four cells, empty window included. On narrow
        // screens these spans become `display: contents` so the whole block is
        // one grid and the times line up down a column — a row short a cell
        // would slide every later row into the wrong column.
        return (
          `<span><i style="background:${l.arm.c}"></i><span class="gp-g-name">${l.arm.label}</span>` +
          `<b>${t}</b><em>${w}</em></span>`
        );
      })
      .join("");
  svg.setAttribute(
    "aria-label",
    actual == null
      ? `Three model arms staged at the time each predicts station 345 runs out.`
      : `Station 345 ran out at ${gpClock(actual)}${unofficial ? ", not yet officially graded" : ""}. ` +
          lanes
            .filter((l) => l.err != null)
            .map((l) => `${l.arm.label} ${gapLabel(l.err!)}`)
            .join(", ") +
          ".",
  );

  // On a narrow screen the strip scrolls. Remember where the action is — the
  // cars and the finish line — so it can be parked in view now and re-parked
  // whenever the viewport changes size under it.
  const xs = geo.map((g) => g.p);
  if (actual != null) xs.push(xOf(actual));
  gpFocusX = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : null;
  gpParkScroll();

  // Same speed for every car; only the braking point differs. Stopping first
  // therefore means braking earliest, which means the model guessed earliest —
  // a faithful reading, not a ranking, because the line is already on screen.
  gpPlan = geo.map((g) => {
    const td = (2 * g.db) / GP.V;
    return {
      y: g.y,
      p: g.p,
      bp: g.bp,
      db: g.db,
      tb: (g.bp - GP.X0) / GP.V,
      td,
      a: GP.V / td,
      car: svg.querySelector(`[data-car="${g.i}"]`) as SVGElement,
      brake: svg.querySelector(`[data-brake="${g.i}"]`) as SVGElement,
      skid: svg.querySelector(`[data-skid="${g.i}"]`) as SVGElement,
      gap: svg.querySelector(`[data-gap="${g.i}"]`) as SVGElement | null,
    };
  });
}

// The resting state, and the only state that ever has to be correct: cars parked
// on their guesses with the line drawn and the gaps labelled. The animation is
// pure enhancement on top of it, so reduced-motion and a dead rAF both land here.
function gpSettle() {
  if (gpRaf != null) {
    cancelAnimationFrame(gpRaf);
    gpRaf = null;
  }
  for (const q of gpPlan) {
    q.car.setAttribute("transform", `translate(${q.p.toFixed(1)},${q.y})`);
    q.skid.setAttribute("width", q.db.toFixed(1));
    q.brake.setAttribute("opacity", "0");
    q.gap?.setAttribute("opacity", "1");
  }
}

// Returns whether the race actually started, so the caller can tell a run from a
// refusal — the auto-play below only spends its one-shot token on a run.
//
// `force` is for the ↻ button. prefers-reduced-motion means "do not move things
// at me that I did not ask for", and it rightly kills the auto-play — but a
// press of a control labelled REPLAY is the asking. Declining that read as a
// dead button, which is how this surfaced: nothing happened, on every click.
// A hidden tab still refuses no matter what, because it physically cannot run.
function gpPlay(force = false): boolean {
  if (!gpPlan.length) return false;
  // A hidden tab does not run rAF. Starting a run here would put the cars back
  // on the grid and then never move them again, so returning to the dashboard
  // would show an empty track with no result on it — worse than no animation.
  // The auto-play fires on load, which is exactly when a restored background
  // tab is most likely to be hidden, so this is the common case and not an edge.
  if (document.hidden || (!force && gpReduced())) {
    gpSettle();
    return false;
  }
  if (gpRaf != null) cancelAnimationFrame(gpRaf);
  const end = Math.max(0, ...gpPlan.map((q) => q.tb + q.td));
  for (const q of gpPlan) {
    q.car.setAttribute("transform", `translate(${GP.X0},${q.y})`);
    q.skid.setAttribute("width", "0");
    q.brake.setAttribute("opacity", "0");
    q.gap?.setAttribute("opacity", "0");
  }
  let t0: number | null = null;
  const frame = (ts: number) => {
    if (t0 == null) t0 = ts;
    const el = (ts - t0) / 1000;
    for (const q of gpPlan) {
      let x: number;
      let br = 0;
      if (el <= q.tb) x = GP.X0 + GP.V * el;
      else if (el <= q.tb + q.td) {
        const d = el - q.tb;
        x = q.bp + GP.V * d - 0.5 * q.a * d * d;
        br = 1;
      } else {
        x = q.p;
        br = Math.max(0, 1 - (el - q.tb - q.td) * 2.4);
      }
      q.car.setAttribute("transform", `translate(${x.toFixed(1)},${q.y})`);
      q.brake.setAttribute("opacity", br.toFixed(2));
      q.skid.setAttribute("width", Math.max(0, Math.min(q.db, x - q.bp)).toFixed(1));
      if (q.gap && el > q.tb + q.td + 0.2)
        q.gap.setAttribute("opacity", Math.min(1, (el - q.tb - q.td - 0.2) * 3).toFixed(2));
    }
    if (el < end + 1.2) gpRaf = requestAnimationFrame(frame);
    else gpSettle();
  };
  gpRaf = requestAnimationFrame(frame);
  return true;
}

// The morning whose race is still owed an auto-play, or null. A tab that loads
// in the background cannot run rAF, and Chrome reports `hidden` for a window it
// considers occluded too — so "there is a result you have not watched" has to
// outlive the render that discovered it.
let gpOwed: string | null = null;

// Spend the one-shot token only on a race that actually RAN. Marking a morning
// seen and then refusing to animate it burned the auto-play on a race nobody
// watched, and nothing ever offered it again — the strip only re-renders when
// the data changes, which for a finished morning is never.
function gpAutoPlay(): boolean {
  if (!gpOwed || !gpPlay()) return false;
  try {
    localStorage.setItem(GP_SEEN, gpOwed);
  } catch {
    /* private mode — it simply replays next time, which is the harmless way round */
  }
  gpOwed = null;
  return true;
}

// ---------- the standings ----------
function renderTower(compare: any, winners: Map<string, string | null>, graded: number) {
  const scores: any[] = compare.scores ?? [];
  const ranked = ARMS.map((arm) => ({ arm, s: scores.find((x: any) => x.variant === arm.key) ?? null })).sort(
    (a, b) => (a.s?.mae ?? Infinity) - (b.s?.mae ?? Infinity),
  );
  const best = ranked[0]?.s?.mae ?? null;
  const resolution = gpResolution(compare, graded);
  const dates = [...winners.keys()].sort();

  $("raceTower").innerHTML = ranked
    .map((r, i) => {
      const mae = r.s?.mae ?? null;
      const gap = mae != null && best != null ? mae - best : null;
      // A gap the experiment cannot yet resolve is shown as approximate rather
      // than as a number, so a lead that is pure sampling noise never renders
      // the same way as one that has cleared the bar.
      const soft = gap != null && resolution != null && gap < resolution;
      const gapTxt =
        mae == null
          ? "—"
          : i === 0
            ? "<b>leader</b>"
            : `<span class="${soft ? "gp-soft" : ""}">${soft ? "≈" : ""}+${gap!.toFixed(1)}</span>`;
      const form = Array.from({ length: RACE_TARGET_NIGHTS }, (_, j) => {
        const d = dates[j];
        if (!d) return `<i class="gp-blk"></i>`;
        const w = winners.get(d);
        const won = w === r.arm.key;
        return `<i class="gp-blk" style="background:${r.arm.c};opacity:${won ? 1 : 0.16}" title="${shortDate(d)} — ${won ? "closest" : w ? "beaten" : "tied"}"></i>`;
      }).join("");
      return `<div class="gp-row">
        <span class="gp-pos${graded < RACE_TARGET_NIGHTS ? " gp-pos--prov" : ""}">P${i + 1}</span>
        <i class="gp-chip" style="background:${r.arm.c}"></i>
        <span class="gp-name">${r.arm.label}<small>${r.arm.note}</small></span>
        <span class="gp-gap">${gapTxt}</span>
        <span class="gp-form" role="img" aria-label="${r.arm.label}: closest on ${dates.filter((d) => winners.get(d) === r.arm.key).length} of ${dates.length} graded mornings">${form}</span>
      </div>`;
    })
    .join("");
}

// The published floor is the one that applies at the full 40 mornings. Paired
// error shrinks with sqrt(n), so today's floor is that same number scaled back
// up — anchored to the server's constant rather than a second one invented here,
// and equal to it exactly at n = RACE_TARGET_NIGHTS.
function gpResolution(compare: any, graded: number): number | null {
  const d = compare.interpretation?.detectableEffectMinutes;
  if (typeof d !== "number" || graded <= 0) return null;
  return d * Math.sqrt(RACE_TARGET_NIGHTS / graded);
}

function renderRace(data: { compare: any; preds: any[] } | null) {
  const card = $("raceCard");
  if (!data) return; // stays hidden — a forecaster outage must not blank the dashboard
  card.hidden = false;
  lastRace = data;
  const { compare, preds } = data;
  const graded: number = compare.gradedNights ?? 0;
  $("raceProgress").textContent = `${graded}/${RACE_TARGET_NIGHTS} mornings`;

  const byDate = new Map<string, any[]>();
  for (const p of preds) {
    if (!byDate.has(p.targetDate)) byDate.set(p.targetDate, []);
    byDate.get(p.targetDate)!.push(p);
  }
  const dates = [...byDate.keys()].sort();
  const newest = dates[dates.length - 1];
  if (!newest) return;

  // Mornings worth offering: the last one with a finish line on it, the one
  // happening now, and the next one the cron has published a forecast for.
  // Today is named explicitly rather than left to fall out of the other two —
  // between the 10pm run and the next grade it is neither. Label them by DATE:
  // "this morning" and "last finish" both had to be decoded, and at 9pm neither
  // one obviously meant "yesterday". A date needs no decoding.
  const todayKeyNow = dateKey(new Date());
  const isGradedOn = (d: string) => byDate.get(d)!.some((r: any) => r.finalizedAt != null);
  const lastGraded = dates.filter(isGradedOn).pop();
  const today = byDate.has(todayKeyNow) ? todayKeyNow : undefined;
  // Deduped and oldest-first, so the finished morning always sits on the left.
  const choices = [...new Set([lastGraded, today, newest].filter(Boolean) as string[])].sort();

  // Default to the latest morning that has actually happened — today whenever
  // the cron has published for it, which is the race you are in and which the
  // provisional line below can finish hours before the forecaster grades it.
  // Sorting for recency rather than reaching for `today` directly also covers
  // the night the cron misses: the most recent real morning stands in, instead
  // of skipping back past it to the last GRADED one. A future date is only ever
  // the default when it is the only thing on offer.
  //
  // A chosen morning survives the 5-minute poll, but not the date rolling over:
  // at midnight yesterday stops being the current race, whoever picked it.
  if (!raceDate || !choices.includes(raceDate) || raceDay !== todayKeyNow) {
    raceDate = choices.filter((d) => d <= todayKeyNow).pop() ?? newest;
    raceDay = todayKeyNow;
  }
  const shown = raceDate;
  const rows = byDate.get(shown)!;
  const isGraded = rows.some((r: any) => r.finalizedAt != null);
  // Once per render, not once per use: it walks every episode of the last 30
  // days through Intl to bucket them by local day.
  const todayRunout = provisionalRunout(todayKeyNow);
  const prov = shown === todayKeyNow ? todayRunout : null;

  $("raceDates").innerHTML = choices
    .map((d) => {
      // A date that has not arrived yet carries no tag — "still running" was
      // flatly wrong there. Today's says whether the bikes have gone, which is
      // the whole question the card exists to answer.
      const tag = isGradedOn(d)
        ? " · finished"
        : d > todayKeyNow
          ? ""
          : d === todayKeyNow
            ? todayRunout != null
              ? " · ran out"
              : " · running"
            : "";
      return `<button role="tab" data-date="${d}" class="${d === shown ? "is-active" : ""}">${friendlyTarget(d)}${tag}</button>`;
    })
    .join("");

  // The flag says what is true in plain words. It happens to be yellow.
  const flag = $("raceFlag");
  flag.hidden = false;
  flag.className = graded >= RACE_TARGET_NIGHTS ? "gp-flag gp-flag--done" : "gp-flag";
  flag.innerHTML =
    graded >= RACE_TARGET_NIGHTS
      ? `<i class="gp-flag__k"></i><b>${graded} mornings complete</b><em>the decision rule can be applied now</em>`
      : // "Not counting yet" read as "we haven't started counting" — the opposite
        // of the truth when 2 mornings are already on the books. Say which thing
        // doesn't count, and don't presume a winner is coming: "no detectable
        // difference" is a real and likely outcome here.
        `<i class="gp-flag__dot"></i><b>Nothing decided yet</b><em>${RACE_TARGET_NIGHTS - graded} more mornings before the standings below mean anything</em>`;


  // Rebuild the strip only when its content actually changed, so the 5-minute
  // poll cannot restart an animation halfway through.
  // `prov` belongs in here: the run-out can land under an open dashboard, and
  // the strip has to redraw when it does.
  const sig = `${shown}|${isGraded}|${prov ?? ""}|${rows
    .map((r: any) => `${r.variant}:${r.predicted?.minutes ?? ""}:${r.actual?.minutes ?? ""}`)
    .sort()
    .join(",")}`;
  if (sig !== gpSig) {
    gpSig = sig;
    renderTrack(rows, isGraded, prov);
    // Auto-play once, for a result you have not seen yet — a provisional line
    // counts, since that is the moment the race is actually decided. Keyed on
    // the date, so tonight's official grade redraws quietly instead of replaying
    // a race already watched. If the browser will not animate right now the debt
    // is remembered rather than written off; visibilitychange settles it.
    const hasLine = isGraded || prov != null;
    gpOwed = null;
    try {
      if (hasLine && localStorage.getItem(GP_SEEN) !== shown) gpOwed = shown;
    } catch {
      /* private mode — no bookkeeping, and the resting state is still correct */
    }
    ($("raceReplay") as HTMLButtonElement).hidden = !hasLine || !gpPlan.length;
    if (!gpAutoPlay()) gpSettle();
  }

  renderTower(compare, nightWinners(byDate), graded);

  const res = gpResolution(compare, graded);
  const mism = (compare.seedMismatches ?? []).length;
  $("raceNote").innerHTML =
    (mism
      ? `<span class="gp-warn">⚠ ${mism} morning${mism === 1 ? "" : "s"} where the arms started from different 10pm
         inventories — that is a flaw in the experiment, not a result.</span>`
      : "") +
    (graded === 0
      ? `No graded mornings yet. The first result lands once a morning has been finalized.`
      : graded < RACE_TARGET_NIGHTS
        ? `<b>Too close to call.</b> At ${graded} morning${graded === 1 ? "" : "s"}, a gap under
           ±${Math.round(res!)} min means nothing at all. That bar tightens to
           ±${compare.interpretation?.detectableEffectMinutes ?? 22} by morning ${RACE_TARGET_NIGHTS} — and a real
           winner also has to be closest on 27 of the 40, not just on average.`
        : `${graded} mornings in. Read the full decision rule with <code>npm run scoreboard</code> — the average
           alone does not settle it.`);
}

$("raceReplay").addEventListener("click", () => gpPlay(true));
window.addEventListener("resize", gpParkScroll);

$("raceDates").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (!b || !lastRace || b.dataset.date === raceDate) return;
  raceDate = b.dataset.date!;
  renderRace(lastRace);
  // Choosing a morning is a request to watch it run, exactly as much as a press
  // of ↻ is — so it forces past reduced-motion the same way, and for the same
  // reason: the motion was asked for. Unforced, this was a dead tab strip on a
  // reduced-motion desktop while the identical tap animated on a phone.
  // A hidden tab still refuses, because rAF genuinely does not run there.
  gpPlay(true);
});

// Frames stop arriving the moment the tab is backgrounded. Land on the resting
// state rather than leaving a race frozen halfway down the track — and on the
// way back in, run any race that was owed one because the tab was hidden when
// its result arrived.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (gpRaf != null) gpSettle();
  } else gpAutoPlay();
});

// ---------- orchestration ----------
let lastRefresh = 0;

async function refreshNow() {
  try {
    renderHero(await api("now"));
  } catch {
    /* keep last good render */
  }
}
async function refreshAll() {
  const [n, today, stats, epEmpty, epFull, prediction, scored, race] = await Promise.all([
    api("now"),
    api("observations?from=" + (Math.floor(Date.now() / 1000) - 86400)),
    api("stats?days=30"),
    api("episodes?type=empty&days=30"),
    api("episodes?type=full&days=30"),
    fetchPrediction(), // resolves null on any failure — the card degrades alone
    fetchTrackRecord(), // [] on failure — same deal
    fetchRace(), // null on failure — the race card stays hidden, nothing else moves
  ]);
  // assign all three before rendering: today + episodes read lastStats for
  // holiday tags, and the race reads lastEpEmpty for its provisional finish line
  lastToday = today;
  lastStats = stats;
  lastEpEmpty = epEmpty;
  lastRefresh = Date.now();
  renderHero(n);
  renderToday();
  renderHeatmap();
  renderStats();
  renderEpisodes(epEmpty, epFull);
  renderTomorrow(prediction);
  renderRace(race);
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

// iOS suspends a backgrounded PWA's timers, so the Home-Screen app comes back
// showing whatever was on screen when it was put away — and after midnight that
// includes the wrong morning, which is the case the default above exists to fix.
// Catch it up on the way back in, rate-limited so flicking between tabs does not
// hammer the API.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastRefresh > 60_000) refreshAll().catch(() => {});
});

refreshAll().catch((e) => console.error(e));
initNotifications().catch((e) => console.error(e));
setInterval(refreshNow, 30_000);
setInterval(() => refreshAll().catch(() => {}), 300_000);
