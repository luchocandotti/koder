<?php /* head.php — <head> shared by index.php and login.php. $editor = true adds CodeMirror. */ ?>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="koder">
<title>k0d3r</title>

<!-- Social preview: point og:url / og:image at your own install -->
<meta property="og:title" content="koder">
<meta property="og:description" content="A code editor that runs on the server it edits — built for working from an iPad or iPhone.">
<meta property="og:image" content="img/icon-512.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:image:alt" content="koder">

<!-- Favicons: drop your own PNGs in img/ (not shipped with the repo) -->
<link rel="icon" type="image/png" sizes="32x32" href="img/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="img/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="img/k-apple-touch-icon.png">
<meta name="theme-color" content="#8CC479">

<?php if (!empty($editor)): ?>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/show-hint.min.css">
<?php endif ?>
<script>try{document.documentElement.dataset.theme=(JSON.parse(localStorage.getItem('editor.session')||'{}').theme)||'citric'}catch(e){}</script>
<link rel="stylesheet" href="app.css?v=<?= @filemtime(__DIR__ . '/app.css') ?>">
