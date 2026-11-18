// Scales and unit formatting. Real lengths are kept in metres internally.
export const PT_M = 0.0254 / 72; // one PDF point on paper, in metres

export const UNITS = {
  mm: { label: 'mm', m: 0.001, metric: true },
  cm: { label: 'cm', m: 0.01, metric: true },
  m: { label: 'm', m: 1, metric: true },
  in: { label: 'in', m: 0.0254, metric: false },
  ft: { label: 'ft', m: 0.3048, metric: false },
  ftin: { label: "ft-in", m: 0.3048, metric: false }
};

export const METRIC_PRESETS = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 2000, 2500, 5000];
// architectural: paper inches per real foot
export const ARCH_PRESETS = [
  ['1/32" = 1\'-0"', 1 / 32], ['1/16" = 1\'-0"', 1 / 16], ['3/32" = 1\'-0"', 3 / 32], ['1/8" = 1\'-0"', 1 / 8],
  ['3/16" = 1\'-0"', 3 / 16], ['1/4" = 1\'-0"', 1 / 4], ['3/8" = 1\'-0"', 3 / 8], ['1/2" = 1\'-0"', 1 / 2],
  ['3/4" = 1\'-0"', 3 / 4], ['1" = 1\'-0"', 1], ['1 1/2" = 1\'-0"', 1.5], ['3" = 1\'-0"', 3], ['12" = 1\'-0"', 12]
];
// engineering: real feet per paper inch
export const ENG_PRESETS = [10, 20, 30, 40, 50, 60, 100, 200];

export function defaultScale() {
  return { mPerPt: PT_M, label: 'Not set (1:1)', unit: 'mm', precision: 0, set: false };
}
export function metricScale(n, unit = 'mm', precision = 0) {
  return { mPerPt: PT_M * n, label: '1:' + n, unit, precision, set: true };
}
export function archScale(label, inchPerFoot, unit = 'ftin', precision = 16) {
  return { mPerPt: PT_M * (12 / inchPerFoot), label, unit, precision, set: true };
}
export function engScale(feetPerInch, unit = 'ft', precision = 2) {
  return { mPerPt: PT_M * feetPerInch * 12, label: '1" = ' + feetPerInch + "'", unit, precision, set: true };
}
export function customScale(paperVal, paperUnit, realVal, realUnit, unit, precision) {
  const paperM = paperVal * UNITS[paperUnit].m, realM = realVal * UNITS[realUnit].m;
  const r = realM / paperM;
  return { mPerPt: PT_M * r, label: `${trimNum(paperVal)} ${UNITS[paperUnit].label} = ${trimNum(realVal)} ${UNITS[realUnit].label}`, unit, precision, set: true };
}
export function calibratedScale(pts, realM, unit, precision) {
  const r = realM / (pts * PT_M);
  return { mPerPt: realM / pts, label: 'Calibrated (1:' + trimNum(Math.round(r * 100) / 100) + ')', unit, precision, set: true };
}
export const trimNum = n => String(Math.round(n * 1e6) / 1e6);

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
export function formatFtIn(m, den = 16) {
  const neg = m < 0; m = Math.abs(m);
  let inches = m / 0.0254;
  let ft = Math.floor(inches / 12);
  let rem = inches - ft * 12;
  let whole = Math.floor(rem);
  let frac = Math.round((rem - whole) * den);
  if (frac === den) { whole++; frac = 0; }
  if (whole === 12) { ft++; whole = 0; }
  let s = `${ft}'-${whole}`;
  if (frac) { const g = gcd(frac, den); s += ` ${frac / g}/${den / g}`; }
  return (neg ? '-' : '') + s + '"';
}
export function formatLength(m, scale) {
  const u = scale.unit;
  if (u === 'ftin') return formatFtIn(m, scale.precision || 16);
  const v = m / UNITS[u].m;
  return v.toFixed(Math.max(0, Math.min(6, scale.precision | 0))) + ' ' + UNITS[u].label;
}
export function areaUnit(scale) { return UNITS[scale.unit].metric ? 'm²' : 'sq ft'; }
export function formatArea(m2, scale) {
  if (UNITS[scale.unit].metric) return m2.toFixed(2) + ' m²';
  return (m2 / 0.09290304).toFixed(2) + ' sq ft';
}
export function formatVolume(m3, scale) {
  if (UNITS[scale.unit].metric) return m3.toFixed(3) + ' m³';
  const cf = m3 / 0.0283168466;
  return cf.toFixed(2) + ' cu ft (' + (cf / 27).toFixed(2) + ' cu yd)';
}
// numeric value in the display unit (for CSV export)
export function lengthValue(m, scale) { return m / UNITS[scale.unit === 'ftin' ? 'ft' : scale.unit].m; }
export function lengthUnitName(scale) { return scale.unit === 'ftin' ? 'ft' : UNITS[scale.unit].label; }
export function areaValue(m2, scale) { return UNITS[scale.unit].metric ? m2 : m2 / 0.09290304; }
export function volumeValue(m3, scale) { return UNITS[scale.unit].metric ? m3 : m3 / 0.0283168466; }
export function volumeUnitName(scale) { return UNITS[scale.unit].metric ? 'm³' : 'cu ft'; }

// "12'-6 1/2"", "12' 6"", "12.5'", "150", "3 1/2" → metres, using `unit` when no marks are typed
export function parseLength(text, unit) {
  const s = String(text).trim().replace(/[″”]/g, '"').replace(/[′’]/g, "'");
  if (!s) return NaN;
  const frac = t => {
    t = t.trim(); if (!t) return 0;
    let tot = 0;
    for (const part of t.split(/[\s-]+/).filter(Boolean)) {
      if (part.includes('/')) { const [a, b] = part.split('/').map(Number); tot += a / b; } else tot += Number(part);
    }
    return tot;
  };
  const m = s.match(/^(-?[\d.\s/]*)'\s*-?\s*([\d.\s/]*)"?$/);
  if (m) return (frac(m[1]) * 12 + frac(m[2] || '')) * 0.0254;
  const mi = s.match(/^([\d.\s/-]+)"$/);
  if (mi) return frac(mi[1]) * 0.0254;
  const v = frac(s);
  if (!isFinite(v)) return NaN;
  const u = unit === 'ftin' ? 'ft' : unit;
  return v * UNITS[u].m;
}
