/* Blue Chat Room - WinRAR style archive preview (ZIP and RAR 4/5 listings).
   Only the archive's table of contents is read, with small Range requests; nothing is unpacked. */
(() => {
'use strict';
const B = window.BCR;
const { h } = B;

/* ---------------- reading helpers ---------------- */
function makeReader(f) {
  const url = B.fileUrl(f);
  let cache = null;
  return async function read(start, len) {
    len = Math.min(len, f.size - start);
    if (len <= 0) return new Uint8Array(0);
    if (cache && start >= cache.s && start + len <= cache.s + cache.b.length) return cache.b.subarray(start - cache.s, start - cache.s + len);
    const want = Math.min(Math.max(len, 131072), f.size - start);
    const r = await fetch(url, { headers: { Range: `bytes=${start}-${start + want - 1}` } });
    if (!r.ok) throw new Error(`Could not read the archive (HTTP ${r.status}).`);
    const b = new Uint8Array(await r.arrayBuffer());
    if (r.status === 200) { cache = { s: 0, b }; return b.subarray(start, start + len); }   // server ignored Range
    cache = { s: start, b };
    return b.subarray(0, len);
  };
}
const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
const dosDate = (d, t) => { const mo = (d >> 5) & 15; return mo >= 1 && mo <= 12 ? new Date(1980 + (d >> 9), mo - 1, d & 31, t >> 11, (t >> 5) & 63, (t & 31) * 2).getTime() : null; };
const clean = p => p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
function text(bytes, utf8) {
  try { return new TextDecoder(utf8 ? 'utf-8' : 'windows-1252', { fatal: utf8 }).decode(bytes); }
  catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
}
const BAD = 'This archive looks damaged or is not a supported format.';

/* ---------------- ZIP ---------------- */
const ZIP_METHODS = { 0: 'Store', 8: 'Deflate', 9: 'Deflate64', 12: 'BZip2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 98: 'PPMd' };
async function parseZip(read, size) {
  const tailLen = Math.min(size, 65557), tail = await read(size - tailLen, tailLen), dv = view(tail);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Not a valid ZIP archive (central directory not found).');
  const count = dv.getUint16(e + 10, true), cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true);
  if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) throw new Error('ZIP64 archives are too big to preview here.');
  if (cdSize > 8 * 1048576 || cdOff + cdSize > size) throw new Error(BAD);
  const cd = await read(cdOff, cdSize), v = view(cd), entries = [];
  let p = 0;
  while (p + 46 <= cd.length && entries.length < 5000 && v.getUint32(p, true) === 0x02014b50) {
    const flags = v.getUint16(p + 8, true), nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const raw = text(cd.subarray(p + 46, p + 46 + nl), !!(flags & 0x800)), dir = raw.endsWith('/') || raw.endsWith('\\');
    entries.push({ path: clean(raw), dir, size: v.getUint32(p + 24, true), packed: v.getUint32(p + 20, true),
      mtime: dosDate(v.getUint16(p + 14, true), v.getUint16(p + 12, true)), crc: dir ? null : v.getUint32(p + 16, true),
      method: ZIP_METHODS[v.getUint16(p + 10, true)] || 'Unknown', enc: !!(flags & 1) });
    p += 46 + nl + el + cl;
  }
  return { type: 'ZIP', entries };
}

/* ---------------- RAR 4 and 5 ---------------- */
const RAR_METHODS = ['Store', 'Fastest', 'Fast', 'Normal', 'Good', 'Best'];
function vint(b, i) {
  let v = 0, m = 1;
  for (let k = 0; k < 10; k++) {
    if (i >= b.length) throw new Error(BAD);
    const c = b[i++]; v += (c & 0x7f) * m;
    if (!(c & 0x80)) return [v, i];
    m *= 128;
  }
  throw new Error(BAD);
}
async function parseRar(read, size) {
  const sg = await read(0, 8), entries = [];
  const head = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07].every((c, i) => sg[i] === c);
  if (!head) throw new Error('Not a RAR archive (or it is a self-extracting file).');
  let solid = false, p;
  if (sg[6] === 0) {                                    // RAR 2.x - 4.x
    p = 7;
    while (p + 7 <= size && entries.length < 5000) {
      let b = await read(p, 32); if (b.length < 7) break;
      let dv = view(b);
      const type = b[2], flags = dv.getUint16(3, true), hs = dv.getUint16(5, true);
      if (hs < 7 || type === 0x7b) break;
      let add = 0;
      if (type === 0x73) { if (flags & 0x80) throw new Error('This archive has encrypted headers, so its contents cannot be listed.'); solid = !!(flags & 8); }
      else if (type === 0x74) {
        b = await read(p, hs); dv = view(b);
        const nl = dv.getUint16(26, true), ft = dv.getUint32(20, true);
        let off = 32, usize = dv.getUint32(11, true);
        add = dv.getUint32(7, true);
        if (flags & 0x100) { add += dv.getUint32(32, true) * 4294967296; usize += dv.getUint32(36, true) * 4294967296; off = 40; }
        const raw = b.subarray(off, off + nl), z = (flags & 0x200) ? raw.indexOf(0) : -1, dir = (flags & 0xE0) === 0xE0;
        entries.push({ path: clean(text(z >= 0 ? raw.subarray(0, z) : raw, true)), dir, size: usize, packed: add, mtime: dosDate(ft >>> 16, ft & 0xFFFF),
          crc: dir ? null : dv.getUint32(16, true), method: RAR_METHODS[b[25] - 0x30] || 'Unknown', enc: !!(flags & 4) });
      } else if (flags & 0x8000) add = dv.getUint32(7, true);
      p += hs + add;
    }
    return { type: 'RAR', ver: '4', solid, entries };
  }
  if (sg[6] !== 1 || sg[7] !== 0) throw new Error(BAD);
  p = 8;                                                // RAR 5
  while (p + 8 <= size && entries.length < 5000) {
    let b = await read(p, 32);
    const [hs, q] = vint(b, 4);
    if (hs > 2097152) throw new Error(BAD);
    b = await read(p, q + hs); const dv = view(b);
    const [type, o1] = vint(b, q), [hf, o2] = vint(b, o1);
    let o3 = o2, dsize = 0;
    if (hf & 1) o3 = vint(b, o3)[1];
    if (hf & 2) [dsize, o3] = vint(b, o3);
    if (type === 4) throw new Error('This archive has encrypted headers, so its contents cannot be listed.');
    if (type === 5) break;
    if (type === 1) solid = !!(vint(b, o3)[0] & 4);
    if (type === 2) {
      let ff, usize, o = o3, mtime = null, crc = null, ci, nl;
      [ff, o] = vint(b, o); [usize, o] = vint(b, o); o = vint(b, o)[1];
      if (ff & 2) { mtime = dv.getUint32(o, true) * 1000; o += 4; }
      if (ff & 4) { crc = dv.getUint32(o, true); o += 4; }
      [ci, o] = vint(b, o); o = vint(b, o)[1]; [nl, o] = vint(b, o);
      const dir = !!(ff & 1);
      entries.push({ path: clean(text(b.subarray(o, o + nl), true)), dir, size: usize, packed: dsize, mtime, crc: dir ? null : crc,
        method: RAR_METHODS[(ci >> 7) & 7] || 'Unknown', enc: false });
    }
    p += q + hs + dsize;
  }
  return { type: 'RAR', ver: '5', solid, entries };
}

async function parseArchive(f) {
  const read = makeReader(f), ext = B.extOf(f.name);
  if (f.size < 22) throw new Error(BAD);
  return ext === 'rar' ? parseRar(read, f.size) : parseZip(read, f.size);
}
B.parsers = { parseZip, parseRar };

/* ---------------- WinRAR window ---------------- */
const crcText = c => c == null ? '' : c.toString(16).toUpperCase().padStart(8, '0');
const when = ms => ms == null ? '' : new Date(ms).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function open(f) {
  const id = 'rar-' + f.id;
  const ex = B.wins.get(id);
  if (ex) { if (ex.min) B.restoreWin(ex); else B.focusWin(ex); return; }
  let info = null, cwd = '';
  const list = h('div', { class: 'wr-list' }, h('div', { class: 'wr-msg' }, 'Reading archive…'));
  const pathBox = h('div', { class: 'wr-path' }, f.name);
  const up = h('button', { class: 'wr-up', title: 'Up one level', disabled: true }, '⬆');
  const status = h('div', { class: 'statusbar' }, h('span', { class: 'sb-cell grow' }, ''), h('span', { class: 'sb-cell' }, f.name));
  const tools = [['Add', '➕'], ['Extract To', '📤', 'dl'], ['Test', '✔️'], ['View', '👁️'], ['Delete', '❌'], ['Find', '🔍'], ['Wizard', '🧙'], ['Info', 'ℹ️', 'info']]
    .map(([label, ic, act]) => {
      const b = h('button', { class: 'wr-tool', disabled: !act, title: act === 'dl' ? 'Download the archive to extract it on your computer' : act ? '' : 'Not available in the preview' },
        h('span', { class: 'wr-ico' }, ic), label);
      if (act === 'dl') b.addEventListener('click', () => B.download(f));
      if (act === 'info') b.addEventListener('click', () => {
        if (!info) return;
        const files = info.entries.filter(e => !e.dir);
        B.msgBox('Archive information', h('div', null,
          h('div', null, `Archive: ${f.name}`), h('div', null, `Format: ${info.type}${info.ver ? ' ' + info.ver : ''}${info.solid ? ' (solid)' : ''}`),
          h('div', null, `Files: ${files.length}, folders: ${info.entries.length - files.length}`),
          h('div', null, `Packed size: ${B.fmtSize(f.size)}`), h('div', null, `Unpacked size: ${B.fmtSize(files.reduce((a, e) => a + e.size, 0))}`)), 'ℹ️');
      });
      return b;
    });
  const content = h('div', { class: 'fill winrar' },
    h('div', { class: 'xp-menubar' }, ['File', 'Commands', 'Tools', 'Favorites', 'Options', 'Help'].map(t => h('span', null, t))),
    h('div', { class: 'wr-tools' }, tools),
    h('div', { class: 'wr-bar' }, up, pathBox), list, status);
  const ds = B.deskSize();
  B.createWindow({ id, title: `${f.name} - WinRAR`, icon: '📚', content, w: 640, h: 380, minW: 420, minH: 240, x: ds.w > 900 ? 160 : 6, y: 90 });

  function render() {
    list.className = 'wr-list';
    const items = new Map();
    for (const e of info.entries) {
      if (cwd && !e.path.startsWith(cwd + '/')) continue;
      const rest = cwd ? e.path.slice(cwd.length + 1) : e.path;
      if (!rest) continue;
      const parts = rest.split('/');
      if (parts.length === 1) items.set(parts[0] + (e.dir ? '/' : ''), { ...e, name: parts[0] });
      else if (!items.has(parts[0] + '/')) items.set(parts[0] + '/', { name: parts[0], dir: true, path: (cwd ? cwd + '/' : '') + parts[0] });
    }
    const rows = [...items.values()].sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    const trs = rows.map(e => {
      const tr = h('tr', null,
        h('td', null, (e.dir ? '📁 ' : e.enc ? '🔒 ' : '📄 ') + e.name),
        h('td', { class: 'num' }, e.dir ? '' : e.size.toLocaleString()), h('td', { class: 'num' }, e.dir ? '' : e.packed.toLocaleString()),
        h('td', null, e.dir ? 'File folder' : (B.extOf(e.name) && e.name.includes('.') ? B.extOf(e.name).toUpperCase() + ' File' : 'File')),
        h('td', null, when(e.mtime)), h('td', null, crcText(e.crc)));
      if (e.dir) tr.addEventListener('dblclick', () => { cwd = e.path; render(); });
      tr.addEventListener('click', () => { list.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel')); tr.classList.add('sel'); });
      return tr;
    });
    if (cwd) {
      const back = h('tr', null, h('td', { colspan: 6 }, '📁 ..'));
      back.addEventListener('dblclick', () => { cwd = cwd.includes('/') ? cwd.slice(0, cwd.lastIndexOf('/')) : ''; render(); });
      trs.unshift(back);
    }
    list.replaceChildren(h('table', null,
      h('thead', null, h('tr', null, ['Name', 'Size', 'Packed', 'Type', 'Modified', 'CRC32'].map(t => h('th', null, t)))), h('tbody', null, trs)));
    up.disabled = !cwd;
    pathBox.textContent = `${f.name} - ${info.type} archive${info.solid ? ', solid' : ''}${cwd ? ' \\ ' + cwd.replace(/\//g, ' \\ ') : ''}`;
    const files = info.entries.filter(e => !e.dir);
    status.firstChild.textContent = `Total ${info.entries.length - files.length} folders and ${files.reduce((a, e) => a + e.size, 0).toLocaleString()} bytes in ${files.length} files`;
  }
  up.addEventListener('click', () => { cwd = cwd.includes('/') ? cwd.slice(0, cwd.lastIndexOf('/')) : ''; render(); });

  parseArchive(f).then(r => { info = r; render(); }).catch(err => {
    list.replaceChildren(h('div', { class: 'wr-msg err' }, '⚠️ ' + (err && err.message || BAD)));
    status.firstChild.textContent = 'Cannot open this archive';
  });
}

B.apps.archive = { open };
})();
