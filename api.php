<?php
declare(strict_types=1);

/* ───────────────────────────────────────────────
 api.php — koder's file system, on public hosting.
 It writes any file under BASE: that is a shell over the site.
 Access: auth.php session (k_authed) + X-Koder anti-CSRF header.
 If you touch either layer, review the other.
 ─────────────────────────────────────────────── */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/collect.php';
require_once __DIR__ . '/auth.php';

const BASE        = KODER_BASE;
const MAX_BYTES   = 4 * 1024 * 1024;     // bigger files are not opened
const MAX_HITS    = 400;                 // search result ceiling
const MAX_EXTRACT = 200 * 1024 * 1024;   // uncompressed ceiling (zip)
const ARCH_RE     = '/\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz2?|gz|bz2)$/i';
const SKIP_DIRS   = COLLECT_SKIP;

const TEXT_EXT = ['php','html','htm','js','mjs','cjs','jsx','ts','tsx','css','scss','sass','less',
	'json','md','markdown','txt','yml','yaml','xml','svg','sql','rb','erb','py','sh','bash','zsh',
	'env','ini','conf','cfg','toml','csv','log','gitignore','htaccess','lock','twig','blade','vue'];

ini_set('display_errors', '0');
error_reporting(E_ALL);

$in     = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$action = $_GET['a'] ?? ($in['a'] ?? '');

// anti-CSRF: a cookie travels with any request, wherever it comes from.
// A custom header is not sent cross-site without preflight; GET is navigation only.
$isGet = $_SERVER['REQUEST_METHOD'] === 'GET';
if ($isGet ? !in_array($action, ['raw', 'zip'], true) : ($_SERVER['HTTP_X_KODER'] ?? '') !== '1') {
	fail('request not allowed', 403);
}
if (!k_authed()) fail('session expired', 401);

function out(array $d): void {
		header('Content-Type: application/json; charset=utf-8');
		echo json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
		exit;
}
function fail(string $msg, int $code = 400): void {
		http_response_code($code);
		out(['error' => $msg]);
}
function inside(string $real): bool {
		$base = realpath(BASE) ?: '/';
		return $base === '/' || str_starts_with($real, rtrim($base, '/') . '/') || $real === $base;
}
function safe(string $p): string {
		$real = realpath($p);
		if ($real === false) fail('does not exist: ' . $p, 404);
		if (!inside($real))  fail('outside the allowed area', 403);
		return $real;
}
function validName(string $n): string {
		$n = trim($n);
		if ($n === '' || $n === '.' || $n === '..') fail('invalid name');
		if (strpbrk($n, "/\\\0") !== false) fail('the name cannot contain slashes');
		return $n;
}
function trashPath(string $root): string {
		return rtrim($root, '/') . '/.koder-trash';
}
function trashDir(string $root): string {
		$dir = trashPath($root);
		if (!is_dir($dir)) {
				if (!@mkdir($dir, 0755)) fail('could not create the trash folder (permissions)', 403);
				@file_put_contents($dir . '/.htaccess',
						"Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
		}
		return $dir;
}
function trashIndex(string $dir): array {
		$f = $dir . '/.index.json';
		$j = is_file($f) ? json_decode((string)@file_get_contents($f), true) : [];
		return is_array($j) ? $j : [];
}
function saveTrashIndex(string $dir, array $ix): void {
		@file_put_contents($dir . '/.index.json',
				json_encode($ix, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
}
function rmTree(string $p): void {
		if (is_dir($p) && !is_link($p)) {
				foreach (scandir($p) ?: [] as $c) {
						if ($c === '.' || $c === '..') continue;
						rmTree($p . '/' . $c);
				}
				@rmdir($p);
		} else {
				@unlink($p);
		}
}
function ext(string $name): string {
		$e = strtolower(pathinfo($name, PATHINFO_EXTENSION));
		return $e !== '' ? $e : strtolower(ltrim($name, '.'));
}
function is_text(string $name): bool {
		return in_array(ext($name), TEXT_EXT, true);
}
function uniq(string $dir, string $orig): string {
		$name = $orig;
		$n = 1;
		$dot = strrpos($orig, '.');
		while (file_exists($dir . '/' . $name)) {
				$name = $dot !== false
						? substr($orig, 0, $dot) . '~' . (++$n) . substr($orig, $dot)
						: $orig . '~' . (++$n);
		}
		return $name;
}

switch ($action) {

/* ── log out ────────────────────────────────── */
case 'logout': {
		k_logout();
		out(['ok' => true]);
}

/* ── contents of a folder ───────────────────── */
case 'ls': {
		$path = safe($in['path'] ?? $_GET['path'] ?? BASE);
		if (!is_dir($path)) fail('not a folder');

		$names = @scandir($path);
		if ($names === false) fail('cannot read: ' . $path . ' — permissions or open_basedir');

		$dirs = $files = [];
		foreach ($names as $name) {
				if ($name === '.' || $name === '..') continue;
				if ($name[0] === '.' && empty($in['hidden']) && !in_array($name, ['.env','.gitignore','.htaccess'], true)) continue;
				$full = rtrim($path, '/') . '/' . $name;
				$item = ['name' => $name, 'path' => $full, 'dir' => is_dir($full), 'ext' => ext($name)];
				if ($item['dir']) $dirs[] = $item; else $files[] = $item;
		}
		$cmp = fn($a, $b) => strnatcasecmp($a['name'], $b['name']);
		usort($dirs, $cmp);
		usort($files, $cmp);
		out(['path' => $path, 'items' => array_merge($dirs, $files)]);
}

/* ── read a file ────────────────────────────── */
case 'read': {
		$path = safe($in['path'] ?? $_GET['path'] ?? '');
		if (!is_file($path))                fail('not a file');
		if (filesize($path) > MAX_BYTES)    fail('file too large');
		$body = file_get_contents($path);
		if ($body === false)                fail('could not read', 500);
		if (strpos(substr($body, 0, 4096), "\0") !== false) fail('binary file');
		out(['path' => $path, 'content' => $body, 'ext' => ext($path)]);
}

/* ── save a file ────────────────────────────── */
case 'save': {
		$path = $in['path'] ?? '';
		if ($path === '') fail('missing path');
		$dir = realpath(dirname($path));
		if ($dir === false || !inside($dir)) fail('invalid path', 403);
		$full = rtrim($dir, '/') . '/' . basename($path);
		if (!is_writable(file_exists($full) ? $full : $dir)) fail('no write permission', 403);
		if (isset($in['b64'])) {
				$body = base64_decode((string)$in['b64'], true);
				if ($body === false) fail('invalid b64 content');
		} else {
				$body = (string)($in['content'] ?? '');
		}
		$bytes = file_put_contents($full, $body, LOCK_EX);
		if ($bytes === false) fail('could not write', 500);
		out(['ok' => true, 'path' => $full, 'bytes' => $bytes]);
}

/* ── check PHP syntax ───────────────────────── */
case 'lint': {
		$src = base64_decode((string)($in['b64'] ?? ''), true);
		if ($src === false)           fail('invalid b64 content');
		if (strlen($src) > MAX_BYTES) fail('file too large');

		$tmp = tempnam(sys_get_temp_dir(), 'klint');
		if ($tmp === false) fail('no temp files', 500);
		file_put_contents($tmp, $src);
		// -n ignores php.ini: no extensions or deprecations muddying the output
		$raw = (string)@shell_exec('php -n -l ' . escapeshellarg($tmp) . ' 2>&1');
		@unlink($tmp);

		if (preg_match('/error:\s*(.+?) in .+ on line (\d+)/i', $raw, $m)) {
				out(['ok' => false, 'line' => (int)$m[2],
						 'msg' => preg_replace('/^syntax error,\s*/i', '', trim($m[1]))]);
		}
		if (stripos($raw, 'No syntax errors') !== false) out(['ok' => true]);
		fail('the checker did not answer');
}

/* ── recursive search ───────────────────────── */
case 'search': {
		$root = safe($in['root'] ?? '');
		$q    = (string)($in['q'] ?? '');
		if (strlen($q) < 2) out(['hits' => [], 'files' => 0]);

		$hits = [];
		$scanned = 0;
		$needle = str_replace("\r\n", "\n", $q);
		$len    = max(1, strlen($needle));
		$stack  = [$root];

		while ($stack && count($hits) < MAX_HITS) {
				$dir = array_pop($stack);
				foreach (scandir($dir) ?: [] as $name) {
						if ($name === '.' || $name === '..') continue;
						if ($name === COLLECT_OUT) continue;
						if ($name[0] === '.' && $name !== '.env' && $name !== '.htaccess') continue;
						if (in_array($name, SKIP_DIRS, true)) continue;
						$full = rtrim($dir, '/') . '/' . $name;

						if (is_dir($full)) { $stack[] = $full; continue; }
						if (!is_text($name) || filesize($full) > MAX_BYTES) continue;

						$body = @file_get_contents($full);
						if ($body === false) continue;
						$body = str_replace("\r\n", "\n", $body);
						if (stripos($body, $needle) === false) continue;
						$scanned++;

						$n = 0;
						$from = 0;
						while (($p = stripos($body, $needle, $from)) !== false) {
								$lineStart = strrpos(substr($body, 0, $p), "\n");
								$lineStart = $lineStart === false ? 0 : $lineStart + 1;
								$lineEnd   = strpos($body, "\n", $p);
								$text      = substr($body, $lineStart, ($lineEnd === false ? strlen($body) : $lineEnd) - $lineStart);

								$hits[] = [
										'file' => $full,
										'rel'  => ltrim(substr($full, strlen($root)), '/'),
										'line' => substr_count($body, "\n", 0, $p) + 1,
										'col'  => mb_strlen(substr($body, $lineStart, $p - $lineStart)),
										'text' => trim(mb_substr($text, 0, 160)),
								];
								$from = $p + $len;
								if (++$n >= 20 || count($hits) >= MAX_HITS) break;
						}
				}
		}
		out(['hits' => $hits, 'files' => $scanned, 'capped' => count($hits) >= MAX_HITS]);
}

/* ── upload a file from disk (multipart) ────── */
case 'upload': {
		$dir = safe($_POST['dir'] ?? '');
		if (!is_dir($dir)) fail('not a folder');

		if (empty($_FILES['file'])) fail('no file arrived');
		$err = $_FILES['file']['error'];
		if ($err !== UPLOAD_ERR_OK) {
				$msg = [
						UPLOAD_ERR_INI_SIZE  => 'the file exceeds the server limit',
						UPLOAD_ERR_FORM_SIZE => 'the file exceeds the allowed limit',
						UPLOAD_ERR_PARTIAL   => 'the upload was cut off halfway',
						UPLOAD_ERR_NO_FILE   => 'no file arrived',
				][$err] ?? ('upload error (' . $err . ')');
				fail($msg);
		}

		$orig = basename((string)$_FILES['file']['name']);
		if ($orig === '') fail('invalid file name');

		$name = uniq($dir, $orig);
		$dest = $dir . '/' . $name;
		if (!@move_uploaded_file($_FILES['file']['tmp_name'], $dest)) fail('could not save on the server (permissions)', 500);
		out(['ok' => true, 'name' => $name]);
}

/* ── extract an archive on the server ───────── */
case 'extract': {
		$src = safe($in['path'] ?? '');
		if (!is_file($src)) fail('not a file');
		$base = basename($src);
		if (!preg_match(ARCH_RE, $base, $m)) fail('unsupported format');
		$kind = strtolower($m[1]);
		$dir  = dirname($src);
		$stem = substr($base, 0, -strlen($m[0])) ?: 'extracted';

		// lone compressed file: .gz / .bz2 → one file
		if ($kind === 'gz' || $kind === 'bz2') {
				$w = $kind === 'gz' ? 'compress.zlib' : 'compress.bzip2';
				if (!in_array($w, stream_get_wrappers(), true)) fail("$kind is not available in this PHP");
				$out = $dir . '/' . uniq($dir, $stem);
				if (!@copy("$w://$src", $out)) { @unlink($out); fail('could not decompress', 500); }
				out(['ok' => true, 'name' => basename($out)]);
		}

		$out = $dir . '/' . uniq($dir, $stem);
		if (!@mkdir($out, 0755)) fail('could not create the folder (permissions)', 403);
		$tmp = null;
		try {
				if ($kind === 'zip') {
						if (!class_exists('ZipArchive')) throw new Exception('ZipArchive is not available in this PHP');
						$z = new ZipArchive();
						if ($z->open($src) !== true) throw new Exception('broken or invalid zip');
						$total = 0;
						for ($i = 0; $i < $z->numFiles; $i++) {
								$s = $z->statIndex($i);
								if (preg_match('#(^|/)\.\.(/|$)|^/#', $s['name'])) throw new Exception('unsafe path: ' . $s['name']);
								$total += $s['size'];
						}
						if ($total > MAX_EXTRACT) throw new Exception('extracted size exceeds ' . (MAX_EXTRACT >> 20) . ' MB');
						if (!$z->extractTo($out)) throw new Exception('extraction failed');
						$z->close();
				} else {
						if (!class_exists('PharData')) throw new Exception('PharData is not available in this PHP');
						// Phar demands ".tar" in the name: tgz/tbz go through a temp copy
						$alias = ['tgz' => 'tar.gz', 'tbz' => 'tar.bz2', 'tbz2' => 'tar.bz2'][$kind] ?? null;
						if ($alias) {
								$tmp = sys_get_temp_dir() . '/koder-' . bin2hex(random_bytes(6)) . '.' . $alias;
								if (!@copy($src, $tmp)) throw new Exception('could not stage the archive');
						}
						(new PharData($tmp ?? $src))->extractTo($out, null, true);
				}
		} catch (Throwable $e) {
				rmTree($out);
				fail($e->getMessage());
		} finally {
				if ($tmp) @unlink($tmp);
		}
		out(['ok' => true, 'name' => basename($out)]);
}

/* ── create a file or folder ────────────────── */
case 'create': {
		$dir = safe($in['dir'] ?? '');
		if (!is_dir($dir)) fail('not a folder');
		$name = validName((string)($in['name'] ?? ''));
		$full = rtrim($dir, '/') . '/' . $name;
		if (file_exists($full)) fail('already exists: ' . $name);
		$ok = !empty($in['folder']) ? @mkdir($full, 0755) : (@file_put_contents($full, '') !== false);
		if (!$ok) fail('could not create (permissions)', 403);
		out(['ok' => true, 'path' => $full]);
}

/* ── rename / move: the same rename() with another destination ── */
case 'rename':
case 'move': {
		$path = safe($in['path'] ?? '');
		if ($action === 'move') {
			$dir = safe($in['dir'] ?? '');
			if (!is_dir($dir)) fail('the destination is not a folder');
			if (str_starts_with($dir . '/', $path . '/')) fail('cannot move a folder into itself');
			$name = basename($path);
		} else {
			$dir  = dirname($path);
			$name = validName((string)($in['name'] ?? ''));
		}
		$dest = rtrim($dir, '/') . '/' . $name;
		if ($dest === $path) out(['ok' => true, 'path' => $path]);
		if (file_exists($dest)) fail('already exists: ' . $name);
		if (!@rename($path, $dest)) fail('could not move (permissions)', 403);
		out(['ok' => true, 'path' => $dest]);
}

/* ── move to the trash ──────────────────────── */
case 'trash': {
		$path = safe($in['path'] ?? '');
		$root = safe($in['root'] ?? '');
		if ($path === $root) fail('cannot delete the folder that is open');
		$dir = trashDir($root);
		if (strpos($path, $dir) === 0) fail('already in the trash');

		$base = basename($path);
		$name = $base;
		$n = 1;
		while (file_exists($dir . '/' . $name)) $name = $base . '~' . (++$n);
		if (!@rename($path, $dir . '/' . $name)) fail('could not move to the trash (permissions)', 403);

		$ix = trashIndex($dir);
		$ix[$name] = ['from' => $path, 'at' => time()];
		saveTrashIndex($dir, $ix);
		out(['ok' => true]);
}

/* ── contents of the trash ──────────────────── */
case 'trashlist': {
		$root = safe($in['root'] ?? '');
		$dir  = trashPath($root);
		if (!is_dir($dir)) out(['items' => [], 'path' => $dir]);
		$ix = trashIndex($dir);
		$items = [];
		foreach (scandir($dir) ?: [] as $name) {
				if ($name === '.' || $name === '..' || $name === '.index.json' || $name === '.htaccess') continue;
				$full = $dir . '/' . $name;
				$items[] = [
						'name' => $name, 'path' => $full, 'dir' => is_dir($full), 'ext' => ext($name),
						'from' => (string)($ix[$name]['from'] ?? ''), 'at' => (int)($ix[$name]['at'] ?? 0),
				];
		}
		usort($items, fn($a, $b) => $b['at'] <=> $a['at']);
		out(['items' => $items, 'path' => $dir]);
}

/* ── restore from the trash ─────────────────── */
case 'restore': {
		$path = safe($in['path'] ?? '');
		$root = safe($in['root'] ?? '');
		$dir  = trashPath($root);
		if (strpos($path, $dir) !== 0) fail('not in the trash');

		$ix   = trashIndex($dir);
		$name = basename($path);
		$dest = (string)($ix[$name]['from'] ?? (rtrim($root, '/') . '/' . $name));
		if (!is_dir(dirname($dest))) fail('the original folder no longer exists');
		if (file_exists($dest))      fail('something with that name is already there');
		if (!@rename($path, $dest))  fail('could not restore (permissions)', 403);

		unset($ix[$name]);
		saveTrashIndex($dir, $ix);
		out(['ok' => true, 'path' => $dest]);
}

/* ── permanent delete ───────────────────────── */
case 'purge': {
		$root = safe($in['root'] ?? '');
		$dir  = trashPath($root);
		if (!is_dir($dir)) out(['ok' => true]);
		$ix = trashIndex($dir);

		if (!empty($in['path'])) {
				$target = safe($in['path']);
				if (strpos($target, $dir) !== 0) fail('outside the trash', 403);
				rmTree($target);
				unset($ix[basename($target)]);
		} else {
				foreach (scandir($dir) ?: [] as $c) {
						if ($c === '.' || $c === '..' || $c === '.index.json' || $c === '.htaccess') continue;
						rmTree($dir . '/' . $c);
				}
				$ix = [];
		}
		saveTrashIndex($dir, $ix);
		out(['ok' => true]);
}

/* ── preview: index of a folder ─────────────── */
case 'indexfor': {
		$dir = safe($in['path'] ?? '');
		if (!is_dir($dir)) fail('not a folder');

		$file = null;
		foreach (['index.php', 'index.html', 'index.htm'] as $name) {
				if (is_file($dir . '/' . $name)) { $file = $name; break; }
		}
		if ($file === null) out(['url' => null]);

		// the docroot comes from BASE: DOCUMENT_ROOT depends on which
		// (sub)domain is serving koder, which may not be the site itself
		$doc = realpath(BASE . '/public_html') ?: '';
		if ($doc === '' || !($dir === $doc || str_starts_with($dir, $doc . '/')))
				out(['url' => null, 'why' => 'this folder is outside the public site']);

		$rel = ltrim(substr($dir, strlen($doc)), '/');
		out(['url' => rtrim(KODER_SITE, '/') . '/' . ($rel !== '' ? $rel . '/' : '') . $file]);
}

/* ── fetch a page of the site (koder may live on another origin) ── */
case 'page': {
		$url = (string)($in['url'] ?? '');
		if (!str_starts_with($url, rtrim(KODER_SITE, '/') . '/')) fail('url outside the site');
		$c = curl_init($url . (str_contains($url, '?') ? '&' : '?') . 'kdr=' . time());
		curl_setopt_array($c, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_FOLLOWLOCATION => true,
			CURLOPT_TIMEOUT        => 15,
			CURLOPT_HTTPHEADER     => ['Cache-Control: no-cache']
		]);
		$html = curl_exec($c);
		$err  = curl_error($c);
		curl_close($c);
		if ($html === false) fail('could not fetch the page: ' . $err);
		out(['html' => mb_scrub($html, 'UTF-8')]);
}

/* ── collect the code into project.txt ──────── */
case 'collect': {
		@set_time_limit(120);
		$root = safe($in['root'] ?? '');
		if (!is_dir($root)) fail('not a folder');
		try { out(collect($root, $root . '/' . COLLECT_OUT)); }
		catch (RuntimeException $e) { fail($e->getMessage(), 500); }
}

/* ── check before navigating to the download ── */
case 'zipcheck': {
		if (!class_exists('ZipArchive')) fail('ZipArchive is not available in this PHP');
		$root = safe($in['path'] ?? '');
		if (!is_dir($root)) fail('not a folder');
		out(['ok' => true]);
}

/* ── export the folder as a zip ─────────────── */
case 'zip': {
		if (!class_exists('ZipArchive')) fail('ZipArchive is not available in this PHP');
		$root = safe($_GET['path'] ?? '');
		if (!is_dir($root)) fail('not a folder');

		$tmp = tempnam(sys_get_temp_dir(), 'koder');
		$zip = new ZipArchive();
		if ($zip->open($tmp, ZipArchive::OVERWRITE) !== true) fail('could not create the zip', 500);

		$base  = basename(rtrim($root, '/')) ?: 'export';
		$total = 0;
		$stack = [$root];

		while ($stack) {
				$dir = array_pop($stack);
				foreach (scandir($dir) ?: [] as $name) {
						if ($name === '.' || $name === '..') continue;
						if (in_array($name, SKIP_DIRS, true)) continue;
						$full = rtrim($dir, '/') . '/' . $name;
						$rel  = $base . '/' . ltrim(substr($full, strlen($root)), '/');

						if (is_dir($full)) { $zip->addEmptyDir($rel); $stack[] = $full; continue; }

						$size = (int)(filesize($full) ?: 0);
						if ($size > 20 * 1024 * 1024) continue;
						$total += $size;
						if ($total > 200 * 1024 * 1024) {
								$zip->close(); @unlink($tmp);
								fail('the folder exceeds the export limit');
						}
						$zip->addFile($full, $rel);
				}
		}
		$zip->close();

		header('Content-Type: application/zip');
		header('Content-Disposition: attachment; filename="' . $base . '.zip"');
		header('Content-Length: ' . filesize($tmp));
		readfile($tmp);
		@unlink($tmp);
		exit;
}

/* ── raw file (to drag outside the browser) ── */
case 'raw': {
		$path = safe($_GET['path'] ?? '');
		if (!is_file($path)) fail('not a file');
		$mime = function_exists('mime_content_type') ? (mime_content_type($path) ?: '') : '';
		header('Content-Type: ' . ($mime !== '' ? $mime : 'application/octet-stream'));
		header('Content-Disposition: attachment; filename="' . basename($path) . '"');
		header('Content-Length: ' . filesize($path));
		readfile($path);
		exit;
}

/* ── valid starting points ──────────────────── */
case 'roots': {
		$cands = [__DIR__, dirname(__DIR__)];
		foreach (explode(PATH_SEPARATOR, (string)ini_get('open_basedir')) as $p) {
				$p = trim($p);
				if ($p !== '') $cands[] = rtrim($p, '/');
		}
		$cands[] = (string)($_SERVER['DOCUMENT_ROOT'] ?? '');
		$cands[] = (string)(getenv('HOME') ?: '');
		$cands[] = '/';

		$ok = [];
		foreach ($cands as $p) {
				if ($p === '') continue;
				$r = realpath($p);
				if ($r === false || !is_dir($r) || !inside($r) || @scandir($r) === false) continue;
				$ok[$r] = true;
		}
		out(['roots' => array_keys($ok), 'open_basedir' => (string)ini_get('open_basedir')]);
}

default:
		fail('unknown action');
}
