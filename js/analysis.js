// Lap analysis: GPS points -> map-matched track position -> laps -> fuel, corners, tips.
import { TRACK } from './track.js';
import { makeKart, fuelFromTrace } from './physics.js';

const R = 6371000;
const COS0 = Math.cos(TRACK.lat0 * Math.PI / 180);
export const KART = makeKart(TRACK.kart, TRACK.fuel);

export function project(lat, lon) {
  return [ (lon - TRACK.lon0) * Math.PI / 180 * R * COS0, (lat - TRACK.lat0) * Math.PI / 180 * R ];
}

// ---- track geometry (closed polyline, index 0 = start/finish line) ----
const C = TRACK.centre;
const N = C.length;
const SEG = C.map((p, i) => { const q = C[(i + 1) % N]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
const S = [0]; for (let i = 1; i < N; i++) S.push(S[i - 1] + SEG[i - 1]);
const L = S[N - 1] + SEG[N - 1];
export const TRACK_LENGTH = L;

function nearestOnTrack(x, y, hint) {
  let best = { d2: Infinity, s: 0, i: 0 };
  const W = 30;
  const tryIdx = (i) => {
    const p = C[i], q = C[(i + 1) % N];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const l2 = dx * dx + dy * dy || 1e-9;
    let t = ((x - p[0]) * dx + (y - p[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const ex = p[0] + t * dx - x, ey = p[1] + t * dy - y;
    const d2 = ex * ex + ey * ey;
    if (d2 < best.d2) best = { d2, s: S[i] + t * SEG[i], i };
  };
  if (hint != null) { for (let k = -W; k <= W; k++) tryIdx(((hint + k) % N + N) % N); }
  if (hint == null || best.d2 > 20 * 20) { for (let i = 0; i < N; i++) tryIdx(i); }
  return { s: best.s, i: best.i, dist: Math.sqrt(best.d2) };
}

const wrapDelta = (d) => { d = ((d % L) + L) % L; return d > L / 2 ? d - L : d; };
const interp = (x, xs, ys) => {           // xs ascending
  if (x <= xs[0]) return ys[0];
  const n = xs.length; if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + f * (ys[hi] - ys[lo]);
};

// reference profiles on the centreline grid
const DS = TRACK.ds;
const GRID = TRACK.ref.ideal.v.map((_, i) => i * DS);
export const DEFAULT_DRIVER_KG = TRACK.defaultDriverKg || 70;
const KART_BASE_KG = TRACK.kartBaseKg || (TRACK.kart.mass - DEFAULT_DRIVER_KG);

// Reference laps for a given driver weight: linear interpolation between the
// precomputed weights in track.js (clamped to the range that was simulated).
function lerpRef(a, b, f) {
  const mix = (x, y) => x + f * (y - x);
  return { v: a.v.map((x, i) => mix(x, b.v[i])), tCum: a.tCum.map((x, i) => mix(x, b.tCum[i])),
           fuelCum: a.fuelCum.map((x, i) => mix(x, b.fuelCum[i])),
           lapTime: mix(a.lapTime, b.lapTime), fuelG: mix(a.fuelG, b.fuelG) };
}
function refsFor(kg) {
  const list = TRACK.refsByMass;
  if (!list || !list.length) return TRACK.ref;
  const k = Math.min(Math.max(kg, list[0].driverKg), list[list.length - 1].driverKg);
  let i = 0; while (i < list.length - 2 && list[i + 1].driverKg < k) i++;
  const lo = list[i], hi = list[Math.min(i + 1, list.length - 1)];
  const f = hi.driverKg === lo.driverKg ? 0 : (k - lo.driverKg) / (hi.driverKg - lo.driverKg);
  return { ideal: lerpRef(lo.ideal, hi.ideal, f), eco: lerpRef(lo.eco, hi.eco, f) };
}

// The phone measures ~1 sample/s and we smooth it, which hides short acceleration
// peaks. To compare fairly, each reference lap is "measured" the same way: sampled
// at 1 Hz, smoothed identically, then run through the same fuel model. fuelScale
// converts these 1 Hz estimates back to the full-resolution (calibrated) fuel use.
function smooth3(a) { return a.map((v, i) => 0.25 * a[Math.max(i - 1, 0)] + 0.5 * v + 0.25 * a[Math.min(i + 1, a.length - 1)]); }
function measuredRef(r, kart) {
  const ts = GRID.map((_, i) => r.tCum[i]).concat([r.lapTime]);
  const ss = GRID.concat([L]);
  const vv = r.v.concat([r.v[0]]);
  const samples = [];                          // two laps so smoothing at the line behaves like mid-session
  for (let t = 0; t <= 2 * r.lapTime; t += 1) {
    const lapT = t % r.lapTime, lapN = Math.floor(t / r.lapTime);
    const s = interp(lapT, ts, ss);
    samples.push({ t, s: s + lapN * L, v: interp(s, ss, vv) });
  }
  const v2 = smooth3(samples.map(q => q.v)); samples.forEach((q, i) => { q.v = v2[i]; });
  const f = fuelFromTrace(kart, samples);
  const sArr = samples.map(q => q.s);
  const cum = (s) => interp(s + L, sArr, f.fuelCumG) - interp(L, sArr, f.fuelCumG);  // use 2nd lap
  return { fuelCum: GRID.map(s => cum(s)), fuelG: cum(L) };
}

// Everything that depends on the total kart + driver mass, cached per weight.
const ctxCache = new Map();
export function contextFor(driverKg) {
  const kg = Math.round(Number.isFinite(+driverKg) && +driverKg > 0 ? +driverKg : DEFAULT_DRIVER_KG);
  if (ctxCache.has(kg)) return ctxCache.get(kg);
  const kart = makeKart({ ...TRACK.kart, mass: KART_BASE_KG + kg }, TRACK.fuel);
  const ref = refsFor(kg);
  const meas = { ideal: measuredRef(ref.ideal, kart), eco: measuredRef(ref.eco, kart) };
  const fuelScale = 0.5 * (ref.ideal.fuelG / meas.ideal.fuelG + ref.eco.fuelG / meas.eco.fuelG);
  const ctx = { kg, kart, ref, meas, fuelScale };
  ctxCache.set(kg, ctx);
  return ctx;
}
export const FUEL_SCALE = contextFor(DEFAULT_DRIVER_KG).fuelScale;

function refAt(ctx, name, key, s) {
  const r = ctx.ref[name];
  if (key === 'tCum') return interp(s, GRID.concat([L]), r.tCum.concat([r.lapTime]));
  if (key === 'fuelCum') {   // 1 Hz-equivalent fuel, rescaled to calibrated grams
    const m = ctx.meas[name];
    return ctx.fuelScale * interp(s, GRID.concat([L]), m.fuelCum.concat([m.fuelG]));
  }
  return interp(s, GRID.concat([L]), r[key].concat([r[key][0]]));
}
function refBetween(ctx, name, key, s0, s1) {       // amount of time/fuel between s0 and s1 (wraps)
  const total = key === 'tCum' ? ctx.ref[name].lapTime : ctx.fuelScale * ctx.meas[name].fuelG;
  const a = refAt(ctx, name, key, s0), b = refAt(ctx, name, key, s1);
  return s1 >= s0 ? b - a : total - a + b;
}
function refMinSpeed(ctx, name, s0, s1) {
  let m = Infinity;
  const len = s1 >= s0 ? s1 - s0 : L - s0 + s1;
  for (let d = 0; d <= len; d += DS) m = Math.min(m, refAt(ctx, name, 'v', (s0 + d) % L));
  return m;
}

// ---- sectors: groups of corners split at the 6 longest gaps between apexes ----
function buildSectors(nSec = 6) {
  const cs = TRACK.corners, n = cs.length;
  const gaps = cs.map((c, k) => ({ k, gap: ((cs[(k + 1) % n].apexS - c.apexS) % L + L) % L }));
  const cuts = gaps.sort((a, b) => b.gap - a.gap).slice(0, nSec).map(g => g.k).sort((a, b) => a - b);
  const secs = [];
  for (let j = 0; j < cuts.length; j++) {
    const first = (cuts[j] + 1) % n, last = cuts[(j + 1) % cuts.length];
    const ids = []; for (let k = first; ; k = (k + 1) % n) { ids.push(cs[k].id); if (k === last) break; }
    secs.push({ s0: cs[first].s0, s1: cs[last].s1, corners: ids });
  }
  secs.sort((a, b) => a.s0 - b.s0);
  // sector 1 = the one containing the start/finish line's first corner
  const startIdx = secs.findIndex(x => x.corners.includes(1));
  const ordered = secs.slice(startIdx).concat(secs.slice(0, startIdx));
  return ordered.map((x, i) => ({ id: i + 1, ...x }));
}
export const SECTORS = buildSectors();

function zoneMetrics(ctx, z, samples, sArr, tArr, fArr) {
  const at = (arr, s) => interp(s, sArr, arr);
  const span = z.s1 >= z.s0 ? [[z.s0, z.s1]] : [[z.s0, L], [0, z.s1]];
  let dt = 0, df = 0, vmin = Infinity;
  for (const [a, b] of span) {
    dt += at(tArr, b) - at(tArr, a); df += at(fArr, b) - at(fArr, a);
    for (const q of samples) if (q.s >= a && q.s <= b) vmin = Math.min(vmin, q.v);
  }
  return { id: z.id, time: dt, fuelG: df, vMin: vmin,
           idealTime: refBetween(ctx, 'ideal', 'tCum', z.s0, z.s1),
           ecoTime: refBetween(ctx, 'eco', 'tCum', z.s0, z.s1),
           ecoFuelG: refBetween(ctx, 'eco', 'fuelCum', z.s0, z.s1),
           ecoVMin: refMinSpeed(ctx, 'eco', z.s0, z.s1) };
}

/**
 * session: { points: [[t_ms, lat, lon, accuracy_m|null, speed_mps|null], ...], driverKg?: number }
 */
export function analyzeSession(session) {
  const ctx = contextFor(session.driverKg);
  const kart = ctx.kart, REF = ctx.ref;
  // ---- 1. clean points ----
  let pts = session.points
    .filter(p => Number.isFinite(p[1]) && Number.isFinite(p[2]) && (p[3] == null || p[3] <= 25))
    .map(p => { const [x, y] = project(p[1], p[2]); return { t: p[0] / 1000, x, y, acc: p[3], dop: p[4] }; })
    .sort((a, b) => a.t - b.t);
  pts = pts.filter((p, i) => i === 0 || p.t > pts[i - 1].t);
  const kept = [];
  for (const p of pts) {
    const q = kept[kept.length - 1];
    if (q && Math.hypot(p.x - q.x, p.y - q.y) / (p.t - q.t) > 35) continue;   // impossible jump
    kept.push(p);
  }
  pts = kept;
  if (pts.length < 10) return { ok: false, reason: 'tooFewPoints', laps: [] };

  // ---- 2. speed: Doppler if present, else from positions; light smoothing ----
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.dop != null && p.dop >= 0) { p.v = p.dop; continue; }
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
    const dt = b.t - a.t;
    p.v = dt > 0 ? Math.hypot(b.x - a.x, b.y - a.y) / dt : 0;
  }
  const vs = pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)].v, b = pts[Math.min(i + 1, pts.length - 1)].v;
    return 0.25 * a + 0.5 * p.v + 0.25 * b;
  });
  pts.forEach((p, i) => { p.v = vs[i]; });

  // ---- 3. map matching + unwrapped progress ----
  let hint = null, prev = null;
  for (const p of pts) {
    const m = nearestOnTrack(p.x, p.y, prev && prev.onTrack && p.t - prev.t < 5 ? hint : null);
    p.s = m.s; p.dist = m.dist; p.onTrack = m.dist < TRACK.widthM / 2 + 12;
    hint = m.i;
    if (!prev) p.sU = p.s;
    else p.sU = prev.sU + (p.onTrack && prev.onTrack ? wrapDelta(p.s - prev.s) : 0);
    prev = p;
  }

  // ---- 4. start/finish crossings (forward only) ----
  const crossings = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (!(a.onTrack && b.onTrack) || b.sU <= a.sU) continue;
    const na = Math.floor(a.sU / L), nb = Math.floor(b.sU / L);
    if (nb > na) {
      const target = nb * L, f = (target - a.sU) / (b.sU - a.sU);
      crossings.push({ t: a.t + f * (b.t - a.t), n: nb, i });
    }
  }

  // ---- 5. laps ----
  const laps = [];
  const idealT = REF.ideal.lapTime;
  for (let k = 1; k < crossings.length; k++) {
    const c0 = crossings[k - 1], c1 = crossings[k];
    if (c1.n !== c0.n + 1) continue;
    const time = c1.t - c0.t;
    const seg = pts.slice(c0.i - 1, c1.i + 1);
    const samples = seg.map(p => ({ t: p.t, v: p.v, s: p.sU - c0.n * L, x: p.x, y: p.y, onTrack: p.onTrack }));
    const onFrac = samples.filter(q => q.onTrack).length / samples.length;
    const valid = time > 0.8 * idealT && time < 2.5 * idealT && onFrac > 0.85;
    // clip samples to [0, L] by interpolating the boundary points
    const fuel = fuelFromTrace(kart, samples);
    fuel.fuelCumG = fuel.fuelCumG.map(g => g * ctx.fuelScale);
    const sArr = samples.map(q => q.s);
    const tArr = samples.map(q => q.t - c0.t);
    const fArr = fuel.fuelCumG;
    const at = (arr, s) => interp(s, sArr, arr);
    const lapFuel = at(fArr, L) - at(fArr, 0);
    const corners = TRACK.corners.map(c => zoneMetrics(ctx, c, samples, sArr, tArr, fArr));
    const sectors = SECTORS.map(z => zoneMetrics(ctx, z, samples, sArr, tArr, fArr));
    // speed profile on the grid for charts
    const profile = GRID.map(s => interp(s, sArr, samples.map(q => q.v)));
    laps.push({
      n: laps.length + 1, start: c0.t, time, valid, onTrackFraction: onFrac,
      avgSpeed: L / time, maxSpeed: Math.max(...samples.map(q => q.v)),
      fuelG: lapFuel, fuelMl: lapFuel / kart.density, co2G: lapFuel * kart.co2PerKg,
      brakeKJ: fuel.brakeJ / 1000, throttlePct: 100 * fuel.throttleS / Math.max(time, 1),
      corners, sectors, profile, path: samples.map(q => [q.x, q.y, q.v]),
      paceScore: Math.min(100, 100 * idealT / time),
      ecoScore: Math.min(100, 100 * REF.eco.fuelG / lapFuel),
      ecoFuelMl: REF.eco.fuelG / kart.density,
    });
  }

  // ---- 6. whole-session totals (includes out-lap, in-lap, pit idling) ----
  const all = fuelFromTrace(kart, pts.map(p => ({ t: p.t, v: p.v })));
  all.fuelG *= ctx.fuelScale;
  const durationS = pts[pts.length - 1].t - pts[0].t;
  const validLaps = laps.filter(l => l.valid);
  const best = validLaps.length ? validLaps.reduce((a, b) => (b.time < a.time ? b : a)) : null;
  const tips = makeTips(validLaps);

  return {
    ok: true, track: TRACK.name, trackLength: L, crossings: crossings.length,
    laps, validLaps: validLaps.length, best,
    meanLap: validLaps.length ? validLaps.reduce((a, l) => a + l.time, 0) / validLaps.length : null,
    session: { durationS, fuelG: all.fuelG, fuelL: all.fuelG / 1000 / kart.density,
               co2G: all.fuelG * kart.co2PerKg,
               litresPerHour: durationS > 0 ? all.fuelG / 1000 / kart.density / (durationS / 3600) : 0 },
    driverKg: ctx.kg, totalMassKg: kart.mass,
    ref: { idealTime: idealT, ecoTime: REF.eco.lapTime,
           ecoFuelMl: REF.eco.fuelG / kart.density, idealFuelMl: REF.ideal.fuelG / kart.density,
           idealV: REF.ideal.v, ecoV: REF.eco.v },
    tips, fuelScale: ctx.fuelScale,
    path: pts.map(p => [p.x, p.y, p.v, p.onTrack ? 1 : 0]),
  };
}

// ---- coaching tips: average each sector over all valid laps, rank the losses ----
function makeTips(laps) {
  if (!laps.length) return [];
  const per = SECTORS.map((z, j) => {
    const avg = (f) => laps.reduce((a, l) => a + f(l.sectors[j]), 0) / laps.length;
    const k = laps[0].sectors[j];
    return { sector: z.id, corners: z.corners,
             wastedFuelG: avg(q => q.fuelG) - k.ecoFuelG,
             timeLoss: avg(q => q.time) - k.idealTime,
             vMin: avg(q => q.vMin), ecoVMin: k.ecoVMin };
  });
  const tips = [];
  const byFuel = [...per].sort((a, b) => b.wastedFuelG - a.wastedFuelG);
  for (const z of byFuel.slice(0, 2)) {
    if (z.wastedFuelG < 0.15) continue;
    const base = { sector: z.sector, from: z.corners[0], to: z.corners[z.corners.length - 1], g: z.wastedFuelG };
    if (z.vMin < z.ecoVMin - 3 / 3.6) tips.push({ key: 'tipCarrySpeed', ...base, v: z.vMin * 3.6, ve: z.ecoVMin * 3.6 });
    else tips.push({ key: 'tipSmoothThrottle', ...base });
  }
  const byTime = [...per].sort((a, b) => b.timeLoss - a.timeLoss);
  const t = byTime.find(z => !tips.some(x => x.sector === z.sector));
  if (t && t.timeLoss > 0.3) tips.push({ key: 'tipUseWidth', sector: t.sector, from: t.corners[0], to: t.corners[t.corners.length - 1], dt: t.timeLoss });
  return tips;
}
