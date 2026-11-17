/* Blue Chat Room - wallpaper / Display Properties. Each visitor's choice is saved in their own browser. */
(() => {
'use strict';
const B = window.BCR;
const { h, desktop } = B;

const BLISS = 'radial-gradient(ellipse 18% 9% at 22% 20%,rgba(255,255,255,.85),transparent 70%),radial-gradient(ellipse 14% 7% at 30% 23%,rgba(255,255,255,.75),transparent 70%),radial-gradient(ellipse 20% 8% at 72% 14%,rgba(255,255,255,.7),transparent 70%),radial-gradient(ellipse 140% 55% at 25% 118%,#6bb82a 0,#4a9a16 48%,transparent 49%),radial-gradient(ellipse 110% 45% at 95% 122%,#58a81c 0,#3c8410 52%,transparent 53%),linear-gradient(#1f5fcf 0%,#4b8fe6 40%,#8dc0f2 62%,#cfe6fb 74%,#e8f4ff 78%)';
const PRESETS = [
  { id: 'bliss', name: 'Bliss', css: BLISS },
  { id: 'azure', name: 'Azure', css: 'linear-gradient(160deg,#0a2a6b,#2d6fd6 55%,#7fb4f0)' },
  { id: 'autumn', name: 'Autumn', css: 'radial-gradient(circle at 70% 30%,#ffe9a8 0,#f6b04a 9%,transparent 10%),linear-gradient(#f6b04a,#c8561a 55%,#5b1d0b)' },
  { id: 'ripple', name: 'Ripple', css: 'repeating-radial-gradient(circle at 70% 130%,#1f5fcf 0 16px,#2f74e0 16px 32px)' },
  { id: 'lace', name: 'Blue Lace 16', css: 'repeating-linear-gradient(45deg,#c9d9f3 0 6px,#e8f0fb 6px 12px)' },
  { id: 'moon', name: 'Red Moon Desert', css: 'radial-gradient(circle at 75% 25%,#f5e6c8 0,#e8a07a 5%,transparent 6%),linear-gradient(#0a0e2a,#2a2a5c 55%,#6b3a3a 80%,#2a1a1a)' },
  { id: 'none', name: '(None)', css: '' },
];
const DEFAULT = { type: 'preset', id: 'bliss', color: '#3a6ea5', pos: 'stretch', img: '' };

function load() {
  let cfg = { ...DEFAULT };
  try { Object.assign(cfg, JSON.parse(B.store('bcr_wall') || '{}')); } catch (e) {}
  if (cfg.type === 'image') cfg.img = B.store('bcr_wall_img') || '';
  if (cfg.type === 'image' && !cfg.img) cfg = { ...DEFAULT };
  return cfg;
}
function save(cfg) {
  const { img, ...rest } = cfg;
  B.store('bcr_wall', JSON.stringify(rest));
  if (cfg.type !== 'image') return true;
  try { localStorage.setItem('bcr_wall_img', img); return true; } catch (e) { return false; }
}

function paint(el, cfg) {
  const st = el.style;
  st.background = ''; st.backgroundSize = ''; st.backgroundRepeat = ''; st.backgroundPosition = '';
  if (cfg.type === 'image' && cfg.img) {
    st.backgroundColor = cfg.color;
    st.backgroundImage = `url("${cfg.img}")`;
    st.backgroundRepeat = cfg.pos === 'tile' ? 'repeat' : 'no-repeat';
    st.backgroundPosition = cfg.pos === 'tile' ? '0 0' : 'center';
    if (cfg.pos === 'stretch') st.backgroundSize = '100% 100%';
  } else if (cfg.type === 'color' || (cfg.type === 'preset' && cfg.id === 'none')) {
    st.background = cfg.color;
  } else {
    const p = PRESETS.find(x => x.id === cfg.id) || PRESETS[0];
    st.background = p.css;
  }
}

let current = load();
paint(desktop, current);

/* scale a chosen picture down so it fits in localStorage */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / img.naturalWidth, 1000 / img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', .82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

function open() {
  const ex = B.wins.get('wallpaper');
  if (ex) { if (ex.min) B.restoreWin(ex); else B.focusWin(ex); return; }
  let draft = { ...current };

  const screen = h('div', { class: 'wp-screen' });
  const list = h('div', { class: 'wp-list', tabindex: '0' });
  const pos = h('select', { class: 'xp-input' },
    h('option', { value: 'center' }, 'Center'), h('option', { value: 'tile' }, 'Tile'), h('option', { value: 'stretch' }, 'Stretch'));
  const color = h('input', { type: 'color', value: draft.color, class: 'wp-color' });
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const browse = h('button', { class: 'xp-btn' }, 'Browse…');
  const ok = h('button', { class: 'xp-btn' }, 'OK');
  const cancel = h('button', { class: 'xp-btn' }, 'Cancel');
  const apply = h('button', { class: 'xp-btn' }, 'Apply');

  function render() {
    paint(screen, draft);
    pos.value = draft.pos; pos.disabled = draft.type !== 'image';
    color.value = /^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : '#3a6ea5';
    const rows = PRESETS.map(p => ({ key: p.id, name: p.name, on: draft.type === 'preset' && draft.id === p.id || draft.type === 'color' && p.id === 'none' }));
    if (draft.type === 'image') rows.unshift({ key: 'img', name: 'My picture', on: true });
    list.replaceChildren(...rows.map(r => {
      const row = h('div', { class: 'wp-row' + (r.on ? ' on' : '') }, '🖼️ ' + r.name);
      row.addEventListener('click', () => {
        if (r.key === 'img') return;
        draft = { ...draft, type: 'preset', id: r.key, img: draft.type === 'image' ? '' : draft.img };
        render();
      });
      return row;
    }));
  }

  pos.addEventListener('change', () => { draft.pos = pos.value; render(); });
  color.addEventListener('input', () => {
    draft = draft.type === 'image' ? { ...draft, color: color.value } : { ...draft, type: 'color', color: color.value };
    render();
  });
  browse.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    try { draft = { ...draft, type: 'image', img: await shrink(f), pos: draft.pos === 'tile' ? 'tile' : 'stretch' }; render(); }
    catch (e) { B.msgBox('Display Properties', 'That file could not be opened as a picture.', '⛔'); }
  });

  const commit = () => {
    current = { ...draft };
    if (!save(current)) B.msgBox('Display Properties', 'Your wallpaper is applied for now, but it is too large for this browser to remember. Pick a smaller picture to keep it next time.', '⚠️');
    paint(desktop, current);
  };
  let win;
  apply.addEventListener('click', commit);
  ok.addEventListener('click', () => { commit(); B.closeWin(win); });
  cancel.addEventListener('click', () => B.closeWin(win));

  const content = h('div', { class: 'fill dp' },
    h('div', { class: 'xp-tabs' }, h('span', { class: 'xp-tab on' }, 'Desktop')),
    h('div', { class: 'xp-tabpanel' },
      h('div', { class: 'wp-monitor' }, h('div', { class: 'wp-bezel' }, screen), h('div', { class: 'wp-stand' })),
      h('div', { class: 'wp-label' }, 'Background:'),
      list,
      h('div', { class: 'wp-opts' }, browse, h('label', null, 'Position: '), pos, h('label', null, 'Color: '), color, file),
      h('div', { class: 'wp-note' }, 'Only you see your wallpaper.')),
    h('div', { class: 'mb-btns dp-btns' }, ok, cancel, apply));
  win = B.createWindow({ id: 'wallpaper', title: 'Display Properties', icon: '🖥️', content, w: 410, h: 470, dialog: true, center: true });
  render();
}

/* right-click menu on the empty desktop */
let menu = null;
function closeMenu() { if (menu) { menu.remove(); menu = null; } }
desktop.addEventListener('contextmenu', e => {
  if (e.target !== desktop) return;
  e.preventDefault(); closeMenu();
  const item = (label, fn, bold) => h('div', { class: 'ctx-item' + (bold ? ' bold' : ''), onclick: () => { closeMenu(); fn(); } }, label);
  menu = h('div', { class: 'ctx', style: `left:${Math.min(e.clientX, innerWidth - 190)}px;top:${Math.min(e.clientY, innerHeight - 140)}px` },
    item('Open Blue Chat Room', () => B.openChat(), true),
    item('Internet Explorer', () => B.apps.browser && B.apps.browser.open()),
    h('div', { class: 'ctx-sep' }),
    item('Change Wallpaper…', open),
    item('Properties', open));
  document.body.append(menu);
});
document.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);

B.apps.wallpaper = { open };
})();
