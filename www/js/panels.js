// Side panels: pages, bookmarks, search, My Tools (left); properties (right); markups list (bottom)
import * as MK from './markups.js';
import * as U from './units.js';
import * as G from './geom.js';
import { ICONS } from './icons.js';
import { $, $$, esc, toast, showMenu, prompt } from './dialogs.js';
import { S, TOOLS, desk, change, touch, changed, pushUndo, snapshot, requestRender, scaleAt, scaleAtFor, goToPage, fitRect, currentPage, activate, closeDoc, setTool, styleFor, saveToolStyles, saveMyTools, saveSettings, buildToolbar, markDirty, measureText, run, pageScale, editText } from './app.js';
import * as D from './features.js';
import * as KS from './shortcuts.js';

let leftTab = 'thumbs';
const listState = { q: '', type: '', status: '', flagged: false, page: 'all', sort: 'page', dir: 1 };

export function init() {
  $$('#left .ptabs button').forEach(b => b.onclick = () => showLeftTab(b.dataset.tab));
  buildListShell();
  refreshAll();
}
export function refreshAll() { renderLeft(); refreshList(); refreshProps(); }

// ---------------------------------------------------------------- document tabs
export function renderTabs() {
  const el = $('#doctabs');
  el.innerHTML = '';
  for (const d of S.docs) {
    const t = document.createElement('div');
    t.className = 'dtab' + (d === S.doc ? ' on' : '');
    t.title = d.path || d.name;
    t.innerHTML = `<span class="nm">${d.dirty ? '<span class="dirty">● </span>' : ''}${esc(d.name)}</span><span class="x" title="Close">✕</span>`;
    t.onclick = e => { if (e.target.classList.contains('x')) closeDoc(d); else activate(d); };
    t.onauxclick = e => { if (e.button === 1) closeDoc(d); };
    el.appendChild(t);
  }
}

// ---------------------------------------------------------------- left panel
export function showLeftTab(tab) {
  leftTab = tab;
  $$('#left .ptabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  renderLeft();
}
function renderLeft() {
  const body = $('#leftBody');
  if (leftTab === 'mytools') return renderMyTools(body);
  if (!S.doc) { body.innerHTML = '<p class="muted small">Open a drawing to see its pages, bookmarks and text.</p>'; return; }
  if (leftTab === 'thumbs') renderThumbs(body);
  else if (leftTab === 'bookmarks') renderBookmarks(body);
  else if (leftTab === 'search') renderSearch(body);
}

// thumbnails
let thumbObserver = null;
function renderThumbs(body) {
  const d = S.doc;
  body.innerHTML = '<div class="thumbs"></div>';
  const wrap = $('.thumbs', body);
  if (thumbObserver) thumbObserver.disconnect();
  thumbObserver = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) { drawThumb(d, Number(en.target.dataset.i), en.target.querySelector('canvas')); thumbObserver.unobserve(en.target); }
  }, { root: body, rootMargin: '300px' });
  const tw = Math.min(170, (S.settings.leftW || 250) - 50);
  d.pages.forEach((p, i) => {
    const t = document.createElement('div');
    t.className = 'thumb'; t.dataset.i = i;
    const c = document.createElement('canvas');
    const h = Math.round(tw * p.h / p.w);
    c.style.width = tw + 'px'; c.style.height = h + 'px';
    t.appendChild(c);
    const lab = document.createElement('div'); lab.className = 'tl';
    t.appendChild(lab);
    t.onclick = () => goToPage(i);
    wrap.appendChild(t);
    thumbObserver.observe(t);
  });
  refreshThumbMarks();
  highlightThumb(currentPage());
}
function drawThumb(d, i, c) {
  const p = d.pages[i];
  const tw = parseFloat(c.style.width), dpr = window.devicePixelRatio || 1;
  const s = tw * dpr / p.w;
  c.width = Math.round(p.w * s); c.height = Math.round(p.h * s);
  if (p.thumb) { c.getContext('2d').drawImage(p.thumb, 0, 0, c.width, c.height); return; }
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  p.pg.render({ canvasContext: ctx, viewport: p.pg.getViewport({ scale: s }) }).promise.then(() => { p.thumb = c; }).catch(() => {});
}
export function refreshThumbMarks() {
  const d = S.doc; if (!d || leftTab !== 'thumbs') return;
  const counts = new Map();
  for (const m of d.markups) counts.set(m.page, (counts.get(m.page) || 0) + 1);
  $$('#leftBody .thumb').forEach(t => {
    const i = Number(t.dataset.i), p = d.pages[i], n = counts.get(i) || 0;
    const sc = d.scales[i];
    t.querySelector('.tl').innerHTML = esc(p.label || String(i + 1)) + (n ? ` <span class="mk">● ${n}</span>` : '') + (sc ? ` <span class="muted">${esc(sc.label)}</span>` : '');
  });
}
export function highlightThumb(i) {
  $$('#leftBody .thumb').forEach(t => {
    const on = Number(t.dataset.i) === i;
    if (on !== t.classList.contains('on')) {
      t.classList.toggle('on', on);
      if (on) { const body = $('#leftBody'), r = t.getBoundingClientRect(), br = body.getBoundingClientRect(); if (r.top < br.top || r.bottom > br.bottom) t.scrollIntoView({ block: 'nearest' }); }
    }
  });
}

// bookmarks
let bmSel = null;
function bmFind(list, id, parent = null) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return { list, i, item: list[i], parent };
    const r = bmFind(list[i].children || [], id, list[i]);
    if (r) return r;
  }
  return null;
}
function bmChanged() { const d = S.doc; d.bookmarksEdited = true; markDirty(d); renderBookmarks($('#leftBody')); }
export function addBookmarkHere(hit) {
  const d = S.doc; if (!d) return;
  const i = hit ? hit.i : currentPage();
  let y = null, x = null;
  if (hit) { y = Math.max(0, hit.p[1] - 40); x = Math.max(0, hit.p[0] - 40); }
  else {
    const r = d.mode === 'single' ? { x: 0, y: 0 } : { x: d.pages[i].left, y: d.pages[i].top };
    y = Math.max(0, d.cam.y / d.cam.zoom - r.y); x = Math.max(0, d.cam.x / d.cam.zoom - r.x);
  }
  prompt('Add bookmark', 'Name', (d.pages[i].label ? 'Sheet ' + d.pages[i].label : 'Page ' + (i + 1))).then(title => {
    if (title == null) return;
    const b = { id: MK.newId(), title: title || 'Bookmark', page: i, y, x, open: true, children: [] };
    const f = bmSel && bmFind(d.bookmarks, bmSel);
    if (f) f.list.splice(f.i + 1, 0, b); else d.bookmarks.push(b);
    bmSel = b.id;
    if (leftTab !== 'bookmarks') showLeftTab('bookmarks');
    bmChanged();
  });
}
function renderBookmarks(body) {
  const d = S.doc;
  body.innerHTML = `<div class="bmbar">
    <button data-b="add" title="Bookmark the current view">+ Add</button><button data-b="child" title="Add inside the selected bookmark">+ Child</button>
    <button data-b="ren">Rename</button><button data-b="del">Delete</button>
    <button data-b="up" title="Move up">↑</button><button data-b="down" title="Move down">↓</button><button data-b="out" title="Move out">←</button><button data-b="in" title="Move in">→</button>
    <button data-b="pages" title="Make one bookmark per page">From pages</button></div><div id="bmTree"></div>`;
  const tree = $('#bmTree', body);
  const draw = (items, depth) => {
    for (const b of items) {
      const row = document.createElement('div');
      row.className = 'bm' + (b.id === bmSel ? ' sel' : '');
      row.style.paddingLeft = (4 + depth * 14) + 'px';
      const hasKids = b.children && b.children.length;
      row.innerHTML = `<span class="tw">${hasKids ? (b.open === false ? '▸' : '▾') : ''}</span><span class="t">${esc(b.title)}</span>`;
      row.onclick = e => {
        if (e.target.classList.contains('tw') && hasKids) { b.open = b.open === false; renderBookmarks(body); return; }
        bmSel = b.id; $$('.bm', tree).forEach(r => r.classList.remove('sel')); row.classList.add('sel');
        if (b.page != null) goToPage(b.page, b.y, b.x);
      };
      row.ondblclick = () => rename(b, row);
      tree.appendChild(row);
      if (hasKids && b.open !== false) draw(b.children, depth + 1);
    }
  };
  if (!d.bookmarks.length) tree.innerHTML = '<p class="muted small">No bookmarks yet. Press ' + esc(KS.labelFor('view.bookmark')) + ' or “+ Add” to bookmark the current view.</p>';
  draw(d.bookmarks, 0);
  const rename = (b, row) => {
    const t = row.querySelector('.t');
    t.innerHTML = `<input value="${esc(b.title)}">`;
    const inp = t.querySelector('input'); inp.focus(); inp.select();
    const done = ok => { if (ok && inp.value.trim()) { b.title = inp.value.trim(); bmChanged(); } else renderBookmarks(body); };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    inp.onblur = () => done(true);
  };
  $$('[data-b]', body).forEach(btn => btn.onclick = () => {
    const a = btn.dataset.b;
    const f = bmSel && bmFind(d.bookmarks, bmSel);
    if (a === 'add') return addBookmarkHere();
    if (a === 'pages') {
      if (d.bookmarks.length && !confirm('Add one bookmark per page at the end of the list?')) return;
      d.pages.forEach((p, i) => d.bookmarks.push({ id: MK.newId(), title: p.label ? 'Sheet ' + p.label : 'Page ' + (i + 1), page: i, y: null, x: null, open: true, children: [] }));
      return bmChanged();
    }
    if (!f) { toast('Select a bookmark first'); return; }
    if (a === 'child') {
      const i = currentPage();
      f.item.children = f.item.children || [];
      const b = { id: MK.newId(), title: 'Page ' + (i + 1), page: i, y: null, x: null, open: true, children: [] };
      f.item.children.push(b); f.item.open = true; bmSel = b.id; bmChanged();
      const row = $$('.bm', tree).find(r => r.classList.contains('sel')); if (row) rename(b, row);
    } else if (a === 'ren') { const row = $$('.bm', tree).find(r => r.classList.contains('sel')); if (row) rename(f.item, row); }
    else if (a === 'del') { f.list.splice(f.i, 1); bmSel = null; bmChanged(); }
    else if (a === 'up' && f.i > 0) { f.list.splice(f.i - 1, 0, f.list.splice(f.i, 1)[0]); bmChanged(); }
    else if (a === 'down' && f.i < f.list.length - 1) { f.list.splice(f.i + 1, 0, f.list.splice(f.i, 1)[0]); bmChanged(); }
    else if (a === 'in' && f.i > 0) { const prev = f.list[f.i - 1]; prev.children = prev.children || []; prev.children.push(f.list.splice(f.i, 1)[0]); prev.open = true; bmChanged(); }
    else if (a === 'out' && f.parent) { const pf = bmFind(d.bookmarks, f.parent.id); f.list.splice(f.i, 1); pf.list.splice(pf.i + 1, 0, f.item); bmChanged(); }
  });
}

// search
const search = { q: '', hits: [], active: -1 };
function renderSearch(body) {
  body.innerHTML = `<div style="display:flex;gap:4px;margin-bottom:8px"><input id="searchInput" type="search" placeholder="Find text in the drawings" style="flex:1" value="${esc(search.q)}"><button class="ghost" id="searchGo">Find</button></div>
    <label class="small muted"><input type="checkbox" id="searchCase"> Match case</label><div id="searchRes" style="margin-top:8px"></div>`;
  const go = () => runSearch($('#searchInput', body).value, $('#searchCase', body).checked);
  $('#searchGo', body).onclick = go;
  $('#searchInput', body).onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { if (search.hits.length && $('#searchInput', body).value === search.q) jump(search.active + 1); else go(); } };
  showHits();
}
async function textOf(d, i) {
  const p = d.pages[i];
  if (p.text) return p.text;
  const tc = await p.pg.getTextContent();
  p.text = tc.items.filter(it => it.str).map(it => ({ str: it.str, m: G.mul(p.vt, it.transform), w: it.width }));
  return p.text;
}
async function runSearch(q, matchCase) {
  const d = S.doc; if (!d) return;
  search.q = q; search.hits = []; search.active = -1;
  const res = $('#searchRes');
  if (!q.trim()) { showHits(); requestRender(); return; }
  const needle = matchCase ? q : q.toLowerCase();
  for (let i = 0; i < d.pages.length; i++) {
    if (res) res.innerHTML = `<p class="muted small">Searching page ${i + 1} of ${d.pages.length}…</p>`;
    const items = await textOf(d, i);
    for (const it of items) {
      const hay = matchCase ? it.str : it.str.toLowerCase();
      let k = hay.indexOf(needle);
      while (k >= 0) {
        const L = it.str.length || 1;
        const t0 = k / L, t1 = (k + needle.length) / L;
        const m = it.m;
        const ax = Math.hypot(m[0], m[1]) || 1;
        const ux = m[0] / ax, uy = m[1] / ax;
        const o = [m[4] + ux * it.w * t0, m[5] + uy * it.w * t0];
        const along = [ux * it.w * (t1 - t0), uy * it.w * (t1 - t0)];
        const up = [m[2], m[3]];
        const quad = [o, [o[0] + along[0], o[1] + along[1]], [o[0] + along[0] + up[0], o[1] + along[1] + up[1]], [o[0] + up[0], o[1] + up[1]]];
        search.hits.push({ page: i, quad, text: it.str, k, n: needle.length });
        k = hay.indexOf(needle, k + Math.max(1, needle.length));
      }
    }
  }
  showHits();
  if (search.hits.length) jump(0);
  requestRender();
}
function showHits() {
  const res = $('#searchRes'); if (!res) return;
  if (!search.q) { res.innerHTML = ''; return; }
  if (!search.hits.length) { res.innerHTML = '<p class="muted small">No matches.</p>'; return; }
  const d = S.doc;
  res.innerHTML = `<p class="muted small">${search.hits.length} match${search.hits.length > 1 ? 'es' : ''}. Enter = next.</p>` + search.hits.slice(0, 500).map((h, i) =>
    `<div class="sr" data-i="${i}"><span class="pg">${esc(d.pages[h.page].label || 'Page ' + (h.page + 1))}</span><br>${esc(h.text.slice(Math.max(0, h.k - 30), h.k))}<b>${esc(h.text.substr(h.k, h.n))}</b>${esc(h.text.slice(h.k + h.n, h.k + h.n + 30))}</div>`).join('');
  $$('.sr', res).forEach(r => r.onclick = () => jump(Number(r.dataset.i)));
}
function jump(i) {
  if (!search.hits.length) return;
  search.active = (i + search.hits.length) % search.hits.length;
  const h = search.hits[search.active];
  const b = G.bbox(h.quad);
  const w = Math.max(b.x2 - b.x1, 1), hh = Math.max(b.y2 - b.y1, 1);
  const d = S.doc;
  const want = Math.max(w * 8, 300);
  fitRect(h.page, (b.x1 + b.x2) / 2 - want / 2, (b.y1 + b.y2) / 2 - want * 0.35, want, want * 0.7, 0);
  if (d.mode === 'single') d.cur = h.page;
  requestRender();
}
export function drawOverlays(ctx, d, i, z) {
  if (!search.hits.length || leftTab !== 'search') return;
  search.hits.forEach((h, k) => {
    if (h.page !== i) return;
    ctx.fillStyle = k === search.active ? 'rgba(255,140,0,.45)' : 'rgba(255,220,0,.35)';
    ctx.beginPath(); h.quad.forEach((q, j) => j ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fill();
  });
}

// My Tools (tool chest)
const TYPE_TOOL = { cloud: 'cloud', area: 'area' };
export function addToMyTools(m) {
  if (!m) return;
  const tool = m.type === 'cloud' && m.pts.length === 2 ? 'rectcloud' : (TYPE_TOOL[m.type] || m.type);
  if (!TOOLS[tool]) return;
  const t = { id: MK.newId(), name: m.subject || MK.TYPES[m.type].name, tool, type: m.type, style: JSON.parse(JSON.stringify(m.style)), subject: m.subject, text: m.type === 'stamp' ? m.text : '', stampSub: m.stampSub || '', depth: m.depth || 0 };
  S.myTools.push(t); saveMyTools();
  toast('Added “' + t.name + '” to My Tools', 'ok');
  if (leftTab === 'mytools') renderLeft();
}
export function refreshMyTools() { if (leftTab === 'mytools') renderLeft(); }
function renderMyTools(body) {
  body.innerHTML = `<p class="muted small">Save markups you use often — right-click a markup → Add to My Tools. Click a tool to draw with it.</p><div id="mtList"></div>
    <div style="display:flex;gap:6px;margin-top:10px"><button class="ghost" id="mtExp">Export</button><button class="ghost" id="mtImp">Import</button></div>`;
  const list = $('#mtList', body);
  if (!S.myTools.length) list.innerHTML = '<p class="small" style="color:#B9C4D1">No tools yet.</p>';
  for (const t of S.myTools) {
    const row = document.createElement('div');
    row.className = 'mytool' + (S.myTool && S.myTool.id === t.id ? ' on' : '');
    row.innerHTML = `<span style="color:${esc(t.style.stroke || t.style.fill || '#ccc')}">${ICONS[TOOLS[t.tool] ? TOOLS[t.tool].icon : 'rect'] || ''}</span><span class="nm">${esc(t.name)}</span><button class="del" title="Remove">✕</button>`;
    row.onclick = e => {
      if (e.target.closest('.del')) { S.myTools = S.myTools.filter(x => x !== t); saveMyTools(); if (S.myTool === t) setTool('select'); renderLeft(); return; }
      setTool(t.tool, t); renderLeft();
    };
    row.ondblclick = async () => { const n = await prompt('Rename tool', 'Name', t.name); if (n) { t.name = n; saveMyTools(); renderLeft(); } };
    list.appendChild(row);
  }
  $('#mtExp', body).onclick = async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ myTools: S.myTools }, null, 2));
    if (desk) await desk.saveAs('Plan Desk tools.json', bytes, 'json');
  };
  $('#mtImp', body).onclick = async () => {
    const txt = desk ? await desk.openJson() : null; if (!txt) return;
    try { const o = JSON.parse(txt); const arr = o.myTools || o; if (!Array.isArray(arr)) throw new Error(); arr.forEach(t => { t.id = MK.newId(); S.myTools.push(t); }); saveMyTools(); renderLeft(); toast('Imported ' + arr.length + ' tools', 'ok'); }
    catch (e) { toast('That file is not a My Tools file', 'err'); }
  };
}

// ---------------------------------------------------------------- right panel: properties
const PALETTE = ['#E5484D', '#F5A524', '#FFE45C', '#30A46C', '#0EA5A4', '#2F7FF5', '#8E4EC6', '#E93D82', '#000000', '#56606E', '#FFFFFF'];
let propsKey = '';
export function refreshProps() {
  const body = $('#rightBody');
  const d = S.doc;
  const sel = d ? d.markups.filter(m => d.sel.has(m.id)) : [];
  const key = (d ? d.id : '') + '|' + S.tool + '|' + (S.myTool ? S.myTool.id : '') + '|' + sel.map(m => m.id).join(',');
  if (key === propsKey && body.contains(document.activeElement)) { updateMeasureBox(sel); return; }
  propsKey = key;
  if (!d) { body.innerHTML = tipsHtml(); return; }
  if (sel.length) return markupProps(body, sel);
  const t = TOOLS[S.tool];
  if (t.type) return toolProps(body, t);
  docProps(body, d);
}
function tipsHtml() {
  return `<div class="sec"><h3>Getting started</h3><p class="small" style="color:#B9C4D1">Open a PDF drawing (Ctrl+O) or drag it here.<br><br>
  • Mouse wheel zooms at the cursor<br>• Double-click the wheel to fit the page<br>• Hold the wheel to pan<br>• Set the scale (Ctrl+Shift+K) or calibrate (K) before measuring<br>• F3 snap, F8 ortho</p></div>`;
}
function docProps(body, d) {
  const pg = currentPage(), sc = pageScale(d, pg);
  const counts = {};
  for (const m of d.markups) counts[MK.TYPES[m.type].name] = (counts[MK.TYPES[m.type].name] || 0) + 1;
  body.innerHTML = `<div class="sec"><h3>Drawing</h3><div class="small" style="word-break:break-all">${esc(d.name)}</div><div class="small muted">${d.pages.length} page${d.pages.length > 1 ? 's' : ''}${d.saveable ? '' : ' · cannot save into this PDF'}</div></div>
  <div class="sec"><h3>Scale — page ${esc(d.pages[pg].label || pg + 1)}</h3><div class="measure-box">${esc(sc.label)}<small>${sc.set ? 'Lengths in ' + esc(U.UNITS[sc.unit].label) : 'Set a scale before measuring'}</small></div>
    <div style="display:flex;gap:6px;margin-top:8px"><button class="ghost" data-act="scale.dialog">Set scale…</button><button class="ghost" data-act="tool.calibrate">Calibrate</button></div></div>
  <div class="sec"><h3>Markups</h3>${Object.keys(counts).length ? Object.entries(counts).map(([k, v]) => `<div class="small">${esc(k)}: <b>${v}</b></div>`).join('') : '<div class="small muted">None yet</div>'}</div>`;
}

function colorRow(label, value, onPick, allowNone) {
  const id = 'c' + Math.random().toString(36).slice(2, 7);
  return { html: `<div class="row"><label>${label}</label><div class="colors" id="${id}">${allowNone ? `<button class="none ${!value ? 'on' : ''}" data-c="" title="None"></button>` : ''}${PALETTE.map(c => `<button style="background:${c}" data-c="${c}" class="${(value || '').toUpperCase() === c ? 'on' : ''}"></button>`).join('')}<input type="color" value="${value || '#000000'}" title="Custom colour"></div></div>`,
    wire: body => { const el = $('#' + id, body); $$('button', el).forEach(b => b.onclick = () => onPick(b.dataset.c)); $('input', el).onchange = e => onPick(e.target.value); } };
}
function styleEditor(type, style, apply, opts = {}) {
  const T = MK.TYPES[type];
  const parts = [], wires = [];
  const add = r => { parts.push(r.html); wires.push(r.wire); };
  const hasFill = ['rect', 'ellipse', 'polygon', 'triangle', 'cloud', 'text', 'callout', 'area', 'radius', 'count', 'note', 'viewport'].includes(type);
  const lineLike = !['note', 'count'].includes(type);
  const textual = ['text', 'callout', 'viewport', 'count'].includes(type) || !!T.measure;
  if (type !== 'stamp') add(colorRow(type === 'highlight' ? 'Colour' : 'Line colour', style.stroke, c => apply(s => { s.stroke = c; if (type === 'stamp') s.textColor = c; }), type === 'text'));
  else add(colorRow('Colour', style.stroke, c => apply(s => { s.stroke = c; s.textColor = c; })));
  if (hasFill) add(colorRow('Fill', style.fill, c => apply(s => { s.fill = c; }), true));
  const num = (label, key, min, max, step, fmt = v => v) => {
    const id = 'n' + Math.random().toString(36).slice(2, 7);
    return { html: `<div class="row"><label>${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${style[key]}"><span class="small muted" style="width:38px;text-align:right" id="${id}v">${fmt(style[key])}</span></div>`,
      wire: body => { const el = $('#' + id, body); el.oninput = () => { $('#' + id + 'v', body).textContent = fmt(Number(el.value)); apply(s => { s[key] = Number(el.value); }, true); }; el.onchange = () => apply(s => { s[key] = Number(el.value); }); } };
  };
  if (hasFill && style.fill) add(num('Fill opacity', 'fillOpacity', 0, 1, 0.05, v => Math.round(v * 100) + '%'));
  add(num('Opacity', 'opacity', 0.1, 1, 0.05, v => Math.round(v * 100) + '%'));
  if (lineLike) add(num('Line width', 'width', type === 'text' ? 0 : 0.25, type === 'highlight' ? 40 : 12, 0.25, v => v + ' pt'));
  if (lineLike && !['pen', 'highlight', 'stamp'].includes(type)) {
    const id = 'd' + Math.random().toString(36).slice(2, 7);
    add({ html: `<div class="row"><label>Line style</label><select id="${id}">${[['solid', 'Solid ——'], ['dash', 'Dashed – – –'], ['dot', 'Dotted · · ·'], ['dashdot', 'Dash dot – · –'], ['long', 'Long dash —  —']].map(([v, l]) => `<option value="${v}" ${style.dash === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`,
      wire: body => { $('#' + id, body).onchange = e => apply(s => { s.dash = e.target.value; }); } });
  }
  if (['line', 'arrow', 'polyline', 'length'].includes(type)) {
    const id = 'a' + Math.random().toString(36).slice(2, 7);
    add({ html: `<div class="row"><label>Arrows</label><label class="small"><input type="checkbox" id="${id}s" ${style.arrowStart ? 'checked' : ''}> Start</label><label class="small"><input type="checkbox" id="${id}e" ${style.arrowEnd ? 'checked' : ''}> End</label></div>`,
      wire: body => { $('#' + id + 's', body).onchange = e => apply(s => { s.arrowStart = e.target.checked; }); $('#' + id + 'e', body).onchange = e => apply(s => { s.arrowEnd = e.target.checked; }); } });
  }
  if (type === 'cloud') add(num('Arc size', 'arcSize', 4, 40, 1, v => v + ' pt'));
  if (type === 'count') {
    const id = 'k' + Math.random().toString(36).slice(2, 7);
    add({ html: `<div class="row"><label>Symbol</label><select id="${id}">${[['circle', 'Circle'], ['square', 'Square'], ['check', 'Check mark']].map(([v, l]) => `<option value="${v}" ${style.marker === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`, wire: body => { $('#' + id, body).onchange = e => apply(s => { s.marker = e.target.value; }); } });
    add(num('Symbol size', 'markerSize', 2, 30, 0.5, v => v + ' pt'));
  }
  if (textual || type === 'note') {
    if (type !== 'note') add(num(T.measure ? 'Label size' : 'Font size', 'fontSize', 4, 72, 0.5, v => v + ' pt'));
    if (type !== 'note') add(colorRow('Text colour', style.textColor, c => apply(s => { s.textColor = c; })));
  }
  return { html: parts.join(''), wire: body => wires.forEach(w => w(body)) };
}

let pendingBefore = null;
function markupProps(body, sel) {
  const d = S.doc;
  const one = sel.length === 1 ? sel[0] : null;
  const type = sel.every(m => m.type === sel[0].type) ? sel[0].type : null;
  const edit = (fn, live) => {
    if (!pendingBefore) pendingBefore = snapshot(d);
    sel.forEach(m => { fn(m); touch(m); });
    requestRender();
    if (!live) { if (snapshot(d) !== pendingBefore) pushUndo(d, pendingBefore); pendingBefore = null; changed(); }
  };
  const editStyle = (fn, live) => edit(m => fn(m.style), live);
  const T = type ? MK.TYPES[type] : null;
  let html = `<div class="sec"><h3>${sel.length > 1 ? sel.length + ' markups selected' : esc(T.name)}${one && one.locked ? ' · locked' : ''}</h3>`;
  if (one && T.measure) html += `<div class="measure-box" id="mBox"></div>`;
  if (one && one.type === 'area') {
    const sc = scaleAt(one.page, one.pts[0]);
    const depthTxt = one.depth ? (sc.unit === 'ftin' ? U.formatFtIn(one.depth) : (one.depth / U.UNITS[sc.unit].m).toString()) : '';
    html += `<div class="row" style="margin-top:8px"><label>Depth</label><input id="pDepth" value="${esc(depthTxt)}" placeholder="for volume, in ${esc(U.UNITS[sc.unit].label)}"></div>`;
  }
  if (one && one.type === 'viewport') html += `<button class="ghost" id="pVpScale" style="margin-top:8px">Scale for this area…</button>`;
  html += `</div><div class="sec"><h3>Details</h3>
    <div class="row"><label>Subject</label><input id="pSubj" value="${esc(one ? one.subject : (sel.every(m => m.subject === sel[0].subject) ? sel[0].subject : ''))}" placeholder="${sel.length > 1 ? '(mixed)' : ''}"></div>
    ${one && MK.TYPES[one.type].text ? `<div class="row"><label>Text</label><textarea id="pText">${esc(one.text || '')}</textarea></div>` : ''}
    ${one && one.type === 'stamp' ? `<div class="row"><label>Stamp</label><button class="ghost" id="pStamp" style="flex:1;text-align:left">${esc(one.text)}</button></div>` : ''}
    <div class="row"><label>Comment</label><textarea id="pComm">${esc(one ? one.comment || '' : '')}</textarea></div>
    <div class="row"><label>Status</label><select id="pStat">${MK.STATUSES.map(s => `<option value="${s}" ${(one ? one.status : sel[0].status) === s ? 'selected' : ''}>${s || 'None'}</option>`).join('')}</select></div>
    <div class="row"><label>Flag</label><div class="colors" id="pFlag">${MK.FLAGS.map(f => `<button data-f="${f}" title="${f || 'No flag'}" class="${(one ? one.flag : sel[0].flag) === f ? 'on' : ''}" style="background:${f ? MK.FLAG_HEX[f] : 'transparent'};${f ? '' : 'border-style:dashed'}"></button>`).join('')}</div></div>
    <div class="row"><label>Author</label><input id="pAuth" value="${esc(one ? one.author || '' : '')}"></div>
    ${one ? `<div class="small muted">Created ${esc(new Date(one.created).toLocaleString())}${one.modified && one.modified !== one.created ? '<br>Changed ' + esc(new Date(one.modified).toLocaleString()) : ''}</div>` : ''}
  </div>`;
  let se = null;
  if (type) { se = styleEditor(type, sel[0].style, editStyle); html += `<div class="sec"><h3>Appearance</h3>${se.html}<button class="ghost small" id="pDefault">Use as default for new ${esc(T.name)}</button></div>`; }
  body.innerHTML = html;
  if (se) se.wire(body);
  updateMeasureBox(sel);
  const bind = (id, fn) => { const el = $('#' + id, body); if (!el) return; el.oninput = () => edit(m => fn(m, el.value), true); el.onchange = () => edit(m => fn(m, el.value)); el.onkeydown = e => e.stopPropagation(); };
  bind('pSubj', (m, v) => { m.subject = v; });
  bind('pComm', (m, v) => { m.comment = v; });
  bind('pAuth', (m, v) => { m.author = v; });
  bind('pText', (m, v) => { m.text = v; });
  const st = $('#pStat', body); st.onchange = () => edit(m => { m.status = st.value; });
  $$('#pFlag button', body).forEach(b => b.onclick = () => { edit(m => { m.flag = b.dataset.f; }); $$('#pFlag button', body).forEach(x => x.classList.toggle('on', x === b)); });
  const dp = $('#pDepth', body);
  if (dp) {
    dp.onkeydown = e => e.stopPropagation();
    dp.onchange = () => { const sc = scaleAt(one.page, one.pts[0]); const v = dp.value.trim() ? U.parseLength(dp.value, sc.unit) : 0; if (isNaN(v)) { toast('Type a depth like 0.2 or 8"', 'err'); return; } edit(m => { m.depth = v; }); };
  }
  const vb = $('#pVpScale', body); if (vb) vb.onclick = () => D.scaleDialog(one.page, one);
  const sb = $('#pStamp', body); if (sb) sb.onclick = () => D.stampTextDialog(one);
  const db = $('#pDefault', body);
  if (db) db.onclick = () => { S.toolStyles[type] = JSON.parse(JSON.stringify(sel[0].style)); saveToolStyles(); buildToolbar(); toast('New ' + T.name + ' markups will look like this', 'ok'); };
}
function updateMeasureBox(sel) {
  const box = $('#mBox'); if (!box || sel.length !== 1) return;
  const m = sel[0], r = MK.measureOf(m, scaleAt);
  if (!r) { box.textContent = ''; return; }
  let sub = r.scale.set ? 'Scale ' + r.scale.label : 'No scale set — values use 1:1 paper size';
  if (r.kind === 'area') sub = 'Perimeter ' + U.formatLength(r.perimeter, r.scale) + ' · ' + sub;
  box.innerHTML = esc(r.text) + `<small>${esc(sub)}</small>`;
}
function toolProps(body, t) {
  const type = t.type;
  const isMy = !!S.myTool;
  const style = isMy ? S.myTool.style : styleFor(type);
  const apply = (fn, live) => {
    if (isMy) { fn(S.myTool.style); if (!live) saveMyTools(); }
    else { const s = styleFor(type); fn(s); S.toolStyles[type] = s; if (!live) { saveToolStyles(); buildToolbar(); } }
    if (S.draft) { S.draft.style = JSON.parse(JSON.stringify(isMy ? S.myTool.style : styleFor(type))); requestRender(); }
  };
  const se = styleEditor(type, style, apply);
  let extra = '';
  if (type === 'stamp' && !isMy) {
    extra = `<div class="sec"><h3>Stamp</h3>${D.stampChoiceHtml(S.settings.stampText || (MK.STAMPS[S.settings.stamp] || MK.STAMPS[0]).text, S.settings.stampSub || '')}
      <label class="small" style="display:block;margin-top:6px"><input type="checkbox" id="stAuto" ${S.settings.stampNameDate ? 'checked' : ''}> Always add my name and today's date</label></div>`;
  }
  body.innerHTML = `<div class="sec"><h3>${esc(isMy ? S.myTool.name : t.label)} — new markups</h3><p class="small muted">${esc(isMy ? 'From My Tools.' : 'These settings are used for the next ' + t.label.toLowerCase() + ' you draw.')}</p></div>${extra}<div class="sec"><h3>Appearance</h3>${se.html}</div>`;
  se.wire(body);
  if (extra) {
    D.wireStamp(body);
    const saveSt = () => {
      const v = $('#stSel', body).value;
      S.settings.stamp = v === 'custom' ? S.settings.stamp : Number(v);
      S.settings.stampText = $('#stText', body).value; S.settings.stampSub = $('#stSub', body).value;
      S.settings.stampNameDate = $('#stAuto', body).checked; saveSettings();
    };
    ['stSel', 'stText', 'stSub', 'stAuto'].forEach(id => { const el = $('#' + id, body); el.addEventListener('change', saveSt); el.addEventListener('keydown', e => e.stopPropagation()); });
    $('#stMe', body).addEventListener('click', () => setTimeout(saveSt, 0));
  }
  if (type === 'area') {
    body.insertAdjacentHTML('beforeend', '<p class="small muted">Tip: select an area and type a Depth to get its volume (e.g. a slab).</p>');
  }
}

// ---------------------------------------------------------------- bottom: markups list
function buildListShell() {
  $('#bottom').innerHTML = `<div class="lbar"><span class="ttl">Markups</span>
    <input type="search" id="lq" placeholder="Search subject, text, comment">
    <select id="lType"><option value="">All types</option>${Object.entries(MK.TYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('')}</select>
    <select id="lStat"><option value="">Any status</option>${MK.STATUSES.filter(Boolean).map(s => `<option>${s}</option>`).join('')}<option value="__none">No status</option></select>
    <select id="lPage"><option value="all">All pages</option><option value="current">This page</option></select>
    <label><input type="checkbox" id="lFlag"> Flagged</label>
    <span class="spacer"></span>
    <span class="small muted" id="lCount"></span>
    <button class="ghost" id="lCsv">Export CSV</button></div>
    <div class="ltable"><table class="ml"><thead><tr>
      <th data-s="flag" style="width:26px">⚑</th><th data-s="subject">Subject</th><th data-s="page">Page</th><th data-s="text">Text / comment</th><th data-s="measure">Measurement</th><th data-s="status">Status</th><th data-s="author">Author</th><th data-s="date">Date</th>
    </tr></thead><tbody id="lBody"></tbody></table></div><div class="totals" id="lTotals"></div>`;
  const upd = () => { listState.q = $('#lq').value; listState.type = $('#lType').value; listState.status = $('#lStat').value; listState.page = $('#lPage').value; listState.flagged = $('#lFlag').checked; refreshList(); };
  $('#lq').oninput = upd; $('#lq').onkeydown = e => e.stopPropagation();
  ['lType', 'lStat', 'lPage', 'lFlag'].forEach(id => $('#' + id).onchange = upd);
  $('#lCsv').onclick = () => { if (S.doc) D.exportCsv(S.doc, filtered(S.doc)); };
  $$('#bottom th').forEach(th => th.onclick = () => { const s = th.dataset.s; if (listState.sort === s) listState.dir *= -1; else { listState.sort = s; listState.dir = 1; } refreshList(); });
}
function filtered(d) {
  const q = listState.q.trim().toLowerCase();
  const cur = currentPage();
  return d.markups.filter(m => {
    if (listState.type && m.type !== listState.type) return false;
    if (listState.status === '__none' ? m.status : listState.status && m.status !== listState.status) return false;
    if (listState.flagged && !m.flag) return false;
    if (listState.page === 'current' && m.page !== cur) return false;
    if (q && !((m.subject || '') + ' ' + (m.text || '') + ' ' + (m.comment || '') + ' ' + (m.author || '')).toLowerCase().includes(q)) return false;
    return true;
  });
}
let listTimer = null;
export function refreshList() {
  const tb = $('#lBody'); if (!tb) return;
  const d = S.doc;
  if (!d) { tb.innerHTML = ''; $('#lTotals').innerHTML = ''; $('#lCount').textContent = ''; return; }
  const sa = scaleAtFor(d);
  let list = filtered(d).map(m => ({ m, r: MK.measureOf(m, sa) }));
  const key = x => {
    const m = x.m;
    switch (listState.sort) {
      case 'flag': return MK.FLAGS.indexOf(m.flag || '');
      case 'subject': return (m.subject || '').toLowerCase();
      case 'text': return ((m.text || '') + (m.comment || '')).toLowerCase();
      case 'measure': return x.r ? x.r.value : -1;
      case 'status': return m.status || '';
      case 'author': return (m.author || '').toLowerCase();
      case 'date': return m.modified || m.created;
      default: return m.page * 1e6 + d.markups.indexOf(m);
    }
  };
  list.sort((a, b) => { const ka = key(a), kb = key(b); return (ka < kb ? -1 : ka > kb ? 1 : 0) * listState.dir; });
  $('#lCount').textContent = list.length + ' of ' + d.markups.length;
  const shown = list.slice(0, 3000);
  tb.innerHTML = shown.map(({ m, r }) => `<tr data-id="${m.id}" class="${d.sel.has(m.id) ? 'sel' : ''}">
    <td><span class="flag" data-flag="${m.id}" style="${m.flag ? 'color:' + MK.FLAG_HEX[m.flag] : ''}">${m.flag ? '⚑' : '⚐'}</span></td>
    <td><span class="swatch" style="background:${esc(m.style.stroke || m.style.fill || '#999')}"></span>${esc(m.subject || MK.TYPES[m.type].name)}</td>
    <td>${esc(d.pages[m.page].label || m.page + 1)}</td>
    <td title="${esc([m.text, m.comment].filter(Boolean).join(' — '))}">${esc([m.type === 'stamp' ? m.text : m.text, m.comment].filter(Boolean).join(' — ').replace(/\n/g, ' '))}</td>
    <td>${r ? esc(r.text.replace('\n', ' · ')) : ''}</td>
    <td><select data-st="${m.id}">${MK.STATUSES.map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s || '—'}</option>`).join('')}</select></td>
    <td>${esc(m.author || '')}</td><td>${esc(new Date(m.modified || m.created).toLocaleDateString())}</td></tr>`).join('');
  $$('tr', tb).forEach(tr => {
    tr.onclick = e => {
      if (e.target.closest('select') || e.target.closest('[data-flag]')) return;
      const m = d.markups.find(x => x.id === tr.dataset.id); if (!m) return;
      if (e.ctrlKey || e.shiftKey) { if (d.sel.has(m.id)) d.sel.delete(m.id); else d.sel.add(m.id); }
      else d.sel = new Set([m.id]);
      if (!e.ctrlKey && !e.shiftKey) zoomTo(m);
      changed();
    };
    tr.ondblclick = () => { const m = d.markups.find(x => x.id === tr.dataset.id); if (m && (MK.TYPES[m.type].text || m.type === 'stamp')) editText(m); };
    tr.oncontextmenu = e => { e.preventDefault(); const m = d.markups.find(x => x.id === tr.dataset.id); if (!m) return; if (!d.sel.has(m.id)) { d.sel = new Set([m.id]); changed(); } showMenu(D.markupMenu(), e.clientX, e.clientY); };
  });
  $$('[data-st]', tb).forEach(s => s.onchange = () => { const m = d.markups.find(x => x.id === s.dataset.st); if (m) change(() => { m.status = s.value; touch(m); }); });
  $$('[data-flag]', tb).forEach(f => f.onclick = () => { const m = d.markups.find(x => x.id === f.dataset.flag); if (!m) return; const i = MK.FLAGS.indexOf(m.flag || ''); change(() => { m.flag = MK.FLAGS[(i + 1) % MK.FLAGS.length]; touch(m); }); });
  // totals by subject
  const groups = new Map();
  for (const { m, r } of list) {
    if (!r || r.kind === 'angle') continue;
    const k = r.kind + '|' + (m.subject || MK.TYPES[m.type].name);
    const g = groups.get(k) || { kind: r.kind, name: m.subject || MK.TYPES[m.type].name, sum: 0, vol: 0, n: 0, scale: r.scale };
    g.sum += r.value; g.vol += r.volume || 0; g.n++;
    groups.set(k, g);
  }
  $('#lTotals').innerHTML = groups.size ? [...groups.values()].map(g => {
    const v = g.kind === 'length' ? U.formatLength(g.sum, g.scale) : g.kind === 'area' ? U.formatArea(g.sum, g.scale) + (g.vol ? ' · ' + U.formatVolume(g.vol, g.scale) : '') : g.sum + ' ea';
    return `<span style="margin-right:18px">${esc(g.name)}: <b>${esc(v)}</b> <span class="muted">(${g.n})</span></span>`;
  }).join('') : '';
}
export function zoomTo(m) {
  const d = S.doc; if (!d) return;
  const b = MK.bounds(m, scaleAt, measureText);
  const w = Math.max(b.x2 - b.x1, 60), h = Math.max(b.y2 - b.y1, 60);
  if (d.mode === 'single') d.cur = m.page;
  fitRect(m.page, (b.x1 + b.x2) / 2 - w * 0.9, (b.y1 + b.y2) / 2 - h * 0.9, w * 1.8, h * 1.8, 0.05);
}
