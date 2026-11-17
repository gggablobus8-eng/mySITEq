/* Blue Chat Room - front end */
(() => {
'use strict';

const API = 'api.php';
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const extOf = n => (String(n).split('.').pop() || '').toLowerCase();
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const fmtTime = s => { if (!isFinite(s) || s < 0) s = 0; s = Math.floor(s); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const fmtClock = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDate = ts => new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : String(k));
  }
  return e;
}

function randomId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

const state = {
  name: store('bcr_name') || '',
  cid: store('bcr_cid') || (() => { const c = randomId(); store('bcr_cid', c); return c; })(),
  sound: store('bcr_sound') !== '0',
  lastId: 0, messages: [], seen: new Set(), loaded: false, stick: true,
  pending: [], uploading: false, unread: 0,
  config: { maxFile: 25 * 1048576, maxFiles: 5, exts: [] },
};

const fileUrl = (f, dl) => `${API}?action=file&id=${encodeURIComponent(f.id)}&n=${encodeURIComponent(f.name)}${dl ? '&dl=1' : ''}`;
const kindIcon = f => f.kind === 'image' ? '🖼️' : f.kind === 'audio' ? '🎵' : ({ zip: '🗜️', rar: '🗜️', '7z': '🗜️', pdf: '📕', txt: '📄', csv: '📊', xls: '📊', xlsx: '📊', doc: '📘', docx: '📘', ppt: '📙', pptx: '📙' }[extOf(f.name)] || '📄');
function allFiles() {
  const out = [];
  for (const m of state.messages) for (const f of (m.files || [])) out.push({ ...f, from: m.name, time: m.time });
  return out;
}
function download(f) {
  const a = h('a', { href: fileUrl(f, true), download: f.name });
  document.body.append(a); a.click(); a.remove();
}

/* =====================================================================
   Window manager
   ===================================================================== */
const desktop = $('#desktop');
const tasksBar = $('#tasks');
const wins = new Map();
let zTop = 10, cascade = 0, uid = 0, active = null;
const deskSize = () => ({ w: desktop.clientWidth, h: desktop.clientHeight });

function makeDraggable(handle, target, { canDrag = () => true, onTap, onDown } = {}) {
  handle.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.tbtns')) return;
    if (onDown) onDown(e);
    if (!canDrag()) return;
    const sx = e.clientX, sy = e.clientY, ox = target.offsetLeft, oy = target.offsetTop;
    let moved = false;
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const ds = deskSize();
      target.style.left = clamp(ox + dx, 60 - target.offsetWidth, ds.w - 60) + 'px';
      target.style.top = clamp(oy + dy, 0, ds.h - 26) + 'px';
    };
    const up = ev => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (!moved && onTap) onTap(ev);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

function focusWin(win) {
  wins.forEach(w => {
    w.el.classList.toggle('inactive', w !== win);
    if (w.task) w.task.classList.toggle('active', w === win && !w.min);
  });
  win.el.style.zIndex = ++zTop;
  active = win;
  if (win.task) win.task.classList.remove('flash');
}
function focusTop() {
  const next = [...wins.values()].filter(w => !w.min && !w.opts.dialog).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0]
    || [...wins.values()].filter(w => !w.min).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0];
  if (next) focusWin(next); else { active = null; wins.forEach(w => w.task && w.task.classList.remove('active')); }
}
function minimizeWin(win) { win.min = true; win.el.style.display = 'none'; if (win.task) win.task.classList.remove('active'); if (active === win) focusTop(); }
function restoreWin(win) { win.min = false; win.el.style.display = ''; focusWin(win); }
function toggleMax(win) {
  const s = win.el.style;
  if (win.max) {
    Object.assign(s, win.saved); win.el.classList.remove('max'); win.max = false;
  } else {
    win.saved = { left: s.left, top: s.top, width: s.width, height: s.height };
    Object.assign(s, { left: '0px', top: '0px', width: '100%', height: '100%' });
    win.el.classList.add('max'); win.max = true;
  }
}
function closeWin(win) {
  if (win.opts.onClose) win.opts.onClose(win);
  win.el.remove();
  if (win.task) win.task.remove();
  wins.delete(win.id);
  if (active === win) focusTop();
}

function createWindow(o) {
  if (o.id && wins.has(o.id)) { const ex = wins.get(o.id); if (ex.min) restoreWin(ex); else focusWin(ex); return ex; }
  const ds = deskSize();
  const w = Math.min(o.w || 400, ds.w - 6), ht = Math.min(o.h || 300, ds.h - 6);
  let x = o.x, y = o.y;
  if (x == null) { x = 40 + (cascade % 8) * 28; y = 24 + (cascade % 8) * 28; cascade++; }
  if (o.center) { x = (ds.w - w) / 2; y = Math.max(0, (ds.h - ht) / 3); }
  x = clamp(x, 0, Math.max(0, ds.w - w)); y = clamp(y, 0, Math.max(0, ds.h - ht));

  const win = { id: o.id || 'w' + (++uid), opts: o, min: false, max: false };
  const canMax = !o.dialog && o.resizable !== false;
  const bMin = h('button', { class: 'tb min', title: 'Minimize', 'aria-label': 'Minimize' });
  const bMax = h('button', { class: 'tb max', title: 'Maximize', 'aria-label': 'Maximize' });
  const bClose = h('button', { class: 'tb close', title: 'Close', 'aria-label': 'Close' });
  const titleText = h('span', { class: 'ttext' }, o.title);
  const bar = h('div', { class: 'titlebar' }, h('span', { class: 'ticon' }, o.icon || ''), titleText,
    h('div', { class: 'tbtns' }, !o.dialog && bMin, canMax && bMax, bClose));
  const body = h('div', { class: 'wbody' }, o.content);
  const el = h('div', { class: 'win', style: `left:${x}px;top:${y}px;width:${w}px;height:${ht}px` }, bar, body);
  Object.assign(win, { el, bar, titleText });

  if (!o.noTask) {
    win.task = h('button', { class: 'task', title: o.title }, (o.icon || '') + ' ', h('span', null, o.title));
    win.task.addEventListener('click', () => { if (win.min) restoreWin(win); else if (active === win) minimizeWin(win); else focusWin(win); });
    tasksBar.append(win.task);
  }
  el.addEventListener('pointerdown', () => { if (active !== win) focusWin(win); }, true);
  bMin.addEventListener('click', () => minimizeWin(win));
  bMax.addEventListener('click', () => toggleMax(win));
  bClose.addEventListener('click', () => closeWin(win));
  if (canMax) bar.addEventListener('dblclick', e => { if (!e.target.closest('.tbtns')) toggleMax(win); });
  makeDraggable(bar, el, { canDrag: () => !win.max });

  if (!o.dialog && o.resizable !== false) {
    const grip = h('div', { class: 'grip' });
    el.append(grip);
    grip.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, sw = el.offsetWidth, sh = el.offsetHeight;
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      const move = ev => {
        el.style.width = Math.max(o.minW || 260, sw + ev.clientX - sx) + 'px';
        el.style.height = Math.max(o.minH || 180, sh + ev.clientY - sy) + 'px';
      };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
  }
  wins.set(win.id, win);
  desktop.append(el);
  focusWin(win);
  return win;
}

function msgBox(title, text, icon = 'ℹ️') {
  const ok = h('button', { class: 'xp-btn' }, 'OK');
  const content = h('div', { class: 'fill msgbox' },
    h('div', { class: 'mb-row' }, h('span', { class: 'mb-icon' }, icon), h('div', { class: 'mb-text' }, text)),
    h('div', { class: 'mb-btns' }, ok));
  const win = createWindow({ title, icon: '💬', w: 360, h: 170, dialog: true, center: true, content, noTask: true });
  ok.addEventListener('click', () => closeWin(win));
  ok.focus();
}

/* =====================================================================
   Sound + notifications
   ===================================================================== */
let sfx = null;
function ding() {
  if (!state.sound) return;
  try {
    sfx = sfx || new (window.AudioContext || window.webkitAudioContext)();
    if (sfx.state === 'suspended') sfx.resume();
    const t = sfx.currentTime;
    [880, 1318].forEach((f, i) => {
      const o = sfx.createOscillator(), g = sfx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * .12);
      g.gain.exponentialRampToValueAtTime(.15, t + i * .12 + .02);
      g.gain.exponentialRampToValueAtTime(.0001, t + i * .12 + .28);
      o.connect(g); g.connect(sfx.destination);
      o.start(t + i * .12); o.stop(t + i * .12 + .32);
    });
  } catch (e) {}
}

let balloonTimer;
function showBalloon(title, text, onClick) {
  const b = $('#balloon');
  const x = h('span', { class: 'b-x', title: 'Close' }, '✕');
  b.replaceChildren(h('div', { class: 'b-title' }, h('span', null, '💬 ' + title), x), h('div', { class: 'b-text' }, text));
  b.style.display = 'block';
  x.addEventListener('click', ev => { ev.stopPropagation(); b.style.display = 'none'; });
  b.onclick = () => { b.style.display = 'none'; if (onClick) onClick(); };
  clearTimeout(balloonTimer);
  balloonTimer = setTimeout(() => { b.style.display = 'none'; }, 7000);
}

function notify(m, count) {
  ding();
  const cw = wins.get('chat');
  const visible = cw && !cw.min && active === cw && !document.hidden;
  if (visible) return;
  if (cw && cw.task) cw.task.classList.add('flash');
  const body = m.text || (m.files && m.files.length ? `sent ${m.files.length === 1 ? m.files[0].name : m.files.length + ' attachments'}` : '');
  showBalloon(m.name + (count > 1 ? ` (+${count - 1} more)` : ''), body, () => openChat());
  if (document.hidden) { state.unread += count; document.title = `(${state.unread}) Blue Chat Room`; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { state.unread = 0; document.title = 'Blue Chat Room'; } });

/* =====================================================================
   Chat window
   ===================================================================== */
const chat = { log: null, input: null, send: null, progress: null, pend: null, conn: null, users: null };

function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    frag.append(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer nofollow' }, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function buildAttachment(f) {
  const dl = h('a', { href: fileUrl(f, true), download: f.name, onclick: e => e.stopPropagation() }, 'Download');
  if (f.kind === 'image') {
    const img = h('img', { class: 'thumb', src: fileUrl(f), alt: f.name, loading: 'lazy', title: 'Click to preview', draggable: 'false' });
    img.addEventListener('click', () => openImage(f));
    img.addEventListener('load', () => { if (state.stick) scrollDown(); });
    return h('div', { class: 'att' }, img, h('div', { class: 'cap' }, h('span', { class: 'fname', title: f.name }, f.name), `(${fmtSize(f.size)})`, dl));
  }
  if (f.kind === 'audio') {
    return h('div', { class: 'att row' }, h('span', { class: 'ficon' }, '🎵'),
      h('div', { class: 'cap' }, h('span', { class: 'fname', title: f.name }, f.name), `(${fmtSize(f.size)})`,
        h('button', { class: 'xp-btn small', onclick: () => openPlayer(f) }, '▶ Play'), dl));
  }
  return h('div', { class: 'att row' }, h('span', { class: 'ficon' }, kindIcon(f)),
    h('div', { class: 'cap' }, h('span', { class: 'fname', title: f.name }, f.name), `(${fmtSize(f.size)})`, dl));
}

function buildMsg(m) {
  const d = h('div', { class: 'msg' + (m.c && m.c === state.cid ? ' mine' : '') },
    h('span', { class: 't' }, '[' + fmtClock(m.time) + ']'),
    h('span', { class: 'n' }, m.name + ':'), ' ');
  if (m.text) d.append(h('span', { class: 'x' }, linkify(m.text)));
  for (const f of (m.files || [])) d.append(buildAttachment(f));
  return d;
}
function scrollDown() { if (chat.log) chat.log.scrollTop = chat.log.scrollHeight; }

function setProgress(frac, show) {
  if (!chat.progress) return;
  chat.progress.classList.toggle('on', !!show);
  chat.progress.firstChild.style.width = Math.round((frac || 0) * 100) + '%';
}

function renderPending() {
  if (!chat.pend) return;
  chat.pend.replaceChildren(...state.pending.map((p, i) => h('span', { class: 'chip' },
    p.url ? h('img', { src: p.url, alt: '' }) : h('span', null, kindIcon({ name: p.file.name, kind: p.kind })),
    h('span', { class: 'cn', title: p.file.name }, p.file.name),
    h('span', { style: 'color:#666' }, fmtSize(p.file.size)),
    h('button', { title: 'Remove', onclick: () => { if (p.url) URL.revokeObjectURL(p.url); state.pending.splice(i, 1); renderPending(); } }, '✕'))));
}
function clearPending() { state.pending.forEach(p => p.url && URL.revokeObjectURL(p.url)); state.pending = []; renderPending(); }

function addFiles(files) {
  const cfg = state.config;
  for (let f of files) {
    if (!f.name) f = new File([f], 'image.' + (extOf(f.type.replace('/', '.')) || 'png'), { type: f.type });
    if (state.pending.length >= cfg.maxFiles) { msgBox('Blue Chat Room', `You can attach up to ${cfg.maxFiles} files per message.`, '⚠️'); break; }
    if (cfg.exts.length && !cfg.exts.includes(extOf(f.name))) {
      msgBox('File type not allowed', `"${f.name}" can't be sent. Allowed: images, mp3/mp2/wav audio, and common documents or zip files.`, '⛔'); continue;
    }
    if (f.size > cfg.maxFile) { msgBox('File too large', `"${f.name}" is ${fmtSize(f.size)}. The limit is ${fmtSize(cfg.maxFile)}.`, '⚠️'); continue; }
    const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : 'file';
    state.pending.push({ file: f, kind, url: kind === 'image' ? URL.createObjectURL(f) : null });
  }
  renderPending();
}

function sendMessage() {
  if (state.uploading) return;
  const text = chat.input.value.trim();
  if (!text && !state.pending.length) return;
  if (!state.name) { askName(); return; }
  const fd = new FormData();
  fd.append('name', state.name); fd.append('text', text); fd.append('cid', state.cid);
  state.pending.forEach(p => fd.append('files[]', p.file, p.file.name));
  const hasFiles = state.pending.length > 0;
  const xhr = new XMLHttpRequest();
  xhr.open('POST', API + '?action=post');
  state.uploading = true; chat.send.disabled = true; setProgress(0, hasFiles);
  const done = () => { state.uploading = false; if (chat.send) chat.send.disabled = false; setProgress(0, false); };
  xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(e.loaded / e.total, hasFiles); };
  xhr.onload = () => {
    done();
    let d = null; try { d = JSON.parse(xhr.responseText); } catch (e) {}
    if (xhr.status === 200 && d && d.ok) {
      if (chat.input) { chat.input.value = ''; chat.input.focus(); }
      clearPending(); state.stick = true; ingest([d.message]); scrollDown();
    } else {
      msgBox('Message not sent', (d && d.error) || `Server error (${xhr.status}).`, '⛔');
    }
  };
  xhr.onerror = () => { done(); msgBox('Message not sent', 'Could not reach the server.', '⛔'); };
  xhr.send(fd);
}

function openChat() {
  if (wins.has('chat')) { const w = wins.get('chat'); if (w.min) restoreWin(w); else focusWin(w); if (chat.input) chat.input.focus(); return w; }
  const log = h('div', { class: 'chatlog', tabindex: '0' });
  const input = h('textarea', { class: 'xp-input', rows: '2', maxlength: '2000', placeholder: 'Type a message…  (Enter = send, Shift+Enter = new line)' });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true });
  const pend = h('div', { class: 'pending' });
  const progress = h('div', { class: 'progress' }, h('div', { class: 'bar' }));
  const attachBtn = h('button', { class: 'xp-btn', title: 'Attach images, audio or files' }, '📎 Attach');
  const sendBtn = h('button', { class: 'xp-btn' }, 'Send');
  const soundBtn = h('button', { class: 'xp-btn small' }, state.sound ? '🔊 Sound on' : '🔇 Sound off');
  const conn = h('span', { class: 'sb-cell' }, 'Connecting…');
  const users = h('span', { class: 'sb-cell grow' }, '');

  const toolbar = h('div', { class: 'toolbar' },
    h('button', { class: 'xp-btn small', onclick: () => askName() }, '👤 Nickname'),
    h('button', { class: 'xp-btn small', onclick: () => openExplorer() }, '📁 Shared Files'),
    h('button', { class: 'xp-btn small', onclick: () => openPlayer() }, '🎵 Media Player'), soundBtn);
  const content = h('div', { class: 'fill chat' }, toolbar, log, pend, progress,
    h('div', { class: 'composer' }, input, h('div', { class: 'cbtns' }, attachBtn, sendBtn)),
    h('div', { class: 'statusbar' }, conn, users), fileInput);

  soundBtn.addEventListener('click', () => { state.sound = !state.sound; store('bcr_sound', state.sound ? '1' : '0'); soundBtn.textContent = state.sound ? '🔊 Sound on' : '🔇 Sound off'; });
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); } });
  input.addEventListener('paste', e => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
  log.addEventListener('scroll', () => { state.stick = log.scrollHeight - log.scrollTop - log.clientHeight < 50; });
  content.addEventListener('dragover', e => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); content.classList.add('drop'); } });
  content.addEventListener('dragleave', e => { if (e.target === content || !content.contains(e.relatedTarget)) content.classList.remove('drop'); });
  content.addEventListener('drop', e => { e.preventDefault(); content.classList.remove('drop'); addFiles([...e.dataTransfer.files]); });

  Object.assign(chat, { log, input, send: sendBtn, progress, pend, conn, users });
  const ds = deskSize();
  const win = createWindow({
    id: 'chat', title: 'Blue Chat Room', icon: '💬', content, w: 580, h: 520, minW: 330, minH: 300,
    x: ds.w > 800 ? 110 : 4, y: 14,
    onClose: () => { Object.assign(chat, { log: null, input: null, send: null, progress: null, pend: null, conn: null, users: null }); },
  });
  state.messages.forEach(m => log.append(buildMsg(m)));
  renderPending(); state.stick = true; scrollDown(); updateStatus();
  input.focus();
  return win;
}

/* =====================================================================
   Login dialog
   ===================================================================== */
function askName() {
  const input = h('input', { class: 'xp-input', type: 'text', maxlength: '20', value: state.name, placeholder: 'Nickname' });
  const ok = h('button', { class: 'xp-btn' }, 'OK');
  const cancel = state.name ? h('button', { class: 'xp-btn' }, 'Cancel') : null;
  const content = h('div', { class: 'fill' },
    h('div', { class: 'login-banner' }, h('div', { class: 'lb-title' }, 'Blue Chat Room'), h('div', { class: 'lb-sub' }, 'Welcome')),
    h('div', { class: 'login-body' }, h('label', null, 'Choose a nickname to join the chat:'), input, h('div', { class: 'mb-btns' }, ok, cancel)));
  const win = createWindow({ id: 'login', title: 'Log On to Blue Chat Room', icon: '🔑', content, w: 370, h: 230, dialog: true, center: true, noTask: true });
  const submit = () => {
    const v = input.value.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!v) { input.focus(); return; }
    state.name = v; store('bcr_name', v); updateName(); closeWin(win);
    if (chat.input) chat.input.focus();
  };
  ok.addEventListener('click', submit);
  if (cancel) cancel.addEventListener('click', () => closeWin(win));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  input.focus(); input.select();
}
function updateName() { $('#sm-user').textContent = state.name || 'Guest'; }

/* =====================================================================
   Image viewer
   ===================================================================== */
function openImage(f) {
  const id = 'img-' + f.id;
  if (wins.has(id)) { const w = wins.get(id); if (w.min) restoreWin(w); else focusWin(w); return; }
  const img = h('img', { src: fileUrl(f), alt: f.name, draggable: 'false' });
  const view = h('div', { class: 'imgview fit' }, img);
  const dim = h('span', { class: 'sb-cell grow' }, 'Loading…');
  const fitBtn = h('button', { class: 'xp-btn small' }, '🔍 Actual size');
  const dlBtn = h('button', { class: 'xp-btn small' }, '💾 Download');
  const content = h('div', { class: 'fill' }, h('div', { class: 'toolbar' }, fitBtn, dlBtn),
    view, h('div', { class: 'statusbar' }, dim, h('span', { class: 'sb-cell' }, fmtSize(f.size))));
  const win = createWindow({ id, title: f.name, icon: '🖼️', content, w: 340, h: 300, minW: 230, minH: 190 });
  fitBtn.addEventListener('click', () => { const fit = view.classList.toggle('fit'); fitBtn.textContent = fit ? '🔍 Actual size' : '🔍 Fit to window'; });
  dlBtn.addEventListener('click', () => download(f));
  img.addEventListener('load', () => {
    const nw = img.naturalWidth, nh = img.naturalHeight, ds = deskSize();
    dim.textContent = `${nw} × ${nh} pixels`;
    if (win.max) return;
    const ww = clamp(nw + 14, 260, Math.max(260, Math.min(ds.w - 6, ds.w * .85)));
    const wh = clamp(nh + 100, 230, Math.max(230, Math.min(ds.h - 6, ds.h * .92)));
    win.el.style.width = ww + 'px'; win.el.style.height = wh + 'px';
    win.el.style.left = clamp(win.el.offsetLeft, 0, Math.max(0, ds.w - ww)) + 'px';
    win.el.style.top = clamp(win.el.offsetTop, 0, Math.max(0, ds.h - wh)) + 'px';
  });
  img.addEventListener('error', () => { dim.textContent = 'This image could not be loaded.'; });
}

/* =====================================================================
   Shared files (explorer)
   ===================================================================== */
const expl = { body: null, status: null, sel: null };
function openExplorer() {
  if (wins.has('explorer')) { const w = wins.get('explorer'); if (w.min) restoreWin(w); else focusWin(w); return; }
  const open = h('button', { class: 'xp-btn small' }, '📂 Open');
  const dl = h('button', { class: 'xp-btn small' }, '💾 Download');
  const body = h('div', { class: 'flist' });
  const status = h('div', { class: 'statusbar' }, h('span', { class: 'sb-cell grow' }, ''));
  const content = h('div', { class: 'fill' }, h('div', { class: 'toolbar' }, open, dl),
    h('div', { class: 'addr' }, h('span', null, 'Address'), h('div', { class: 'box' }, '📁 My Network Places\\Blue Chat Room\\Shared Files')),
    body, status);
  Object.assign(expl, { body, status, sel: null });
  open.addEventListener('click', () => { const f = allFiles().find(x => x.id === expl.sel); if (f) openFile(f); });
  dl.addEventListener('click', () => { const f = allFiles().find(x => x.id === expl.sel); if (f) download(f); });
  const ds = deskSize();
  createWindow({ id: 'explorer', title: 'Shared Files', icon: '📁', content, w: 560, h: 340, minW: 320, minH: 200, x: ds.w > 800 ? 220 : 10, y: 120,
    onClose: () => { expl.body = null; } });
  refreshExplorer();
}
function openFile(f) { if (f.kind === 'image') openImage(f); else if (f.kind === 'audio') openPlayer(f); else download(f); }
function refreshExplorer() {
  if (!expl.body) return;
  const files = allFiles().reverse();
  const rows = files.map(f => {
    const tr = h('tr', { class: f.id === expl.sel ? 'sel' : '' },
      h('td', null, kindIcon(f) + ' ' + f.name), h('td', null, f.kind === 'file' ? extOf(f.name).toUpperCase() + ' File' : f.kind === 'image' ? 'Image' : 'Audio'),
      h('td', null, fmtSize(f.size)), h('td', null, f.from), h('td', null, fmtDate(f.time)));
    tr.addEventListener('click', () => { expl.sel = f.id; refreshExplorer(); });
    tr.addEventListener('dblclick', () => openFile(f));
    return tr;
  });
  expl.body.replaceChildren(files.length
    ? h('table', null, h('thead', null, h('tr', null, ['Name', 'Type', 'Size', 'Shared by', 'Date'].map(t => h('th', null, t)))), h('tbody', null, rows))
    : h('div', { class: 'empty' }, 'No files have been shared yet. Attach something in the chat!'));
  expl.status.firstChild.textContent = `${files.length} object(s)`;
}

/* =====================================================================
   Windows Media Player 9 style player
   ===================================================================== */
const wmp = { audio: null, ctx: null, an: null, data: null, cur: null, raf: 0, ui: null };
const playlist = () => allFiles().filter(f => f.kind === 'audio');

function openPlayer(f) {
  let win = wins.get('wmp');
  if (!win) win = buildPlayer();
  else if (win.min) restoreWin(win); else focusWin(win);
  if (f) loadTrack(f, true);
}

function buildPlayer() {
  const audio = new Audio();
  audio.preload = 'metadata';
  const canvas = h('canvas');
  const title = h('div', { class: 'wmp-title' }, 'Windows Media Player');
  const msg = h('div', { class: 'wmp-msg' }, 'Choose a song from the chat or the playlist.');
  const listEl = h('div', { class: 'wmp-list' });
  const tabList = h('button', { class: 'wmp-tab on' }, 'Playlist');
  const seek = h('input', { type: 'range', min: '0', max: '1000', value: '0', step: '1', 'aria-label': 'Seek' });
  const vol = h('input', { type: 'range', class: 'vol', min: '0', max: '100', value: '80', 'aria-label': 'Volume' });
  const bPrev = h('button', { class: 'rb', title: 'Previous' }, '|◀');
  const bStop = h('button', { class: 'rb', title: 'Stop' }, '■');
  const bPlay = h('button', { class: 'rb big', title: 'Play' }, '▶');
  const bNext = h('button', { class: 'rb', title: 'Next' }, '▶|');
  const bMute = h('button', { class: 'rb', title: 'Mute' }, '🔊');
  const lcd = h('div', { class: 'lcd' }, '00:00 / 00:00');
  const status = h('div', { class: 'wmp-status' }, 'Ready');

  const content = h('div', { class: 'fill wmp' },
    h('div', { class: 'wmp-top' }, h('button', { class: 'wmp-tab on' }, 'Now Playing'), tabList, h('span', { class: 'wmp-brand' }, 'Windows Media Player')),
    h('div', { class: 'wmp-main' }, h('div', { class: 'wmp-view' }, canvas, title, msg), listEl),
    h('div', { class: 'wmp-seek' }, seek),
    h('div', { class: 'wmp-ctrl' }, bStop, bPrev, bPlay, bNext, bMute, vol, lcd),
    status);

  const ds = deskSize();
  const win = createWindow({
    id: 'wmp', title: 'Windows Media Player', icon: '🎵', content, w: 560, h: 400, minW: 360, minH: 300,
    x: ds.w > 800 ? ds.w - 600 : 6, y: 70,
    onClose: () => {
      cancelAnimationFrame(wmp.raf);
      audio.pause(); audio.removeAttribute('src'); audio.load();
      try { if (wmp.ctx) wmp.ctx.close(); } catch (e) {}
      Object.assign(wmp, { audio: null, ctx: null, an: null, data: null, cur: null, ui: null });
    },
  });
  Object.assign(wmp, { audio, ctx: null, an: null, data: null, cur: null, ui: { title, msg, listEl, seek, bPlay, bMute, lcd, status, win, canvas } });

  let seeking = false;
  audio.volume = .8;
  tabList.addEventListener('click', () => { listEl.classList.toggle('hide'); tabList.classList.toggle('on'); });
  bPlay.addEventListener('click', () => {
    if (!wmp.cur) { const l = playlist(); if (l.length) loadTrack(l[0], true); return; }
    if (audio.paused) { startAudio(); } else audio.pause();
  });
  bStop.addEventListener('click', () => { audio.pause(); audio.currentTime = 0; setStatus('Stopped'); });
  bPrev.addEventListener('click', () => step(-1));
  bNext.addEventListener('click', () => step(1));
  bMute.addEventListener('click', () => { audio.muted = !audio.muted; bMute.textContent = audio.muted ? '🔇' : '🔊'; });
  vol.addEventListener('input', () => { audio.volume = vol.value / 100; if (audio.muted && vol.value > 0) { audio.muted = false; bMute.textContent = '🔊'; } });
  seek.addEventListener('input', () => { seeking = true; if (isFinite(audio.duration)) { audio.currentTime = seek.value / 1000 * audio.duration; updateTime(); } });
  seek.addEventListener('change', () => { seeking = false; });
  const updateTime = () => {
    const d = audio.duration;
    lcd.textContent = `${fmtTime(audio.currentTime)} / ${isFinite(d) ? fmtTime(d) : '--:--'}`;
    if (!seeking && isFinite(d) && d > 0) seek.value = String(audio.currentTime / d * 1000);
  };
  audio.addEventListener('timeupdate', updateTime);
  audio.addEventListener('loadedmetadata', updateTime);
  audio.addEventListener('play', () => { bPlay.textContent = '❚❚'; bPlay.title = 'Pause'; msg.textContent = ''; setStatus('Playing: ' + (wmp.cur ? wmp.cur.name : '')); });
  audio.addEventListener('pause', () => { bPlay.textContent = '▶'; bPlay.title = 'Play'; if (!audio.ended && audio.currentTime > 0) setStatus('Paused'); });
  audio.addEventListener('waiting', () => setStatus('Buffering…'));
  audio.addEventListener('playing', () => setStatus('Playing: ' + (wmp.cur ? wmp.cur.name : '')));
  audio.addEventListener('ended', () => { const l = playlist(); const i = l.findIndex(x => wmp.cur && x.id === wmp.cur.id); if (i >= 0 && i < l.length - 1) step(1); else { setStatus('Stopped'); audio.currentTime = 0; seek.value = '0'; } });
  audio.addEventListener('error', () => {
    const f = wmp.cur;
    msg.textContent = `Windows Media Player cannot play this file in your browser${f ? ' (.' + extOf(f.name) + ')' : ''}. You can still download it from the chat.`;
    setStatus('Cannot play this file');
  });

  cancelAnimationFrame(wmp.raf);
  drawViz();
  renderPlaylist();
  return win;
}

function setStatus(t) { if (wmp.ui) wmp.ui.status.textContent = t; }

function ensureAnalyser() {
  if (wmp.ctx || !wmp.audio) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(wmp.audio);
    const an = ctx.createAnalyser();
    an.fftSize = 256; an.smoothingTimeConstant = .8;
    src.connect(an); an.connect(ctx.destination);
    Object.assign(wmp, { ctx, an, data: new Uint8Array(an.frequencyBinCount) });
  } catch (e) {}
}
function startAudio() {
  ensureAnalyser();
  if (wmp.ctx && wmp.ctx.state === 'suspended') wmp.ctx.resume();
  wmp.audio.play().catch(() => setStatus('Press Play to start'));
}

function loadTrack(f, autoplay) {
  if (!wmp.audio) return;
  wmp.cur = f;
  wmp.ui.msg.textContent = '';
  wmp.ui.title.textContent = f.name;
  wmp.ui.win.titleText.textContent = f.name + ' - Windows Media Player';
  wmp.audio.src = fileUrl(f);
  wmp.ui.seek.value = '0';
  setStatus('Opening: ' + f.name);
  renderPlaylist();
  if (autoplay) startAudio();
}
function step(d) {
  const l = playlist();
  if (!l.length) return;
  const i = l.findIndex(x => wmp.cur && x.id === wmp.cur.id);
  if (d < 0 && wmp.audio.currentTime > 3) { wmp.audio.currentTime = 0; return; }
  const n = i + d;
  if (n >= 0 && n < l.length) loadTrack(l[n], true);
}
function renderPlaylist() {
  if (!wmp.ui) return;
  const l = playlist();
  wmp.ui.listEl.replaceChildren(...(l.length
    ? l.map((f, i) => h('div', { class: 'row' + (wmp.cur && wmp.cur.id === f.id ? ' on' : ''), title: f.name, onclick: () => loadTrack(f, true) }, `${i + 1}. ${f.name}`))
    : [h('div', { class: 'none' }, 'No audio shared yet.')]));
}
function refreshPlayerList() { renderPlaylist(); }

function drawViz() {
  wmp.raf = requestAnimationFrame(drawViz);
  const ui = wmp.ui;
  if (!ui || ui.win.min) return;
  const c = ui.canvas, W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,12,.3)'; g.fillRect(0, 0, W, H);
  const playing = wmp.an && wmp.audio && !wmp.audio.paused;
  if (playing) wmp.an.getByteFrequencyData(wmp.data);
  const n = Math.max(16, Math.floor(W / 13)), bw = W / n, t = performance.now() / 1000;
  for (let i = 0; i < n; i++) {
    const v = playing ? wmp.data[Math.floor(i / n * wmp.data.length * .75)] / 255 : .05 + .035 * Math.sin(t * 2 + i * .45);
    const bh = Math.max(2, v * H * .86);
    g.fillStyle = `hsl(${205 + v * 55},100%,${38 + v * 32}%)`;
    g.fillRect(i * bw + 1, H - bh, bw - 2, bh);
    g.fillStyle = `hsla(${205 + v * 55},100%,60%,.18)`;
    g.fillRect(i * bw + 1, H - bh - 6, bw - 2, 4);
  }
}

/* =====================================================================
   Message intake / polling
   ===================================================================== */
function ingest(list) {
  const fresh = [];
  for (const m of list) {
    if (state.seen.has(m.id)) continue;
    state.seen.add(m.id); state.messages.push(m);
    state.lastId = Math.max(state.lastId, m.id); fresh.push(m);
  }
  if (!fresh.length) return;
  if (chat.log) { const stick = state.stick; fresh.forEach(m => chat.log.append(buildMsg(m))); if (stick) scrollDown(); }
  refreshExplorer(); refreshPlayerList();
  if (state.loaded) {
    const others = fresh.filter(m => !(m.c && m.c === state.cid));
    if (others.length) notify(others[others.length - 1], others.length);
  }
}

function updateStatus(online) {
  if (online != null) state.online = online;
  if (chat.conn) chat.conn.textContent = state.connected === false ? 'Reconnecting…' : 'Connected';
  if (chat.users) chat.users.textContent = state.users && state.users.length ? `Online (${state.users.length}): ${state.users.join(', ')}` : '';
  $('#tray-users').textContent = '👥 ' + (state.users ? state.users.length : 0);
}

async function poll() {
  try {
    const url = `${API}?action=fetch&since=${state.lastId}&cid=${state.cid}&name=${encodeURIComponent(state.name)}`;
    const r = await fetch(url, { cache: 'no-store' });
    const d = await r.json();
    if (!d.ok) throw new Error('bad response');
    if (d.config) state.config = d.config;
    if (d.last < state.lastId) {
      state.messages = []; state.seen = new Set(); state.lastId = 0; state.loaded = false;
      if (chat.log) chat.log.replaceChildren();
      setTimeout(poll, 100); return;
    }
    ingest(d.messages);
    if (!state.loaded) { state.loaded = true; scrollDown(); }
    state.users = d.users; state.connected = true;
  } catch (e) {
    state.connected = false;
  }
  updateStatus();
  setTimeout(poll, document.hidden ? 4000 : 1500);
}

/* =====================================================================
   Desktop icons, start menu, clock
   ===================================================================== */
function buildIcons() {
  const defs = [
    { label: 'Blue Chat Room', glyph: '💬', open: openChat },
    { label: 'Shared Files', glyph: '📁', open: openExplorer },
    { label: 'Windows Media Player', glyph: '🎵', open: () => openPlayer() },
  ];
  const icons = [];
  defs.forEach((d, i) => {
    const el = h('div', { class: 'icon', style: `left:10px;top:${10 + i * 92}px`, tabindex: '0' },
      h('div', { class: 'glyph' }, d.glyph), h('span', { class: 'label' }, d.label));
    const select = () => { icons.forEach(x => x.classList.remove('sel')); el.classList.add('sel'); };
    makeDraggable(el, el, { onDown: select, onTap: e => { if (e.pointerType === 'touch' || e.pointerType === 'pen') d.open(); } });
    el.addEventListener('dblclick', d.open);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') d.open(); });
    icons.push(el); desktop.append(el);
  });
  desktop.addEventListener('pointerdown', e => { if (e.target === desktop) icons.forEach(x => x.classList.remove('sel')); });
}

function setupStart() {
  const btn = $('#start'), menu = $('#startmenu');
  const close = () => { menu.style.display = 'none'; btn.classList.remove('open'); };
  btn.addEventListener('click', () => { const open = menu.style.display !== 'block'; menu.style.display = open ? 'block' : 'none'; btn.classList.toggle('open', open); });
  document.addEventListener('pointerdown', e => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(); });
  menu.addEventListener('click', e => {
    const it = e.target.closest('[data-action]');
    if (!it) return;
    close();
    ({
      chat: openChat, files: openExplorer, player: () => openPlayer(), nick: askName,
      about: () => msgBox('About Blue Chat Room', 'Blue Chat Room - a shared chat for everyone who visits this page. Share images, music and files, and drag the windows wherever you like.', '💬'),
      logoff: () => { state.name = ''; store('bcr_name', ''); updateName(); askName(); },
    })[it.dataset.action]();
  });
}

function tickClock() { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

/* ---------- go ---------- */
buildIcons(); setupStart(); tickClock(); setInterval(tickClock, 10000); updateName();
openChat();
if (!state.name) askName();
poll();
})();
