// Markup types: how each one is drawn (as primitives shared by the screen and PDF saving), measured, hit and edited.
import * as G from './geom.js';
import { formatLength, formatArea, formatVolume } from './units.js';

export const TYPES = {
  pen: { name: 'Pen', group: 'markup' },
  highlight: { name: 'Highlight', group: 'markup' },
  line: { name: 'Line', group: 'markup' },
  arrow: { name: 'Arrow', group: 'markup' },
  polyline: { name: 'Polyline', group: 'markup' },
  rect: { name: 'Rectangle', group: 'markup', box: true },
  ellipse: { name: 'Ellipse', group: 'markup', box: true },
  polygon: { name: 'Polygon', group: 'markup' },
  triangle: { name: 'Triangle', group: 'markup' },
  cloud: { name: 'Cloud', group: 'markup' },
  text: { name: 'Text Box', group: 'markup', box: true, text: true },
  callout: { name: 'Callout', group: 'markup', text: true },
  note: { name: 'Note', group: 'markup', text: true },
  stamp: { name: 'Stamp', group: 'markup', box: true },
  length: { name: 'Length', group: 'measure', measure: 'length' },
  polylength: { name: 'Polylength', group: 'measure', measure: 'length' },
  area: { name: 'Area', group: 'measure', measure: 'area' },
  perimeter: { name: 'Perimeter', group: 'measure', measure: 'length' },
  count: { name: 'Count', group: 'measure', measure: 'count' },
  angle: { name: 'Angle', group: 'measure', measure: 'angle' },
  radius: { name: 'Radius', group: 'measure', measure: 'length' },
  viewport: { name: 'Scale Area', group: 'measure', box: true }
};

export const STAMPS = [
  { text: 'APPROVED', color: '#1E8E3E' }, { text: 'APPROVED AS NOTED', color: '#1A73E8' },
  { text: 'REVISE & RESUBMIT', color: '#E37400' }, { text: 'REJECTED', color: '#D93025' },
  { text: 'FOR REVIEW', color: '#1A73E8' }, { text: 'CHECKED', color: '#1E8E3E' },
  { text: 'FOR CONSTRUCTION', color: '#1E8E3E' }, { text: 'NOT FOR CONSTRUCTION', color: '#D93025' },
  { text: 'VOID', color: '#D93025' }, { text: 'PRELIMINARY', color: '#E37400' }
];

export const STATUSES = ['', 'Accepted', 'Rejected', 'Cancelled', 'Completed', 'Question', 'In Progress'];
export const FLAGS = ['', 'red', 'orange', 'green', 'blue'];
export const FLAG_HEX = { red: '#E5484D', orange: '#F5A524', green: '#30A46C', blue: '#3E7BFA' };

export function defaultStyle(type) {
  const base = { stroke: '#E5484D', fill: '', fillOpacity: 0.25, opacity: 1, width: 1.5, dash: 'solid', fontSize: 12, textColor: '#E5484D', arrowStart: false, arrowEnd: false };
  switch (type) {
    case 'pen': return { ...base, width: 1.5 };
    case 'highlight': return { ...base, stroke: '#FFE45C', width: 14, opacity: 0.45 };
    case 'arrow': return { ...base, arrowEnd: true };
    case 'cloud': return { ...base, width: 1.5, arcSize: 14 };
    case 'text': return { ...base, stroke: '', fill: '', textColor: '#E5484D', fontSize: 12 };
    case 'callout': return { ...base, fill: '#FFFFFF', fillOpacity: 1, textColor: '#E5484D' };
    case 'note': return { ...base, stroke: '#B88A00', fill: '#FFD84D', fillOpacity: 1 };
    case 'stamp': return { ...base, stroke: '#1E8E3E', width: 2.5, textColor: '#1E8E3E', opacity: 0.85 };
    case 'length': return { ...base, stroke: '#2F7FF5', textColor: '#2F7FF5', fontSize: 10, arrowStart: false, arrowEnd: false };
    case 'polylength': return { ...base, stroke: '#2F7FF5', textColor: '#2F7FF5', fontSize: 10 };
    case 'perimeter': return { ...base, stroke: '#8E4EC6', textColor: '#8E4EC6', fontSize: 10 };
    case 'area': return { ...base, stroke: '#30A46C', fill: '#30A46C', fillOpacity: 0.25, textColor: '#1F7A4D', fontSize: 10 };
    case 'count': return { ...base, stroke: '#E5484D', fill: '#E5484D', fillOpacity: 0.85, textColor: '#FFFFFF', fontSize: 8, marker: 'circle', markerSize: 7 };
    case 'angle': return { ...base, stroke: '#F5A524', textColor: '#B87400', fontSize: 10 };
    case 'radius': return { ...base, stroke: '#0EA5A4', textColor: '#0B7F7E', fontSize: 10 };
    case 'viewport': return { ...base, stroke: '#7C8796', width: 1, dash: 'dash', textColor: '#56606E', fontSize: 9 };
    default: return base;
  }
}

let idCounter = 0;
export function newId() { return Date.now().toString(36) + '-' + (idCounter++).toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

// ---------- measurement
export function measureOf(m, scaleAt) {
  const t = TYPES[m.type];
  if (!t || !t.measure) return null;
  const sc = scaleAt(m.page, m.pts[0] || [0, 0]);
  const k = sc.mPerPt;
  switch (m.type) {
    case 'length': { const L = G.dist(m.pts[0], m.pts[1] || m.pts[0]) * k; return { kind: 'length', value: L, text: formatLength(L, sc), scale: sc }; }
    case 'polylength': { const L = G.polyLength(m.pts) * k; return { kind: 'length', value: L, text: formatLength(L, sc), scale: sc }; }
    case 'perimeter': { const L = G.polyLength(m.pts, true) * k; return { kind: 'length', value: L, text: formatLength(L, sc), scale: sc }; }
    case 'radius': { const R = G.dist(m.pts[0], m.pts[1] || m.pts[0]) * k; return { kind: 'length', value: R, text: 'R ' + formatLength(R, sc) + '  Ø ' + formatLength(2 * R, sc), scale: sc, area: Math.PI * R * R }; }
    case 'area': {
      const A = G.polyArea(m.pts) * k * k;
      const P = G.polyLength(m.pts, true) * k;
      let text = formatArea(A, sc);
      let volume = null;
      if (m.depth > 0) { volume = A * m.depth; text += '\n' + formatVolume(volume, sc); }
      return { kind: 'area', value: A, perimeter: P, volume, text, scale: sc };
    }
    case 'count': return { kind: 'count', value: m.pts.length, text: String(m.pts.length), scale: sc };
    case 'angle': { const a = m.pts.length >= 3 ? G.angleAt(m.pts[0], m.pts[1], m.pts[2]) : 0; return { kind: 'angle', value: a, text: a.toFixed(1) + '°', scale: sc }; }
  }
  return null;
}

// ---------- primitives: {k:'path', cmds, stroke, fill, width, dash, opacity, fillOpacity, cap} | {k:'text', x, y, size, text, color, align, bg, bgOpacity, border}
const DASHES = { solid: null, dash: [6, 4], dot: [1.2, 3], dashdot: [7, 3, 1.2, 3], long: [12, 5] };
export function dashFor(style) { const d = DASHES[style.dash]; return d ? d.map(v => v * Math.max(1, style.width * 0.6)) : null; }

function arrowHead(tip, from, size) {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const s = 0.42;
  const p1 = [tip[0] - size * Math.cos(a - s), tip[1] - size * Math.sin(a - s)];
  const p2 = [tip[0] - size * Math.cos(a + s), tip[1] - size * Math.sin(a + s)];
  return [['M', p1[0], p1[1]], ['L', tip[0], tip[1]], ['L', p2[0], p2[1]], ['Z']];
}
function tick(p, dir, size) {
  // architectural tick: 45° slash
  const a = Math.atan2(dir[1], dir[0]) + Math.PI / 4;
  return [['M', p[0] - Math.cos(a) * size, p[1] - Math.sin(a) * size], ['L', p[0] + Math.cos(a) * size, p[1] + Math.sin(a) * size]];
}

export function wrapText(text, maxW, size, measure) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    if (!para) { lines.push(''); continue; }
    const words = para.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (cur && measure(test.trimEnd(), size) > maxW) { lines.push(cur.trimEnd()); cur = w.trimStart(); }
      else cur = test;
      // very long word: break by characters
      while (measure(cur, size) > maxW && cur.length > 1) {
        let i = cur.length - 1;
        while (i > 1 && measure(cur.slice(0, i), size) > maxW) i--;
        lines.push(cur.slice(0, i)); cur = cur.slice(i);
      }
    }
    lines.push(cur.trimEnd());
  }
  return lines;
}

function label(out, text, at, style, measure, opts = {}) {
  if (!text) return;
  const size = style.fontSize || 10;
  const lines = String(text).split('\n');
  const w = Math.max(...lines.map(l => measure(l, size))) + size * 0.6;
  const h = lines.length * size * 1.2 + size * 0.3;
  let x = at[0] - w / 2, y = at[1] - h / 2;
  if (opts.above) y = at[1] - h - size * 0.25;
  out.push({ k: 'path', cmds: G.polyCmds(G.rectPts([x, y], [x + w, y + h]), true), fill: '#FFFFFF', fillOpacity: 0.85, stroke: '', width: 0, opacity: 1, label: true });
  lines.forEach((l, i) => out.push({ k: 'text', x: at[0], y: y + size * 0.15 + size * (i + 0.95) * 1.2 - size * 0.2, size, text: l, color: style.textColor || style.stroke, align: 'center', bold: true }));
}

// Build the drawing for a markup. `measure(text,size)` returns text width in points.
export function primitives(m, scaleAt, measure) {
  const s = m.style, P = m.pts, out = [];
  const path = (cmds, extra = {}) => out.push({ k: 'path', cmds, stroke: s.stroke, fill: '', width: s.width, dash: dashFor(s), opacity: s.opacity, fillOpacity: s.fillOpacity, ...extra });
  const shape = (cmds) => {
    if (s.fill) out.push({ k: 'path', cmds, stroke: '', fill: s.fill, fillOpacity: s.fillOpacity, opacity: s.opacity, width: 0 });
    if (s.stroke && s.width > 0) path(cmds);
  };
  const meas = measureOf(m, scaleAt);
  switch (m.type) {
    case 'pen': case 'highlight':
      if (P.length) path(smoothCmds(P), { cap: 'round', join: 'round', blend: m.type === 'highlight' ? 'multiply' : '' });
      break;
    case 'line': case 'arrow': case 'polyline': {
      if (P.length < 2) break;
      path(G.polyCmds(P, false), { cap: 'round', join: 'round' });
      const hs = Math.max(6, s.width * 4);
      if (s.arrowEnd) out.push({ k: 'path', cmds: arrowHead(P[P.length - 1], P[P.length - 2], hs), fill: s.stroke, fillOpacity: 1, stroke: s.stroke, width: s.width, opacity: s.opacity });
      if (s.arrowStart) out.push({ k: 'path', cmds: arrowHead(P[0], P[1], hs), fill: s.stroke, fillOpacity: 1, stroke: s.stroke, width: s.width, opacity: s.opacity });
      break;
    }
    case 'rect': case 'viewport': {
      if (P.length < 2) break;
      shape(G.polyCmds(G.rectPts(P[0], P[1]), true));
      if (m.type === 'viewport') {
        const b = G.bbox(P);
        const name = (m.subject || 'Scale Area') + (m.scale ? ' — ' + m.scale.label : '');
        out.push({ k: 'text', x: b.x1 + 3, y: b.y1 - 3, size: s.fontSize, text: name, color: s.textColor, align: 'left' });
      }
      break;
    }
    case 'ellipse': {
      if (P.length < 2) break;
      const b = G.bbox(P);
      shape(G.ellipseCmds((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, (b.x2 - b.x1) / 2, (b.y2 - b.y1) / 2));
      break;
    }
    case 'polygon': case 'triangle':
      if (P.length >= 2) shape(G.polyCmds(P, P.length > 2));
      break;
    case 'cloud':
      if (P.length >= 2) {
        const pts = P.length === 2 ? G.rectPts(P[0], P[1]) : P;
        shape(G.cloudCmds(pts, s.arcSize || 14));
      }
      break;
    case 'text': {
      if (P.length < 2) break;
      const b = G.bbox(P);
      shape(G.polyCmds(G.rectPts([b.x1, b.y1], [b.x2, b.y2]), true));
      textBlock(out, m.text, b, s, measure);
      break;
    }
    case 'callout': {
      if (P.length < 3) break;
      const b = G.bbox([P[1], P[2]]);
      const tip = P[0];
      const anchor = closestEdgeMid(b, tip);
      out.push({ k: 'path', cmds: [['M', anchor[0], anchor[1]], ['L', tip[0], tip[1]]], stroke: s.stroke, width: s.width, opacity: s.opacity, fill: '' });
      out.push({ k: 'path', cmds: arrowHead(tip, anchor, Math.max(6, s.width * 4)), fill: s.stroke, fillOpacity: 1, stroke: s.stroke, width: s.width, opacity: s.opacity });
      const box = G.polyCmds(G.rectPts([b.x1, b.y1], [b.x2, b.y2]), true);
      if (s.fill) out.push({ k: 'path', cmds: box, fill: s.fill, fillOpacity: s.fillOpacity, opacity: s.opacity, stroke: '', width: 0 });
      out.push({ k: 'path', cmds: box, stroke: s.stroke, width: s.width, opacity: s.opacity, fill: '', dash: dashFor(s) });
      textBlock(out, m.text, b, s, measure);
      break;
    }
    case 'note': {
      const p = P[0]; const z = 16;
      const cmds = [['M', p[0], p[1]], ['L', p[0] + z, p[1]], ['L', p[0] + z, p[1] + z * 0.72], ['L', p[0] + z * 0.72, p[1] + z], ['L', p[0], p[1] + z], ['Z']];
      out.push({ k: 'path', cmds, fill: s.fill || '#FFD84D', fillOpacity: 1, stroke: s.stroke || '#B88A00', width: 1, opacity: 1 });
      for (let i = 0; i < 3; i++) out.push({ k: 'path', cmds: [['M', p[0] + 3.5, p[1] + 4.5 + i * 3.4], ['L', p[0] + z - 3.5 - (i === 2 ? 4 : 0), p[1] + 4.5 + i * 3.4]], stroke: s.stroke || '#B88A00', width: 0.9, opacity: 1, fill: '' });
      break;
    }
    case 'stamp': {
      if (P.length < 2) break;
      const b = G.bbox(P);
      const r = Math.min(8, (b.y2 - b.y1) / 4);
      const cmds = roundRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1, r);
      out.push({ k: 'path', cmds, stroke: s.stroke, width: s.width, opacity: s.opacity, fill: '' });
      const inset = s.width * 2.2;
      out.push({ k: 'path', cmds: roundRect(b.x1 + inset, b.y1 + inset, b.x2 - b.x1 - 2 * inset, b.y2 - b.y1 - 2 * inset, Math.max(0, r - inset * 0.6)), stroke: s.stroke, width: s.width * 0.45, opacity: s.opacity, fill: '' });
      const main = m.text || 'APPROVED';
      const sub = m.stampSub || '';
      const H = b.y2 - b.y1, W = b.x2 - b.x1;
      let size = H * (sub ? 0.36 : 0.48);
      const tw = measure(main, size);
      if (tw > W * 0.86) size *= W * 0.86 / tw;
      const cy = sub ? b.y1 + H * 0.5 : b.y1 + H / 2 + size * 0.35;
      out.push({ k: 'text', x: (b.x1 + b.x2) / 2, y: cy, size, text: main, color: s.stroke, align: 'center', bold: true, opacity: s.opacity });
      if (sub) {
        let ss = H * 0.17; const sw = measure(sub, ss); if (sw > W * 0.86) ss *= W * 0.86 / sw;
        out.push({ k: 'text', x: (b.x1 + b.x2) / 2, y: b.y1 + H * 0.8, size: ss, text: sub, color: s.stroke, align: 'center', opacity: s.opacity });
      }
      break;
    }
    case 'length': {
      if (P.length < 2) break;
      const [a, b] = P;
      path([['M', a[0], a[1]], ['L', b[0], b[1]]], { cap: 'butt' });
      const d = G.sub(b, a), ts = Math.max(4, s.width * 3);
      if (s.arrowStart || s.arrowEnd) {
        if (s.arrowEnd) out.push({ k: 'path', cmds: arrowHead(b, a, Math.max(6, s.width * 4)), fill: s.stroke, fillOpacity: 1, stroke: s.stroke, width: s.width, opacity: s.opacity });
        if (s.arrowStart) out.push({ k: 'path', cmds: arrowHead(a, b, Math.max(6, s.width * 4)), fill: s.stroke, fillOpacity: 1, stroke: s.stroke, width: s.width, opacity: s.opacity });
      } else {
        out.push({ k: 'path', cmds: [...tick(a, d, ts), ...tick(b, d, ts)], stroke: s.stroke, width: s.width, opacity: s.opacity, fill: '' });
      }
      label(out, meas && meas.text, G.mid(a, b), s, measure, { above: false });
      break;
    }
    case 'polylength': {
      if (P.length < 2) break;
      path(G.polyCmds(P, false), { join: 'round' });
      for (const p of P) out.push({ k: 'path', cmds: G.ellipseCmds(p[0], p[1], s.width * 1.3 + 0.8, s.width * 1.3 + 0.8), fill: s.stroke, fillOpacity: 1, stroke: '', width: 0, opacity: s.opacity });
      const i = longestSeg(P);
      label(out, meas && meas.text, G.mid(P[i], P[i + 1]), s, measure);
      break;
    }
    case 'perimeter': {
      if (P.length < 2) break;
      path(G.polyCmds(P, P.length > 2), { join: 'round' });
      label(out, meas && meas.text, G.centroid(P), s, measure);
      break;
    }
    case 'area': {
      if (P.length < 2) break;
      shape(G.polyCmds(P, true));
      if (P.length > 2) label(out, meas && meas.text, G.centroid(P), s, measure);
      break;
    }
    case 'count': {
      const z = s.markerSize || 7;
      P.forEach((p, i) => {
        if (s.marker === 'square') out.push({ k: 'path', cmds: G.polyCmds(G.rectPts([p[0] - z, p[1] - z], [p[0] + z, p[1] + z]), true), fill: s.fill || s.stroke, fillOpacity: s.fillOpacity, stroke: s.stroke, width: 0.8, opacity: s.opacity });
        else if (s.marker === 'check') out.push({ k: 'path', cmds: [['M', p[0] - z * 0.8, p[1]], ['L', p[0] - z * 0.2, p[1] + z * 0.65], ['L', p[0] + z * 0.9, p[1] - z * 0.75]], stroke: s.stroke, width: Math.max(1.5, z / 3), opacity: s.opacity, fill: '', cap: 'round', join: 'round' });
        else out.push({ k: 'path', cmds: G.ellipseCmds(p[0], p[1], z, z), fill: s.fill || s.stroke, fillOpacity: s.fillOpacity, stroke: s.stroke, width: 0.8, opacity: s.opacity });
        if (s.marker !== 'check') out.push({ k: 'text', x: p[0], y: p[1] + (s.fontSize || 8) * 0.36, size: s.fontSize || 8, text: String(i + 1), color: s.textColor || '#FFFFFF', align: 'center', bold: true });
      });
      break;
    }
    case 'angle': {
      if (P.length < 2) break;
      path(G.polyCmds(P.slice(0, 3), false), { join: 'round' });
      if (P.length >= 3) {
        const [a, v, b] = P;
        const r = Math.min(G.dist(a, v), G.dist(b, v)) * 0.35;
        let a1 = Math.atan2(a[1] - v[1], a[0] - v[0]), a2 = Math.atan2(b[1] - v[1], b[0] - v[0]);
        let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        out.push({ k: 'path', cmds: G.arcCmds(v[0], v[1], r, a1, a1 + d, true), stroke: s.stroke, width: s.width, opacity: s.opacity, fill: '' });
        const am = a1 + d / 2;
        label(out, meas && meas.text, [v[0] + Math.cos(am) * (r + 14), v[1] + Math.sin(am) * (r + 14)], s, measure);
      }
      break;
    }
    case 'radius': {
      if (P.length < 2) break;
      const [c, e] = P, r = G.dist(c, e);
      shape(G.ellipseCmds(c[0], c[1], r, r));
      path([['M', c[0], c[1]], ['L', e[0], e[1]]]);
      out.push({ k: 'path', cmds: G.ellipseCmds(c[0], c[1], 1.6, 1.6), fill: s.stroke, fillOpacity: 1, stroke: '', width: 0, opacity: 1 });
      label(out, meas && meas.text, G.mid(c, e), s, measure);
      break;
    }
  }
  return out;
}

function roundRect(x, y, w, h, r) {
  if (w <= 0 || h <= 0) return [];
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = 0.5523 * r;
  return [['M', x + r, y], ['L', x + w - r, y], ['C', x + w - r + k, y, x + w, y + r - k, x + w, y + r], ['L', x + w, y + h - r],
    ['C', x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h], ['L', x + r, y + h], ['C', x + r - k, y + h, x, y + h - r + k, x, y + h - r],
    ['L', x, y + r], ['C', x, y + r - k, x + r - k, y, x + r, y], ['Z']];
}
function textBlock(out, text, b, s, measure) {
  const size = s.fontSize || 12, pad = Math.max(2, size * 0.3);
  const lines = wrapText(text, Math.max(4, b.x2 - b.x1 - pad * 2), size, measure);
  lines.forEach((l, i) => {
    const y = b.y1 + pad + size * 0.92 + i * size * 1.2;
    if (y > b.y2 + size * 0.2) return;
    out.push({ k: 'text', x: b.x1 + pad, y, size, text: l, color: s.textColor || '#000', align: 'left', opacity: s.opacity });
  });
}
function closestEdgeMid(b, p) {
  const c = [[(b.x1 + b.x2) / 2, b.y1], [(b.x1 + b.x2) / 2, b.y2], [b.x1, (b.y1 + b.y2) / 2], [b.x2, (b.y1 + b.y2) / 2]];
  return c.reduce((best, q) => G.dist(q, p) < G.dist(best, p) ? q : best, c[0]);
}
function longestSeg(P) { let bi = 0, bl = -1; for (let i = 0; i + 1 < P.length; i++) { const l = G.dist(P[i], P[i + 1]); if (l > bl) { bl = l; bi = i; } } return bi; }
function smoothCmds(P) {
  if (P.length < 3) return G.polyCmds(P.length === 1 ? [P[0], [P[0][0] + 0.01, P[0][1]]] : P, false);
  const c = [['M', P[0][0], P[0][1]]];
  for (let i = 1; i < P.length - 1; i++) {
    const m1 = G.mid(P[i], P[i + 1]);
    // quadratic through midpoints, as cubic
    const p0 = i === 1 ? P[0] : G.mid(P[i - 1], P[i]);
    c.push(['C', p0[0] + 2 / 3 * (P[i][0] - p0[0]), p0[1] + 2 / 3 * (P[i][1] - p0[1]), m1[0] + 2 / 3 * (P[i][0] - m1[0]), m1[1] + 2 / 3 * (P[i][1] - m1[1]), m1[0], m1[1]]);
  }
  c.push(['L', P[P.length - 1][0], P[P.length - 1][1]]);
  return c;
}

// ---------- geometry for selection and editing
export function bounds(m, scaleAt, measure) {
  if (m.type === 'note') return { x1: m.pts[0][0], y1: m.pts[0][1], x2: m.pts[0][0] + 16, y2: m.pts[0][1] + 16 };
  const prims = primitives(m, scaleAt, measure);
  let b = m.pts.length ? G.bbox(m.pts) : { x1: 0, y1: 0, x2: 0, y2: 0 };
  for (const p of prims) {
    if (p.k === 'path') { const q = G.cmdsBBox(p.cmds); b = union(b, q); }
    else if (p.k === 'text') { const w = measure(p.text, p.size); const x = p.align === 'center' ? p.x - w / 2 : p.x; b = union(b, { x1: x, y1: p.y - p.size, x2: x + w, y2: p.y + p.size * 0.3 }); }
  }
  const pad = (m.style.width || 1) / 2;
  return { x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad };
}
const union = (a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) });

export function hitTest(m, p, tol, scaleAt, measure) {
  const P = m.pts, w = (m.style.width || 1) / 2 + tol;
  switch (m.type) {
    case 'note': return p[0] >= P[0][0] - tol && p[0] <= P[0][0] + 16 + tol && p[1] >= P[0][1] - tol && p[1] <= P[0][1] + 16 + tol;
    case 'pen': case 'highlight': case 'line': case 'arrow': case 'polyline': case 'polylength': case 'length': case 'angle':
      if (G.distToPolyline(p, P, false) <= w) return true;
      break;
    case 'count': return P.some(q => G.dist(q, p) <= (m.style.markerSize || 7) + tol);
    case 'radius': { const r = G.dist(P[0], P[1]); if (Math.abs(G.dist(P[0], p) - r) <= w || (m.style.fill && G.dist(P[0], p) <= r)) return true; break; }
    case 'ellipse': {
      const b = G.bbox(P); const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, rx = Math.max(1e-3, (b.x2 - b.x1) / 2), ry = Math.max(1e-3, (b.y2 - b.y1) / 2);
      const v = Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry);
      if (m.style.fill ? v <= 1 + w / Math.min(rx, ry) : Math.abs(v - 1) * Math.min(rx, ry) <= w) return true;
      break;
    }
    case 'rect': case 'viewport': case 'text': case 'stamp': case 'callout': {
      const box = m.type === 'callout' ? [P[1], P[2]] : P;
      const R = G.rectPts(box[0], box[1]);
      const filled = m.type === 'text' || m.type === 'stamp' || m.type === 'callout' || !!m.style.fill;
      if (filled ? G.pointInPoly(p, R) : false) return true;
      if (G.distToPolyline(p, R, true) <= w) return true;
      if (m.type === 'callout' && G.nearestOnSeg(p, P[0], closestEdgeMid(G.bbox(box), P[0]))[2] <= w) return true;
      break;
    }
    case 'cloud': case 'polygon': case 'triangle': case 'area': case 'perimeter': {
      const pts = m.type === 'cloud' && P.length === 2 ? G.rectPts(P[0], P[1]) : P;
      if ((m.style.fill || m.type === 'area') && G.pointInPoly(p, pts)) return true;
      if (G.distToPolyline(p, pts, true) <= w + (m.type === 'cloud' ? (m.style.arcSize || 14) / 2 : 0)) return true;
      break;
    }
  }
  // labels count as part of the markup
  if (TYPES[m.type] && TYPES[m.type].measure) {
    for (const q of primitives(m, scaleAt, measure)) if (q.label) { const b = G.cmdsBBox(q.cmds); if (p[0] >= b.x1 && p[0] <= b.x2 && p[1] >= b.y1 && p[1] <= b.y2) return true; }
  }
  return false;
}

// handles: [{x,y,i}] — i is passed back to moveHandle
export function handles(m) {
  const P = m.pts;
  if (m.type === 'pen' || m.type === 'highlight' || m.type === 'note') { const b = G.bbox(P); return []; }
  if (TYPES[m.type].box || (m.type === 'cloud' && P.length === 2)) {
    const R = G.rectPts(P[0], P[1]);
    return R.map((p, i) => ({ x: p[0], y: p[1], i }));
  }
  if (m.type === 'callout') {
    const R = G.rectPts(P[1], P[2]);
    return [{ x: P[0][0], y: P[0][1], i: 'tip' }, ...R.map((p, i) => ({ x: p[0], y: p[1], i }))];
  }
  return P.map((p, i) => ({ x: p[0], y: p[1], i }));
}
export function moveHandle(m, h, p) {
  const P = m.pts;
  const boxEdit = (a, b) => {
    // corners of the box in order tl,tr,br,bl; the opposite corner stays fixed
    const R = G.rectPts(a, b);
    const opp = R[(h + 2) % 4];
    return [opp.slice(), p.slice()];
  };
  if (m.type === 'callout') {
    if (h === 'tip') P[0] = p.slice();
    else { const [a, b] = boxEdit(P[1], P[2]); P[1] = a; P[2] = b; }
    return;
  }
  if (TYPES[m.type].box || (m.type === 'cloud' && P.length === 2)) { const [a, b] = boxEdit(P[0], P[1]); P[0] = a; P[1] = b; return; }
  if (typeof h === 'number' && P[h]) P[h] = p.slice();
}
export function translate(m, dx, dy) { m.pts = m.pts.map(p => [p[0] + dx, p[1] + dy]); }

// points other tools can snap to
export function snapPoints(m) {
  const pts = [];
  if (m.type === 'pen' || m.type === 'highlight') return pts;
  for (const h of handles(m)) pts.push({ p: [h.x, h.y], kind: 'end' });
  if (m.type === 'radius' || m.type === 'ellipse') { const b = G.bbox(m.type === 'radius' ? [m.pts[0]] : m.pts); pts.push({ p: m.type === 'radius' ? m.pts[0] : [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2], kind: 'center' }); }
  return pts;
}
export function snapSegs(m) {
  const P = m.pts, segs = [];
  if (['line', 'arrow', 'polyline', 'length', 'polylength', 'angle'].includes(m.type)) for (let i = 1; i < P.length; i++) segs.push([P[i - 1], P[i]]);
  else if (['polygon', 'triangle', 'area', 'perimeter'].includes(m.type) || (m.type === 'cloud' && P.length > 2)) for (let i = 0; i < P.length; i++) segs.push([P[i], P[(i + 1) % P.length]]);
  else if (TYPES[m.type].box && P.length === 2) { const R = G.rectPts(P[0], P[1]); for (let i = 0; i < 4; i++) segs.push([R[i], R[(i + 1) % 4]]); }
  return segs;
}
