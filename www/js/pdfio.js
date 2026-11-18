// Reading and writing markups inside the PDF itself.
// Each markup is saved as a real PDF annotation with its own appearance (so Bluebeam, Acrobat and browsers show it),
// and the full editable details are kept in the PDF under /PlanDeskData so Plan Desk can reopen them for editing.
import { primitives } from './markups.js';
import { invert, apply, cmdsBBox } from './geom.js';

const L = () => globalThis.PDFLib;
const DATA_KEY = 'PlanDeskData';
const ID_KEY = 'PlanDeskId';

function stripOurAnnots(pdfDoc) {
  const { PDFName, PDFArray, PDFDict } = L();
  let removed = 0;
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookup(i);
      if (a instanceof PDFDict && a.get(PDFName.of(ID_KEY))) { annots.remove(i); removed++; }
    }
  }
  return removed;
}

function readData(pdfDoc) {
  const { PDFName, PDFRawStream, decodePDFRawStream } = L();
  const s = pdfDoc.catalog.lookup(PDFName.of(DATA_KEY));
  if (!s || !(s instanceof PDFRawStream || s.getContents)) return null;
  try {
    const bytes = s.dict.get(PDFName.of('Filter')) ? decodePDFRawStream(s).decode() : s.getContents();
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) { console.warn('Could not read Plan Desk data', e); return null; }
}

// Returns the bytes to show (without our own annotations, which Plan Desk draws itself), plus saved data
export async function openForView(bytes) {
  let pdfDoc;
  try {
    pdfDoc = await L().PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return { viewBytes: bytes, data: null, saveable: false, reason: /encrypt/i.test(String(e && e.message)) ? 'This PDF is password-protected, so markups cannot be saved into it. Use Export → Markups summary (CSV), or ask for an unlocked copy.' : 'This PDF could not be opened for saving (' + (e && e.message || 'unknown problem') + ').' };
  }
  const data = readData(pdfDoc);
  const removed = stripOurAnnots(pdfDoc);
  if (!removed) return { viewBytes: bytes, data, saveable: true };
  const viewBytes = await pdfDoc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  return { viewBytes, data, saveable: true };
}

// ---------- PDF content operators from primitives
const n = v => (Math.round(v * 1000) / 1000).toString();
function rgb(hex) {
  const h = String(hex || '#000').replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255);
}
const rgbOp = (hex, op) => rgb(hex).map(n).join(' ') + ' ' + op;

class OpsWriter {
  constructor(fonts) { this.parts = []; this.gs = new Map(); this.fonts = fonts; }
  gsName(ca, CA) {
    const k = n(ca) + '/' + n(CA);
    if (!this.gs.has(k)) this.gs.set(k, { name: 'G' + this.gs.size, ca, CA });
    return this.gs.get(k).name;
  }
  path(cmds) {
    for (const c of cmds) {
      if (c[0] === 'M') this.parts.push(`${n(c[1])} ${n(c[2])} m`);
      else if (c[0] === 'L') this.parts.push(`${n(c[1])} ${n(c[2])} l`);
      else if (c[0] === 'C') this.parts.push(`${n(c[1])} ${n(c[2])} ${n(c[3])} ${n(c[4])} ${n(c[5])} ${n(c[6])} c`);
      else if (c[0] === 'Z') this.parts.push('h');
    }
  }
  prim(p) {
    const P = this.parts;
    if (p.k === 'path') {
      const hasFill = !!p.fill, hasStroke = !!p.stroke && p.width > 0;
      if (!hasFill && !hasStroke) return;
      const op = p.opacity == null ? 1 : p.opacity;
      // fill and stroke can have different opacity, so draw them separately when needed
      if (hasFill) {
        P.push('q', `/${this.gsName(op * (p.fillOpacity == null ? 1 : p.fillOpacity), op)} gs`, rgbOp(p.fill, 'rg'));
        this.path(p.cmds); P.push('f', 'Q');
      }
      if (hasStroke) {
        P.push('q', `/${this.gsName(op, op)} gs`, rgbOp(p.stroke, 'RG'), `${n(p.width)} w`);
        P.push(`${p.cap === 'round' ? 1 : p.cap === 'square' ? 2 : 0} J`, `${p.join === 'round' ? 1 : 0} j`);
        if (p.dash && p.dash.length) P.push(`[${p.dash.map(n).join(' ')}] 0 d`);
        this.path(p.cmds); P.push('S', 'Q');
      }
    } else if (p.k === 'text') {
      const font = p.bold ? this.fonts.bold : this.fonts.regular;
      const name = p.bold ? 'F2' : 'F1';
      const text = safeText(font, p.text);
      if (!text) return;
      const w = font.widthOfTextAtSize(text, p.size);
      const x = p.align === 'center' ? p.x - w / 2 : p.align === 'right' ? p.x - w : p.x;
      const op = p.opacity == null ? 1 : p.opacity;
      // the page matrix flips y, so flip the text back upright
      P.push('q', `/${this.gsName(op, op)} gs`, 'BT', rgbOp(p.color || '#000', 'rg'), `/${name} ${n(p.size)} Tf`, `1 0 0 -1 ${n(x)} ${n(p.y)} Tm`, `${font.encodeText(text).toString()} Tj`, 'ET', 'Q');
    }
  }
  resources(ctx) {
    const { PDFName } = L();
    const ext = {};
    for (const g of this.gs.values()) ext[g.name] = ctx.obj({ Type: 'ExtGState', ca: g.ca, CA: g.CA });
    return ctx.obj({ Font: ctx.obj({ F1: this.fonts.regular.ref, F2: this.fonts.bold.ref }), ExtGState: ctx.obj(ext) });
  }
}
function safeText(font, text) {
  // Helvetica covers Latin text only; replace characters it cannot draw
  let out = '';
  for (const ch of String(text)) {
    try { font.encodeText(ch); out += ch; } catch (e) { out += '?'; }
  }
  return out;
}

const SUBTYPE = {
  pen: 'Ink', highlight: 'Ink', line: 'Line', arrow: 'Line', length: 'Line', polyline: 'PolyLine', polylength: 'PolyLine', angle: 'PolyLine',
  rect: 'Square', viewport: 'Square', text: 'FreeText', callout: 'FreeText', ellipse: 'Circle', radius: 'Circle', polygon: 'Polygon', triangle: 'Polygon',
  cloud: 'Polygon', area: 'Polygon', perimeter: 'Polygon', note: 'Text', stamp: 'Stamp', count: 'Stamp'
};

function pdfDate(t) {
  const d = new Date(t || Date.now());
  const p = v => String(v).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// state: { markups, pageTransforms[i] (pdf→page points), scaleAt, measure, data (object saved as JSON), bookmarks|null }
export async function savePdf(fileBytes, state, { flatten = false } = {}) {
  const { PDFDocument, StandardFonts, PDFName, PDFHexString, PDFString, PDFArray } = L();
  const pdfDoc = await PDFDocument.load(fileBytes, { updateMetadata: false });
  stripOurAnnots(pdfDoc);
  const ctx = pdfDoc.context;
  const fonts = { regular: await pdfDoc.embedFont(StandardFonts.Helvetica), bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold) };
  const pages = pdfDoc.getPages();
  const flatByPage = new Map();

  for (const m of state.markups) {
    const page = pages[m.page];
    if (!page || !m.pts || !m.pts.length) continue;
    if (m.type === 'viewport' && !flatten) { /* scale areas are kept in the data only */ }
    const vt = state.pageTransforms[m.page];
    const inv = invert(vt); // page points → PDF space
    const prims = primitives(m, state.scaleAt, state.measure);
    if (!prims.length) continue;
    // bounding box in PDF space
    let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
    const grow = (x, y) => { const [X, Y] = apply(inv, x, y); bx1 = Math.min(bx1, X); by1 = Math.min(by1, Y); bx2 = Math.max(bx2, X); by2 = Math.max(by2, Y); };
    for (const p of prims) {
      if (p.k === 'path') { const b = cmdsBBox(p.cmds); const pad = (p.width || 0) + 1; grow(b.x1 - pad, b.y1 - pad); grow(b.x2 + pad, b.y2 + pad); grow(b.x1 - pad, b.y2 + pad); grow(b.x2 + pad, b.y1 - pad); }
      else { const w = fonts.bold.widthOfTextAtSize(safeText(fonts.bold, p.text), p.size); const x = p.align === 'center' ? p.x - w / 2 : p.x; grow(x - 1, p.y - p.size * 1.1); grow(x + w + 1, p.y + p.size * 0.4); grow(x - 1, p.y + p.size * 0.4); grow(x + w + 1, p.y - p.size * 1.1); }
    }
    if (!isFinite(bx1)) continue;
    const w = new OpsWriter(fonts);
    w.parts.push('q', inv.map(n).join(' ') + ' cm');
    for (const p of prims) w.prim(p);
    w.parts.push('Q');
    const content = w.parts.join('\n');
    if (flatten) {
      if (m.type === 'viewport' || m.hidden) continue;
      if (!flatByPage.has(m.page)) flatByPage.set(m.page, []);
      flatByPage.get(m.page).push({ content, res: w });
      continue;
    }
    const form = ctx.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: [bx1, by1, bx2, by2], Resources: w.resources(ctx) });
    const apRef = ctx.register(form);
    const P = m.pts.map(p => apply(inv, p[0], p[1]));
    const sub = SUBTYPE[m.type] || 'Square';
    const dict = {
      Type: 'Annot', Subtype: sub, Rect: [bx1, by1, bx2, by2], F: m.hidden ? 4 | 2 : 4,
      C: rgb(m.style.stroke || m.style.fill || '#E5484D'), CA: m.style.opacity == null ? 1 : m.style.opacity,
      AP: ctx.obj({ N: apRef }), M: PDFString.of(pdfDate(m.modified)), CreationDate: PDFString.of(pdfDate(m.created)),
      NM: PDFHexString.fromText(m.id), Subj: PDFHexString.fromText(m.subject || ''),
      T: PDFHexString.fromText(m.author || ''), Contents: PDFHexString.fromText(contentsText(m, state)),
      [ID_KEY]: PDFHexString.fromText(m.id)
    };
    if (sub === 'Line') dict.L = [P[0][0], P[0][1], (P[1] || P[0])[0], (P[1] || P[0])[1]];
    if (sub === 'PolyLine' || sub === 'Polygon') dict.Vertices = [].concat(...(m.type === 'cloud' && P.length === 2 ? rectCorners(P) : P));
    if (sub === 'Ink') dict.InkList = ctx.obj([ctx.obj([].concat(...P))]);
    if (sub === 'FreeText') dict.DA = PDFString.of(`/Helv ${n(m.style.fontSize || 12)} Tf ${rgb(m.style.textColor).map(n).join(' ')} rg`);
    if (sub === 'Text') dict.Name = 'Comment';
    if (sub === 'Stamp') dict.Name = PDFName.of(m.type === 'count' ? 'Count' : 'Approved');
    if (m.type === 'cloud') dict.BE = ctx.obj({ S: 'C', I: 1 });
    if (m.style.fill && ['Square', 'Circle', 'Polygon'].includes(sub)) dict.IC = rgb(m.style.fill);
    const ref = ctx.register(ctx.obj(dict));
    let annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) { annots = ctx.obj([]); page.node.set(PDFName.of('Annots'), annots); }
    annots.push(ref);
  }

  if (flatten) {
    for (const [pi, items] of flatByPage) {
      const page = pages[pi];
      page.node.normalize();
      const ops = [];
      items.forEach((it, i) => {
        const pageBox = page.getMediaBox();
        const form = ctx.stream(it.content, { Type: 'XObject', Subtype: 'Form', BBox: [pageBox.x - 1e5, pageBox.y - 1e5, pageBox.x + 1e5, pageBox.y + 1e5], Resources: it.res.resources(ctx) });
        const name = page.node.newXObject('PlanDesk', ctx.register(form));
        ops.push(`q /${name.asString().slice(1)} Do Q`);
      });
      const start = ctx.register(ctx.stream('q'));
      const end = ctx.register(ctx.stream('Q\n' + ops.join('\n')));
      page.node.wrapContentStreams(start, end);
    }
  } else {
    pdfDoc.catalog.set(PDFName.of(DATA_KEY), ctx.register(ctx.flateStream(new TextEncoder().encode(JSON.stringify(state.data)))));
  }
  if (state.bookmarks) writeOutline(pdfDoc, state.bookmarks, state.pageTransforms);
  return await pdfDoc.save({ updateFieldAppearances: false });
}
function rectCorners(P) { return [[P[0][0], P[0][1]], [P[1][0], P[0][1]], [P[1][0], P[1][1]], [P[0][0], P[1][1]]]; }
function contentsText(m, state) {
  const parts = [];
  if (m.text && m.type !== 'stamp') parts.push(m.text);
  if (m.comment) parts.push(m.comment);
  if (m._measureText) parts.push(m._measureText.replace('\n', ', '));
  return parts.join('\n');
}

// bookmarks: [{title, page, y, children}] (y in page points from the top, or null)
function writeOutline(pdfDoc, bookmarks, pageTransforms) {
  const { PDFName, PDFHexString, PDFNull } = L();
  const ctx = pdfDoc.context;
  const pages = pdfDoc.getPages();
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  const build = (items, parentRef, parentDict) => {
    const refs = items.map(() => ctx.nextRef());
    let total = 0;
    items.forEach((b, i) => {
      const d = ctx.obj({ Title: PDFHexString.fromText(b.title || 'Untitled'), Parent: parentRef });
      if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < items.length - 1) d.set(PDFName.of('Next'), refs[i + 1]);
      if (b.page != null && pages[b.page]) {
        const inv = invert(pageTransforms[b.page]);
        const top = b.y != null ? apply(inv, b.x || 0, b.y) : null;
        d.set(PDFName.of('Dest'), ctx.obj([pages[b.page].ref, PDFName.of('XYZ'), top ? top[0] : PDFNull, top ? top[1] : PDFNull, PDFNull]));
      }
      let count = 0;
      if (b.children && b.children.length) count = build(b.children, refs[i], d);
      if (count) d.set(PDFName.of('Count'), ctx.obj(b.open === false ? -count : count));
      ctx.assign(refs[i], d);
      total += 1 + (b.open === false ? 0 : count);
    });
    if (refs.length) { parentDict.set(PDFName.of('First'), refs[0]); parentDict.set(PDFName.of('Last'), refs[refs.length - 1]); }
    return total;
  };
  const count = build(bookmarks, rootRef, root);
  root.set(PDFName.of('Count'), ctx.obj(count));
  if (bookmarks.length) pdfDoc.catalog.set(PDFName.of('Outlines'), rootRef);
  else pdfDoc.catalog.delete(PDFName.of('Outlines'));
}
