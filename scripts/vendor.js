// Copies the PDF libraries from node_modules into www/lib so the app works fully offline.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const nm = p => path.join(root, 'node_modules', p);
const lib = path.join(root, 'www', 'lib');
fs.rmSync(lib, { recursive: true, force: true });
fs.mkdirSync(lib, { recursive: true });
let failed = false;
function copyFirst(dest, candidates) {
  const hit = candidates.map(nm).find(f => fs.existsSync(f));
  if (!hit) { console.error('MISSING: ' + dest + ' (looked for ' + candidates.join(', ') + ')'); failed = true; return; }
  fs.copyFileSync(hit, path.join(lib, dest));
  console.log('lib/' + dest + '  <-  ' + path.relative(root, hit));
}
copyFirst('pdf.js', ['pdfjs-dist/legacy/build/pdf.min.mjs', 'pdfjs-dist/legacy/build/pdf.mjs']);
copyFirst('pdf.worker.js', ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdfjs-dist/legacy/build/pdf.worker.mjs']);
copyFirst('pdf-lib.min.js', ['pdf-lib/dist/pdf-lib.min.js']);
// fonts and character maps so every drawing's text shows correctly offline
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = nm('pdfjs-dist/' + dir);
  if (fs.existsSync(src)) { fs.cpSync(src, path.join(lib, dir), { recursive: true }); console.log('lib/' + dir + '/'); }
  else console.warn('not found, skipped: pdfjs-dist/' + dir);
}
if (failed) { console.error('Some files are missing, so the build stops here.'); process.exit(1); }
console.log('All libraries copied.');
