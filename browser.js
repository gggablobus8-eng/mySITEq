/* Blue Chat Room - Internet Explorer 6 style browser window.
   Pages are shown in a sandboxed <iframe>, so any site that forbids being framed (Google, YouTube, Facebook ...)
   will not display. That is a browser security rule, so the toolbar has an "Open in new tab" button as a fallback. */
(() => {
'use strict';
const B = window.BCR;
const { h } = B;

const HOME = 'about:home';
const SEARCH = 'https://duckduckgo.com/html/?q=';
const FAVS = [
  ['Wikipedia', 'https://en.wikipedia.org/'],
  ['Internet Archive', 'https://archive.org/'],
  ['Wayback Machine', 'https://web.archive.org/'],
  ['Example Domain', 'https://example.com/'],
  ['Project Gutenberg', 'https://www.gutenberg.org/'],
  ['NASA', 'https://www.nasa.gov/'],
];

/* turn whatever was typed into a safe http(s) address, HOME, or null (blocked) */
function resolve(raw) {
  let v = String(raw || '').trim();
  if (!v || /^about:(home|blank)$/i.test(v)) return HOME;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^https?:\/\//i.test(v) && !/^[^\s/:]+:\d+(\/|$)/.test(v)) return null;   // javascript:, data:, file: ...
  if (!/^https?:\/\//i.test(v)) {
    if (/\s/.test(v) || (!/[.:]/.test(v) && v !== 'localhost')) return SEARCH + encodeURIComponent(v);
    v = 'https://' + v;
  }
  let u;
  try { u = new URL(v); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return null;
  return u.href;
}

function open(startUrl) {
  const ex = B.wins.get('ie');
  if (ex) { if (ex.min) B.restoreWin(ex); else B.focusWin(ex); if (startUrl) ex.ie.go(startUrl); return; }

  let hist = [], idx = -1, cur = HOME, win;
  const frame = h('iframe', { class: 'ie-frame', hidden: true, title: 'Web page', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer' });
  const home = h('div', { class: 'ie-doc ie-home' });
  const err = h('div', { class: 'ie-doc ie-err', hidden: true });
  const addr = h('input', { class: 'xp-input ie-input', type: 'text', spellcheck: 'false', value: HOME, 'aria-label': 'Address' });
  const status = h('span', { class: 'sb-cell grow' }, 'Done');
  const throb = h('div', { class: 'ie-throb', title: 'Microsoft Internet Explorer' }, 'e');
  const side = h('div', { class: 'ie-side', hidden: true });
  const hint = h('div', { class: 'ie-hint' }, 'ℹ️ Some sites (Google, YouTube, Facebook…) do not allow being shown inside another page. If a page stays blank, click “Open in new tab”.',
    h('a', { href: '#', onclick: e => { e.preventDefault(); hint.remove(); } }, 'Close'));

  const tool = (ico, label, fn, tip) => { const b = h('button', { class: 'ie-tool', title: tip || label }, h('span', { class: 'ie-ico' }, ico), label); b.addEventListener('click', fn); return b; };
  const bBack = tool('⬅️', 'Back', () => step(-1)), bFwd = tool('➡️', '', () => step(1), 'Forward');
  const bStop = tool('⛔', 'Stop', () => { frame.src = 'about:blank'; busy(false); status.textContent = 'Done'; });
  const bRef = tool('🔄', 'Refresh', () => show(cur, true));
  const bHome = tool('🏠', 'Home', () => go(HOME));
  const bSearch = tool('🔍', 'Search', () => panel('search'));
  const bFav = tool('⭐', 'Favorites', () => panel('favs'));
  const bNew = tool('↗️', 'Open in new tab', () => { if (/^https?:/.test(cur)) window.open(cur, '_blank', 'noopener,noreferrer'); }, 'Open this page in a new browser tab');

  function busy(on) { throb.classList.toggle('on', on); }
  function updateButtons() { bBack.disabled = idx <= 0; bFwd.disabled = idx >= hist.length - 1; bNew.disabled = !/^https?:/.test(cur); }
  function setTitle(t) { win.titleText.textContent = `${t} - Microsoft Internet Explorer`; if (win.task) win.task.lastChild.textContent = t; }

  function panel(kind) {
    if (!side.hidden && side.dataset.kind === kind) { side.hidden = true; return; }
    side.hidden = false; side.dataset.kind = kind;
    if (kind === 'favs') {
      side.replaceChildren(h('div', { class: 'ie-side-h' }, 'Favorites'), ...FAVS.map(([n, u]) => h('a', { href: '#', onclick: e => { e.preventDefault(); go(u); } }, '⭐ ' + n)));
    } else {
      const q = h('input', { class: 'xp-input', type: 'text', placeholder: 'Search the web…' }), b = h('button', { class: 'xp-btn small' }, 'Search');
      const run = () => { if (q.value.trim()) go(q.value); };
      b.addEventListener('click', run); q.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
      side.replaceChildren(h('div', { class: 'ie-side-h' }, 'Search'), h('div', { class: 'ie-side-b' }, h('div', null, 'What are you looking for?'), q, b));
      q.focus();
    }
  }

  function buildHome() {
    home.replaceChildren(h('div', { class: 'ie-banner' }, h('span', { class: 'ie-logo' }, 'e'), h('div', null, h('b', null, 'Blue Chat Room'), h('div', null, 'Web Portal'))),
      h('p', null, 'Type an address in the bar above, or pick a site:'),
      h('ul', null, FAVS.map(([n, u]) => h('li', null, h('a', { href: '#', onclick: e => { e.preventDefault(); go(u); } }, n), h('span', null, '  ' + u)))));
  }

  function showError(raw) {
    home.hidden = true; frame.hidden = true; err.hidden = false;
    err.replaceChildren(h('h2', null, 'The page cannot be displayed'), h('p', null, 'The page you are looking for is currently unavailable or the address is not allowed here.'), h('hr'),
      h('p', null, 'Please try the following:'), h('ul', null, h('li', null, 'Check the address for typing errors such as ', h('b', null, 'ww.example.com'), ' instead of ', h('b', null, 'www.example.com'), '.'),
        h('li', null, 'Only http:// and https:// addresses can be opened.')), h('p', { class: 'ie-small' }, 'Cannot open: ' + raw));
    status.textContent = 'Done'; busy(false); setTitle('Cannot find server');
  }

  function show(url) {
    err.hidden = true; cur = url; addr.value = url;
    if (url === HOME) { frame.hidden = true; frame.src = 'about:blank'; home.hidden = false; busy(false); status.textContent = 'Done'; setTitle('Web Portal'); }
    else { home.hidden = true; frame.hidden = false; frame.src = url; busy(true); status.textContent = 'Opening page ' + url + '…'; setTitle(new URL(url).hostname); }
    updateButtons();
  }
  function go(raw) {
    const u = resolve(raw);
    if (u === null) { addr.value = raw; showError(raw); return; }
    hist = hist.slice(0, idx + 1); hist.push(u); idx = hist.length - 1;
    show(u);
  }
  function step(d) { const n = idx + d; if (n >= 0 && n < hist.length) { idx = n; show(hist[idx]); } }

  frame.addEventListener('load', () => { if (frame.src && frame.src !== 'about:blank' && !frame.hidden) { busy(false); status.textContent = 'Done'; } });
  addr.addEventListener('keydown', e => { if (e.key === 'Enter') go(addr.value); });
  addr.addEventListener('focus', () => addr.select());
  const goBtn = h('button', { class: 'ie-go' }, h('span', null, '➡️'), 'Go');
  goBtn.addEventListener('click', () => go(addr.value));

  const content = h('div', { class: 'fill ie' },
    h('div', { class: 'xp-menubar' }, ['File', 'Edit', 'View', 'Favorites', 'Tools', 'Help'].map(t => h('span', null, t)), throb),
    h('div', { class: 'ie-tools' }, bBack, bFwd, bStop, bRef, bHome, h('span', { class: 'ie-sep' }), bSearch, bFav, h('span', { class: 'ie-sep' }), bNew),
    h('div', { class: 'ie-addr' }, h('label', null, 'Address'), addr, goBtn),
    hint,
    h('div', { class: 'ie-main' }, side, h('div', { class: 'ie-page' }, frame, home, err)),
    h('div', { class: 'statusbar' }, status, h('span', { class: 'sb-cell' }, '🌐 Internet')));
  const ds = B.deskSize();
  win = B.createWindow({ id: 'ie', title: 'Microsoft Internet Explorer', icon: '🌐', content, w: 760, h: 520, minW: 420, minH: 300,
    x: ds.w > 1000 ? 90 : 4, y: 30, onClose: () => { frame.src = 'about:blank'; } });
  win.ie = { go };
  buildHome();
  idx = 0; hist = [HOME]; show(HOME);
  if (startUrl) go(startUrl);
}

B.apps.browser = { open };
B.resolveUrl = resolve;
})();
