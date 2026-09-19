<?php
declare(strict_types=1);

/* ───────────────────────────────────────────────
   auth.php — koder's login (single user).

   Data lives outside the document root: api.php (BASE = the site)
   cannot reach it, so nobody inside koder can delete the password
   or reopen the setup screen.

   With no pass.json the login screen asks you to define a password.
   Create it BEFORE removing any Basic Auth you had in front.
   ─────────────────────────────────────────────── */

require_once __DIR__ . '/config.php';

define('K_DATA', KODER_DATA);
define('K_PASS', K_DATA . '/pass.json');
const K_TTL = 60 * 60 * 24 * 30;                          // session: 30 days since last use
const K_RL  = ['free' => 5, 'base' => 30, 'max' => 3600]; // free tries · first lockout · ceiling (seconds)
const K_MIN = 16;                                         // minimum password length

function k_read(string $f): array {
	$j = is_file($f) ? json_decode((string)@file_get_contents($f), true) : null;
	return is_array($j) ? $j : [];
}
function k_write(string $f, array $d): bool {
	$dir = dirname($f);
	return (is_dir($dir) || @mkdir($dir, 0700, true))
		&& @file_put_contents($f, json_encode($d), LOCK_EX) !== false;
}

/* ── session ────────────────────────────────── */

function k_cookie(): array {
	return [
		'path'     => rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/',
		'secure'   => true,
		'httponly' => true,
		'samesite' => 'Lax',
	];
}

function k_session(): void {
	static $ready = false;
	if (!$ready) {
		$dir = K_DATA . '/sessions';
		is_dir($dir) || @mkdir($dir, 0700, true);
		session_save_path($dir);
		session_name('koder');
		ini_set('session.use_strict_mode', '1');
		ini_set('session.gc_maxlifetime', (string)K_TTL);
		session_set_cookie_params(['lifetime' => K_TTL] + k_cookie());
		$ready = true;
	}
	if (session_status() !== PHP_SESSION_ACTIVE) session_start();
}

/** Valid session? Renews the expiry (server side too: we don't rely on GC)
 *  and releases the lock, otherwise parallel requests queue up. */
function k_authed(): bool {
	k_session();
	$ok = !empty($_SESSION['koder']) && time() - ($_SESSION['seen'] ?? 0) < K_TTL;
	if ($ok) {
		$_SESSION['seen'] = time();
		setcookie(session_name(), session_id(), ['expires' => time() + K_TTL] + k_cookie());
	}
	session_write_close();
	return $ok;
}

function k_start(): void {
	k_session();
	session_regenerate_id(true);
	$_SESSION = ['koder' => true, 'seen' => time()];
	session_write_close();
	@unlink(k_rl_file());
}

function k_logout(): void {
	k_session();
	$_SESSION = [];
	session_destroy();
	setcookie(session_name(), '', ['expires' => 1] + k_cookie());
}

/* ── rate limit per IP (REMOTE_ADDR: no trusted proxy in front) ── */

function k_rl_file(): string {
	return K_DATA . '/ratelimit/' . hash('sha256', $_SERVER['REMOTE_ADDR'] ?? '') . '.json';
}
function k_blocked(): int {
	return max(0, (int)(k_read(k_rl_file())['until'] ?? 0) - time());
}
function k_fail(): void {
	sleep(1); // fixed delay: invisible to a human, poison to a bot
	$f = k_rl_file();
	$d = k_read($f);
	$d['n'] = ($d['n'] ?? 0) + 1;
	$over = $d['n'] - K_RL['free'];
	if ($over > 0) $d['until'] = time() + (int)min(K_RL['base'] * 2 ** ($over - 1), K_RL['max']);
	k_write($f, $d);
}
function k_human(int $s): string {
	if ($s < 60) return $s . ' seconds';
	$m = (int)ceil($s / 60);
	return $m . ' minute' . ($m === 1 ? '' : 's');
}

/* ── gatekeeper for index.php ───────────────── */

function k_same_origin(): bool {
	$o = $_SERVER['HTTP_ORIGIN'] ?? '';
	return $o === '' || $o === 'https://' . ($_SERVER['HTTP_HOST'] ?? '');
}

/** First run: stores the hash. Returns the error, or '' if it worked. */
function k_setup(string $p): string {
	if (strlen($p) < K_MIN) return 'at least ' . K_MIN . ' characters';
	return k_write(K_PASS, ['hash' => password_hash($p, PASSWORD_DEFAULT)]) ? '' : 'could not write to ' . K_DATA;
}

/** With a session, walks through. Without one, handles the form and shows login.php. */
function k_gate(): void {
	if (k_authed()) return;

	$hash  = k_read(K_PASS)['hash'] ?? '';
	$setup = $hash === '';
	$error = '';

	if ($_SERVER['REQUEST_METHOD'] === 'POST') {
		$p = (string)($_POST['pass'] ?? '');
		if (!k_same_origin())      $error = 'invalid origin';
		elseif ($s = k_blocked())  $error = 'too many attempts — try again in ' . k_human($s);
		elseif ($setup)            $error = k_setup($p);
		elseif (!password_verify($p, $hash)) { k_fail(); $error = 'wrong password'; }

		if ($error === '') {
			k_start();
			header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'), true, 303);
			exit;
		}
	}
	require __DIR__ . '/login.php';
	exit;
}
