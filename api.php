<?php
declare(strict_types=1);

/*
 * Blue Chat Room - backend
 *   GET  api.php?action=fetch&since=ID&cid=...&name=...   new messages + presence + config
 *   POST api.php?action=post   (multipart: name, text, cid, files[])
 *   GET  api.php?action=file&id=<stored name>&n=<download name>[&dl=1]
 *
 * Requires PHP 7.4+ with the mbstring extension.
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;  // per file (also capped by php.ini limits)
const MAX_FILES      = 5;                 // per message
const MAX_TEXT       = 2000;
const MAX_NAME       = 20;
const KEEP_MESSAGES  = 300;               // older messages (and their files) are pruned
const RATE_COUNT     = 6;                 // max posts per IP ...
const RATE_WINDOW    = 10;                // ... in this many seconds
const KEEP_DELS      = 300;               // deletion notices kept so other browsers can catch up

// extension => [kind, mime]. Anything not listed is rejected. No SVG/HTML/PHP on purpose.
const TYPES = [
    'jpg'  => ['image', 'image/jpeg'], 'jpeg' => ['image', 'image/jpeg'],
    'png'  => ['image', 'image/png'],  'gif'  => ['image', 'image/gif'],
    'webp' => ['image', 'image/webp'], 'bmp'  => ['image', 'image/bmp'],
    'mp3'  => ['audio', 'audio/mpeg'], 'mp2'  => ['audio', 'audio/mpeg'],
    'wav'  => ['audio', 'audio/wav'],  'ogg'  => ['audio', 'audio/ogg'],
    'm4a'  => ['audio', 'audio/mp4'],  'mp1'  => ['audio', 'audio/mpeg'],
    'flac' => ['audio', 'audio/flac'],
    'txt'  => ['file', 'text/plain'],  'pdf'  => ['file', 'application/pdf'],
    'zip'  => ['file', 'application/zip'], '7z' => ['file', 'application/x-7z-compressed'],
    'rar'  => ['file', 'application/vnd.rar'],
    'doc'  => ['file', 'application/msword'], 'docx' => ['file', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    'xls'  => ['file', 'application/vnd.ms-excel'], 'xlsx' => ['file', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    'ppt'  => ['file', 'application/vnd.ms-powerpoint'], 'pptx' => ['file', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    'csv'  => ['file', 'text/csv'],    'rtf'  => ['file', 'application/rtf'],
];

$DATA   = __DIR__ . '/data';
$UPLOAD = __DIR__ . '/uploads';
$STORE  = $DATA . '/messages.json';
$PRES   = $DATA . '/presence.json';

header('X-Content-Type-Options: nosniff');

/* ---------- setup ---------- */
foreach ([$DATA, $UPLOAD] as $dir) {
    if (!is_dir($dir)) { @mkdir($dir, 0755, true); }
    $guard = $dir . '/.htaccess';
    if (is_dir($dir) && !is_file($guard)) {
        @file_put_contents($guard,
            "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n" .
            "<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
    }
}

/* ---------- helpers ---------- */
function out(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $msg, int $status = 400): void {
    out(['ok' => false, 'error' => $msg], $status);
}

function ini_bytes(string $v): int {
    $v = trim($v);
    if ($v === '') return PHP_INT_MAX;
    $n = (int)$v;
    switch (strtolower(substr($v, -1))) {
        case 'g': $n *= 1024;
        case 'm': $n *= 1024;
        case 'k': $n *= 1024;
    }
    return $n > 0 ? $n : PHP_INT_MAX;
}

function max_file_bytes(): int {
    return min(MAX_FILE_BYTES, ini_bytes((string)ini_get('upload_max_filesize')), ini_bytes((string)ini_get('post_max_size')));
}

function clean_name(string $s): string {
    $s = (string)preg_replace('/[\p{C}]+/u', '', mb_scrub($s));
    $s = trim((string)preg_replace('/\s+/u', ' ', $s));
    return mb_substr($s, 0, MAX_NAME);
}

function clean_text(string $s): string {
    $s = str_replace(["\r\n", "\r"], "\n", mb_scrub($s));
    $s = (string)preg_replace('/[^\P{C}\n\t]+/u', '', $s);
    $s = (string)preg_replace("/\n{4,}/", "\n\n\n", $s);
    return trim(mb_substr($s, 0, MAX_TEXT));
}

function clean_filename(string $s): string {
    $s = basename(str_replace('\\', '/', mb_scrub($s)));
    $s = (string)preg_replace('/[\p{C}<>:"|?*\/\\\\]+/u', '', $s);
    $s = trim($s, " .");
    if ($s === '') $s = 'file';
    return mb_substr($s, -80);
}

function store_open(string $path, int $lock) {
    $fh = fopen($path, 'c+');
    if (!$fh) fail('Server storage is not writable. Check permissions on the data/ folder.', 500);
    flock($fh, $lock);
    return $fh;
}

function store_read($fh): array {
    rewind($fh);
    $raw = stream_get_contents($fh);
    $d = $raw ? json_decode($raw, true) : null;
    if (!is_array($d) || !isset($d['messages']) || !is_array($d['messages'])) {
        $d = ['next' => 1, 'messages' => [], 'dseq' => 0, 'dels' => []];
    }
    if (!isset($d['next'])) $d['next'] = 1;
    if (!isset($d['dseq'])) $d['dseq'] = 0;
    if (!isset($d['dels']) || !is_array($d['dels'])) $d['dels'] = [];
    return $d;
}

function store_write($fh, array $d): void {
    rewind($fh);
    ftruncate($fh, 0);
    fwrite($fh, json_encode($d, JSON_UNESCAPED_UNICODE));
    fflush($fh);
}

function public_msg(array $m): array {
    unset($m['h'], $m['k']);
    return $m;
}

function add_del(array &$d, int $id, ?string $file): void {
    $d['dseq'] = (int)$d['dseq'] + 1;
    $d['dels'][] = [$d['dseq'], $id, $file];
    if (count($d['dels']) > KEEP_DELS) $d['dels'] = array_slice($d['dels'], -KEEP_DELS);
}

function unlink_upload(string $dir, string $id): void {
    if (preg_match('/^[a-f0-9]{24}\.[a-z0-9]{2,4}$/', $id)) @unlink($dir . '/' . $id);
}

function presence(string $file, string $cid, string $name): array {
    $now = time();
    $fh = @fopen($file, 'c+');
    if (!$fh) return [];
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $p = $raw ? json_decode($raw, true) : [];
    if (!is_array($p)) $p = [];
    $changed = false;
    if ($cid !== '' && $name !== '' && (!isset($p[$cid]) || $now - (int)$p[$cid]['t'] >= 8 || $p[$cid]['n'] !== $name)) {
        $p[$cid] = ['t' => $now, 'n' => $name];
        $changed = true;
    }
    foreach ($p as $k => $v) {
        if ($now - (int)$v['t'] > 30) { unset($p[$k]); $changed = true; }
    }
    if ($changed) {
        rewind($fh); ftruncate($fh, 0); fwrite($fh, json_encode($p, JSON_UNESCAPED_UNICODE)); fflush($fh);
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    $names = [];
    foreach ($p as $v) $names[$v['n']] = true;
    return array_slice(array_keys($names), 0, 40);
}

function normalize_files($f): array {
    if (!is_array($f) || !isset($f['name'])) return [];
    $out = [];
    if (is_array($f['name'])) {
        foreach ($f['name'] as $i => $n) {
            if ($f['error'][$i] === UPLOAD_ERR_NO_FILE) continue;
            $out[] = ['name' => (string)$n, 'tmp' => (string)$f['tmp_name'][$i], 'size' => (int)$f['size'][$i], 'error' => (int)$f['error'][$i]];
        }
    } elseif ($f['error'] !== UPLOAD_ERR_NO_FILE) {
        $out[] = ['name' => (string)$f['name'], 'tmp' => (string)$f['tmp_name'], 'size' => (int)$f['size'], 'error' => (int)$f['error']];
    }
    return $out;
}

/* ---------- routes ---------- */
$action = $_GET['action'] ?? '';

if ($action === 'fetch') {
    $since = (int)($_GET['since'] ?? 0);
    $cid   = preg_match('/^[a-f0-9]{16}$/', (string)($_GET['cid'] ?? '')) ? (string)$_GET['cid'] : '';
    $name  = clean_name((string)($_GET['name'] ?? ''));

    $fh = store_open($STORE, LOCK_SH);
    $d = store_read($fh);
    flock($fh, LOCK_UN);
    fclose($fh);

    $msgs = $d['messages'];
    $last = (int)$d['next'] - 1;
    $ds   = (int)($_GET['ds'] ?? 0);
    $dels = array_values(array_filter($d['dels'], fn($x) => (int)$x[0] > $ds));
    if ($since <= 0) {
        $msgs = array_slice($msgs, -100);
    } else {
        $msgs = array_values(array_filter($msgs, fn($m) => (int)$m['id'] > $since));
    }

    out([
        'ok'       => true,
        'last'     => $last,
        'dseq'     => (int)$d['dseq'],
        'dels'     => $dels,
        'messages' => array_map('public_msg', array_values($msgs)),
        'users'    => presence($PRES, $cid, $name),
        'config'   => ['maxFile' => max_file_bytes(), 'maxFiles' => MAX_FILES, 'exts' => array_keys(TYPES)],
    ]);
}

if ($action === 'post') {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('POST required.', 405);

    if (empty($_POST) && empty($_FILES) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
        $mb = round(ini_bytes((string)ini_get('post_max_size')) / 1048576);
        fail("That upload is bigger than this server allows (post_max_size is about {$mb} MB).", 413);
    }

    $name = clean_name((string)($_POST['name'] ?? ''));
    if ($name === '') fail('Please choose a nickname first.');
    $text = clean_text((string)($_POST['text'] ?? ''));
    $cid  = preg_match('/^[a-f0-9]{16}$/', (string)($_POST['cid'] ?? '')) ? (string)$_POST['cid'] : '';
    $files = normalize_files($_FILES['files'] ?? null);

    if ($text === '' && !$files) fail('Nothing to send.');
    if (count($files) > MAX_FILES) fail('You can attach up to ' . MAX_FILES . ' files per message.');

    $limit = max_file_bytes();
    $okImageTypes = [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_GIF, IMAGETYPE_BMP, defined('IMAGETYPE_WEBP') ? IMAGETYPE_WEBP : 18];
    $prepared = [];
    foreach ($files as $f) {
        $orig = clean_filename($f['name']);
        if ($f['error'] !== UPLOAD_ERR_OK) {
            $why = in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
                ? 'is larger than the server upload limit (' . round($limit / 1048576) . ' MB)'
                : 'could not be uploaded (error ' . $f['error'] . ')';
            fail("\"{$orig}\" {$why}.");
        }
        if ($f['size'] > $limit) fail("\"{$orig}\" is too large (limit " . round($limit / 1048576) . ' MB).');
        $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
        if (!isset(TYPES[$ext])) fail("\"{$orig}\": this file type is not allowed.");
        if (!is_uploaded_file($f['tmp'])) fail('Invalid upload.');
        [$kind, $mime] = TYPES[$ext];
        if ($kind === 'image') {
            $info = @getimagesize($f['tmp']);
            if (!$info || !in_array($info[2], $okImageTypes, true)) fail("\"{$orig}\" is not a valid image.");
        }
        $prepared[] = ['tmp' => $f['tmp'], 'name' => $orig, 'size' => $f['size'], 'ext' => $ext, 'kind' => $kind, 'mime' => $mime];
    }

    $h = substr(sha1(($_SERVER['REMOTE_ADDR'] ?? '') . 'bcr-salt'), 0, 12);
    $fh = store_open($STORE, LOCK_EX);
    $d = store_read($fh);

    $now = time();
    $recent = 0;
    foreach ($d['messages'] as $m) {
        if (($m['h'] ?? '') === $h && $now - (int)$m['time'] < RATE_WINDOW) $recent++;
    }
    if ($recent >= RATE_COUNT) {
        flock($fh, LOCK_UN); fclose($fh);
        fail('Slow down! You are sending messages too quickly.', 429);
    }

    $saved = [];
    foreach ($prepared as $p) {
        $id = bin2hex(random_bytes(12)) . '.' . $p['ext'];
        if (!move_uploaded_file($p['tmp'], $UPLOAD . '/' . $id)) {
            foreach ($saved as $s) @unlink($UPLOAD . '/' . $s['id']);
            flock($fh, LOCK_UN); fclose($fh);
            fail('Could not store the uploaded file. Check permissions on the uploads/ folder.', 500);
        }
        $saved[] = ['id' => $id, 'name' => $p['name'], 'size' => $p['size'], 'kind' => $p['kind'], 'mime' => $p['mime']];
    }

    $token = bin2hex(random_bytes(16));
    $msg = ['id' => (int)$d['next'], 'time' => $now, 'name' => $name, 'text' => $text, 'files' => $saved, 'c' => $cid, 'h' => $h, 'k' => hash('sha256', $token)];
    $d['messages'][] = $msg;
    $d['next'] = $msg['id'] + 1;

    if (count($d['messages']) > KEEP_MESSAGES) {
        $drop = array_splice($d['messages'], 0, count($d['messages']) - KEEP_MESSAGES);
        foreach ($drop as $old) {
            foreach (($old['files'] ?? []) as $of) unlink_upload($UPLOAD, (string)$of['id']);
            add_del($d, (int)$old['id'], null);
        }
    }

    store_write($fh, $d);
    flock($fh, LOCK_UN);
    fclose($fh);
    out(['ok' => true, 'message' => public_msg($msg), 'token' => $token]);
}

if ($action === 'delete') {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('POST required.', 405);
    $id    = (int)($_POST['id'] ?? 0);
    $token = (string)($_POST['token'] ?? '');
    $file  = (string)($_POST['file'] ?? '');
    if ($id <= 0 || $token === '') fail('Missing delete information.');

    $fh = store_open($STORE, LOCK_EX);
    $d = store_read($fh);
    $idx = null;
    foreach ($d['messages'] as $i => $m) { if ((int)$m['id'] === $id) { $idx = $i; break; } }
    if ($idx === null) { flock($fh, LOCK_UN); fclose($fh); fail('That message no longer exists.', 404); }
    $m = $d['messages'][$idx];
    if (empty($m['k']) || !hash_equals((string)$m['k'], hash('sha256', $token))) {
        flock($fh, LOCK_UN); fclose($fh);
        fail('You can only delete things you posted from this browser.', 403);
    }

    if ($file !== '') {
        $keep = [];
        $found = false;
        foreach (($m['files'] ?? []) as $f) {
            if ((string)$f['id'] === $file) { unlink_upload($UPLOAD, $file); $found = true; } else { $keep[] = $f; }
        }
        if (!$found) { flock($fh, LOCK_UN); fclose($fh); fail('File not found.', 404); }
        add_del($d, $id, $file);
        if ($keep || $m['text'] !== '') {
            $d['messages'][$idx]['files'] = $keep;
        } else {
            array_splice($d['messages'], $idx, 1);
            add_del($d, $id, null);
        }
    } else {
        foreach (($m['files'] ?? []) as $f) unlink_upload($UPLOAD, (string)$f['id']);
        array_splice($d['messages'], $idx, 1);
        add_del($d, $id, null);
    }
    store_write($fh, $d);
    flock($fh, LOCK_UN);
    fclose($fh);
    out(['ok' => true]);
}

if ($action === 'file') {
    $id = (string)($_GET['id'] ?? '');
    if (!preg_match('/^[a-f0-9]{24}\.([a-z0-9]{2,4})$/', $id, $m) || !isset(TYPES[$m[1]])) { http_response_code(404); exit; }
    $path = $UPLOAD . '/' . $id;
    if (!is_file($path)) { http_response_code(404); exit; }

    [$kind, $mime] = TYPES[$m[1]];
    $download = !empty($_GET['dl']) || $kind === 'file';
    $dlName = clean_filename((string)($_GET['n'] ?? $id));
    $ascii = (string)preg_replace('/[^A-Za-z0-9._ -]/', '_', $dlName);

    $size = filesize($path);
    $start = 0;
    $end = $size - 1;
    $status = 200;
    if ($size > 0 && isset($_SERVER['HTTP_RANGE']) && preg_match('/^bytes=(\d*)-(\d*)$/', trim($_SERVER['HTTP_RANGE']), $r)) {
        if ($r[1] === '' && $r[2] !== '') {
            $start = max(0, $size - (int)$r[2]);
        } elseif ($r[1] !== '') {
            $start = (int)$r[1];
            if ($r[2] !== '') $end = min($end, (int)$r[2]);
        }
        if ($start > $end || $start >= $size) {
            http_response_code(416);
            header('Content-Range: bytes */' . $size);
            exit;
        }
        $status = 206;
    }

    while (ob_get_level() > 0) ob_end_clean();
    http_response_code($status);
    header('Content-Type: ' . ($kind === 'file' ? 'application/octet-stream' : $mime));
    header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode($dlName));
    header("Content-Security-Policy: default-src 'none'; sandbox");
    header('Accept-Ranges: bytes');
    header('Cache-Control: public, max-age=86400, immutable');
    header('Content-Length: ' . ($end - $start + 1));
    if ($status === 206) header("Content-Range: bytes {$start}-{$end}/{$size}");

    set_time_limit(0);
    $fp = fopen($path, 'rb');
    fseek($fp, $start);
    $left = $end - $start + 1;
    while ($left > 0 && !feof($fp)) {
        $chunk = fread($fp, min(65536, $left));
        if ($chunk === false || $chunk === '') break;
        echo $chunk;
        $left -= strlen($chunk);
        flush();
    }
    fclose($fp);
    exit;
}

fail('Unknown action.', 404);
