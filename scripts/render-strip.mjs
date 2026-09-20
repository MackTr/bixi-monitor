#!/usr/bin/env node
// Renders the race strip as a standalone still — the same picture the dashboard
// draws, minus the browser. This is a deliberate PORT of renderTrack() in
// web/main.ts, not a lookalike: geometry (GP), the car path, the arm colours,
// the kerb/lane/chequer construction and the draw ORDER are copied from it, so
// a still made here and a screenshot of the live card are the same image.
//
// The one difference is state: the live strip builds the grid and animates into
// the settled state, and a still has no animation to run, so cars are written
// straight to their final positions with skids at full length and the gap
// labels already up — exactly what gpSettle() leaves behind.
//
//   node scripts/render-strip.mjs --png
//   node scripts/render-strip.mjs --gaussian -11 --ml 7 --blend -6 --actual 8:13a
//
// Errors are signed MINUTES the way the API's errorMinutes is: negative =
// braked early = guessed before the bikes went, positive = late. Keeping that
// convention means the numbers you pass here read the same as the ones in the
// real payload, and gapLabel below is the app's own, unchanged.
import { writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt;
};

// "8:13a" | "8:13p" | "493" -> minutes from midnight
function parseClock(v) {
  if (/^-?\d+$/.test(v)) return +v;
  const m = /^(\d{1,2}):(\d{2})\s*([ap])?m?$/i.exec(v.trim());
  if (!m) throw new Error(`unreadable time: ${v} (want 8:13a or minutes)`);
  let h = +m[1] % 12;
  if (m[3]?.toLowerCase() === "p") h += 12;
  return h * 60 + +m[2];
}

const ACTUAL = parseClock(opt("actual", "8:13a"));
const UNOFFICIAL = !flag("official");
const CAPTION = flag("caption");
const BG = opt("bg", "#141b2b");
const SCALE = +opt("scale", 3);
const OUT = resolve(ROOT, opt("out", "race-strip.svg"));

// Signed error per arm, and how wide each one's window was. The widths differ
// per arm on purpose — a band is a claim about confidence, and three identical
// bands would say all three models were equally sure, which is never true.
const GAUSSIAN = { err: +opt("gaussian", -11), win: +opt("gaussian-window", 30) };
const ML = { err: +opt("ml", 7), win: +opt("ml-window", 26) };

// Blend is not a third opinion about the morning — it is the other two, gated
// by how sure each one was, which is what the dashboard calls it in as many
// words: "confidence-gated mix of both". So it is DERIVED here rather than
// typed in. A blend parked outside its parents, or leaning towards the one
// with the WIDER window, is not a mix, and a still of this strip gets read as
// a claim about how the three arms relate to each other.
//
// Inverse-variance weighting with each window read as ±1σ: the tighter arm
// pulls harder, and the combined window falls out tighter than either parent's
// — which is the entire reason for blending two forecasts in the first place.
// Errors mix exactly like the times they came from, since every prediction is
// the same actual plus its error and the weights sum to 1.
function confidenceGatedMix(a, b) {
  const wa = 1 / (a.win / 2) ** 2;
  const wb = 1 / (b.win / 2) ** 2;
  return { err: (a.err * wa + b.err * wb) / (wa + wb), win: 2 / Math.sqrt(wa + wb), lean: (wa / (wa + wb)) * 100 };
}
const MIXED = confidenceGatedMix(GAUSSIAN, ML);
const BLEND = {
  err: argv.includes("--blend") ? +opt("blend") : Math.round(MIXED.err),
  win: argv.includes("--blend-window") ? +opt("blend-window") : Math.round(MIXED.win),
};

const LANES = [
  { key: "gaussian", label: "Gaussian", c: "#e0484d", ...GAUSSIAN },
  { key: "ml", label: "ML", c: "#7a72e8", ...ML },
  { key: "blend", label: "Blend", c: "#2fa896", ...BLEND },
];

// ---------- app constants, copied from web/main.ts ----------
const GP = { TOP: 46, LANE: 38, TX: 88, TW: 586, L: 170, R: 650, X0: 96, V: 300, DB: 58 };
const gpLaneY = (i) => GP.TOP + GP.LANE * i + GP.LANE / 2;
const pad = (n) => String(n).padStart(2, "0");

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

// Minutes go negative for the previous evening and JS's % keeps the dividend's
// sign — floor into range so -15 reads 11:45p rather than "-1:-15".
function gpClock(mins) {
  const wrap = (n, m) => ((n % m) + m) % m;
  const h24 = wrap(Math.floor(mins / 60), 24);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${pad(wrap(mins, 60))}${h24 < 12 ? "a" : "p"}`;
}
const gapLabel = (err) => (err === 0 ? "on the line" : err < 0 ? `${-err}m early` : `${err}m late`);

// ---------- the strip ----------
const lanes = LANES.map((l) => ({
  ...l,
  pred: ACTUAL + l.err,
  early: ACTUAL + l.err - Math.round(l.win / 2),
  late: ACTUAL + l.err + Math.round(l.win / 2),
}));

// Anchor the clock on the things that are certainly times, then let windows
// widen it only if they land within a morning's reach of that core.
let lo = Math.min(ACTUAL, ...lanes.map((l) => l.pred));
let hi = Math.max(ACTUAL, ...lanes.map((l) => l.pred));
for (const l of lanes)
  for (const v of [l.early, l.late])
    if (v > lo - 180 && v < hi + 180) {
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
const xOf = (m) => GP.L + ((m - lo) / (hi - lo)) * (GP.R - GP.L);
const H = GP.LANE * lanes.length;
const BOT = GP.TOP + H;

let s =
  `<defs>${GP_CAR}<clipPath id="gptrack"><rect x="${GP.TX}" y="${GP.TOP}" width="${GP.TW}" height="${H}" rx="7"/></clipPath></defs>` +
  `<rect x="${GP.TX}" y="${GP.TOP}" width="${GP.TW}" height="${H}" rx="7" fill="#0c1017"/>` +
  `<g clip-path="url(#gptrack)">`;
for (let k = 0; k < lanes.length; k += 2)
  s += `<rect x="${GP.TX}" y="${GP.TOP + GP.LANE * k}" width="${GP.TW}" height="${GP.LANE}" fill="#8fa0c4" opacity=".045"/>`;
const KERB = GP.TW / 26;
for (let i = 0; i < 26; i++) {
  const kx = (GP.TX + i * KERB).toFixed(1);
  s += `<rect x="${kx}" y="${GP.TOP}" width="${KERB.toFixed(1)}" height="5" fill="${i % 2 ? "#e0484d" : "#dfe4ee"}" opacity=".55"/>`;
  s += `<rect x="${kx}" y="${BOT - 5}" width="${KERB.toFixed(1)}" height="5" fill="${i % 2 ? "#dfe4ee" : "#e0484d"}" opacity=".55"/>`;
}
for (let k = 1; k < lanes.length; k++)
  s += `<line x1="${GP.TX + 6}" y1="${GP.TOP + GP.LANE * k}" x2="${GP.TX + GP.TW - 6}" y2="${GP.TOP + GP.LANE * k}" stroke="#39445c" stroke-dasharray="10 12"/>`;
s += `</g>`;

const step = hi - lo > 150 ? 60 : 30;
for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) {
  s += `<line x1="${xOf(m).toFixed(1)}" y1="${BOT}" x2="${xOf(m).toFixed(1)}" y2="${BOT + 5}" stroke="#232c42"/>`;
  s += `<text x="${xOf(m).toFixed(1)}" y="${BOT + 19}" fill="#69728c" font-size="10.5" text-anchor="middle">${gpClock(m)}</text>`;
}

// The line goes down first, before any car. A provisional line is the same
// line, ghosted — the run-out is a fact either way.
const fx = xOf(ACTUAL);
const cell = H / 14;
s += `<g opacity="${UNOFFICIAL ? ".55" : "1"}">`;
for (let r = 0; r < 14; r++)
  for (let c = 0; c < 2; c++)
    s += `<rect x="${(fx - 6 + c * 6).toFixed(1)}" y="${(GP.TOP + r * cell).toFixed(1)}" width="6" height="${cell.toFixed(2)}" fill="${(r + c) % 2 ? "#0a0d14" : "#f2f5fb"}"/>`;
s += `</g>`;
s += `<text x="${fx.toFixed(1)}" y="${GP.TOP - (UNOFFICIAL ? 21 : 10)}" fill="${UNOFFICIAL ? "#9aa6c0" : "#f2f5fb"}" font-size="10.5" font-weight="700" text-anchor="middle">ran out ${gpClock(ACTUAL)}</text>`;
if (UNOFFICIAL)
  s += `<text x="${fx.toFixed(1)}" y="${GP.TOP - 10}" fill="#69728c" font-size="9" text-anchor="middle">unofficial</text>`;

for (const [i, l] of lanes.entries()) {
  const y = gpLaneY(i);
  s += `<text x="8" y="${y + 3.5}" fill="${l.c}" font-size="9.5" font-weight="700">${l.label.toUpperCase()}</text>`;
  const w0 = Math.max(GP.TX + 4, xOf(l.early));
  const w1 = Math.min(GP.TX + GP.TW - 4, xOf(l.late));
  if (w1 > w0)
    s += `<rect x="${w0.toFixed(1)}" y="${y - 13}" width="${(w1 - w0).toFixed(1)}" height="26" rx="4" fill="${l.c}" opacity=".12"/>`;
  const p = xOf(l.pred);
  const db = Math.min(GP.DB, Math.max(10, p - GP.X0 - 6));
  // Settled state: skid laid down full length, car parked on its guess, brake
  // light out, gap label up. gpSettle() writes exactly these four.
  s += `<rect x="${(p - db).toFixed(1)}" y="${y - 9}" width="${db.toFixed(1)}" height="18" fill="#0a0d14" opacity=".45"/>`;
  s += `<g style="color:${l.c}" transform="translate(${p.toFixed(1)},${y})"><use href="#gpcar" transform="scale(1.12)"/></g>`;
  const left = l.err < 0;
  s += `<text x="${(left ? p - 30 : p + 30).toFixed(1)}" y="${y + 3.5}" fill="${l.c}" font-size="10.5" font-weight="700" text-anchor="${left ? "end" : "start"}">${gapLabel(l.err)}</text>`;
}

if (CAPTION)
  s += `<text x="350" y="${BOT + 40}" fill="#69728c" font-size="10.5" text-anchor="middle">${
    UNOFFICIAL ? "drawn live from the station — tonight's grade makes it official" : "the line is when the bikes actually ran out — closest to it wins"
  }</text>`;

// The live card gets its font from the page; a standalone file has to carry the
// stack itself or it renders in whatever the viewer's default is. Same list as
// body in styles.css, tnum included — the axis is a column of digits.
// An official line has no "unofficial" under it, so its title sits 11 units
// lower and leaves that much dead space at the top. Drop the viewBox origin to
// match, or the two styles crop differently for no reason a reader can see.
const VH = CAPTION ? 208 : 190;
const VY = UNOFFICIAL ? 0 : 13;
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${VY} 700 ${VH - VY}" width="700" height="${VH - VY}" role="img" ` +
  `aria-label="Station 345 ran out at ${gpClock(ACTUAL)}${UNOFFICIAL ? ", not yet officially graded" : ""}. ` +
  `${lanes.map((l) => `${l.label} ${gapLabel(l.err)}`).join(", ")}.">` +
  `<style>text{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-feature-settings:"tnum" 1,"cv05" 1}</style>` +
  (BG === "transparent" ? "" : `<rect width="700" height="${VH}" fill="${BG}"/>`) +
  s +
  `</svg>`;

writeFileSync(OUT, svg + "\n");
console.log(`svg  ${OUT}`);
for (const l of lanes)
  console.log(
    `     ${l.label.padEnd(9)} ${gpClock(l.pred)}  ${gapLabel(l.err).padEnd(11)} window ${gpClock(l.early)}–${gpClock(l.late)}`,
  );
console.log(
  `     blend = ${MIXED.lean.toFixed(0)}% gaussian / ${(100 - MIXED.lean).toFixed(0)}% ml -> ` +
    `${MIXED.err > 0 ? "+" : ""}${MIXED.err.toFixed(1)}m, window ${MIXED.win.toFixed(1)}m`,
);
console.log(`     line      ${gpClock(ACTUAL)}${UNOFFICIAL ? "  (unofficial)" : ""}`);

// ---------- optional PNG ----------
// Through Chrome rather than a rasteriser library: Chrome is the renderer the
// dashboard itself is read in, so the fonts, the hinting and the .55-opacity
// chequer come out identical to the card instead of merely close.
if (flag("png")) {
  const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const png = OUT.replace(/\.svg$/, ".png");
  const html = OUT.replace(/\.svg$/, ".tmp.html");
  // Embedded at its NATURAL size with the window sized to match; resolution
  // comes from the device scale factor alone. Scaling the element instead
  // (width:100%/height:auto) makes Chrome lay the root out at a height the
  // viewBox never asked for, and the strip renders offset and clipped.
  writeFileSync(
    html,
    `<html><body style="margin:0;background:${BG === "transparent" ? "transparent" : BG}">` +
      svg.replace("<svg ", '<svg style="display:block" ') +
      `</body></html>`,
  );
  try {
    execFileSync(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        `--force-device-scale-factor=${SCALE}`,
        `--window-size=700,${VH - VY}`,
        ...(BG === "transparent" ? ["--default-background-color=00000000"] : []),
        `--screenshot=${png}`,
        `file://${html}`,
      ],
      { stdio: "pipe" },
    );
    console.log(`png  ${png}  (${700 * SCALE}×${(VH - VY) * SCALE})`);
  } finally {
    unlinkSync(html);
  }
}
