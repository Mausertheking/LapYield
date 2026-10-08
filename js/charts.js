// SVG charts: track map coloured by speed, and speed-vs-distance comparison with hover readout.
import { TRACK } from './track.js';
import { SECTORS, TRACK_LENGTH } from './analysis.js';
import { t, num } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function text(parent, x, y, str, attrs = {}) {
  const e = el('text', { x, y, ...attrs }, parent); e.textContent = str; return e;
}

// ---------- track map ----------
export function trackMap(lap) {
  const C = TRACK.centre;
  const pad = TRACK.widthM;
  const xs = C.map(p => p[0]), ys = C.map(p => p[1]);
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const W = maxX - minX, H = maxY - minY;
  const svg = el('svg', { viewBox: `0 0 ${W.toFixed(1)} ${H.toFixed(1)}`, role: 'img', 'aria-label': t('mapTitle') });
  const X = (x) => (x - minX).toFixed(1), Y = (y) => (maxY - y).toFixed(1);
  const pts = C.concat([C[0]]).map(p => `${X(p[0])},${Y(p[1])}`).join(' ');
  el('polyline', { points: pts, fill: 'none', stroke: 'var(--track-edge)', 'stroke-width': TRACK.widthM + 1.5, 'stroke-linejoin': 'round' }, svg);
  el('polyline', { points: pts, fill: 'none', stroke: 'var(--track)', 'stroke-width': TRACK.widthM, 'stroke-linejoin': 'round' }, svg);

  // driver's path, binned speed colours (sequential ramp, darker = faster on light)
  if (lap && lap.path.length > 1) {
    const vs = lap.path.map(p => p[2]);
    const vmin = Math.min(...vs), vmax = Math.max(...vs);
    const bin = (v) => Math.min(4, Math.floor(5 * (v - vmin) / Math.max(vmax - vmin, 0.1)));
    for (let i = 1; i < lap.path.length; i++) {
      const a = lap.path[i - 1], b = lap.path[i];
      el('line', { x1: X(a[0]), y1: Y(a[1]), x2: X(b[0]), y2: Y(b[1]), stroke: `var(--seq-${bin((a[2] + b[2]) / 2) + 1})`,
                   'stroke-width': 3.2, 'stroke-linecap': 'round' }, svg);
    }
    svg.dataset.vmin = vmin; svg.dataset.vmax = vmax;
  }

  // start/finish line (perpendicular to the track at index 0)
  const p0 = C[0], p1 = C[1];
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d, ny = dx / d, h = TRACK.widthM / 2 + 1;
  el('line', { x1: X(p0[0] + nx * h), y1: Y(p0[1] + ny * h), x2: X(p0[0] - nx * h), y2: Y(p0[1] - ny * h),
               stroke: 'var(--text)', 'stroke-width': 1.6, 'stroke-dasharray': '1.6 1.2' }, svg);

  // sector labels at each sector's middle, pushed off the track
  for (const z of SECTORS) {
    const len = z.s1 >= z.s0 ? z.s1 - z.s0 : TRACK_LENGTH - z.s0 + z.s1;
    const sm = (z.s0 + len / 2) % TRACK_LENGTH;
    const i = Math.round(sm / TRACK.ds) % C.length;
    const a = C[i], b = C[(i + 1) % C.length];
    const ddx = b[0] - a[0], ddy = b[1] - a[1], dd = Math.hypot(ddx, ddy) || 1;
    // put the label on the side with more free space (farther from any other part of the track)
    const nx0 = -ddy / dd, ny0 = ddx / dd, off = TRACK.widthM / 2 + 9;
    const clearance = (x, y) => Math.min(...C.map(q => Math.hypot(q[0] - x, q[1] - y)));
    const A = [a[0] + nx0 * off, a[1] + ny0 * off], B = [a[0] - nx0 * off, a[1] - ny0 * off];
    const [lx, ly] = clearance(...A) >= clearance(...B) ? A : B;
    el('circle', { cx: X(lx), cy: Y(ly), r: 8, fill: 'var(--surface)', stroke: 'var(--border)', 'stroke-width': 0.8 }, svg);
    text(svg, X(lx), (+Y(ly) + 3.1).toFixed(1), 'S' + z.id, { 'text-anchor': 'middle', 'font-size': 8.5, 'font-weight': 700, fill: 'var(--text)' });
  }
  // label on whichever side of the line is further from the track's centre
  const cxm = (minX + maxX) / 2, cym = (minY + maxY) / 2;
  const side = ((p0[0] + nx - cxm) ** 2 + (p0[1] + ny - cym) ** 2) > ((p0[0] - nx - cxm) ** 2 + (p0[1] - ny - cym) ** 2) ? 1 : -1;
  const sfx = p0[0] + side * nx * (h + 6), sfy = p0[1] + side * ny * (h + 6);
  text(svg, X(sfx), Y(sfy), t('startLine'), { 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 600, fill: 'var(--text-2)' });
  return svg;
}

export function mapLegend(svg) {
  const div = document.createElement('div');
  div.className = 'maplegend';
  const vmin = +svg.dataset.vmin * 3.6, vmax = +svg.dataset.vmax * 3.6;
  const a = document.createElement('span'); a.textContent = `${Math.round(vmin)} ${t('speedUnit')} (${t('mapLegendSlow')})`;
  const ramp = document.createElement('span'); ramp.className = 'ramp';
  for (let i = 1; i <= 5; i++) { const b = document.createElement('i'); b.style.background = `var(--seq-${i})`; ramp.appendChild(b); }
  const c = document.createElement('span'); c.textContent = `${Math.round(vmax)} ${t('speedUnit')} (${t('mapLegendFast')})`;
  div.append(a, ramp, c);
  return div;
}

// ---------- speed chart ----------
export function speedChart(lap, ref = { idealV: TRACK.ref.ideal.v, ecoV: TRACK.ref.eco.v }) {
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const series = [
    { key: 'you', label: t('seriesYou'), color: 'var(--series-1)', v: lap.profile },
    { key: 'ideal', label: t('seriesIdeal'), color: 'var(--series-2)', v: ref.idealV, dash: '5 4' },
    { key: 'eco', label: t('seriesEco'), color: 'var(--series-3)', v: ref.ecoV },
  ];
  const legend = document.createElement('div'); legend.className = 'legend';
  for (const s of series) {
    const sp = document.createElement('span'); const i = document.createElement('i');
    i.style.borderColor = s.color; if (s.dash) i.className = 'dash';
    sp.append(i, document.createTextNode(s.label)); legend.appendChild(sp);
  }
  wrap.appendChild(legend);

  const W = 360, H = 250, m = { l: 30, r: 8, t: 22, b: 32 };
  const L = TRACK_LENGTH, n = lap.profile.length;
  const allV = series.flatMap(s => s.v).map(v => v * 3.6);
  const yMax = Math.ceil(Math.max(...allV) / 10) * 10, yMin = Math.max(0, Math.floor(Math.min(...allV) / 10) * 10 - 10);
  const X = (s) => m.l + (s / L) * (W - m.l - m.r);
  const Y = (kmh) => m.t + (1 - (kmh - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('chartTitle') }, wrap);

  // sector bands (alternating subtle background) + gridlines
  SECTORS.forEach((z, k) => {
    const spans = z.s1 >= z.s0 ? [[z.s0, z.s1]] : [[z.s0, L], [0, z.s1]];
    if (k % 2 === 0) for (const [a, b] of spans) el('rect', { x: X(a), y: m.t, width: X(b) - X(a), height: H - m.t - m.b, fill: 'var(--surface-2)', opacity: 0.55 }, svg);
    const len = z.s1 >= z.s0 ? z.s1 - z.s0 : L - z.s0 + z.s1;
    text(svg, X((z.s0 + len / 2) % L), m.t + 11, 'S' + z.id, { 'text-anchor': 'middle', class: 'lbl', 'font-weight': 600 });
  });
  const g = el('g', { class: 'axis' }, svg);
  for (let v = yMin; v <= yMax; v += 10) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'gridline' }, g);
    text(g, m.l - 6, Y(v) + 4, String(v), { 'text-anchor': 'end' });
  }
  for (let s = 0; s <= L; s += 100) text(g, X(s), H - m.b + 16, String(s), { 'text-anchor': 'middle' });
  text(g, (m.l + W - m.r) / 2, H - 2, t('axisDist'), { 'text-anchor': 'middle' });
  text(g, 4, 10, t('speedUnit'), { 'text-anchor': 'start' });

  for (const s of [...series].reverse()) {
    const d = s.v.map((v, i) => `${i ? 'L' : 'M'}${X(i * TRACK.ds).toFixed(1)},${Y(v * 3.6).toFixed(1)}`).join('');
    el('path', { d, class: 'series', stroke: s.color, 'stroke-dasharray': s.dash || 'none' }, svg);
  }

  // hover: crosshair + tooltip listing every series at that distance
  const cross = el('line', { y1: m.t, y2: H - m.b, stroke: 'var(--text-3)', 'stroke-width': 1, visibility: 'hidden' }, svg);
  const tip = document.createElement('div'); tip.className = 'tooltip'; wrap.appendChild(tip);
  const hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' }, svg);
  const show = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = (evt.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * L / TRACK.ds)));
    cross.setAttribute('x1', X(i * TRACK.ds)); cross.setAttribute('x2', X(i * TRACK.ds)); cross.setAttribute('visibility', 'visible');
    tip.replaceChildren();
    const head = document.createElement('div'); head.className = 'head'; head.textContent = `${Math.round(i * TRACK.ds)} m`; tip.appendChild(head);
    for (const s of series) {
      const row = document.createElement('div'); row.className = 'row';
      const k = document.createElement('i'); k.style.borderColor = s.color;
      const lab = document.createElement('span'); lab.textContent = s.label;
      const val = document.createElement('b'); val.textContent = `${Math.round(s.v[i] * 3.6)} ${t('speedUnit')}`;
      row.append(k, lab, val); tip.appendChild(row);
    }
    tip.style.display = 'block';
    const left = (X(i * TRACK.ds) / W) * r.width;
    tip.style.left = Math.min(Math.max(left + 12, 0), r.width - tip.offsetWidth) + 'px';
    tip.style.top = '30px';
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); });
  return wrap;
}

// ---------- decorative / live track outline ----------
// variant 'hero': band + thin line + an animated "kart" streak running a lap.
// variant 'mini': band + a dot that follows the live GPS position (returns setPos).
export function trackOutline(variant = 'hero') {
  const C = TRACK.centre;
  const pad = TRACK.widthM;
  const xs = C.map(p => p[0]), ys = C.map(p => p[1]);
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const W = maxX - minX, H = maxY - minY;
  const X = (x) => (x - minX).toFixed(1), Y = (y) => (maxY - y).toFixed(1);
  const svg = el('svg', { viewBox: `0 0 ${W.toFixed(1)} ${H.toFixed(1)}`, 'aria-hidden': 'true' });
  const d = C.concat([C[0]]).map((p, i) => `${i ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`).join('') + 'Z';
  if (variant === 'hero') {
    el('path', { d, class: 'band', fill: 'none', 'stroke-width': TRACK.widthM, 'stroke-linejoin': 'round' }, svg);
    el('path', { d, class: 'line', fill: 'none', 'stroke-width': 0.8, 'stroke-dasharray': '3 3' }, svg);
    const run = el('path', { d, class: 'run', fill: 'none', 'stroke-width': 3.2, 'stroke-linecap': 'round', pathLength: 2000 }, svg);
    run.style.strokeDasharray = '90 1910';
    return { svg };
  }
  el('path', { d, fill: 'none', stroke: '#1f2421', 'stroke-width': TRACK.widthM, 'stroke-linejoin': 'round' }, svg);
  el('path', { d, fill: 'none', stroke: '#2f3531', 'stroke-width': 0.8 }, svg);
  const p0 = C[0], p1 = C[1], dx = p1[0] - p0[0], dy = p1[1] - p0[1], dd = Math.hypot(dx, dy) || 1;
  const nx = -dy / dd, ny = dx / dd, hw = TRACK.widthM / 2;
  el('line', { x1: X(p0[0] + nx * hw), y1: Y(p0[1] + ny * hw), x2: X(p0[0] - nx * hw), y2: Y(p0[1] - ny * hw), stroke: '#8a8a84', 'stroke-width': 1.5, 'stroke-dasharray': '1.5 1.2' }, svg);
  const halo = el('circle', { r: 9, fill: 'rgba(79,211,149,.18)', visibility: 'hidden' }, svg);
  const dot = el('circle', { r: 4.5, fill: '#4fd395', stroke: '#000', 'stroke-width': 1.2, visibility: 'hidden' }, svg);
  const setPos = (x, y) => {
    for (const c of [halo, dot]) { c.setAttribute('cx', X(x)); c.setAttribute('cy', Y(y)); c.setAttribute('visibility', 'visible'); }
  };
  return { svg, setPos };
}
