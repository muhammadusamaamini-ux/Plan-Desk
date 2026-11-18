// Syntax-checks every app script before the installer is built, so a broken file stops the build.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-check-'));
let bad = 0;
const jsDir = path.join(root, 'www', 'js');
for (const f of fs.readdirSync(jsDir).filter(f => f.endsWith('.js'))) {
  const copy = path.join(tmp, f.replace(/\.js$/, '.mjs'));
  fs.copyFileSync(path.join(jsDir, f), copy);
  try { execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' }); console.log('ok  www/js/' + f); }
  catch (e) { bad++; console.error('ERROR in www/js/' + f + '\n' + String(e.stderr || e.message)); }
}
for (const f of ['electron/main.js', 'electron/preload.js']) {
  try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); console.log('ok  ' + f); }
  catch (e) { bad++; console.error('ERROR in ' + f + '\n' + String(e.stderr || e.message)); }
}
if (bad) process.exit(1);
