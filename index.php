<?php
// Blue Chat Room - main page. Version numbers on style/script force browsers to reload after updates.
$v = static function (string $f): int { return (int)@filemtime(__DIR__ . '/' . $f); };
header('Content-Type: text/html; charset=utf-8');
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blue Chat Room</title>
<link rel="stylesheet" href="style.css?v=<?= $v('style.css') ?>">
<link rel="stylesheet" href="extras.css?v=<?= $v('extras.css') ?>">
</head>
<body>

<div id="desktop"></div>

<div id="startmenu" role="menu">
  <div class="sm-head"><span class="sm-avatar">🙂</span><span id="sm-user">Guest</span></div>
  <div class="sm-cols">
    <div class="sm-left">
      <div class="sm-item" data-action="chat"><span>💬</span><b>Blue Chat Room</b></div>
      <div class="sm-item" data-action="player"><span>🎵</span><b>Windows Media Player</b></div>
      <div class="sm-item" data-action="browser"><span>🌐</span><b>Internet Explorer</b></div>
      <div class="sm-item" data-action="files"><span>📁</span><b>Shared Files</b></div>
    </div>
    <div class="sm-right">
      <div class="sm-item" data-action="wallpaper"><span>🖼️</span>Change Wallpaper</div>
      <div class="sm-item" data-action="nick"><span>👤</span>Change Nickname</div>
      <div class="sm-item" data-action="about"><span>❔</span>About</div>
    </div>
  </div>
  <div class="sm-foot"><button data-action="logoff">🔑 Log Off</button></div>
</div>

<div id="balloon"></div>

<div id="taskbar">
  <button id="start"><span class="flag"><i></i><i></i><i></i><i></i></span><span>start</span></button>
  <div id="tasks"></div>
  <div id="tray">
    <span id="tray-users" title="Users online">👥 0</span>
    <span id="clock"></span>
  </div>
</div>

<noscript><p style="position:fixed;top:40%;left:0;right:0;text-align:center;background:#fff;padding:20px">Blue Chat Room needs JavaScript.</p></noscript>
<script src="app.js?v=<?= $v('app.js') ?>"></script>
<?php foreach (['wallpaper', 'explorer', 'archive', 'browser'] as $m): ?>
<script src="<?= $m ?>.js?v=<?= $v($m . '.js') ?>"></script>
<?php endforeach; ?>
</body>
</html>
