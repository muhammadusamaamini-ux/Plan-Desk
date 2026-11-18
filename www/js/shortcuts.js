// Keyboard shortcuts: defaults (Bluebeam/AutoCAD style) that the person can change. Stored in localStorage.
export const ACTIONS = [
  // group, id, label, default keys
  ['Tools', 'tool.select', 'Select', ['V']],
  ['Tools', 'tool.pan', 'Pan', ['Shift+V']],
  ['Tools', 'tool.zoomrect', 'Zoom window', ['Z']],
  ['Markup', 'tool.pen', 'Pen', ['Alt+P']],
  ['Markup', 'tool.highlight', 'Highlighter', ['H']],
  ['Markup', 'tool.line', 'Line', ['L']],
  ['Markup', 'tool.arrow', 'Arrow', ['A']],
  ['Markup', 'tool.polyline', 'Polyline', ['N']],
  ['Markup', 'tool.rect', 'Rectangle', ['R']],
  ['Markup', 'tool.ellipse', 'Ellipse', ['E']],
  ['Markup', 'tool.polygon', 'Polygon', ['P']],
  ['Markup', 'tool.triangle', 'Triangle', ['T']],
  ['Markup', 'tool.cloud', 'Cloud (click points)', ['C']],
  ['Markup', 'tool.rectcloud', 'Rectangle cloud', ['Shift+C']],
  ['Markup', 'tool.text', 'Text box', ['W']],
  ['Markup', 'tool.callout', 'Callout', ['Q']],
  ['Markup', 'tool.note', 'Note', ['Shift+N']],
  ['Markup', 'tool.stamp', 'Stamp', ['S']],
  ['Measure', 'tool.calibrate', 'Calibrate scale', ['K']],
  ['Measure', 'tool.length', 'Length', ['Shift+Alt+L']],
  ['Measure', 'tool.polylength', 'Polylength', ['Shift+Alt+P']],
  ['Measure', 'tool.area', 'Area', ['Shift+Alt+A']],
  ['Measure', 'tool.rectarea', 'Rectangle area', ['Shift+Alt+R']],
  ['Measure', 'tool.perimeter', 'Perimeter', ['Shift+Alt+E']],
  ['Measure', 'tool.count', 'Count', ['Shift+Alt+C']],
  ['Measure', 'tool.angle', 'Angle', ['Shift+Alt+G']],
  ['Measure', 'tool.radius', 'Radius / diameter', ['Shift+Alt+D']],
  ['Measure', 'tool.viewport', 'Scale area (different scale on part of a sheet)', ['Shift+Alt+V']],
  ['Measure', 'scale.dialog', 'Set page scale…', ['Ctrl+Shift+K']],
  ['Measure', 'toggle.snap', 'Snap to content on/off', ['F3']],
  ['Measure', 'toggle.ortho', 'Ortho (straight lines) on/off', ['F8']],
  ['File', 'file.open', 'Open', ['Ctrl+O']],
  ['File', 'file.save', 'Save', ['Ctrl+S']],
  ['File', 'file.saveas', 'Save as', ['Ctrl+Shift+S']],
  ['File', 'file.flatten', 'Export copy with markups flattened', ['Ctrl+E']],
  ['File', 'file.csv', 'Export markups summary (CSV)', ['Ctrl+Shift+E']],
  ['File', 'file.close', 'Close tab', ['Ctrl+W', 'Ctrl+F4']],
  ['File', 'tab.next', 'Next tab', ['Ctrl+Tab']],
  ['File', 'tab.prev', 'Previous tab', ['Ctrl+Shift+Tab']],
  ['Edit', 'edit.undo', 'Undo', ['Ctrl+Z']],
  ['Edit', 'edit.redo', 'Redo', ['Ctrl+Y', 'Ctrl+Shift+Z']],
  ['Edit', 'edit.copy', 'Copy', ['Ctrl+C']],
  ['Edit', 'edit.paste', 'Paste', ['Ctrl+V']],
  ['Edit', 'edit.duplicate', 'Duplicate', ['Ctrl+D']],
  ['Edit', 'edit.delete', 'Delete', ['Delete']],
  ['Edit', 'edit.selectall', 'Select all on page', ['Ctrl+A']],
  ['Edit', 'edit.flag', 'Flag / unflag selected', ['F']],
  ['Edit', 'edit.status', 'Set status of selected…', ['Ctrl+Shift+T']],
  ['Edit', 'edit.addtool', 'Add selected to My Tools', ['Ctrl+Shift+M']],
  ['View', 'view.zoomin', 'Zoom in', ['Ctrl+=', 'Ctrl++']],
  ['View', 'view.zoomout', 'Zoom out', ['Ctrl+-']],
  ['View', 'view.fitpage', 'Fit page (zoom extents)', ['Ctrl+0']],
  ['View', 'view.fitwidth', 'Fit width', ['Ctrl+1']],
  ['View', 'view.actual', 'Actual size (100%)', ['Ctrl+2']],
  ['View', 'view.nextpage', 'Next page', ['PageDown', 'Ctrl+Right']],
  ['View', 'view.prevpage', 'Previous page', ['PageUp', 'Ctrl+Left']],
  ['View', 'view.firstpage', 'First page', ['Home']],
  ['View', 'view.lastpage', 'Last page', ['End']],
  ['View', 'view.goto', 'Go to page…', ['Ctrl+G']],
  ['View', 'view.mode', 'Continuous / single page', ['Ctrl+Shift+P']],
  ['View', 'view.find', 'Find text', ['Ctrl+F']],
  ['View', 'view.bookmark', 'Add bookmark here', ['Ctrl+B']],
  ['View', 'panel.left', 'Show/hide left panel', ['F4']],
  ['View', 'panel.right', 'Show/hide properties', ['F6']],
  ['View', 'panel.list', 'Show/hide markups list', ['Alt+L']],
  ['Help', 'help.shortcuts', 'Keyboard shortcuts', ['Ctrl+K', 'F1']],
  ['Help', 'help.updates', 'Check for updates', []]
];

const KEY = 'pd.shortcuts';
let custom = {};
try { custom = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { custom = {}; }

export function keysFor(id) { if (custom[id]) return custom[id]; const a = ACTIONS.find(a => a[1] === id); return a ? a[3] : []; }
export function setKeys(id, keys) { custom[id] = keys; save(); }
export function resetAll() { custom = {}; save(); }
export function resetOne(id) { delete custom[id]; save(); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(custom)); } catch (e) { /* ignore */ } }
export function exportAll() { const o = {}; for (const a of ACTIONS) o[a[1]] = keysFor(a[1]); return o; }
export function importAll(o) { custom = {}; for (const a of ACTIONS) if (Array.isArray(o[a[1]])) custom[a[1]] = o[a[1]]; save(); }

const CODE_NAMES = { Equal: '=', Minus: '-', NumpadAdd: '+', NumpadSubtract: '-', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`', Space: 'Space' };
export function comboFromEvent(e) {
  let k = '';
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) k = c.slice(3);
  else if (/^Digit\d$/.test(c)) k = c.slice(5);
  else if (/^Numpad\d$/.test(c)) k = 'Num' + c.slice(6);
  else if (CODE_NAMES[c]) k = CODE_NAMES[c];
  else if (/^F\d+$/.test(e.key)) k = e.key;
  else if (['Delete', 'Backspace', 'PageUp', 'PageDown', 'Home', 'End', 'Tab', 'Insert', 'Enter', 'Escape'].includes(e.key)) k = e.key;
  else if (e.key && e.key.startsWith('Arrow')) k = e.key.slice(5);
  else if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  else k = (e.key || '').length === 1 ? e.key.toUpperCase() : e.key;
  if (!k) return null;
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.altKey ? 'Alt+' : '') + k;
}
export function actionFor(combo) {
  for (const a of ACTIONS) if (keysFor(a[1]).includes(combo)) return a[1];
  return null;
}
export function conflicts(combo, exceptId) {
  return ACTIONS.filter(a => a[1] !== exceptId && keysFor(a[1]).includes(combo)).map(a => a[2]);
}
export function labelFor(id) { const k = keysFor(id); return k.length ? k[0] : ''; }
