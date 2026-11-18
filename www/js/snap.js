// Reads the line work of a PDF page so the cursor can snap to it (endpoints, midpoints, intersections, along lines).
import { mul, apply, nearestOnSeg, segIntersect, dist } from './geom.js';

const CELL = 24;          // grid cell size in page points
const MAX_SEGS = 1500000; // safety limit for extremely dense pages

export class SnapIndex {
  constructor() { this.segs = []; this.flags = []; this.grid = new Map(); this.ready = false; }
  key(cx, cy) { return cx * 131072 + cy; }
  addSeg(x1, y1, x2, y2, curveStart, curveEnd) {
    if (this.flags.length >= MAX_SEGS) return;
    if (Math.abs(x1 - x2) < 1e-3 && Math.abs(y1 - y2) < 1e-3) return;
    const i = this.flags.length;
    this.segs.push(x1, y1, x2, y2);
    // flag bits: 1 = start is a real endpoint, 2 = end is a real endpoint, 4 = straight line
    this.flags.push((curveStart ? 0 : 1) | (curveEnd ? 0 : 2) | (curveStart || curveEnd ? 0 : 4));
    const L = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(L / (CELL / 2)));
    let last = -1;
    for (let s = 0; s <= steps; s++) {
      const x = x1 + (x2 - x1) * s / steps, y = y1 + (y2 - y1) * s / steps;
      const k = this.key(Math.floor(x / CELL) + 65536, Math.floor(y / CELL));
      if (k === last) continue;
      last = k;
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, arr = []);
      if (arr[arr.length - 1] !== i) arr.push(i);
    }
  }
  near(p, r) {
    const out = new Set();
    const cx0 = Math.floor((p[0] - r) / CELL) + 65536, cx1 = Math.floor((p[0] + r) / CELL) + 65536;
    const cy0 = Math.floor((p[1] - r) / CELL), cy1 = Math.floor((p[1] + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const arr = this.grid.get(this.key(cx, cy));
      if (arr) for (const i of arr) out.add(i);
    }
    return out;
  }
  seg(i) { const s = this.segs; return [[s[4 * i], s[4 * i + 1]], [s[4 * i + 2], s[4 * i + 3]]]; }
}

// build the index for one page; `viewTransform` maps PDF space to page points (scale 1, with page rotation)
export async function buildSnapIndex(page, viewTransform, pdfjsLib) {
  const idx = new SnapIndex();
  const ops = await page.getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE });
  const OPS = pdfjsLib.OPS;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = args && args[0];
      if (m && m.length === 6) ctm = mul(ctm, Array.from(m));
    } else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.constructPath) {
      if (args[0] === OPS.endPath) continue; // clipping paths are not visible lines
      const buf = args[1] && args[1][0];
      if (buf && buf.length) addPathBuffer(idx, buf, mul(viewTransform, ctm));
      else if (Array.isArray(args[0]) && Array.isArray(args[1])) addOldPath(idx, args[0], args[1], mul(viewTransform, ctm), OPS);
    }
    if (idx.flags.length >= MAX_SEGS) break;
  }
  idx.ready = true;
  return idx;
}

function addPathBuffer(idx, b, M) {
  // pdf.js path buffer: 0 moveTo x y, 1 lineTo x y, 2 curveTo x1 y1 x2 y2 x y, 3 quadraticCurveTo x1 y1 x y, 4 closePath
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (let k = 0; k < b.length;) {
    const op = b[k++];
    if (op === 0) { [cx, cy] = apply(M, b[k], b[k + 1]); sx = cx; sy = cy; k += 2; }
    else if (op === 1) { const [x, y] = apply(M, b[k], b[k + 1]); idx.addSeg(cx, cy, x, y); cx = x; cy = y; k += 2; }
    else if (op === 2) {
      const p1 = apply(M, b[k], b[k + 1]), p2 = apply(M, b[k + 2], b[k + 3]), p3 = apply(M, b[k + 4], b[k + 5]);
      addBezier(idx, [cx, cy], p1, p2, p3); [cx, cy] = p3; k += 6;
    } else if (op === 3) {
      const q = apply(M, b[k], b[k + 1]), p3 = apply(M, b[k + 2], b[k + 3]);
      const p1 = [cx + 2 / 3 * (q[0] - cx), cy + 2 / 3 * (q[1] - cy)], p2 = [p3[0] + 2 / 3 * (q[0] - p3[0]), p3[1] + 2 / 3 * (q[1] - p3[1])];
      addBezier(idx, [cx, cy], p1, p2, p3); [cx, cy] = p3; k += 4;
    } else if (op === 4) { idx.addSeg(cx, cy, sx, sy); cx = sx; cy = sy; }
    else break;
  }
}
// older pdf.js format (ops list + flat coordinates)
function addOldPath(idx, ops, c, M, OPS) {
  let j = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  for (const op of ops) {
    if (op === OPS.moveTo) { [cx, cy] = apply(M, c[j], c[j + 1]); sx = cx; sy = cy; j += 2; }
    else if (op === OPS.lineTo) { const [x, y] = apply(M, c[j], c[j + 1]); idx.addSeg(cx, cy, x, y); cx = x; cy = y; j += 2; }
    else if (op === OPS.rectangle) {
      const x = c[j], y = c[j + 1], w = c[j + 2], h = c[j + 3]; j += 4;
      const P = [apply(M, x, y), apply(M, x + w, y), apply(M, x + w, y + h), apply(M, x, y + h)];
      for (let q = 0; q < 4; q++) idx.addSeg(P[q][0], P[q][1], P[(q + 1) % 4][0], P[(q + 1) % 4][1]);
      [cx, cy] = P[0]; sx = cx; sy = cy;
    } else if (op === OPS.curveTo) { const p1 = apply(M, c[j], c[j + 1]), p2 = apply(M, c[j + 2], c[j + 3]), p3 = apply(M, c[j + 4], c[j + 5]); addBezier(idx, [cx, cy], p1, p2, p3); [cx, cy] = p3; j += 6; }
    else if (op === OPS.curveTo2) { const p2 = apply(M, c[j], c[j + 1]), p3 = apply(M, c[j + 2], c[j + 3]); addBezier(idx, [cx, cy], [cx, cy], p2, p3); [cx, cy] = p3; j += 4; }
    else if (op === OPS.curveTo3) { const p1 = apply(M, c[j], c[j + 1]), p3 = apply(M, c[j + 2], c[j + 3]); addBezier(idx, [cx, cy], p1, p3, p3); [cx, cy] = p3; j += 4; }
    else if (op === OPS.closePath) { idx.addSeg(cx, cy, sx, sy); cx = sx; cy = sy; }
  }
}
function addBezier(idx, p0, p1, p2, p3) {
  const len = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(2, Math.min(24, Math.ceil(len / 6)));
  let prev = p0;
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const p = [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
    idx.addSeg(prev[0], prev[1], p[0], p[1], i !== 1, i !== n);
    prev = p;
  }
}

// Find the best snap near p (page points). r = search radius in page points.
// extraPts: [{p, kind}] from markups; extraSegs: [[a,b]] from markups
export function findSnap(index, p, r, extraPts = [], extraSegs = [], modes = { end: true, mid: true, int: true, near: true }) {
  let best = null;
  const consider = (q, kind, rank) => {
    const d = dist(p, q);
    if (d > r) return;
    const score = d + rank * r; // lower rank wins when both are inside the radius
    if (!best || score < best.score) best = { p: q, kind, score };
  };
  const segs = [];
  if (index && index.ready) {
    for (const i of index.near(p, r)) {
      const [a, b] = index.seg(i);
      segs.push([a, b, index.flags[i]]);
    }
  }
  for (const [a, b] of extraSegs) segs.push([a, b, 7]);
  // limit the work on very dense areas: keep the segments closest to the cursor
  let list = segs;
  if (list.length > 400) {
    list = segs.map(s => [s, nearestOnSeg(p, s[0], s[1])[2]]).sort((x, y) => x[1] - y[1]).slice(0, 400).map(x => x[0]);
  }
  for (const [a, b, f] of list) {
    if (modes.end) { if (f & 1) consider(a, 'end', 0); if (f & 2) consider(b, 'end', 0); }
    if (modes.mid && (f & 4)) consider([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'mid', 0.15);
  }
  for (const e of extraPts) if (modes.end) consider(e.p, e.kind || 'end', 0);
  if (modes.int && list.length > 1) {
    const close = list.filter(s => nearestOnSeg(p, s[0], s[1])[2] <= r).slice(0, 120);
    for (let i = 0; i < close.length; i++) for (let j = i + 1; j < close.length; j++) {
      const q = segIntersect(close[i][0], close[i][1], close[j][0], close[j][1]);
      if (q) consider(q, 'int', 0.05);
    }
  }
  if (modes.near && !best) {
    for (const [a, b] of list) { const [q] = nearestOnSeg(p, a, b); consider(q, 'near', 0.6); }
  }
  return best;
}
