// Geometry helpers. All coordinates are page points (1/72 inch) in the page's on-screen orientation, y pointing down.
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];

export function polyLength(pts, closed = false) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) L += dist(pts[pts.length - 1], pts[0]);
  return L;
}
export function polyArea(pts) {
  let A = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) A += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(A / 2);
}
export function centroid(pts) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    A += f; cx += (pts[j][0] + pts[i][0]) * f; cy += (pts[j][1] + pts[i][1]) * f;
  }
  if (Math.abs(A) < 1e-9) { const b = bbox(pts); return [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2]; }
  return [cx / (3 * A), cy / (3 * A)];
}
export function bbox(pts) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) { if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1]; }
  return { x1, y1, x2, y2 };
}
export function rectPts(a, b) {
  const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]), y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}
// nearest point on segment ab to p; returns [point, t, distance]
export function nearestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return [q, t, dist(p, q)];
}
export function distToPolyline(p, pts, closed) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, nearestOnSeg(p, pts[i - 1], pts[i])[2]);
  if (closed && pts.length > 2) best = Math.min(best, nearestOnSeg(p, pts[pts.length - 1], pts[0])[2]);
  return best;
}
export function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
export function segIntersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}
// constrain p relative to origin o to multiples of `step` degrees
export function constrainAngle(o, p, step = 45) {
  const d = dist(o, p);
  if (!d) return p;
  const a = Math.atan2(p[1] - o[1], p[0] - o[0]);
  const s = step * Math.PI / 180;
  const q = Math.round(a / s) * s;
  return [o[0] + Math.cos(q) * d, o[1] + Math.sin(q) * d];
}
export function angleAt(a, v, b) {
  const a1 = Math.atan2(a[1] - v[1], a[0] - v[0]), a2 = Math.atan2(b[1] - v[1], b[0] - v[0]);
  let d = Math.abs(a2 - a1) * 180 / Math.PI;
  if (d > 180) d = 360 - d;
  return d;
}
// 2D affine matrices [a b c d e f] like PDF
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function invert(m) {
  const d = m[0] * m[3] - m[1] * m[2];
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}

// ---- path commands shared by screen drawing and PDF saving: ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Z']
export function polyCmds(pts, closed) {
  const c = [];
  pts.forEach((p, i) => c.push([i ? 'L' : 'M', p[0], p[1]]));
  if (closed) c.push(['Z']);
  return c;
}
const K = 0.5522847498;
export function ellipseCmds(cx, cy, rx, ry) {
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry],
    ['C', cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy],
    ['C', cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry],
    ['C', cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy],
    ['Z']
  ];
}
// circular arc from angle a0 to a1 (radians, any direction) as cubic beziers; continues the current path
export function arcCmds(cx, cy, r, a0, a1, moveFirst) {
  const out = [];
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const da = (a1 - a0) / n;
  const k = 4 / 3 * Math.tan(da / 4);
  let x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  if (moveFirst) out.push(['M', x0, y0]);
  for (let i = 0; i < n; i++) {
    const s = a0 + i * da, e = s + da;
    const x3 = cx + r * Math.cos(e), y3 = cy + r * Math.sin(e);
    out.push(['C', x0 - k * r * Math.sin(s), y0 + k * r * Math.cos(s), x3 + k * r * Math.sin(e), y3 - k * r * Math.cos(e), x3, y3]);
    x0 = x3; y0 = y3;
  }
  return out;
}
// revision cloud along a closed polygon: bulges point outward
export function cloudCmds(pts, arcSize) {
  if (pts.length < 2) return [];
  const P = pts.slice();
  // make the polygon clockwise on screen (y down) so bulges point outward
  let s = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[i][0] - P[j][0]) * (P[i][1] + P[j][1]);
  if (s > 0) P.reverse();
  const out = [];
  let first = true;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const L = dist(a, b);
    if (L < 1e-6) continue;
    const n = Math.max(1, Math.round(L / arcSize));
    for (let k = 0; k < n; k++) {
      const p0 = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
      const p1 = [a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n];
      const c = mid(p0, p1), r = dist(p0, p1) / 2;
      const ang = Math.atan2(p0[1] - c[1], p0[0] - c[0]);
      // sweep 180° going outward (counter-clockwise on screen for a clockwise polygon)
      out.push(...arcCmds(c[0], c[1], r, ang, ang - Math.PI, first));
      first = false;
    }
  }
  out.push(['Z']);
  return out;
}
export function cmdsToCanvas(ctx, cmds) {
  ctx.beginPath();
  for (const c of cmds) {
    if (c[0] === 'M') ctx.moveTo(c[1], c[2]);
    else if (c[0] === 'L') ctx.lineTo(c[1], c[2]);
    else if (c[0] === 'C') ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else if (c[0] === 'Z') ctx.closePath();
  }
}
export function cmdsBBox(cmds) {
  const pts = [];
  for (const c of cmds) for (let i = 1; i + 1 < c.length; i += 2) pts.push([c[i], c[i + 1]]);
  return bbox(pts);
}
