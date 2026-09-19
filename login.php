<?php /* login.php — pure view: $setup and $error are set by k_gate() before the require. */ ?>
<!doctype html>
<html lang="en">
<head>
<?php require __DIR__ . '/head.php'; ?>
</head>
<body class="login">
<div class="login-wrap">
	<div class="k0dr-logo">k0d3r</div>
	<form class="login-box" method="post">
		<?php if ($setup): ?><p class="hint">Set a password (at least <?= K_MIN ?> characters).</p><?php endif; ?>
		<?php if ($error): ?><p><?= htmlspecialchars($error) ?></p><?php endif; ?>
		<input name="u" value="koder" autocomplete="username" hidden>
		<input type="password" name="pass" placeholder="password" required autofocus
			autocomplete="<?= $setup ? 'new-password' : 'current-password' ?>">
		<button type="submit"><?= $setup ? 'create' : 'sign in' ?></button>
	</form>
</div>
</body>
</html>
