// Saving, exporting, scales, recent files, recovery, shortcuts editor, settings and updates
import * as MK from './markups.js';
import * as U from './units.js';
import * as G from './geom.js';
import * as KS from './shortcuts.js';
import { savePdf } from './pdfio.js';
import { $, $$, esc, toast, modal, ask, prompt, showMenu } from './dialogs.js';
import { S, desk, store, change, touch, changed, snapshot, scaleAtFor, measureText, currentPage, setStatus, updateStatus, run, editText, saveSettings, buildToolbar, pageScale, openFiles, goToPage, fitPage, setTool, requestRender, saveToolStyles } from './app.js';
import * as P from './panels.js';

const strip = (k, v) => (k && k[0] === '_') ? undefined : v;

// ---------------------------------------------------------------- outline (bookmarks) from the PDF
export async function readOutline(d) {
  const ol = await d.pdf.getOutline();
  if (!ol) return [];
  const conv = async items => {
    const out = [];
    for (const it of items) {
      let page = null, y = null, x = null;
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await d.pdf.getDestination(dest);
        if (Array.isArray(dest)) {
          const ref = dest[0];
          page = typeof ref === 'number' ? ref : await d.pdf.getPageIndex(ref);
          if (dest[1] && dest[1].name === 'XYZ' && dest[3] != null && d.pages[page]) {
            const v = G.apply(d.pages[page].vt, dest[2] || 0, dest[3]);
            y = Math.max(0, v[1]); if (dest[2] != null) x = Math.max(0, v[0]);
          }
        }
      } catch (e) { /* bookmark without a page */ }
      out.push({ id: MK.newId(), title: it.title || 'Untitled', page, y, x, open: !(it.count < 0), children: await conv(it.items || []) });
    }
    return out;
  };
  return await conv(ol);
}

// ---------------------------------------------------------------- save / export
function stateFor(d, opts = {}) {
  const scaleAt = scaleAtFor(d);
  for (const m of d.markups) { const r = MK.measureOf(m, scaleAt); m._measureText = r ? r.text : ''; }
  return {
    markups: d.markups, pageTransforms: d.pages.map(p => p.vt), scaleAt, measure: measureText,
    data: { app: 'Plan Desk', v: 1, markups: JSON.parse(JSON.stringify(d.markups, strip)), scales: d.scales },
    bookmarks: d.bookmarksEdited || opts.withBookmarks ? strip2(d.bookmarks) : null
  };
}
const strip2 = b => JSON.parse(JSON.stringify(b, strip));
function download(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function save(d, { saveAs = false } = {}) {
  if (!d.saveable) {
    const r = await modal('Cannot save into this PDF', `<p>${esc(d.saveReason)}</p><p>You can still export a markups summary (CSV).</p>`, [{ label: 'Close', value: null }, { label: 'Export CSV…', value: 'csv', primary: true }]);
    if (r === 'csv') await exportCsv(d);
    return false;
  }
  setStatus('Saving…');
  let bytes;
  try { bytes = await savePdf(d.fileBytes, stateFor(d)); }
  catch (e) { console.error(e); setStatus(''); toast('Could not save: ' + (e.message || e), 'err', 7000); return false; }
  let res;
  if (!desk) { download(d.name, bytes, 'application/pdf'); res = { saved: true }; }
  else if (saveAs || !d.path) res = await desk.saveAs(d.name, bytes, 'pdf');
  else {
    const mt = await desk.fileMtime(d.path);
    if (d.mtime && mt && Math.abs(mt - d.mtime) > 1500) {
      const ok = await ask('File changed', d.name + ' was changed by another program after you opened it. Save over it anyway?', 'Save anyway', true);
      if (!ok) { setStatus(''); return false; }
    }
    res = await desk.savePdf(d.path, bytes);
  }
  setStatus('');
  if (!res || !res.saved) { if (res && res.error) toast('Could not save: ' + res.error, 'err', 8000); return false; }
  if (res.path) { if (d.path !== res.path) clearRecovery(d); d.path = res.path; d.name = res.name || d.name; addRecent(res.path); }
  if (res.mtime) d.mtime = res.mtime;
  d.fileBytes = bytes; d.dirty = false; d.bookmarksEdited = false;
  clearRecovery(d);
  P.renderTabs();
  toast('Saved ' + d.name, 'ok');
  return true;
}
export async function exportFlattened(d) {
  if (!d.saveable) { toast(d.saveReason, 'err', 7000); return; }
  setStatus('Preparing flattened copy…');
  try {
    const bytes = await savePdf(d.fileBytes, stateFor(d, { withBookmarks: true }), { flatten: true });
    const name = d.name.replace(/\.pdf$/i, '') + ' - markups.pdf';
    if (!desk) download(name, bytes, 'application/pdf');
    else { const r = await desk.saveAs(name, bytes, 'pdf'); if (r && r.saved) toast('Exported ' + r.name, 'ok'); else if (r && r.error) toast(r.error, 'err'); }
  } catch (e) { console.error(e); toast('Could not export: ' + e.message, 'err'); }
  setStatus('');
}
function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
export function csvRows(d, list = d.markups) {
  const scaleAt = scaleAtFor(d);
  const head = ['Page', 'Page label', 'Type', 'Subject', 'Text', 'Comment', 'Status', 'Flag', 'Author', 'Date', 'Measurement', 'Value', 'Unit', 'Perimeter', 'Depth', 'Volume', 'Volume unit', 'Scale'];
  const rows = [head];
  for (const m of list) {
    const r = MK.measureOf(m, scaleAt);
    let value = '', unit = '', per = '', vol = '', volU = '';
    if (r) {
      if (r.kind === 'length') { value = U.lengthValue(r.value, r.scale).toFixed(4); unit = U.lengthUnitName(r.scale); }
      else if (r.kind === 'area') { value = U.areaValue(r.value, r.scale).toFixed(4); unit = U.areaUnit(r.scale); per = U.lengthValue(r.perimeter, r.scale).toFixed(4); if (r.volume) { vol = U.volumeValue(r.volume, r.scale).toFixed(4); volU = U.volumeUnitName(r.scale); } }
      else if (r.kind === 'count') { value = r.value; unit = 'ea'; }
      else if (r.kind === 'angle') { value = r.value.toFixed(2); unit = 'deg'; }
    }
    const sc = scaleAt(m.page, m.pts[0]);
    rows.push([m.page + 1, d.pages[m.page].label || '', MK.TYPES[m.type].name, m.subject, m.type === 'stamp' ? m.text : (m.text || ''), m.comment, m.status, m.flag, m.author,
      new Date(m.modified || m.created).toLocaleString(), r ? r.text.replace('\n', ' / ') : '', value, unit, per, m.depth ? U.lengthValue(m.depth, sc).toFixed(3) + ' ' + U.lengthUnitName(sc) : '', vol, volU, r ? sc.label : '']);
  }
  return rows;
}
export async function exportCsv(d, list) {
  const rows = csvRows(d, list);
  const text = '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const bytes = new TextEncoder().encode(text);
  const name = d.name.replace(/\.pdf$/i, '') + ' - markups.csv';
  if (!desk) { download(name, bytes, 'text/csv'); return; }
  const r = await desk.saveAs(name, bytes, 'csv');
  if (r && r.saved) toast('Exported ' + r.name, 'ok');
}
export function browserOpen() {
  return new Promise(resolve => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.pdf'; i.multiple = true;
    i.onchange = async () => { const out = []; for (const f of i.files) out.push({ name: f.name, path: '', data: new Uint8Array(await f.arrayBuffer()) }); resolve(out); };
    i.click();
  });
}

// ---------------------------------------------------------------- recent files
export function addRecent(p) {
  let r = JSON.parse(localStorage.getItem('pd.recent') || '[]').filter(x => x.toLowerCase() !== p.toLowerCase());
  r.unshift(p); r = r.slice(0, 12); store('pd.recent', r); showRecent();
}
function recentList() { try { return JSON.parse(localStorage.getItem('pd.recent') || '[]'); } catch (e) { return []; } }
async function openRecent(p) {
  if (!desk) return;
  const f = await desk.readPath(p);
  if (f) openFiles([f]);
  else { toast('That file was moved or deleted.', 'err'); store('pd.recent', recentList().filter(x => x !== p)); showRecent(); }
}
export function showRecent() {
  const list = recentList();
  const el = $('#recent');
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="rh">Recent</div>' + list.map((p, i) => {
    const parts = p.split(/[\\/]/); const name = parts.pop();
    return `<button data-i="${i}">${esc(name)}<small>${esc(parts.slice(-2).join('\\'))}</small></button>`;
  }).join('');
  $$('button', el).forEach(b => b.onclick = () => openRecent(list[Number(b.dataset.i)]));
}
export function recentMenu() {
  const list = recentList();
  if (!list.length) return [{ label: 'No recent files', disabled: true }];
  return [...list.map(p => ({ label: p.split(/[\\/]/).pop(), act: () => openRecent(p) })), '-', { label: 'Clear list', act: () => { store('pd.recent', []); showRecent(); } }];
}

// ---------------------------------------------------------------- crash recovery
const recTimers = new Map();
export function queueRecovery(d) {
  if (!d.path) return;
  clearTimeout(recTimers.get(d.id));
  recTimers.set(d.id, setTimeout(() => { if (d.dirty) store('pd.rec:' + d.path.toLowerCase(), { t: Date.now(), data: snapshot(d) }); }, 1500));
}
export function clearRecovery(d) { if (d.path) { clearTimeout(recTimers.get(d.id)); localStorage.removeItem('pd.rec:' + d.path.toLowerCase()); } }
export async function checkRecovery(d) {
  if (!d.path) return;
  let rec = null;
  try { rec = JSON.parse(localStorage.getItem('pd.rec:' + d.path.toLowerCase())); } catch (e) { rec = null; }
  if (!rec || !rec.data || rec.data === snapshot(d)) return;
  if (d.mtime && rec.t < d.mtime) { clearRecovery(d); return; }
  const ok = await ask('Restore unsaved markups?', `Plan Desk closed before your last changes to ${d.name} were saved (${new Date(rec.t).toLocaleString()}). Restore them?`, 'Restore');
  if (ok) {
    change(dd => { const o = JSON.parse(rec.data); dd.markups = o.m; dd.scales = o.s || {}; dd.markups.forEach(m => { m._rev = 1; }); S.scaleRev++; }, d);
    toast('Markups restored — remember to save.', 'ok');
  } else clearRecovery(d);
}

// ---------------------------------------------------------------- scale
const PREC_DEC = [0, 1, 2, 3, 4];
const PREC_FRAC = [1, 2, 4, 8, 16, 32, 64];
function unitPrecisionHtml(sc) {
  const unit = sc.unit || 'm';
  return `<label>Show lengths in</label><select id="sUnit">${Object.entries(U.UNITS).map(([k, u]) => `<option value="${k}" ${k === unit ? 'selected' : ''}>${u.label}</option>`).join('')}</select>
  <label>Precision</label><select id="sPrec"></select>`;
}
function wirePrecision(body, sc) {
  const fill = () => {
    const u = $('#sUnit', body).value;
    const cur = $('#sPrec', body).value || String(sc.precision);
    $('#sPrec', body).innerHTML = u === 'ftin'
      ? PREC_FRAC.map(n => `<option value="${n}">${n === 1 ? 'nearest inch' : '1/' + n + '"'}</option>`).join('')
      : PREC_DEC.map(n => `<option value="${n}">${(1).toFixed(n).replace(/1$/, n ? '1' : '1')} (${n} decimals)</option>`).join('');
    const want = $$('option', $('#sPrec', body)).find(o => o.value === cur) ? cur : (u === 'ftin' ? '16' : u === 'm' ? '2' : u === 'mm' ? '0' : '2');
    $('#sPrec', body).value = want;
  };
  $('#sUnit', body).addEventListener('change', fill);
  fill();
}
function applyTargets(body, page, d) {
  const which = $('input[name=apply]:checked', body).value;
  if (which === 'page') return [page];
  if (which === 'all') return d.pages.map((_, i) => i);
  const txt = $('#sRange', body).value;
  const out = new Set();
  for (const part of txt.split(',')) {
    const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= d.pages.length) out.add(i - 1);
  }
  return [...out];
}
const applyHtml = page => `<label>Apply to</label><div><label><input type="radio" name="apply" value="page" checked> This page (${page + 1})</label><br>
  <label><input type="radio" name="apply" value="all"> All pages</label><br>
  <label><input type="radio" name="apply" value="range"> Pages <input id="sRange" placeholder="e.g. 1-5, 8" style="width:120px"></label></div>`;

export async function scaleDialog(page, viewportMarkup = null) {
  const d = S.doc; if (!d) return;
  const cur = viewportMarkup ? (viewportMarkup.scale || pageScale(d, page)) : pageScale(d, page);
  const sys = cur.label.includes("'") ? (cur.label.includes('=') && cur.label.includes('1"') ? 'eng' : 'arch') : 'metric';
  const metricN = (cur.label.match(/^1:(\d+(?:\.\d+)?)$/) || [])[1] || '100';
  const html = `
  <div class="seg" id="sys"><button data-s="metric">Metric 1:n</button><button data-s="arch">Architectural</button><button data-s="eng">Engineering</button><button data-s="custom">Custom</button></div>
  <div class="grid2">
    <label class="sm-metric">Scale 1 :</label><div class="sm-metric"><input id="sMetric" list="metricList" value="${esc(metricN)}" style="width:110px"><datalist id="metricList">${U.METRIC_PRESETS.map(n => `<option value="${n}">`).join('')}</datalist></div>
    <label class="sm-arch">Scale</label><select class="sm-arch" id="sArch">${U.ARCH_PRESETS.map(([l], i) => `<option value="${i}" ${l === cur.label ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <label class="sm-eng">Scale</label><select class="sm-eng" id="sEng">${U.ENG_PRESETS.map(n => `<option value="${n}" ${cur.label === '1" = ' + n + "'" ? 'selected' : ''}>1" = ${n}'</option>`).join('')}</select>
    <label class="sm-custom">On paper</label><div class="sm-custom"><input id="sPaper" value="1" style="width:70px"> <select id="sPaperU">${['mm', 'cm', 'in'].map(u => `<option>${u}</option>`).join('')}</select></div>
    <label class="sm-custom">Equals real</label><div class="sm-custom"><input id="sReal" value="100" style="width:70px"> <select id="sRealU">${['mm', 'cm', 'm', 'in', 'ft'].map(u => `<option ${u === 'mm' ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
    ${unitPrecisionHtml(cur.set ? cur : { unit: S.settings.defaultUnit || 'm', precision: 2 })}
    ${viewportMarkup ? '<label>Name</label><input id="sName" value="' + esc(viewportMarkup.subject || 'Scale Area') + '">' : applyHtml(page)}
  </div>
  <p class="small muted" style="margin-top:12px">${viewportMarkup ? 'Measurements that start inside this area use this scale.' : 'Tip: if the drawing has no reliable scale, use Calibrate and click a known dimension.'}</p>`;
  let system = sys;
  const r = await modal(viewportMarkup ? 'Scale for this area' : 'Page scale', html, [
    ...(viewportMarkup ? [] : [{ label: 'Calibrate instead', value: 'cal' }]),
    { label: 'Cancel', value: null },
    { label: 'Apply', primary: true, value: body => {
      const unit = $('#sUnit', body).value, prec = Number($('#sPrec', body).value);
      let sc;
      if (system === 'metric') { const n = parseFloat($('#sMetric', body).value); if (!(n > 0)) return null; sc = U.metricScale(n, unit, prec); }
      else if (system === 'arch') { const [l, v] = U.ARCH_PRESETS[Number($('#sArch', body).value)]; sc = U.archScale(l, v, unit, prec); }
      else if (system === 'eng') sc = U.engScale(Number($('#sEng', body).value), unit, prec);
      else { const a = parseFloat($('#sPaper', body).value), b = parseFloat($('#sReal', body).value); if (!(a > 0 && b > 0)) return null; sc = U.customScale(a, $('#sPaperU', body).value, b, $('#sRealU', body).value, unit, prec); }
      return { sc, pages: viewportMarkup ? null : applyTargets(body, page, d), name: viewportMarkup ? $('#sName', body).value : null };
    } }
  ], body => {
    const show = s => { system = s; $$('#sys button', body).forEach(b => b.classList.toggle('on', b.dataset.s === s)); for (const k of ['metric', 'arch', 'eng', 'custom']) $$('.sm-' + k, body).forEach(e => e.style.display = k === s ? '' : 'none'); };
    $$('#sys button', body).forEach(b => b.onclick = () => { show(b.dataset.s); if (b.dataset.s === 'arch' || b.dataset.s === 'eng') { $('#sUnit', body).value = b.dataset.s === 'arch' ? 'ftin' : 'ft'; $('#sUnit', body).dispatchEvent(new Event('change')); } });
    show(sys === 'metric' && cur.set && !/^1:/.test(cur.label) ? 'custom' : sys);
    wirePrecision(body, cur.set ? cur : { precision: 2 });
  });
  if (r === 'cal') { setTool('calibrate'); return; }
  if (!r || !r.sc) return;
  change(dd => {
    if (viewportMarkup) { viewportMarkup.scale = r.sc; viewportMarkup.subject = r.name || 'Scale Area'; touch(viewportMarkup); }
    else for (const i of r.pages) dd.scales[i] = { ...r.sc };
    if (!viewportMarkup) S.settings.defaultUnit = r.sc.unit, saveSettings();
    S.scaleRev++;
  });
  updateStatus();
  toast('Scale set: ' + r.sc.label + (r.pages && r.pages.length > 1 ? ' on ' + r.pages.length + ' pages' : ''), 'ok');
}

export async function calibrateDialog(page, ptsLen) {
  const d = S.doc; if (!d) return;
  const cur = pageScale(d, page);
  const unit0 = cur.set ? cur.unit : (S.settings.defaultUnit || 'm');
  const html = `<p>You picked a line ${(ptsLen * 25.4 / 72).toFixed(1)} mm long on the paper. What is its real length?</p>
  <div class="grid2">
    <label>Real length</label><div><input id="cLen" style="width:130px" placeholder="${unit0 === 'ftin' ? "e.g. 12'-6\"" : 'e.g. 6.5'}"> <select id="cUnit">${Object.entries(U.UNITS).map(([k, u]) => `<option value="${k}" ${k === unit0 ? 'selected' : ''}>${u.label}</option>`).join('')}</select></div>
    ${unitPrecisionHtml({ unit: unit0, precision: cur.set ? cur.precision : 2 })}
    ${applyHtml(page)}
  </div>`;
  const r = await modal('Calibrate scale', html, [{ label: 'Cancel', value: null }, { label: 'Apply', primary: true, value: body => {
    const realM = U.parseLength($('#cLen', body).value, $('#cUnit', body).value);
    if (!(realM > 0)) return { err: true };
    return { sc: U.calibratedScale(ptsLen, realM, $('#sUnit', body).value, Number($('#sPrec', body).value)), pages: applyTargets(body, page, d) };
  } }], body => {
    wirePrecision(body, { precision: cur.set ? cur.precision : 2 });
    $('#cUnit', body).addEventListener('change', () => { $('#sUnit', body).value = $('#cUnit', body).value; $('#sUnit', body).dispatchEvent(new Event('change')); });
  });
  if (!r) { setTool('select'); return; }
  if (r.err) { toast('Type the real length, for example 6.5 or 12\'-6"', 'err'); return; }
  change(dd => { for (const i of r.pages) dd.scales[i] = { ...r.sc }; S.scaleRev++; });
  S.settings.defaultUnit = r.sc.unit; saveSettings();
  updateStatus();
  setTool('select');
  toast('Calibrated: ' + r.sc.label, 'ok');
}

// ---------------------------------------------------------------- stamps, status
export function stampChoiceHtml(text, sub) {
  return `<div class="grid2"><label>Stamp</label><select id="stSel">${MK.STAMPS.map((s, i) => `<option value="${i}" ${s.text === text ? 'selected' : ''}>${esc(s.text)}</option>`).join('')}<option value="custom" ${MK.STAMPS.some(s => s.text === text) ? '' : 'selected'}>Custom…</option></select>
  <label>Text</label><input id="stText" value="${esc(text)}">
  <label>Second line</label><div style="display:flex;gap:6px"><input id="stSub" value="${esc(sub || '')}" style="flex:1"><button class="ghost" id="stMe" type="button">Name + date</button></div></div>`;
}
export function wireStamp(body) {
  $('#stSel', body).onchange = () => { const v = $('#stSel', body).value; if (v !== 'custom') $('#stText', body).value = MK.STAMPS[Number(v)].text; };
  $('#stMe', body).onclick = () => { $('#stSub', body).value = (S.settings.author ? S.settings.author + '  ' : '') + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
}
export async function stampTextDialog(m) {
  const r = await modal('Stamp', stampChoiceHtml(m.text, m.stampSub), [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: b => ({ text: $('#stText', b).value || 'APPROVED', sub: $('#stSub', b).value, sel: $('#stSel', b).value }) }], wireStamp);
  if (!r) return;
  change(() => {
    m.text = r.text; m.stampSub = r.sub;
    const st = MK.STAMPS.find(s => s.text === r.text);
    if (st) m.style.stroke = m.style.textColor = st.color;
    touch(m);
  });
}
export async function statusDialog() {
  const d = S.doc; if (!d) return;
  const sel = d.markups.filter(m => d.sel.has(m.id));
  const r = await modal('Set status', `<div class="grid2"><label>Status</label><select id="stv">${MK.STATUSES.map(s => `<option value="${s}">${s || 'None'}</option>`).join('')}</select></div>`, [{ label: 'Cancel', value: null }, { label: 'Set', primary: true, value: b => $('#stv', b).value }]);
  if (r == null) return;
  change(() => sel.forEach(m => { m.status = r; touch(m); }));
}

// ---------------------------------------------------------------- context menus
export function markupMenu() {
  const d = S.doc;
  const sel = d.markups.filter(m => d.sel.has(m.id));
  const one = sel.length === 1 ? sel[0] : null;
  const setAll = fn => change(() => sel.forEach(m => { fn(m); touch(m); }));
  return [
    one && (MK.TYPES[one.type].text || one.type === 'stamp') ? { label: 'Edit text', act: () => editText(one) } : null,
    one && one.type === 'viewport' ? { label: 'Scale for this area…', act: () => scaleDialog(one.page, one) } : null,
    { label: 'Status', sub: MK.STATUSES.map(s => ({ label: s || 'None', checked: one && one.status === s, act: () => setAll(m => { m.status = s; }) })) },
    { label: 'Flag', sub: MK.FLAGS.map(f => ({ label: f ? f[0].toUpperCase() + f.slice(1) : 'No flag', checked: one && one.flag === f, act: () => setAll(m => { m.flag = f; }) })) },
    '-',
    { label: 'Bring to front', act: () => change(dd => { dd.markups = [...dd.markups.filter(m => !dd.sel.has(m.id)), ...sel]; }) },
    { label: 'Send to back', act: () => change(dd => { dd.markups = [...sel, ...dd.markups.filter(m => !dd.sel.has(m.id))]; }) },
    { label: one && one.locked ? 'Unlock' : 'Lock', act: () => setAll(m => { m.locked = !(one && one.locked); }) },
    '-',
    { label: 'Copy', key: KS.labelFor('edit.copy'), act: () => run('edit.copy') },
    { label: 'Duplicate', key: KS.labelFor('edit.duplicate'), act: () => run('edit.duplicate') },
    { label: 'Delete', key: KS.labelFor('edit.delete'), act: () => run('edit.delete') },
    '-',
    one ? { label: 'Add to My Tools', act: () => P.addToMyTools(one) } : null,
    one ? { label: 'Use this look for new ' + MK.TYPES[one.type].name + ' markups', act: () => { S.toolStyles[one.type] = JSON.parse(JSON.stringify(one.style)); saveToolStyles(); buildToolbar(); toast('Saved as the default look', 'ok'); } } : null,
    { label: 'Properties', act: () => { if (!S.settings.rightOn) run('panel.right'); } }
  ].filter(Boolean);
}
export function pageMenu(hit) {
  return [
    { label: 'Paste', key: KS.labelFor('edit.paste'), disabled: !S.clip, act: () => run('edit.paste') },
    { label: 'Add bookmark here', act: () => P.addBookmarkHere(hit) },
    { label: 'Set page scale…', act: () => scaleDialog(hit ? hit.i : currentPage()) },
    '-',
    { label: 'Fit page', key: KS.labelFor('view.fitpage'), act: () => fitPage(hit ? hit.i : undefined) },
    { label: 'Select tool', act: () => setTool('select') }
  ];
}

// ---------------------------------------------------------------- keyboard shortcuts editor
export async function shortcutsDialog() {
  let capturing = null;
  const render = body => {
    const q = ($('#ksFind', body).value || '').toLowerCase();
    let g = '', html = '';
    for (const [group, id, label] of KS.ACTIONS) {
      const keys = KS.keysFor(id);
      if (q && !label.toLowerCase().includes(q) && !keys.join(' ').toLowerCase().includes(q)) continue;
      if (group !== g) { g = group; html += `<tr><td class="g" colspan="3">${esc(group)}</td></tr>`; }
      html += `<tr><td>${esc(label)}</td><td>${keys.map((k, i) => `<span class="kb">${esc(k)}<span class="rm" data-id="${id}" data-i="${i}" title="Remove">×</span></span>`).join('')}</td>
        <td style="text-align:right;white-space:nowrap"><button data-add="${id}" class="${capturing === id ? 'capturing' : ''}">${capturing === id ? 'Press keys…' : '+ Key'}</button> <button data-reset="${id}" title="Back to default">↺</button></td></tr>`;
    }
    $('#ksTable', body).innerHTML = html;
    $$('[data-add]', body).forEach(b => b.onclick = () => { capturing = b.dataset.add; render(body); });
    $$('[data-reset]', body).forEach(b => b.onclick = () => { KS.resetOne(b.dataset.reset); render(body); });
    $$('.rm', body).forEach(b => b.onclick = () => { const k = KS.keysFor(b.dataset.id).slice(); k.splice(Number(b.dataset.i), 1); KS.setKeys(b.dataset.id, k); render(body); });
  };
  let bodyRef = null;
  const onKey = e => {
    if (!capturing || !bodyRef) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === 'Escape') { capturing = null; render(bodyRef); return; }
    const combo = KS.comboFromEvent(e);
    if (!combo) return;
    const clash = KS.conflicts(combo, capturing);
    if (clash.length) {
      // move the key: remove it from the other command
      for (const a of KS.ACTIONS) if (a[1] !== capturing && KS.keysFor(a[1]).includes(combo)) KS.setKeys(a[1], KS.keysFor(a[1]).filter(k => k !== combo));
      toast(combo + ' moved from: ' + clash.join(', '));
    }
    const keys = KS.keysFor(capturing).slice();
    if (!keys.includes(combo)) keys.push(combo);
    KS.setKeys(capturing, keys);
    capturing = null; render(bodyRef);
  };
  window.addEventListener('keydown', onKey, true);
  await modal('Keyboard shortcuts', `<div style="display:flex;gap:8px;margin-bottom:8px"><input id="ksFind" placeholder="Search commands or keys" style="flex:1" data-nokey="1">
    <button class="ghost" id="ksExport">Export</button><button class="ghost" id="ksImport">Import</button><button class="ghost" id="ksReset">Reset all</button></div>
    <div style="width:640px;max-width:80vw"><table class="keys" id="ksTable"></table></div>`, [{ label: 'Done', value: true, primary: true }], body => {
    bodyRef = body;
    render(body);
    $('#ksFind', body).oninput = () => render(body);
    $('#ksReset', body).onclick = async () => { KS.resetAll(); render(body); };
    $('#ksExport', body).onclick = async () => {
      const bytes = new TextEncoder().encode(JSON.stringify({ shortcuts: KS.exportAll() }, null, 2));
      if (desk) await desk.saveAs('Plan Desk shortcuts.json', bytes, 'json'); else download('Plan Desk shortcuts.json', bytes, 'application/json');
    };
    $('#ksImport', body).onclick = async () => {
      const txt = desk ? await desk.openJson() : null;
      if (!txt) return;
      try { const o = JSON.parse(txt); KS.importAll(o.shortcuts || o); render(body); toast('Shortcuts imported', 'ok'); } catch (e) { toast('That file is not a shortcuts file', 'err'); }
    };
  });
  window.removeEventListener('keydown', onKey, true);
  buildToolbar();
}

// ---------------------------------------------------------------- settings, about, tips
export async function settingsDialog() {
  const s = S.settings;
  const r = await modal('Settings', `<div class="grid2">
    <label>Your name</label><input id="stA" value="${esc(s.author)}" placeholder="Shown as the author of your markups">
    <label>Mouse wheel</label><select id="stW"><option value="zoom" ${s.wheel === 'zoom' ? 'selected' : ''}>Zoom (like Bluebeam) — Ctrl+wheel scrolls</option><option value="scroll" ${s.wheel === 'scroll' ? 'selected' : ''}>Scroll — Ctrl+wheel zooms</option></select>
    <label>Snap distance</label><div><input id="stR" type="number" min="4" max="40" value="${s.snapRadius}" style="width:70px"> screen pixels</div>
    <label>After drawing</label><select id="stRt"><option value="0" ${!s.returnToSelect ? 'selected' : ''}>Keep the tool active</option><option value="1" ${s.returnToSelect ? 'selected' : ''}>Go back to Select</option></select>
    <label>Updates</label><label><input type="checkbox" id="stU" ${s.autoUpdate ? 'checked' : ''}> Check for updates when Plan Desk starts</label>
  </div>`, [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: b => ({ author: $('#stA', b).value.trim(), wheel: $('#stW', b).value, snapRadius: Math.max(4, Math.min(40, Number($('#stR', b).value) || 12)), returnToSelect: $('#stRt', b).value === '1', autoUpdate: $('#stU', b).checked }) }]);
  if (!r) return;
  Object.assign(S.settings, r); saveSettings();
  toast('Settings saved', 'ok');
}
export async function askAuthor() {
  const v = await prompt('Welcome to Plan Desk', 'Your name (shown as the author of markups)', '');
  if (v != null) { S.settings.author = v.trim(); saveSettings(); }
}
export async function aboutDialog() {
  const v = desk ? await desk.version() : 'browser preview';
  modal('About Plan Desk', `<p><b>Plan Desk</b> ${esc(v)}</p><p>Drawing review, markups and takeoffs for PDF drawings. Works offline. Markups are saved inside the PDF, so Bluebeam, Acrobat and web browsers can show them too.</p>`, [{ label: 'Close', value: true, primary: true }]);
}
export function tipsDialog() {
  const k = id => esc(KS.labelFor(id) || '—');
  modal('Mouse & tips', `<table class="keys" style="width:560px">
    <tr><td>Mouse wheel</td><td>${S.settings.wheel === 'zoom' ? 'Zoom at the cursor (Ctrl+wheel scrolls, Shift+wheel scrolls sideways)' : 'Scroll (Ctrl+wheel zooms)'}</td></tr>
    <tr><td>Double-click the wheel</td><td>Fit page (zoom extents)</td></tr>
    <tr><td>Hold the wheel and drag</td><td>Pan</td></tr>
    <tr><td>Hold Space and drag</td><td>Pan</td></tr>
    <tr><td>Shift while drawing</td><td>Straight lines in 45° steps; squares for boxes</td></tr>
    <tr><td>Snap (${k('toggle.snap')})</td><td>Snaps to line ends ▢, middles △, crossings ✕ and along lines ⧖ in the drawing</td></tr>
    <tr><td>Ortho (${k('toggle.ortho')})</td><td>Horizontal and vertical lines only</td></tr>
    <tr><td>Right-click while drawing</td><td>Finish a polyline, polygon, area or cloud</td></tr>
    <tr><td>Drag on empty space</td><td>Select markups in a box (right to left selects anything it touches)</td></tr>
    <tr><td>Alt + drag a markup</td><td>Copy it</td></tr>
    <tr><td>Arrow keys</td><td>Nudge selected markups (Shift = 10×)</td></tr>
  </table>`, [{ label: 'Close', value: true, primary: true }]);
}

// ---------------------------------------------------------------- updates
let updateInfo = null;
export function initUpdates() {
  desk.onUpdateClicked(() => showUpdate());
  desk.onUpdateProgress(p => { const bar = $('#updBar'); if (bar) bar.style.width = Math.round(p) + '%'; });
  $('#updateChip').onclick = () => showUpdate();
  // what's new after an update
  desk.version().then(v => {
    let pending = null; try { pending = JSON.parse(localStorage.getItem('pd.pendingNotes')); } catch (e) { pending = null; }
    if (pending && pending.version === v) {
      localStorage.removeItem('pd.pendingNotes');
      modal('Plan Desk updated to ' + v, `<p>What's new:</p><div class="notes">${esc(pending.notes || 'Improvements and fixes.')}</div>`, [{ label: 'Great', value: true, primary: true }]);
    }
  });
  if (S.settings.autoUpdate) setTimeout(() => checkUpdates(false), 5000);
  setInterval(() => { if (S.settings.autoUpdate) checkUpdates(false); }, 6 * 3600 * 1000);
}
export async function checkUpdates(manual) {
  if (!desk) { if (manual) toast('Updates work in the installed Windows app.'); return; }
  let r;
  try { r = await desk.checkUpdate(); } catch (e) { if (manual) toast('Could not check for updates — are you online?', 'err'); return; }
  if (r.dev) { if (manual) toast('Update checks run in the installed app.'); return; }
  if (!r.available) { if (manual) toast('You have the latest version.', 'ok'); return; }
  updateInfo = r;
  const chip = $('#updateChip'); chip.textContent = 'Update ' + r.version; chip.classList.remove('hidden');
  if (localStorage.getItem('pd.notified') !== r.version) { desk.notifyUpdate(r.version, r.notes); localStorage.setItem('pd.notified', r.version); }
  if (manual) showUpdate();
}
async function showUpdate() {
  if (!updateInfo) { await checkUpdates(true); return; }
  const r = updateInfo;
  await modal('Plan Desk ' + r.version + ' is available', `<p>What's new:</p><div class="notes">${esc(r.notes || 'Improvements and fixes.')}</div><div class="progress"><div id="updBar"></div></div><p class="small muted" id="updMsg"></p>`,
    [{ label: 'Later', value: null }, { label: 'Download and install', primary: true, validate: body => {
      const btn = $$('.dfoot button', body.parentElement).pop();
      if (btn.dataset.state === 'ready') { saveOpenWork().then(() => { store('pd.pendingNotes', { version: r.version, notes: r.notes }); desk.installUpdate(); }); return false; }
      if (btn.dataset.state === 'busy') return false;
      btn.dataset.state = 'busy'; btn.textContent = 'Downloading…';
      $('#updMsg', body).textContent = 'Downloading the update. You can keep working.';
      desk.downloadUpdate().then(() => { btn.dataset.state = 'ready'; btn.textContent = 'Restart and install'; $('#updMsg', body).textContent = 'Ready. Plan Desk will close, update and reopen.'; $('#updBar').style.width = '100%'; })
        .catch(e => { btn.dataset.state = ''; btn.textContent = 'Try again'; $('#updMsg', body).textContent = 'Download failed: ' + (e.message || e); });
      return false;
    } }]);
}
async function saveOpenWork() {
  for (const d of S.docs) if (d.dirty) {
    const ok = await ask('Save before updating?', 'Save your markups in ' + d.name + ' before Plan Desk restarts?', 'Save');
    if (ok) await save(d);
  }
}
