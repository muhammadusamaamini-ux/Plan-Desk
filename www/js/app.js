// Plan Desk — main window: documents, viewer, tools and commands
import * as pdfjsLib from '../lib/pdf.mjs';
import * as G from './geom.js';
import * as MK from './markups.js';
import * as U from './units.js';
import { buildSnapIndex, findSnap } from './snap.js';
import { openForView, savePdf } from './pdfio.js';
import * as KS from './shortcuts.js';
import { ICONS } from './icons.js';
import { $, $$, esc, toast, modal, ask, prompt, showMenu, closeMenus, modalOpen } from './dialogs.js';
import * as P from './panels.js';
import * as D from './features.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.mjs', import.meta.url).href;
const LIB = new URL('../lib/', import.meta.url).href;
export const desk = window.desk || null; // the Windows app bridge (missing when opened in a plain browser)

// ---------------------------------------------------------------- state
function load(key, def) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; } catch (e) { return def; } }
export function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage full */ } }

export const S = {
  docs: [], doc: null,
  tool: 'select', myTool: null,
  snap: true, ortho: false,
  draft: null, hover: null, snapHit: null,
  clip: null, scaleRev: 0,
  settings: Object.assign({ author: '', wheel: 'zoom', snapRadius: 12, returnToSelect: false, autoUpdate: true, leftOn: true, rightOn: true, listOn: true, leftW: 250, rightW: 280, bottomH: 220, stamp: 0, defaultUnit: 'm' }, load('pd.settings', {})),
  toolStyles: load('pd.toolStyles', {}),
  myTools: load('pd.myTools', [])
};
export const saveSettings = () => store('pd.settings', S.settings);
export const saveToolStyles = () => store('pd.toolStyles', S.toolStyles);
export const saveMyTools = () => store('pd.myTools', S.myTools);
export const doc = () => S.doc;

// tool definitions: mode decides how clicks build the markup
export const TOOLS = {
  select: { label: 'Select', icon: 'select' },
  pan: { label: 'Pan', icon: 'pan' },
  zoomrect: { label: 'Zoom window', icon: 'zoomrect' },
  pen: { type: 'pen', mode: 'free', label: 'Pen' },
  highlight: { type: 'highlight', mode: 'free', label: 'Highlighter' },
  line: { type: 'line', mode: 'two', label: 'Line' },
  arrow: { type: 'arrow', mode: 'two', label: 'Arrow' },
  polyline: { type: 'polyline', mode: 'multi', min: 2, label: 'Polyline' },
  rect: { type: 'rect', mode: 'box', label: 'Rectangle' },
  ellipse: { type: 'ellipse', mode: 'box', label: 'Ellipse' },
  polygon: { type: 'polygon', mode: 'multi', min: 3, closed: true, label: 'Polygon' },
  triangle: { type: 'triangle', mode: 'box', label: 'Triangle' },
  cloud: { type: 'cloud', mode: 'multi', min: 3, closed: true, label: 'Cloud' },
  rectcloud: { type: 'cloud', mode: 'box', label: 'Rectangle cloud', icon: 'rectcloud' },
  text: { type: 'text', mode: 'box', label: 'Text box', defSize: [160, 40] },
  callout: { type: 'callout', mode: 'callout', label: 'Callout' },
  note: { type: 'note', mode: 'click', label: 'Note' },
  stamp: { type: 'stamp', mode: 'box', label: 'Stamp', defSize: [200, 60] },
  calibrate: { mode: 'two', label: 'Calibrate', special: 'calibrate', icon: 'calibrate', type: 'length' },
  length: { type: 'length', mode: 'two', label: 'Length' },
  polylength: { type: 'polylength', mode: 'multi', min: 2, label: 'Polylength' },
  area: { type: 'area', mode: 'multi', min: 3, closed: true, label: 'Area' },
  rectarea: { type: 'area', mode: 'box', label: 'Rectangle area', icon: 'rectarea', toPoly: true },
  perimeter: { type: 'perimeter', mode: 'multi', min: 3, closed: true, label: 'Perimeter' },
  count: { type: 'count', mode: 'count', label: 'Count' },
  angle: { type: 'angle', mode: 'multi', min: 3, max: 3, label: 'Angle' },
  radius: { type: 'radius', mode: 'two', label: 'Radius' },
  viewport: { type: 'viewport', mode: 'box', label: 'Scale area' }
};
for (const [id, t] of Object.entries(TOOLS)) if (!t.icon) t.icon = id;

export function styleFor(type) { return Object.assign(MK.defaultStyle(type), S.toolStyles[type] || {}); }

// ---------------------------------------------------------------- text measuring (Arial = Helvetica metrics)
const mctx = document.createElement('canvas').getContext('2d');
const mcache = new Map();
export function measureText(t, size) {
  const k = t;
  let w = mcache.get(k);
  if (w == null) { mctx.font = 'bold 100px Arial, Helvetica, sans-serif'; w = mctx.measureText(t).width / 100; if (mcache.size > 5000) mcache.clear(); mcache.set(k, w); }
  return w * size;
}

// ---------------------------------------------------------------- scale lookup
export function pageScale(d, i) { return (d.scales && d.scales[i]) || U.defaultScale(); }
export function scaleAtFor(d) {
  return (page, pt) => {
    if (pt) for (const m of d.markups) {
      if (m.type === 'viewport' && m.page === page && m.scale && m.pts.length === 2) {
        const b = G.bbox(m.pts);
        if (pt[0] >= b.x1 && pt[0] <= b.x2 && pt[1] >= b.y1 && pt[1] <= b.y2) return m.scale;
      }
    }
    return pageScale(d, page);
  };
}
export const scaleAt = (page, pt) => S.doc ? scaleAtFor(S.doc)(page, pt) : U.defaultScale();

// primitives cache
const primCache = new WeakMap();
export function prims(m) {
  if (!m._rev) return MK.primitives(m, scaleAt, measureText);
  const key = m._rev + '|' + S.scaleRev;
  const c = primCache.get(m);
  if (c && c.key === key) return c.prims;
  const p = MK.primitives(m, scaleAt, measureText);
  primCache.set(m, { key, prims: p });
  return p;
}
export function touch(m) { m._rev = (m._rev || 0) + 1; m.modified = Date.now(); }

// ---------------------------------------------------------------- opening documents
export async function openFiles(list) {
  for (const f of list) {
    const already = S.docs.find(d => d.path && f.path && d.path.toLowerCase() === f.path.toLowerCase());
    if (already) { activate(already); continue; }
    try { await openDoc(f); } catch (e) { console.error(e); toast('Could not open ' + f.name + ': ' + (e.message || e), 'err', 6000); }
  }
}
async function openDoc(f) {
  setStatus('Opening ' + f.name + '…');
  const prep = await openForView(f.data);
  const task = pdfjsLib.getDocument({
    data: prep.viewBytes === f.data ? f.data.slice() : prep.viewBytes,
    cMapUrl: LIB + 'cmaps/', cMapPacked: true, standardFontDataUrl: LIB + 'standard_fonts/', wasmUrl: LIB + 'wasm/', iccUrl: LIB + 'iccs/',
    isEvalSupported: false, enableXfa: false
  });
  task.onPassword = async (update, reason) => {
    const pw = await prompt(reason === 2 ? 'Wrong password' : 'Password needed', f.name + ' is protected. Password:', '');
    if (pw == null) task.destroy(); else update(pw);
  };
  const pdf = await task.promise;
  const d = {
    id: MK.newId(), name: f.name, path: f.path || '', mtime: f.mtime || 0, fileBytes: f.data, pdf,
    pages: [], markups: [], scales: {}, bookmarks: [], bookmarksEdited: false,
    cam: { x: 0, y: 0, zoom: 1 }, undo: [], redo: [], dirty: false, sel: new Set(),
    saveable: prep.saveable, saveReason: prep.reason || '', mode: 'continuous', cur: 0
  };
  // page sizes (in batches so big sets open quickly)
  const n = pdf.numPages;
  for (let i = 0; i < n; i += 16) {
    const batch = [];
    for (let k = i; k < Math.min(n, i + 16); k++) batch.push(pdf.getPage(k + 1));
    for (const pg of await Promise.all(batch)) {
      const vp = pg.getViewport({ scale: 1 });
      d.pages.push({ pg, w: vp.width, h: vp.height, vt: vp.transform, base: null, detail: null, snap: null, text: null, label: '' });
    }
  }
  try { const labels = await pdf.getPageLabels(); if (labels) labels.forEach((l, i) => { if (d.pages[i]) d.pages[i].label = l; }); } catch (e) { /* no labels */ }
  if (prep.data && Array.isArray(prep.data.markups)) {
    d.markups = prep.data.markups.filter(m => m && m.type && MK.TYPES[m.type] && d.pages[m.page]);
    d.markups.forEach(m => { m._rev = 1; });
    d.scales = prep.data.scales || {};
  }
  try { d.bookmarks = await D.readOutline(d); } catch (e) { console.warn('outline', e); d.bookmarks = []; }
  layout(d);
  S.docs.push(d);
  activate(d);
  fitPage();
  if (d.path) D.addRecent(d.path);
  setStatus('');
  if (!d.saveable) toast(d.saveReason, 'err', 8000);
  D.checkRecovery(d);
}

export function activate(d) {
  if (S.doc === d) return;
  cancelDraft();
  S.doc = d;
  $('#welcome').classList.toggle('hidden', !!d);
  P.renderTabs(); P.refreshAll();
  updateStatus();
  requestRender();
}
export async function closeDoc(d = S.doc) {
  if (!d) return true;
  if (d.dirty) {
    activate(d);
    const r = await modal('Save changes?', `<p>Save your markups in <b>${esc(d.name)}</b> before closing?</p>`,
      [{ label: 'Cancel', value: 'cancel' }, { label: "Don't save", value: 'discard' }, { label: 'Save', value: 'save', primary: true }]);
    if (!r || r === 'cancel') return false;
    if (r === 'save' && !(await D.save(d))) return false;
    if (r === 'discard') D.clearRecovery(d);
  }
  const i = S.docs.indexOf(d);
  S.docs.splice(i, 1);
  try { d.pdf.destroy(); } catch (e) { /* ignore */ }
  for (const p of d.pages) { p.base = p.detail = null; }
  if (S.doc === d) { S.doc = null; activate(S.docs[Math.min(i, S.docs.length - 1)] || null); }
  if (!S.docs.length) { $('#welcome').classList.remove('hidden'); D.showRecent(); P.renderTabs(); P.refreshAll(); updateStatus(); requestRender(); }
  return true;
}

// ---------------------------------------------------------------- layout & camera
const GAP = 24;
const vp = $('#viewport'), pdfc = $('#pdfc'), inkc = $('#inkc');
let W = 1, H = 1, DPR = 1;
export function layout(d) {
  const maxW = Math.max(...d.pages.map(p => p.w));
  let y = 0;
  for (const p of d.pages) { p.left = (maxW - p.w) / 2; p.top = y; y += p.h + GAP; }
  d.maxW = maxW; d.totalH = y - GAP;
}
export function pageRect(d, i) {
  const p = d.pages[i];
  if (d.mode === 'single') return { x: 0, y: 0, w: p.w, h: p.h };
  return { x: p.left, y: p.top, w: p.w, h: p.h };
}
export function visiblePages(d) {
  if (d.mode === 'single') return [d.cur];
  const z = d.cam.zoom, top = d.cam.y / z, bot = (d.cam.y + H) / z;
  const out = [];
  // binary search the first page
  let lo = 0, hi = d.pages.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; const p = d.pages[m]; if (p.top + p.h < top) lo = m + 1; else hi = m; }
  for (let i = lo; i < d.pages.length; i++) { const p = d.pages[i]; if (p.top > bot) break; out.push(i); }
  return out;
}
export const toScreen = (d, i, x, y) => { const r = pageRect(d, i); return [(r.x + x) * d.cam.zoom - d.cam.x, (r.y + y) * d.cam.zoom - d.cam.y]; };
export function pageAt(d, sx, sy, loose = false) {
  const z = d.cam.zoom, dx = (sx + d.cam.x) / z, dy = (sy + d.cam.y) / z;
  const cand = d.mode === 'single' ? [d.cur] : visiblePages(d);
  let best = null, bd = Infinity;
  for (const i of cand) {
    const r = pageRect(d, i);
    const inside = dx >= r.x && dx <= r.x + r.w && dy >= r.y && dy <= r.y + r.h;
    if (inside) return { i, p: [dx - r.x, dy - r.y] };
    if (loose) { const dd = Math.max(r.x - dx, 0, dx - r.x - r.w) + Math.max(r.y - dy, 0, dy - r.y - r.h); if (dd < bd) { bd = dd; best = { i, p: [dx - r.x, dy - r.y] }; } }
  }
  return best;
}
const ZMIN = 0.02, ZMAX = 64;
export function zoomAt(sx, sy, z) {
  const d = S.doc; if (!d) return;
  z = Math.max(ZMIN, Math.min(ZMAX, z));
  const k = z / d.cam.zoom;
  d.cam.x = (d.cam.x + sx) * k - sx;
  d.cam.y = (d.cam.y + sy) * k - sy;
  d.cam.zoom = z;
  clampCam(); requestRender(); updateStatus();
}
function clampCam() {
  const d = S.doc; if (!d) return;
  const z = d.cam.zoom;
  const w = (d.mode === 'single' ? d.pages[d.cur].w : d.maxW) * z, h = (d.mode === 'single' ? d.pages[d.cur].h : d.totalH) * z;
  const m = 80;
  if (w <= W) d.cam.x = Math.max(-(W - w), Math.min(0, d.cam.x)); else d.cam.x = Math.min(Math.max(d.cam.x, -W + m), w - m);
  if (h <= H) d.cam.y = Math.max(Math.min(d.cam.y, 0), -(H - h)); else d.cam.y = Math.min(Math.max(d.cam.y, -H + m), h - m);
}
export function fitRect(i, x, y, w, h, pad = 0.04) {
  const d = S.doc; if (!d) return;
  const r = pageRect(d, i);
  const z = Math.max(ZMIN, Math.min(ZMAX, Math.min(W / (w * (1 + 2 * pad)), H / (h * (1 + 2 * pad)))));
  d.cam.zoom = z;
  d.cam.x = (r.x + x + w / 2) * z - W / 2;
  d.cam.y = (r.y + y + h / 2) * z - H / 2;
  requestRender(); updateStatus();
}
export function fitPage(i) {
  const d = S.doc; if (!d) return;
  if (i == null) i = currentPage();
  const p = d.pages[i];
  fitRect(i, 0, 0, p.w, p.h, 0.02);
  d.cur = i;
}
export function fitWidth() {
  const d = S.doc; if (!d) return;
  const i = currentPage(), p = d.pages[i], r = pageRect(d, i);
  const z = W / (p.w * 1.03);
  const cy = (d.cam.y + H / 2) / d.cam.zoom;
  d.cam.zoom = z; d.cam.x = (r.x + p.w / 2) * z - W / 2;
  d.cam.y = (d.mode === 'single' ? r.y * z - 10 : cy * z - H / 2);
  clampCam(); requestRender(); updateStatus();
}
export function currentPage() {
  const d = S.doc; if (!d) return 0;
  if (d.mode === 'single') return d.cur;
  const vis = visiblePages(d);
  if (!vis.length) return d.cur;
  // page covering most of the view
  let best = vis[0], ba = -1;
  const z = d.cam.zoom;
  for (const i of vis) { const r = pageRect(d, i); const a = Math.max(0, Math.min((r.y + r.h) * z - d.cam.y, H) - Math.max(r.y * z - d.cam.y, 0)); if (a > ba) { ba = a; best = i; } }
  return best;
}
export function goToPage(i, y = null, x = null) {
  const d = S.doc; if (!d) return;
  i = Math.max(0, Math.min(d.pages.length - 1, i));
  cancelDraft();
  const z = d.cam.zoom;
  if (d.mode === 'single') {
    const changed = d.cur !== i; d.cur = i;
    if (y != null) { const r = pageRect(d, i); d.cam.y = (r.y + y) * z - 20; if (x != null) d.cam.x = (r.x + x) * z - 40; }
    else if (changed) { fitPage(i); return; }
  } else {
    const r = pageRect(d, i);
    d.cam.y = (r.y + (y || 0)) * z - (y != null ? 20 : 8);
    if (x != null) d.cam.x = (r.x + x) * z - 40;
    d.cur = i;
  }
  clampCam(); requestRender(); updateStatus();
}

// ---------------------------------------------------------------- rendering
let needRender = false;
export function requestRender() { if (!needRender) { needRender = true; requestAnimationFrame(frame); } }
function frame() {
  needRender = false;
  drawPdf();
  drawInk();
}
function resize() {
  W = Math.max(1, vp.clientWidth); H = Math.max(1, vp.clientHeight); DPR = window.devicePixelRatio || 1;
  for (const c of [pdfc, inkc]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); c.style.width = W + 'px'; c.style.height = H + 'px'; }
  requestRender();
}
new ResizeObserver(resize).observe(vp);
resize();

const baseLRU = [];
const renderQueue = new Set();
let rendering = 0;
function baseScale(p) { return Math.min(2.5, 3200 / Math.max(p.w, p.h)); }
function ensureBase(d, i) {
  const p = d.pages[i];
  if (p.base || p.baseBusy) return;
  renderQueue.add(d.id + ':' + i);
  pumpQueue();
}
function pumpQueue() {
  while (rendering < 2 && renderQueue.size) {
    const key = renderQueue.values().next().value;
    renderQueue.delete(key);
    const [id, si] = key.split(':');
    const d = S.docs.find(x => x.id === id);
    if (!d) continue;
    const i = Number(si), p = d.pages[i];
    if (!p || p.base || p.baseBusy) continue;
    // skip pages no longer on screen
    if (d !== S.doc || !visiblePages(d).includes(i)) continue;
    p.baseBusy = true; rendering++;
    const s = baseScale(p);
    const c = document.createElement('canvas');
    c.width = Math.ceil(p.w * s); c.height = Math.ceil(p.h * s);
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    p.pg.render({ canvasContext: ctx, viewport: p.pg.getViewport({ scale: s }), background: '#ffffff' }).promise
      .then(() => {
        p.base = { canvas: c, scale: s };
        baseLRU.push(p);
        while (baseLRU.length > 10) { const old = baseLRU.shift(); if (old !== p && !isVisible(old)) { old.base = null; } else baseLRU.push(old); if (baseLRU.length > 30) break; }
      })
      .catch(e => { if (e && e.name !== 'RenderingCancelledException') console.warn('render', e); })
      .finally(() => { p.baseBusy = false; rendering--; requestRender(); pumpQueue(); });
  }
}
function isVisible(p) { const d = S.doc; if (!d) return false; const i = d.pages.indexOf(p); return i >= 0 && visiblePages(d).includes(i); }

let detailTimer = null;
function scheduleDetail() {
  clearTimeout(detailTimer);
  detailTimer = setTimeout(renderDetails, 140);
}
function renderDetails() {
  const d = S.doc; if (!d) return;
  const z = d.cam.zoom, scale = z * DPR;
  for (const i of visiblePages(d)) {
    const p = d.pages[i];
    if (!p.base || scale <= p.base.scale * 1.05) { if (p.detail) p.detail = null; continue; }
    const r = pageRect(d, i);
    const x0 = Math.max(0, d.cam.x / z - r.x), y0 = Math.max(0, d.cam.y / z - r.y);
    const x1 = Math.min(p.w, (d.cam.x + W) / z - r.x), y1 = Math.min(p.h, (d.cam.y + H) / z - r.y);
    if (x1 <= x0 || y1 <= y0) continue;
    const det = p.detail;
    if (det && Math.abs(det.zoom - z) < 1e-6 && det.x <= x0 + 0.5 && det.y <= y0 + 0.5 && det.x + det.w >= x1 - 0.5 && det.y + det.h >= y1 - 0.5) continue;
    if (p.detailTask) { try { p.detailTask.cancel(); } catch (e) { /* ignore */ } }
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((x1 - x0) * scale)); c.height = Math.max(1, Math.ceil((y1 - y0) * scale));
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const task = p.pg.render({ canvasContext: ctx, viewport: p.pg.getViewport({ scale }), transform: [1, 0, 0, 1, -x0 * scale, -y0 * scale], background: '#ffffff' });
    p.detailTask = task;
    task.promise.then(() => { if (p.detailTask === task) { p.detail = { canvas: c, zoom: z, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; p.detailTask = null; requestRender(); } })
      .catch(e => { if (e && e.name !== 'RenderingCancelledException') console.warn('detail', e); });
  }
}

function drawPdf() {
  const ctx = pdfc.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pdfc.width, pdfc.height);
  const d = S.doc; if (!d) return;
  const z = d.cam.zoom;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  for (const i of visiblePages(d)) {
    const p = d.pages[i], r = pageRect(d, i);
    const sx = r.x * z - d.cam.x, sy = r.y * z - d.cam.y, sw = p.w * z, sh = p.h * z;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#fff'; ctx.fillRect(sx, sy, sw, sh);
    ctx.restore();
    if (p.base) ctx.drawImage(p.base.canvas, sx, sy, sw, sh); else ensureBase(d, i);
    if (p.detail) { const t = p.detail; ctx.drawImage(t.canvas, sx + t.x * z, sy + t.y * z, t.w * z, t.h * z); }
  }
  scheduleDetail();
}

export function drawPrim(ctx, p, z) {
  if (p.k === 'path') {
    G.cmdsToCanvas(ctx, p.cmds);
    const op = p.opacity == null ? 1 : p.opacity;
    ctx.globalCompositeOperation = p.blend === 'multiply' ? 'multiply' : 'source-over';
    if (p.fill) { ctx.globalAlpha = op * (p.fillOpacity == null ? 1 : p.fillOpacity); ctx.fillStyle = p.fill; ctx.fill(); }
    if (p.stroke && p.width > 0) {
      ctx.globalAlpha = op; ctx.strokeStyle = p.stroke;
      ctx.lineWidth = Math.max(p.width, 1 / (z * DPR));
      ctx.setLineDash(p.dash || []);
      ctx.lineCap = p.cap || 'butt'; ctx.lineJoin = p.join || 'miter';
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  } else if (p.k === 'text') {
    ctx.globalAlpha = p.opacity == null ? 1 : p.opacity;
    ctx.fillStyle = p.color || '#000';
    ctx.font = (p.bold ? 'bold ' : '') + p.size + 'px Arial, Helvetica, sans-serif';
    ctx.textAlign = p.align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

function drawInk() {
  const ctx = inkc.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, inkc.width, inkc.height);
  const d = S.doc; if (!d) return;
  const z = d.cam.zoom;
  const vis = visiblePages(d);
  const editing = S.editing && S.editing.m;
  for (const i of vis) {
    const r = pageRect(d, i);
    ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (r.x * z - d.cam.x), DPR * (r.y * z - d.cam.y));
    for (const m of d.markups) {
      if (m.page !== i || m.hidden) continue;
      if (editing === m && (m.type === 'text' || m.type === 'callout')) {
        // text is shown in the editor while typing
        for (const p of prims(m)) if (p.k !== 'text') drawPrim(ctx, p, z);
        continue;
      }
      for (const p of prims(m)) drawPrim(ctx, p, z);
    }
    if (S.draft && S.draft.page === i && S.draft.pts && S.draft.pts.length) for (const p of MK.primitives(draftWithHover(), scaleAt, measureText)) drawPrim(ctx, p, z);
    P.drawOverlays(ctx, d, i, z);
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // selection
  const sel = d.markups.filter(m => d.sel.has(m.id) && vis.includes(m.page));
  for (const m of sel) {
    const b = MK.bounds(m, scaleAt, measureText);
    const [x1, y1] = toScreen(d, m.page, b.x1, b.y1), [x2, y2] = toScreen(d, m.page, b.x2, b.y2);
    ctx.strokeStyle = '#3E8BFF'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.round(x1) - 3.5, Math.round(y1) - 3.5, Math.round(x2 - x1) + 7, Math.round(y2 - y1) + 7);
    ctx.setLineDash([]);
    if (sel.length === 1 && !m.locked) {
      for (const h of MK.handles(m)) {
        const [hx, hy] = toScreen(d, m.page, h.x, h.y);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2C6FD6'; ctx.lineWidth = 1.5;
        ctx.fillRect(hx - 4, hy - 4, 8, 8); ctx.strokeRect(hx - 4, hy - 4, 8, 8);
      }
    }
  }
  // rubber band
  if (ptr && (ptr.mode === 'band' || ptr.mode === 'zoomrect') && ptr.cur) {
    const [ax, ay] = ptr.start, [bx, by] = ptr.cur;
    ctx.fillStyle = 'rgba(62,139,255,.12)'; ctx.strokeStyle = '#3E8BFF'; ctx.lineWidth = 1; ctx.setLineDash(ptr.mode === 'zoomrect' ? [5, 3] : []);
    ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    ctx.strokeRect(Math.min(ax, bx) + 0.5, Math.min(ay, by) + 0.5, Math.abs(bx - ax), Math.abs(by - ay));
    ctx.setLineDash([]);
  }
  // snap marker
  if (S.snapHit && S.hover && S.hover.page === S.snapHit.page) {
    const [sx, sy] = toScreen(d, S.snapHit.page, S.snapHit.p[0], S.snapHit.p[1]);
    drawSnapGlyph(ctx, sx, sy, S.snapHit.kind);
  }
  // crosshair-ish cursor hint for drawing tools
  if (S.hover && TOOLS[S.tool].mode && !ptr?.pan) {
    const [sx, sy] = toScreen(d, S.hover.page, S.hover.sp[0], S.hover.sp[1]);
    ctx.strokeStyle = 'rgba(20,20,20,.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx - 9, sy + 0.5); ctx.lineTo(sx - 3, sy + 0.5); ctx.moveTo(sx + 3, sy + 0.5); ctx.lineTo(sx + 9, sy + 0.5);
    ctx.moveTo(sx + 0.5, sy - 9); ctx.lineTo(sx + 0.5, sy - 3); ctx.moveTo(sx + 0.5, sy + 3); ctx.lineTo(sx + 0.5, sy + 9); ctx.stroke();
  }
}
function drawSnapGlyph(ctx, x, y, kind) {
  ctx.save();
  ctx.lineWidth = 2; ctx.strokeStyle = '#00C2A8'; ctx.fillStyle = 'rgba(0,194,168,.15)';
  ctx.beginPath();
  if (kind === 'end') ctx.rect(x - 6, y - 6, 12, 12);
  else if (kind === 'mid') { ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y + 5); ctx.lineTo(x - 7, y + 5); ctx.closePath(); }
  else if (kind === 'int') { ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); }
  else if (kind === 'center') ctx.arc(x, y, 6, 0, Math.PI * 2);
  else { ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.lineTo(x + 6, y + 6); ctx.closePath(); }
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- snapping
function ensureSnap(d, i) {
  const p = d.pages[i];
  if (p.snap || p.snapBusy) return p.snap;
  p.snapBusy = true;
  buildSnapIndex(p.pg, p.vt, pdfjsLib).then(ix => { p.snap = ix; p.snapBusy = false; }).catch(e => { console.warn('snap', e); p.snapBusy = false; p.snap = { ready: false }; });
  return null;
}
function snapPoint(d, i, p, ignore) {
  if (!S.snap) return null;
  const r = S.settings.snapRadius / d.cam.zoom;
  const idx = ensureSnap(d, i);
  const extraPts = [], extraSegs = [];
  for (const m of d.markups) {
    if (m.page !== i || m === ignore || m.hidden) continue;
    const b = m.pts.length ? G.bbox(m.pts) : null;
    if (b && (p[0] < b.x1 - r * 2 || p[0] > b.x2 + r * 2 || p[1] < b.y1 - r * 2 || p[1] > b.y2 + r * 2)) continue;
    extraPts.push(...MK.snapPoints(m)); extraSegs.push(...MK.snapSegs(m));
  }
  if (S.draft && S.draft.page === i) S.draft.pts.slice(0, -0 || undefined).forEach(q => extraPts.push({ p: q, kind: 'end' }));
  const hit = findSnap(idx && idx.ready ? idx : null, p, r, extraPts, extraSegs);
  return hit ? { p: hit.p, kind: hit.kind, page: i } : null;
}

// ---------------------------------------------------------------- undo / changes
const strip = (k, v) => (k && k[0] === '_') ? undefined : v;
export function snapshot(d) { return JSON.stringify({ m: d.markups, s: d.scales }, strip); }
function restore(d, snap) {
  const o = JSON.parse(snap);
  d.markups = o.m; d.scales = o.s || {};
  d.markups.forEach(m => { m._rev = 1; });
  S.scaleRev++;
  for (const id of [...d.sel]) if (!d.markups.find(m => m.id === id)) d.sel.delete(id);
}
export function pushUndo(d, before) {
  d.undo.push(before);
  if (d.undo.length > 150) d.undo.shift();
  d.redo = [];
  markDirty(d);
}
export function change(fn, d = S.doc) {
  if (!d) return;
  const before = snapshot(d);
  fn(d);
  if (snapshot(d) !== before) pushUndo(d, before);
  changed();
}
export function markDirty(d) {
  if (!d.dirty) { d.dirty = true; P.renderTabs(); }
  D.queueRecovery(d);
}
let listTimer = null;
export function changed() {
  requestRender();
  clearTimeout(listTimer);
  listTimer = setTimeout(() => { P.refreshList(); P.refreshProps(); P.refreshThumbMarks(); }, 60);
}
function undo() {
  const d = S.doc; if (!d || !d.undo.length) return;
  cancelDraft();
  d.redo.push(snapshot(d)); restore(d, d.undo.pop()); markDirty(d); changed();
}
function redo() {
  const d = S.doc; if (!d || !d.redo.length) return;
  d.undo.push(snapshot(d)); restore(d, d.redo.pop()); markDirty(d); changed();
}

export function newMarkup(type, page, pts, extra = {}) {
  const m = {
    id: MK.newId(), type, page, pts, style: styleFor(type),
    subject: MK.TYPES[type].name, comment: '', text: '', status: '', flag: '',
    author: S.settings.author || '', created: Date.now(), modified: Date.now(), _rev: 1, ...extra
  };
  if (S.myTool && S.myTool.type === type) {
    m.style = JSON.parse(JSON.stringify(S.myTool.style));
    if (S.myTool.subject) m.subject = S.myTool.subject;
    if (type === 'stamp') { m.text = S.myTool.text || m.text; m.stampSub = S.myTool.stampSub || ''; }
    if (S.myTool.depth) m.depth = S.myTool.depth;
  }
  return m;
}
function addMarkup(m) {
  change(d => { d.markups.push(m); d.sel = new Set([m.id]); });
  if (S.settings.returnToSelect && S.tool !== 'count') setTool('select');
}

// ---------------------------------------------------------------- tools
export function setTool(id, myTool = null) {
  if (!TOOLS[id]) return;
  if (S.editing) commitText();
  cancelDraft();
  S.tool = id; S.myTool = myTool;
  if (id !== 'select' && S.doc) { /* keep selection visible */ }
  $$('#toolbar .tbtn').forEach(b => b.classList.toggle('on', b.dataset.tool === id && !myTool));
  inkc.style.cursor = id === 'pan' ? 'grab' : id === 'select' ? 'default' : 'crosshair';
  P.refreshProps(); P.refreshMyTools();
  const t = TOOLS[id];
  setStatus(t.mode ? hintFor(id) : '');
  requestRender();
}
function hintFor(id) {
  const t = TOOLS[id];
  if (t.special === 'calibrate') return 'Calibrate: click two points a known distance apart.';
  switch (t.mode) {
    case 'two': return t.label + ': click start and end (or drag). Shift = 45° steps. Esc to stop.';
    case 'multi': return t.label + ': click points. Double-click, Enter or right-click to finish. Backspace removes the last point.' + (t.closed ? ' Click the first point to close.' : '');
    case 'box': return t.label + ': drag to draw. Shift = square.';
    case 'free': return t.label + ': hold and draw.';
    case 'count': return 'Count: click each item. Enter or Esc to finish this count.';
    case 'callout': return 'Callout: click the point to mark, then click where the text goes.';
    case 'click': return 'Note: click where the note goes.';
  }
  return '';
}
export function cancelDraft() {
  if (S.draft && S.draft._countLive) { S.draft = null; }
  S.draft = null; S.snapHit = null;
  if (ptr && ptr.mode === 'tool') ptr = null;
  requestRender();
}
function draftWithHover() {
  const d = S.draft;
  if (!d) return null;
  const t = TOOLS[S.tool];
  if (!S.hover || S.hover.page !== d.page || d._fixed) return d;
  const h = S.hover.sp;
  const m = Object.assign({}, d);
  if (t.mode === 'multi' || t.mode === 'two') m.pts = [...d.pts, h];
  else if (t.mode === 'callout') m.pts = d.pts.length === 1 ? [d.pts[0], h, [h[0] + 120, h[1] + 36]] : d.pts;
  return m;
}
function finishDraft() {
  const d = S.doc, dr = S.draft, t = TOOLS[S.tool];
  if (!d || !dr) return;
  S.draft = null;
  if (t.mode === 'count') { requestRender(); return; }
  let pts = dr.pts;
  // remove a duplicate last point (from double-click)
  if (pts.length > 1 && G.dist(pts[pts.length - 1], pts[pts.length - 2]) < 0.5 / d.cam.zoom) pts = pts.slice(0, -1);
  if (pts.length < (t.min || 2)) { requestRender(); return; }
  if (t.max) pts = pts.slice(0, t.max);
  addMarkup(Object.assign(dr, { pts, _rev: 1 }));
}

export function stampInfo() {
  const st = MK.STAMPS[S.settings.stamp] || MK.STAMPS[0];
  const text = S.settings.stampText || st.text;
  let sub = S.settings.stampSub || '';
  if (S.settings.stampNameDate) sub = (S.settings.author ? S.settings.author + '  ' : '') + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return { text, stampSub: sub };
}
// box tool result → final points
function boxPts(t, a, b) {
  if (t.type === 'triangle') { const r = G.rectPts(a, b); return [[(r[0][0] + r[1][0]) / 2, r[0][1]], r[2], r[3]]; }
  if (t.toPoly) return G.rectPts(a, b);
  return [a, b];
}

let ptr = null;          // active pointer gesture
let space = false;       // space held = pan
let lastMid = 0, lastMidPos = [0, 0];
let lastClick = { t: 0, x: 0, y: 0 };

function evPoint(e) { const r = inkc.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

// compute hover point (snapped / constrained) for drawing tools
function toolPoint(e, sx, sy) {
  const d = S.doc;
  const fixedPage = S.draft ? S.draft.page : (ptr && ptr.page != null ? ptr.page : null);
  let hit;
  if (fixedPage != null) { const r = pageRect(d, fixedPage); hit = { i: fixedPage, p: [(sx + d.cam.x) / d.cam.zoom - r.x, (sy + d.cam.y) / d.cam.zoom - r.y] }; }
  else hit = pageAt(d, sx, sy);
  if (!hit) return null;
  const t = TOOLS[S.tool];
  let p = hit.p, snap = null;
  if (t.mode !== 'free') snap = snapPoint(d, hit.i, p, ptr && ptr.m);
  if (snap) p = snap.p;
  // straight lines: Shift = 45° steps, Ortho = 90°
  const prev = S.draft && S.draft.pts.length ? S.draft.pts[S.draft.pts.length - 1] : (ptr && ptr.anchor) || null;
  if (prev && (e.shiftKey || S.ortho) && t.mode !== 'box' && t.mode !== 'free') {
    p = G.constrainAngle(prev, p, S.ortho ? 90 : 45);
    if (snap) snap = { ...snap, p };
  }
  S.snapHit = snap;
  return { page: hit.i, p: hit.p, sp: p };
}

function hitMarkup(d, page, p) {
  const tol = 5 / d.cam.zoom;
  for (let k = d.markups.length - 1; k >= 0; k--) {
    const m = d.markups[k];
    if (m.page !== page || m.hidden) continue;
    if (MK.hitTest(m, p, tol, scaleAt, measureText)) return m;
  }
  return null;
}
function hitHandle(d, sx, sy) {
  const sel = d.markups.filter(m => d.sel.has(m.id));
  if (sel.length !== 1 || sel[0].locked) return null;
  const m = sel[0];
  for (const h of MK.handles(m)) {
    const [hx, hy] = toScreen(d, m.page, h.x, h.y);
    if (Math.abs(hx - sx) <= 6 && Math.abs(hy - sy) <= 6) return { m, h: h.i };
  }
  return null;
}

inkc.addEventListener('pointerdown', e => {
  const d = S.doc; if (!d) return;
  if (S.editing) commitText();
  closeMenus();
  vp.focus({ preventScroll: true });
  const [sx, sy] = evPoint(e);
  // middle button: pan, double-click = fit page
  if (e.button === 1) {
    e.preventDefault();
    const now = performance.now();
    if (now - lastMid < 400 && Math.hypot(sx - lastMidPos[0], sy - lastMidPos[1]) < 8) { lastMid = 0; fitPage(); return; }
    lastMid = now; lastMidPos = [sx, sy];
    ptr = { mode: 'pan', pan: true, last: [sx, sy] }; inkc.setPointerCapture(e.pointerId); inkc.style.cursor = 'grabbing';
    return;
  }
  if (e.button === 2) return; // context menu handles it
  if (e.button !== 0) return;
  if (space || S.tool === 'pan') { ptr = { mode: 'pan', pan: true, last: [sx, sy] }; inkc.setPointerCapture(e.pointerId); inkc.style.cursor = 'grabbing'; return; }
  inkc.setPointerCapture(e.pointerId);
  const now = performance.now();
  const dbl = now - lastClick.t < 380 && Math.hypot(sx - lastClick.x, sy - lastClick.y) < 6;
  lastClick = { t: dbl ? 0 : now, x: sx, y: sy };

  if (S.tool === 'zoomrect') { ptr = { mode: 'zoomrect', start: [sx, sy], cur: [sx, sy] }; return; }
  if (S.tool === 'select') {
    const hh = hitHandle(d, sx, sy);
    if (hh) { ptr = { mode: 'handle', m: hh.m, h: hh.h, before: snapshot(d), page: hh.m.page }; return; }
    const hit = pageAt(d, sx, sy);
    const m = hit && hitMarkup(d, hit.i, hit.p);
    if (m) {
      if (dbl && (MK.TYPES[m.type].text || m.type === 'stamp')) { editText(m); ptr = null; return; }
      if (e.shiftKey || e.ctrlKey) { if (d.sel.has(m.id)) d.sel.delete(m.id); else d.sel.add(m.id); }
      else if (!d.sel.has(m.id)) d.sel = new Set([m.id]);
      d.cur = m.page;
      changed();
      const moving = d.markups.filter(x => d.sel.has(x.id) && !x.locked);
      ptr = { mode: 'move', start: hit.p, page: hit.i, orig: moving.map(x => [x, x.pts.map(p => p.slice())]), before: snapshot(d), moved: false, dup: e.altKey };
      return;
    }
    if (!e.shiftKey && !e.ctrlKey && d.sel.size) { d.sel.clear(); changed(); }
    ptr = { mode: 'band', start: [sx, sy], cur: [sx, sy], add: e.shiftKey || e.ctrlKey };
    return;
  }
  // drawing tools
  const t = TOOLS[S.tool];
  const tp = toolPoint(e, sx, sy);
  if (!tp) return;
  S.hover = tp;
  const p = tp.sp;
  switch (t.mode) {
    case 'free':
      S.draft = newMarkup(t.type, tp.page, [p]);
      ptr = { mode: 'tool', page: tp.page };
      break;
    case 'box':
      S.draft = newMarkup(t.type, tp.page, [p, p]); S.draft._fixed = true;
      if (t.type === 'stamp' && !S.myTool) { Object.assign(S.draft, stampInfo()); const st = MK.STAMPS.find(x => x.text === S.draft.text); if (st) S.draft.style.stroke = S.draft.style.textColor = st.color; }
      ptr = { mode: 'tool', page: tp.page, start: p, anchor: p };
      break;
    case 'two':
      if (S.draft) { S.draft.pts.push(p); completeTwo(); }
      else { S.draft = newMarkup(t.type, tp.page, [p]); ptr = { mode: 'tool', page: tp.page, start: p, startS: [sx, sy], anchor: p }; }
      break;
    case 'multi': {
      if (!S.draft) S.draft = newMarkup(t.type, tp.page, []);
      const dr = S.draft;
      if (dbl && dr.pts.length) { finishDraft(); break; }
      if (t.closed && dr.pts.length >= (t.min || 3) - 0 && dr.pts.length >= 2) {
        const [fx, fy] = toScreen(d, dr.page, dr.pts[0][0], dr.pts[0][1]);
        if (Math.hypot(fx - sx, fy - sy) < 8) { finishDraft(); break; }
      }
      dr.pts.push(p);
      if (t.max && dr.pts.length >= t.max) finishDraft();
      break;
    }
    case 'count': {
      let live = S.draft && S.draft._countOf && d.markups.find(m => m.id === S.draft._countOf);
      if (live && live.page !== tp.page) live = null;
      if (!live) {
        const m = newMarkup('count', tp.page, [p]);
        change(dd => { dd.markups.push(m); dd.sel = new Set([m.id]); });
        S.draft = { _countOf: m.id, page: tp.page, pts: [], type: 'count', style: m.style, _fixed: true };
      } else change(() => { live.pts.push(p); touch(live); });
      break;
    }
    case 'callout':
      if (!S.draft) { S.draft = newMarkup('callout', tp.page, [p]); }
      else {
        const tip = S.draft.pts[0];
        S.draft.pts = [tip, p, [p[0] + 140, p[1] + 40]];
        S.draft._fixed = true;
        ptr = { mode: 'tool', page: tp.page, start: p, callout: true };
      }
      break;
    case 'click': {
      const m = newMarkup(t.type, tp.page, [p]);
      addMarkup(m);
      setTimeout(() => editText(m, true), 30);
      break;
    }
  }
  requestRender();
});

function completeTwo() {
  const t = TOOLS[S.tool], dr = S.draft;
  if (!dr || dr.pts.length < 2) return;
  if (G.dist(dr.pts[0], dr.pts[1]) < 0.5 / S.doc.cam.zoom) { dr.pts = [dr.pts[0]]; return; }
  if (t.special === 'calibrate') {
    const pts = dr.pts.slice(0, 2), page = dr.page;
    S.draft = null; ptr = null; requestRender();
    D.calibrateDialog(page, G.dist(pts[0], pts[1]));
    return;
  }
  finishDraft();
}

window.addEventListener('pointermove', e => {
  const d = S.doc; if (!d) return;
  const [sx, sy] = evPoint(e);
  if (ptr && ptr.pan) {
    d.cam.x -= sx - ptr.last[0]; d.cam.y -= sy - ptr.last[1]; ptr.last = [sx, sy];
    clampCam(); requestRender(); updateStatus(); return;
  }
  if (e.target !== inkc && !ptr) return;
  if (ptr && (ptr.mode === 'band' || ptr.mode === 'zoomrect')) { ptr.cur = [sx, sy]; requestRender(); return; }
  if (ptr && ptr.mode === 'move') {
    const r = pageRect(d, ptr.page);
    const p = [(sx + d.cam.x) / d.cam.zoom - r.x, (sy + d.cam.y) / d.cam.zoom - r.y];
    let dx = p[0] - ptr.start[0], dy = p[1] - ptr.start[1];
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (!ptr.moved && Math.hypot(dx, dy) * d.cam.zoom < 3) return;
    if (!ptr.moved && ptr.dup) {
      // Alt+drag copies
      const copies = ptr.orig.map(([m, pts]) => { const c = JSON.parse(JSON.stringify(m, strip)); c.id = MK.newId(); c.created = c.modified = Date.now(); c._rev = 1; c.pts = pts.map(q => q.slice()); return [c, pts]; });
      copies.forEach(([c]) => d.markups.push(c));
      ptr.orig = copies; d.sel = new Set(copies.map(([c]) => c.id));
    }
    ptr.moved = true;
    for (const [m, pts] of ptr.orig) { m.pts = pts.map(q => [q[0] + dx, q[1] + dy]); touch(m); }
    requestRender(); return;
  }
  if (ptr && ptr.mode === 'handle') {
    const tp = toolPoint(e, sx, sy);
    if (!tp) return;
    S.hover = tp;
    MK.moveHandle(ptr.m, ptr.h, tp.sp); touch(ptr.m); ptr.moved = true;
    requestRender(); return;
  }
  // hover
  const t = TOOLS[S.tool];
  if (t.mode) {
    const tp = toolPoint(e, sx, sy);
    S.hover = tp;
    if (ptr && ptr.mode === 'tool' && S.draft && tp) {
      if (t.mode === 'free') {
        const last = S.draft.pts[S.draft.pts.length - 1];
        if (G.dist(last, tp.p) * d.cam.zoom > 1.5) S.draft.pts.push(tp.p);
      } else if (t.mode === 'box' || ptr.callout) {
        let b = tp.sp;
        if (e.shiftKey) { const a = ptr.start, s = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); b = [a[0] + Math.sign(b[0] - a[0] || 1) * s, a[1] + Math.sign(b[1] - a[1] || 1) * s]; }
        if (ptr.callout) { if (G.dist(ptr.start, b) * d.cam.zoom > 4) S.draft.pts[2] = b; }
        else S.draft.pts = [ptr.start, b];
      }
    }
    updateCursorInfo(tp);
  } else {
    S.snapHit = null;
    // hover cursor over handles / markups
    if (S.tool === 'select' && !ptr) {
      const hh = hitHandle(d, sx, sy);
      const hit = !hh && pageAt(d, sx, sy);
      const m = hit && hitMarkup(d, hit.i, hit.p);
      inkc.style.cursor = hh ? 'crosshair' : m ? 'move' : 'default';
      updateCursorInfo(hit ? { page: hit.i, sp: hit.p } : null);
    }
  }
  requestRender();
});

window.addEventListener('pointerup', e => {
  const d = S.doc;
  if (!ptr || !d) return;
  const [sx, sy] = evPoint(e);
  const g = ptr;
  ptr = null;
  try { inkc.releasePointerCapture(e.pointerId); } catch (er) { /* ignore */ }
  if (g.pan) { inkc.style.cursor = S.tool === 'pan' ? 'grab' : S.tool === 'select' ? 'default' : 'crosshair'; return; }
  if (g.mode === 'band') {
    const [ax, ay] = g.start;
    if (Math.hypot(sx - ax, sy - ay) > 4) {
      const x1 = Math.min(ax, sx), x2 = Math.max(ax, sx), y1 = Math.min(ay, sy), y2 = Math.max(ay, sy);
      const crossing = sx < ax; // right-to-left selects anything touching (like CAD)
      if (!g.add) d.sel.clear();
      for (const m of d.markups) {
        if (m.hidden || !visiblePages(d).includes(m.page)) continue;
        const b = MK.bounds(m, scaleAt, measureText);
        const [bx1, by1] = toScreen(d, m.page, b.x1, b.y1), [bx2, by2] = toScreen(d, m.page, b.x2, b.y2);
        const inside = bx1 >= x1 && bx2 <= x2 && by1 >= y1 && by2 <= y2;
        const touchR = bx2 >= x1 && bx1 <= x2 && by2 >= y1 && by1 <= y2;
        if (inside || (crossing && touchR)) d.sel.add(m.id);
      }
      changed();
    }
    requestRender(); return;
  }
  if (g.mode === 'zoomrect') {
    const [ax, ay] = g.start;
    if (Math.hypot(sx - ax, sy - ay) > 6) {
      const z = d.cam.zoom;
      const cx = (ax + sx) / 2, cy = (ay + sy) / 2, w = Math.abs(sx - ax), h = Math.abs(sy - ay);
      const nz = Math.min(ZMAX, z * Math.min(W / w, H / h));
      const dcx = (cx + d.cam.x) / z, dcy = (cy + d.cam.y) / z;
      d.cam.zoom = nz; d.cam.x = dcx * nz - W / 2; d.cam.y = dcy * nz - H / 2;
    } else zoomAt(sx, sy, d.cam.zoom * 2);
    clampCam(); requestRender(); updateStatus(); return;
  }
  if (g.mode === 'move') { if (g.moved) { pushUndo(d, g.before); changed(); } return; }
  if (g.mode === 'handle') { if (g.moved) { pushUndo(d, g.before); changed(); } S.snapHit = null; return; }
  if (g.mode === 'tool' && S.draft) {
    const t = TOOLS[S.tool];
    if (t.mode === 'free') { if (S.draft.pts.length > 1) addMarkup(S.draft); S.draft = null; }
    else if (t.mode === 'box') {
      const dr = S.draft; dr._fixed = false;
      const [a, b] = dr.pts;
      if (G.dist(a, b) * d.cam.zoom < 4) {
        if (t.defSize || t.type === 'stamp') { const [w, h] = t.defSize; dr.pts = [a, [a[0] + w, a[1] + h]]; }
        else { S.draft = null; requestRender(); return; }
      }
      dr.pts = boxPts(t, dr.pts[0], dr.pts[1]);
      S.draft = null;
      if (t.type === 'viewport') { addMarkup(dr); D.scaleDialog(dr.page, dr); return; }
      addMarkup(dr);
      if (t.type === 'text') setTimeout(() => editText(dr, true), 20);
    } else if (t.mode === 'two') {
      if (g.startS && Math.hypot(sx - g.startS[0], sy - g.startS[1]) > 6) {
        const tp = toolPoint(e, sx, sy);
        if (tp) { S.draft.pts = [S.draft.pts[0], tp.sp]; completeTwo(); }
      }
    } else if (g.callout) {
      const dr = S.draft; S.draft = null;
      const b = G.bbox([dr.pts[1], dr.pts[2]]);
      if ((b.x2 - b.x1) * d.cam.zoom < 6 || (b.y2 - b.y1) * d.cam.zoom < 6) dr.pts[2] = [dr.pts[1][0] + 140, dr.pts[1][1] + 40];
      addMarkup(dr);
      setTimeout(() => editText(dr, true), 20);
    }
  }
  requestRender();
});

inkc.addEventListener('contextmenu', e => {
  e.preventDefault();
  const d = S.doc; if (!d) return;
  if (S.draft && TOOLS[S.tool].mode === 'multi') { finishDraft(); return; }
  if (S.draft && TOOLS[S.tool].mode === 'count') { cancelDraft(); return; }
  const [sx, sy] = evPoint(e);
  const hit = pageAt(d, sx, sy);
  const m = hit && hitMarkup(d, hit.i, hit.p);
  if (m) {
    if (!d.sel.has(m.id)) { d.sel = new Set([m.id]); changed(); }
    showMenu(D.markupMenu(), e.clientX, e.clientY);
  } else {
    showMenu(D.pageMenu(hit), e.clientX, e.clientY);
  }
});
inkc.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
inkc.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); }); // stop Windows auto-scroll

vp.addEventListener('wheel', e => {
  e.preventDefault();
  const d = S.doc; if (!d) return;
  const [sx, sy] = evPoint(e);
  let dy = e.deltaY, dx = e.deltaX;
  if (e.deltaMode === 1) { dy *= 33; dx *= 33; } else if (e.deltaMode === 2) { dy *= H; dx *= W; }
  const zoomMode = S.settings.wheel === 'zoom' ? !e.ctrlKey && !e.shiftKey : e.ctrlKey;
  if (zoomMode) zoomAt(sx, sy, d.cam.zoom * Math.pow(1.0018, -dy));
  else if (e.shiftKey) { d.cam.x += dy || dx; clampCam(); requestRender(); }
  else {
    d.cam.y += dy; d.cam.x += dx;
    // single page mode: scrolling past the edge turns the page
    if (d.mode === 'single') {
      const p = d.pages[d.cur], h = p.h * d.cam.zoom;
      if (dy > 0 && d.cam.y > h - H + 60 && d.cur < d.pages.length - 1 && h - H + 60 > -1e9) { goToPage(d.cur + 1); return; }
      if (dy < 0 && d.cam.y < -60 && d.cur > 0) { goToPage(d.cur - 1); const q = d.pages[d.cur]; d.cam.y = q.h * d.cam.zoom - H + 20; }
    }
    clampCam(); requestRender();
  }
  updateStatus();
}, { passive: false });

// ---------------------------------------------------------------- text editing
const te = $('#textEditor');
export function editText(m, isNew = false) {
  const d = S.doc; if (!d) return;
  if (m.type === 'stamp') { D.stampTextDialog(m); return; }
  if (!MK.TYPES[m.type].text) return;
  d.sel = new Set([m.id]);
  S.editing = { m, before: snapshot(d), orig: m.text || '', isNew };
  const z = d.cam.zoom;
  const vr = vp.getBoundingClientRect();
  te.value = m.text || '';
  if (m.type === 'note') {
    const [x, y] = toScreen(d, m.page, m.pts[0][0] + 18, m.pts[0][1]);
    Object.assign(te.style, { left: vr.left + x + 'px', top: vr.top + y + 'px', width: '240px', height: '120px', fontSize: '13px', color: '#111', background: '#FFF8C9', padding: '6px' });
  } else {
    const box = m.type === 'callout' ? G.bbox([m.pts[1], m.pts[2]]) : G.bbox(m.pts);
    const [x1, y1] = toScreen(d, m.page, box.x1, box.y1), [x2, y2] = toScreen(d, m.page, box.x2, box.y2);
    const pad = Math.max(2, (m.style.fontSize || 12) * 0.3) * z;
    Object.assign(te.style, {
      left: vr.left + x1 + 'px', top: vr.top + y1 + 'px', width: Math.max(40, x2 - x1) + 'px', height: Math.max(20, y2 - y1) + 'px',
      fontSize: (m.style.fontSize || 12) * z + 'px', color: m.style.textColor || '#000', background: 'rgba(255,255,255,.92)', padding: pad + 'px'
    });
  }
  te.style.display = 'block';
  te.focus();
  te.select();
  requestRender();
}
te.addEventListener('input', () => { if (S.editing) { S.editing.m.text = te.value; touch(S.editing.m); requestRender(); } });
te.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') { if (S.editing) { S.editing.m.text = S.editing.orig; touch(S.editing.m); } commitText(); }
  else if (e.key === 'Enter' && (e.ctrlKey || S.editing && S.editing.m.type === 'note' && !e.shiftKey && false)) { e.preventDefault(); commitText(); }
});
te.addEventListener('blur', () => commitText());
export function commitText() {
  const ed = S.editing; if (!ed) return;
  S.editing = null;
  te.style.display = 'none';
  const d = S.doc;
  if (d && ed.isNew && !(ed.m.text || '').trim()) {
    // an empty new text box is not kept
    d.markups = d.markups.filter(x => x !== ed.m); d.sel.delete(ed.m.id);
    if (d.undo.length) d.undo.pop();
    changed(); vp.focus({ preventScroll: true }); return;
  }
  if (d && ed.m.text !== ed.orig) {
    // grow the text box so all lines fit
    if (ed.m.type === 'text' || ed.m.type === 'callout') {
      const s = ed.m.style, size = s.fontSize || 12;
      const i0 = ed.m.type === 'callout' ? 1 : 0;
      const b = G.bbox([ed.m.pts[i0], ed.m.pts[i0 + 1]]);
      const lines = MK.wrapText(ed.m.text, Math.max(4, b.x2 - b.x1 - size * 0.6), size, measureText);
      const need = lines.length * size * 1.2 + size * 0.8;
      if (need > b.y2 - b.y1) { ed.m.pts[i0] = [b.x1, b.y1]; ed.m.pts[i0 + 1] = [b.x2, b.y1 + need]; }
    }
    touch(ed.m);
    pushUndo(d, ed.before);
  }
  changed();
  vp.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', e => {
  if (modalOpen()) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
  const d = S.doc;
  if (e.key === ' ' && !space) { space = true; inkc.style.cursor = 'grab'; e.preventDefault(); return; }
  if (e.key === 'Escape') {
    closeMenus();
    if (S.draft && TOOLS[S.tool].mode === 'multi' && S.draft.pts.length >= (TOOLS[S.tool].min || 2)) { cancelDraft(); return; }
    if (S.draft) { cancelDraft(); return; }
    if (S.tool !== 'select') { setTool('select'); return; }
    if (d && d.sel.size) { d.sel.clear(); changed(); }
    return;
  }
  if (e.key === 'Enter' && S.draft) { e.preventDefault(); if (TOOLS[S.tool].mode === 'count') cancelDraft(); else finishDraft(); return; }
  if (e.key === 'Backspace' && S.draft && S.draft.pts && S.draft.pts.length && TOOLS[S.tool].mode === 'multi') { S.draft.pts.pop(); requestRender(); e.preventDefault(); return; }
  if (d && d.sel.size && e.key.startsWith('Arrow') && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) / Math.max(0.25, d.cam.zoom);
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    change(() => { for (const m of d.markups) if (d.sel.has(m.id) && !m.locked) { MK.translate(m, dx, dy); touch(m); } });
    return;
  }
  const combo = KS.comboFromEvent(e);
  if (!combo) return;
  const act = KS.actionFor(combo);
  if (act) { e.preventDefault(); run(act); }
  else if (combo === 'Backspace' && d && d.sel.size) { e.preventDefault(); run('edit.delete'); }
});
document.addEventListener('keyup', e => { if (e.key === ' ') { space = false; inkc.style.cursor = S.tool === 'pan' ? 'grab' : S.tool === 'select' ? 'default' : 'crosshair'; } });
window.addEventListener('blur', () => { space = false; });

// ---------------------------------------------------------------- commands
export async function run(id) {
  const d = S.doc;
  if (id.startsWith('tool.')) { const t = id.slice(5); if (d || t === 'select') setTool(t); return; }
  switch (id) {
    case 'file.open': { const files = desk ? await desk.openDialog() : await D.browserOpen(); await openFiles(files); break; }
    case 'file.save': if (d) await D.save(d); break;
    case 'file.saveas': if (d) await D.save(d, { saveAs: true }); break;
    case 'file.flatten': if (d) await D.exportFlattened(d); break;
    case 'file.csv': if (d) await D.exportCsv(d); break;
    case 'file.close': if (d) await closeDoc(d); break;
    case 'file.closeall': for (const x of [...S.docs]) if (!(await closeDoc(x))) break; break;
    case 'tab.next': if (S.docs.length > 1) activate(S.docs[(S.docs.indexOf(d) + 1) % S.docs.length]); break;
    case 'tab.prev': if (S.docs.length > 1) activate(S.docs[(S.docs.indexOf(d) - 1 + S.docs.length) % S.docs.length]); break;
    case 'edit.undo': undo(); break;
    case 'edit.redo': redo(); break;
    case 'edit.copy': if (d && d.sel.size) { S.clip = JSON.parse(JSON.stringify(d.markups.filter(m => d.sel.has(m.id)), strip)); toast(S.clip.length + ' markup' + (S.clip.length > 1 ? 's' : '') + ' copied'); } break;
    case 'edit.paste': pasteClip(); break;
    case 'edit.duplicate': if (d && d.sel.size) { S.clip = JSON.parse(JSON.stringify(d.markups.filter(m => d.sel.has(m.id)), strip)); pasteClip(true); } break;
    case 'edit.delete': if (d && d.sel.size) change(dd => { dd.markups = dd.markups.filter(m => !dd.sel.has(m.id) || m.locked); dd.sel.clear(); }); break;
    case 'edit.selectall': if (d) { const pg = currentPage(); d.sel = new Set(d.markups.filter(m => m.page === pg && !m.hidden).map(m => m.id)); changed(); } break;
    case 'edit.flag': if (d && d.sel.size) { const sel = d.markups.filter(m => d.sel.has(m.id)); const on = sel.some(m => !m.flag); change(() => sel.forEach(m => { m.flag = on ? 'red' : ''; touch(m); })); } break;
    case 'edit.status': if (d && d.sel.size) D.statusDialog(); break;
    case 'edit.addtool': if (d && d.sel.size) P.addToMyTools(d.markups.find(m => d.sel.has(m.id))); break;
    case 'view.zoomin': if (d) zoomAt(W / 2, H / 2, d.cam.zoom * 1.25); break;
    case 'view.zoomout': if (d) zoomAt(W / 2, H / 2, d.cam.zoom / 1.25); break;
    case 'view.fitpage': fitPage(); break;
    case 'view.fitwidth': fitWidth(); break;
    case 'view.actual': if (d) zoomAt(W / 2, H / 2, 96 / 72); break;
    case 'view.nextpage': if (d) goToPage(currentPage() + 1); break;
    case 'view.prevpage': if (d) goToPage(currentPage() - 1); break;
    case 'view.firstpage': if (d) goToPage(0); break;
    case 'view.lastpage': if (d) goToPage(d.pages.length - 1); break;
    case 'view.goto': if (d) { const v = await prompt('Go to page', 'Page number (1–' + d.pages.length + ')', String(currentPage() + 1)); if (v) goToPage(Number(v) - 1); } break;
    case 'view.mode': if (d) { const pg = currentPage(); d.mode = d.mode === 'single' ? 'continuous' : 'single'; d.cur = pg; fitPage(pg); updateStatus(); } break;
    case 'view.find': setPanel('left', true); P.showLeftTab('search'); setTimeout(() => { const i = $('#searchInput'); if (i) { i.focus(); i.select(); } }, 30); break;
    case 'view.bookmark': if (d) P.addBookmarkHere(); break;
    case 'panel.left': setPanel('left', !S.settings.leftOn); break;
    case 'panel.right': setPanel('right', !S.settings.rightOn); break;
    case 'panel.list': setPanel('list', !S.settings.listOn); break;
    case 'scale.dialog': if (d) D.scaleDialog(currentPage()); break;
    case 'toggle.snap': S.snap = !S.snap; $('#snapBtn').classList.toggle('on', S.snap); toast('Snap ' + (S.snap ? 'on' : 'off')); break;
    case 'toggle.ortho': S.ortho = !S.ortho; $('#orthoBtn').classList.toggle('on', S.ortho); toast('Ortho ' + (S.ortho ? 'on' : 'off')); break;
    case 'help.shortcuts': D.shortcutsDialog(); break;
    case 'help.updates': D.checkUpdates(true); break;
    case 'help.settings': D.settingsDialog(); break;
    case 'help.about': D.aboutDialog(); break;
  }
}
function pasteClip(inPlace = false) {
  const d = S.doc; if (!d || !S.clip || !S.clip.length) return;
  const pg = inPlace ? null : (S.hover ? S.hover.page : currentPage());
  const b = G.bbox(S.clip.flatMap(m => m.pts));
  let dx = 12, dy = 12;
  if (!inPlace && S.hover) { dx = S.hover.p[0] - b.x1; dy = S.hover.p[1] - b.y1; }
  const added = S.clip.map(c => { const m = JSON.parse(JSON.stringify(c)); m.id = MK.newId(); m.created = m.modified = Date.now(); m._rev = 1; if (pg != null) m.page = pg; MK.translate(m, dx, dy); m._rev = 1; return m; });
  change(dd => { dd.markups.push(...added); dd.sel = new Set(added.map(m => m.id)); });
}

export function setPanel(which, on) {
  if (which === 'left') { S.settings.leftOn = on; } else if (which === 'right') { S.settings.rightOn = on; } else S.settings.listOn = on;
  applyPanels(); saveSettings();
}
function applyPanels() {
  const s = S.settings;
  $('#left').style.display = s.leftOn ? '' : 'none'; $('[data-split=left]').style.display = s.leftOn ? '' : 'none';
  $('#right').style.display = s.rightOn ? '' : 'none'; $('[data-split=right]').style.display = s.rightOn ? '' : 'none';
  $('#bottom').style.display = s.listOn ? '' : 'none'; $('[data-split=bottom]').style.display = s.listOn ? '' : 'none';
  $('#left').style.width = s.leftW + 'px'; $('#right').style.width = s.rightW + 'px'; $('#bottom').style.height = s.bottomH + 'px';
}
// panel splitters
for (const sp of $$('.splitter')) {
  sp.addEventListener('pointerdown', e => {
    e.preventDefault(); sp.setPointerCapture(e.pointerId);
    const which = sp.dataset.split, s = S.settings, x0 = e.clientX, y0 = e.clientY;
    const w0 = which === 'left' ? s.leftW : which === 'right' ? s.rightW : s.bottomH;
    const mv = ev => {
      if (which === 'left') s.leftW = Math.max(150, Math.min(600, w0 + ev.clientX - x0));
      else if (which === 'right') s.rightW = Math.max(200, Math.min(600, w0 - (ev.clientX - x0)));
      else s.bottomH = Math.max(60, Math.min(innerHeight - 250, w0 - (ev.clientY - y0)));
      applyPanels();
    };
    const up = () => { sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); saveSettings(); };
    sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
  });
}

// ---------------------------------------------------------------- status bar
let statusTimer = null;
export function setStatus(t) { $('#statusMsg').textContent = t || ''; }
export function updateStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    const d = S.doc;
    $('#pageCount').textContent = '/ ' + (d ? d.pages.length : 0);
    if (!d) { $('#pageInput').value = ''; $('#zoomInput').value = ''; $('#scaleBtn').textContent = 'Scale: —'; return; }
    const pg = currentPage();
    if (d.mode !== 'single') d.cur = pg;
    if (document.activeElement !== $('#pageInput')) $('#pageInput').value = d.pages[pg].label || String(pg + 1);
    if (document.activeElement !== $('#zoomInput')) $('#zoomInput').value = Math.round(d.cam.zoom * 100 * 72 / 96) + '%';
    const sc = pageScale(d, pg);
    const sb = $('#scaleBtn');
    sb.textContent = 'Scale: ' + sc.label + (sc.set ? ' · ' + U.UNITS[sc.unit].label : '');
    sb.classList.toggle('unset', !sc.set);
    $('#modeBtn').textContent = d.mode === 'single' ? 'Single page' : 'Continuous';
    P.highlightThumb(pg);
  }, 30);
}
function updateCursorInfo(tp) {
  const d = S.doc;
  if (!tp || !d) { $('#cursorInfo').textContent = ''; return; }
  const sc = scaleAt(tp.page, tp.sp);
  let txt = '';
  if (S.draft && S.draft.pts && S.draft.pts.length && TOOLS[S.tool].mode && S.draft.page === tp.page) {
    const last = S.draft.pts[S.draft.pts.length - 1];
    const L = G.dist(last, tp.sp) * sc.mPerPt;
    const ang = (Math.atan2(-(tp.sp[1] - last[1]), tp.sp[0] - last[0]) * 180 / Math.PI + 360) % 360;
    txt = 'Segment ' + U.formatLength(L, sc) + '  ∠ ' + ang.toFixed(1) + '°';
  }
  $('#cursorInfo').textContent = txt;
}
$('#pageInput').addEventListener('change', e => {
  const d = S.doc; if (!d) return;
  const v = e.target.value.trim();
  let i = d.pages.findIndex(p => p.label && p.label.toLowerCase() === v.toLowerCase());
  if (i < 0) i = Number(v) - 1;
  if (isFinite(i)) goToPage(i);
  vp.focus();
});
$('#zoomInput').addEventListener('change', e => {
  const d = S.doc; if (!d) return;
  const v = parseFloat(e.target.value);
  if (v > 0) zoomAt(W / 2, H / 2, v / 100 * 96 / 72);
  vp.focus();
});

// ---------------------------------------------------------------- toolbar & menus
function buildToolbar() {
  const groups = [
    ['Navigate', ['select', 'pan', 'zoomrect']],
    ['Markup', ['pen', 'highlight', 'line', 'arrow', 'polyline', 'rect', 'ellipse', 'polygon', 'triangle', 'cloud', 'rectcloud']],
    ['Text', ['text', 'callout', 'note', 'stamp']],
    ['Measure', ['calibrate', 'length', 'polylength', 'area', 'rectarea', 'perimeter', 'count', 'angle', 'radius', 'viewport']]
  ];
  const tb = $('#toolbar');
  tb.innerHTML = '';
  for (const [name, ids] of groups) {
    const g = document.createElement('div'); g.className = 'tgroup';
    const bs = document.createElement('div'); bs.className = 'tg-btns';
    for (const id of ids) {
      const t = TOOLS[id];
      const b = document.createElement('button');
      b.className = 'tbtn'; b.dataset.tool = id;
      const k = KS.labelFor('tool.' + id);
      b.title = t.label + (k ? '  (' + k + ')' : '');
      b.innerHTML = ICONS[t.icon] || '';
      if (t.type) { const st = styleFor(t.type); const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = st.stroke || st.fill || 'transparent'; b.appendChild(dot); }
      b.onclick = () => run('tool.' + id);
      bs.appendChild(b);
    }
    g.appendChild(bs);
    const n = document.createElement('div'); n.className = 'tg-name'; n.textContent = name; g.appendChild(n);
    tb.appendChild(g);
  }
  $$('#toolbar .tbtn').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool && !S.myTool));
}
export { buildToolbar };
function menuDefs() {
  const k = id => KS.labelFor(id);
  const d = S.doc;
  const it = (label, id, extra = {}) => ({ label, key: k(id), act: () => run(id), ...extra });
  return {
    File: [it('Open…', 'file.open'), { label: 'Open recent', sub: D.recentMenu() }, '-', it('Save', 'file.save', { disabled: !d }), it('Save as…', 'file.saveas', { disabled: !d }),
      it('Export copy with markups flattened…', 'file.flatten', { disabled: !d }), it('Export markups summary (CSV)…', 'file.csv', { disabled: !d }), '-',
      { label: 'Show file in folder', act: () => d && desk && desk.showInFolder(d.path), disabled: !d || !d.path || !desk },
      it('Close tab', 'file.close', { disabled: !d }), { label: 'Close all', act: () => run('file.closeall'), disabled: !d }],
    Edit: [it('Undo', 'edit.undo', { disabled: !d || !d.undo.length }), it('Redo', 'edit.redo', { disabled: !d || !d.redo.length }), '-',
      it('Copy', 'edit.copy'), it('Paste', 'edit.paste', { disabled: !S.clip }), it('Duplicate', 'edit.duplicate'), it('Delete', 'edit.delete'), '-',
      it('Select all on page', 'edit.selectall'), it('Flag / unflag', 'edit.flag'), it('Set status…', 'edit.status'), it('Add to My Tools', 'edit.addtool'), '-',
      { label: 'Keyboard shortcuts…', key: k('help.shortcuts'), act: () => run('help.shortcuts') }, { label: 'Settings…', act: () => run('help.settings') }],
    View: [it('Zoom in', 'view.zoomin'), it('Zoom out', 'view.zoomout'), it('Fit page', 'view.fitpage'), it('Fit width', 'view.fitwidth'), it('Actual size', 'view.actual'), '-',
      it(d && d.mode === 'single' ? 'Continuous pages' : 'Single page', 'view.mode'), it('Go to page…', 'view.goto'), it('Find text', 'view.find'), it('Add bookmark here', 'view.bookmark'), '-',
      it('Pages / bookmarks panel', 'panel.left', { checked: S.settings.leftOn }), it('Properties panel', 'panel.right', { checked: S.settings.rightOn }), it('Markups list', 'panel.list', { checked: S.settings.listOn })],
    Markup: ['pen', 'highlight', 'line', 'arrow', 'polyline', 'rect', 'ellipse', 'polygon', 'triangle', 'cloud', 'rectcloud', 'text', 'callout', 'note', 'stamp'].map(t => it(TOOLS[t].label, 'tool.' + t)),
    Measure: [it('Set page scale…', 'scale.dialog'), ...['calibrate', 'viewport'].map(t => it(TOOLS[t].label, 'tool.' + t)), '-',
      ...['length', 'polylength', 'area', 'rectarea', 'perimeter', 'count', 'angle', 'radius'].map(t => it(TOOLS[t].label, 'tool.' + t)), '-',
      it('Snap to content', 'toggle.snap', { checked: S.snap }), it('Ortho', 'toggle.ortho', { checked: S.ortho })],
    Help: [it('Keyboard shortcuts', 'help.shortcuts'), { label: 'Mouse & tips', act: () => D.tipsDialog() }, it('Check for updates', 'help.updates'), { label: 'Settings…', act: () => run('help.settings') }, { label: 'About Plan Desk', act: () => run('help.about') }]
  };
}
function buildMenus() {
  const nav = $('#menus');
  nav.innerHTML = '';
  for (const name of ['File', 'Edit', 'View', 'Markup', 'Measure', 'Help']) {
    const b = document.createElement('button');
    b.textContent = name;
    const open = () => { closeMenus(); b.classList.add('open'); const r = b.getBoundingClientRect(); showMenu(menuDefs()[name], r.left, r.bottom + 2, { keep: true }); };
    b.onclick = () => { if (b.classList.contains('open')) closeMenus(); else open(); };
    b.onmouseenter = () => { if ($('#menus > button.open') && !b.classList.contains('open')) open(); };
    nav.appendChild(b);
  }
}
for (const b of $$('.qbtn')) { const id = b.dataset.act; b.innerHTML = ICONS[{ 'file.open': 'open', 'file.save': 'save', 'edit.undo': 'undo', 'edit.redo': 'redo' }[id]]; const k = KS.labelFor(id); if (k) b.title += ' (' + k + ')'; }
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.closest('.menu')) { run(b.dataset.act); } });

// ---------------------------------------------------------------- drag & drop, startup
window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
window.addEventListener('drop', async e => {
  e.preventDefault(); document.body.classList.remove('dragging');
  const files = Array.from(e.dataTransfer.files || []).filter(f => /\.pdf$/i.test(f.name));
  const list = [];
  for (const f of files) {
    const p = desk ? desk.pathForFile(f) : '';
    if (p && desk) { const r = await desk.readPath(p); if (r) { list.push(r); continue; } }
    list.push({ name: f.name, path: '', data: new Uint8Array(await f.arrayBuffer()) });
  }
  openFiles(list);
});

async function start() {
  applyPanels();
  buildMenus();
  buildToolbar();
  P.init();
  setTool('select');
  D.showRecent();
  updateStatus();
  if (desk) {
    desk.onOpenFile(async () => openFiles(await desk.takePendingFiles()));
    desk.onCloseRequest(async () => {
      for (const d of [...S.docs]) if (!(await closeDoc(d))) return;
      desk.closeNow();
    });
    openFiles(await desk.takePendingFiles());
    D.initUpdates();
  }
  if (!S.settings.author) setTimeout(() => D.askAuthor(), 800);
}
start();
window.__pd = { S, run, openFiles, setTool, fitPage, zoomAt, toScreen, pageRect }; // for testing
