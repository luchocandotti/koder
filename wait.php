<?php /* wait.php — pure view: $pending is set by k_gate() before the require.
         Never served directly (see .htaccess), only included from auth.php. */ ?>
<!doctype html>
<html lang="en">
<head>
<?php require __DIR__ . '/head.php'; ?>
</head>
<body class="login">
<div class="login-wrap">
	<div class="k0dr-logo">k0d3r</div>
	<div class="login-box">
		<p class="hint">Waiting for approval.</p>
		<div class="k0dr-code"><?= htmlspecialchars($pending['code']) ?></div>
		<p class="hint">Approve only if the notice shows this same number.</p>
	</div>
</div>
<script>
// The approval lands in a file, not in this page: polling is the only way
// to hear about it. On expiry the reload falls back to the login screen.
setInterval(async () => {
	try {
		const r = await (await fetch('check.php', { cache: 'no-store' })).json();
		if (r.state !== 'waiting') location.reload();
	} catch {}
}, 2000);
setTimeout(() => location.reload(), <?= (K_2FA_TTL + 2) * 1000 ?>);
</script>
</body>
</html>
