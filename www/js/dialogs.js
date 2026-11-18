// Dialogs, menus and small messages
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, kind = '', ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

let openModals = 0;
export const modalOpen = () => openModals > 0;
// buttons: [{label, value, primary, danger}] ; onOpen(body, close) for wiring; returns the chosen value
export function modal(title, html, buttons = [{ label: 'OK', value: true, primary: true }], onOpen) {
  return new Promise(resolve => {
    openModals++;
    const bd = document.createElement('div');
    bd.className = 'backdrop';
    bd.innerHTML = `<div class="dialog" role="dialog"><h2>${esc(title)}</h2><div class="dbody">${html}</div><div class="dfoot"></div></div>`;
    const foot = $('.dfoot', bd);
    let done = false;
    const close = v => { if (done) return; done = true; openModals--; bd.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.className = b.primary ? 'primary' : b.danger ? 'danger' : 'ghost';
      btn.onclick = () => {
        if (b.validate) { const r = b.validate($('.dbody', bd)); if (r === false) return; close(r === true || r === undefined ? b.value : r); return; }
        close(typeof b.value === 'function' ? b.value($('.dbody', bd)) : b.value);
      };
      foot.appendChild(btn);
    }
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); }
      else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && !e.target.dataset.nokey) {
        const p = buttons.find(b => b.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); foot.children[buttons.indexOf(p)].click(); }
      }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    $('#modalLayer').appendChild(bd);
    if (onOpen) onOpen($('.dbody', bd), close);
    const first = $('input:not([type=checkbox]):not([type=radio]), select, textarea', bd);
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
  });
}
export async function ask(title, text, okLabel = 'OK', danger = false) {
  return await modal(title, `<p>${esc(text)}</p>`, [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }]);
}
export async function prompt(title, label, value = '') {
  return await modal(title, `<div class="grid2"><label>${esc(label)}</label><input id="pv" value="${esc(value)}"></div>`,
    [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: b => $('#pv', b).value }]);
}

// ---- dropdown menus
export function closeMenus() { $('#menuLayer').innerHTML = ''; document.querySelectorAll('#menus > button.open').forEach(b => b.classList.remove('open')); }
// items: [{label, key, act(), disabled, checked, sub:[items]} | '-']
export function showMenu(items, x, y, opts = {}) {
  if (!opts.keep) closeMenus();
  const m = document.createElement('div');
  m.className = 'menu';
  for (const it of items) {
    if (it === '-') { const s = document.createElement('div'); s.className = 'sep'; m.appendChild(s); continue; }
    if (!it) continue;
    const b = document.createElement('button');
    b.className = 'mi' + (it.disabled ? ' dis' : '') + (it.sub ? ' sub' : '');
    b.innerHTML = `<span class="ck">${it.checked ? '✓' : ''}</span><span>${esc(it.label)}</span>${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}`;
    if (it.sub) {
      b.onmouseenter = () => {
        $$('.menu', $('#menuLayer')).forEach((mm, i, arr) => { if (Number(mm.dataset.level) > Number(m.dataset.level || 0)) mm.remove(); });
        const r = b.getBoundingClientRect();
        const sm = showMenu(it.sub, r.right - 2, r.top - 4, { keep: true });
        sm.dataset.level = String(Number(m.dataset.level || 0) + 1);
      };
    } else {
      b.onmouseenter = () => $$('.menu', $('#menuLayer')).forEach(mm => { if (Number(mm.dataset.level || 0) > Number(m.dataset.level || 0)) mm.remove(); });
      b.onclick = () => { if (it.disabled) return; closeMenus(); it.act && it.act(); };
    }
    m.appendChild(b);
  }
  m.dataset.level = '0';
  $('#menuLayer').appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(2, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = Math.max(2, Math.min(y, innerHeight - r.height - 4)) + 'px';
  return m;
}
document.addEventListener('mousedown', e => { if (!e.target.closest('.menu') && !e.target.closest('#menus')) closeMenus(); }, true);
