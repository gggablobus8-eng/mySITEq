/* Blue Chat Room - Windows Explorer style browser for everything shared in the chat */
(() => {
'use strict';
const B = window.BCR;
const { h } = B;

const FOLDERS = [
  { id: 'all', name: 'All Files', icon: '📁', test: () => true },
  { id: 'pics', name: 'Pictures', icon: '🖼️', test: f => f.kind === 'image' },
  { id: 'music', name: 'Music', icon: '🎵', test: f => f.kind === 'audio' },
  { id: 'arch', name: 'Archives', icon: '🗜️', test: f => ['zip', 'rar', '7z'].includes(B.extOf(f.name)) },
  { id: 'docs', name: 'Documents', icon: '📄', test: f => f.kind === 'file' && !['zip', 'rar', '7z'].includes(B.extOf(f.name)) },
];
const typeName = f => f.kind === 'image' ? 'Image' : f.kind === 'audio' ? 'Audio' : B.extOf(f.name).toUpperCase() + ' File';

const ui = { body: null, tree: null, addr: null, status: null, btns: null };
const st = { folder: 'all', sel: null, view: 'icons' };

const filesNow = () => {
  const fo = FOLDERS.find(x => x.id === st.folder) || FOLDERS[0];
  return B.allFiles().filter(fo.test).reverse();
};
const selected = () => B.allFiles().find(f => f.id === st.sel);
const ownerMsg = f => f && B.state.messages.find(m => (m.files || []).some(x => x.id === f.id));

function render() {
  if (!ui.body) return;
  const all = B.allFiles();
  const files = filesNow();
  if (st.sel && !all.some(f => f.id === st.sel)) st.sel = null;

  ui.tree.replaceChildren(
    h('div', { class: 'xt-row top' }, '🖥️ My Network Places'),
    h('div', { class: 'xt-row lvl1' }, '🌐 Blue Chat Room'),
    ...FOLDERS.map(fo => {
      const n = all.filter(fo.test).length;
      const row = h('div', { class: 'xt-row lvl2' + (fo.id === st.folder ? ' on' : '') }, `${fo.icon} ${fo.name}`, h('span', { class: 'xt-n' }, ` (${n})`));
      row.addEventListener('click', () => { st.folder = fo.id; st.sel = null; render(); });
      return row;
    }));

  const fo = FOLDERS.find(x => x.id === st.folder);
  ui.addr.textContent = `${fo.icon} My Network Places\\Blue Chat Room\\${fo.name}`;

  if (!files.length) {
    ui.body.className = 'xp-view empty';
    ui.body.replaceChildren(h('div', { class: 'xe-empty' }, 'This folder is empty. Attach files in the chat to fill it.'));
  } else if (st.view === 'icons') {
    ui.body.className = 'xp-view icons';
    ui.body.replaceChildren(...files.map(f => {
      const pic = f.kind === 'image'
        ? h('img', { class: 'xi-thumb', src: B.fileUrl(f), alt: '', loading: 'lazy', draggable: 'false' })
        : h('div', { class: 'xi-glyph' }, B.kindIcon(f));
      const it = h('div', { class: 'xi' + (f.id === st.sel ? ' sel' : ''), title: `${f.name}\n${typeName(f)}\n${B.fmtSize(f.size)}\nShared by ${f.from}` },
        pic, h('div', { class: 'xi-name' }, f.name));
      it.addEventListener('click', () => { st.sel = f.id; render(); });
      it.addEventListener('dblclick', () => B.openFile(f));
      return it;
    }));
  } else {
    ui.body.className = 'xp-view details';
    const rows = files.map(f => {
      const tr = h('tr', { class: f.id === st.sel ? 'sel' : '' },
        h('td', null, B.kindIcon(f) + ' ' + f.name), h('td', null, typeName(f)), h('td', null, B.fmtSize(f.size)), h('td', null, f.from), h('td', null, B.fmtDate(f.time)));
      tr.addEventListener('click', () => { st.sel = f.id; render(); });
      tr.addEventListener('dblclick', () => B.openFile(f));
      return tr;
    });
    ui.body.replaceChildren(h('table', null,
      h('thead', null, h('tr', null, ['Name', 'Type', 'Size', 'Shared by', 'Date'].map(t => h('th', null, t)))), h('tbody', null, rows)));
  }

  const f = selected(), m = ownerMsg(f);
  ui.btns.open.disabled = !f; ui.btns.dl.disabled = !f;
  ui.btns.del.disabled = !(f && m && B.owns(m.id));
  ui.btns.del.title = f && !ui.btns.del.disabled ? 'Delete this file' : 'You can only delete files you shared from this browser';
  ui.btns.view.textContent = st.view === 'icons' ? '☰ Details' : '▦ Icons';
  ui.status.firstChild.textContent = f ? `${f.name} — ${typeName(f)}, ${B.fmtSize(f.size)}` : `${files.length} object(s)`;
}

function open() {
  const ex = B.wins.get('explorer');
  if (ex) { if (ex.min) B.restoreWin(ex); else B.focusWin(ex); return; }
  const btn = (label, fn) => { const b = h('button', { class: 'xp-btn small' }, label); b.addEventListener('click', fn); return b; };
  const btns = {
    open: btn('📂 Open', () => { const f = selected(); if (f) B.openFile(f); }),
    dl: btn('💾 Download', () => { const f = selected(); if (f) B.download(f); }),
    del: btn('🗑️ Delete', () => { const f = selected(), m = ownerMsg(f); if (f && m) B.askDelete(m, f); }),
    view: btn('', () => { st.view = st.view === 'icons' ? 'details' : 'icons'; render(); }),
  };
  const tree = h('div', { class: 'xp-tree' });
  const body = h('div', { class: 'xp-view' });
  const addr = h('div', { class: 'box' });
  const status = h('div', { class: 'statusbar' }, h('span', { class: 'sb-cell grow' }, ''));
  Object.assign(ui, { tree, body, addr, status, btns });
  const content = h('div', { class: 'fill' },
    h('div', { class: 'xp-menubar' }, ['File', 'Edit', 'View', 'Favorites', 'Tools', 'Help'].map(t => h('span', null, t))),
    h('div', { class: 'toolbar' }, btns.open, btns.dl, btns.del, h('span', { class: 'grow' }), btns.view),
    h('div', { class: 'addr' }, h('span', null, 'Address'), addr),
    h('div', { class: 'xp-split' }, tree, body), status);
  const ds = B.deskSize();
  B.createWindow({ id: 'explorer', title: 'Shared Files', icon: '📁', content, w: 620, h: 400, minW: 380, minH: 240,
    x: ds.w > 900 ? 200 : 6, y: 110, onClose: () => { ui.body = null; } });
  render();
}

B.apps.explorer = { open, refresh: render };
})();
