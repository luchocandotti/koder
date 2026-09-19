<?php
declare(strict_types=1);

/* ───────────────────────────────────────────────
   collect.php — concatenates the code of a folder into one txt.
   Standalone: copy it as-is into any project.

   require __DIR__ . '/collect.php';
   collect(__DIR__, __DIR__ . '/project.txt');
   ─────────────────────────────────────────────── */

const COLLECT_EXT  = ['php','html','htm','js','mjs','cjs','jsx','ts','tsx','vue','css','scss','sass','less',
  'json','md','markdown','txt','yml','yaml','xml','sql','rb','erb','py','sh','bash','zsh',
  'ini','conf','cfg','toml','twig','blade','htaccess','gitignore'];
const COLLECT_DOTS = ['.htaccess', '.gitignore'];
const COLLECT_SKIP = ['.git','node_modules','vendor','dist','build','.cache','.next','__pycache__','.koder-trash'];
const COLLECT_MAX  = 4 * 1024 * 1024;
const COLLECT_OUT  = 'project.txt';

function collect(string $root, string $dest): array {
    $root = realpath($root);
    if ($root === false || !is_dir($root)) throw new RuntimeException('invalid folder');

    $tmp = $dest . '.tmp';
    $fh  = @fopen($tmp, 'wb');
    if (!$fh) throw new RuntimeException('no write permission in ' . dirname($dest));

    $n = 0;
    collect_walk($root, basename($dest), function (string $f) use ($fh, &$n): void {
        $body = @file_get_contents($f);
        if ($body === false || str_contains(substr($body, 0, 4096), "\0")) return;
        fwrite($fh, "-------------{$f}-------------\n\n" . rtrim($body) . "\n\n");
        $n++;
    });
    fclose($fh);

    if (!@rename($tmp, $dest)) {
        @unlink($tmp);
        throw new RuntimeException('could not save ' . basename($dest));
    }
    return ['path' => $dest, 'files' => $n, 'bytes' => filesize($dest)];
}

// files of the folder first (index.* up front), subfolders after
function collect_walk(string $dir, string $self, callable $emit): void {
    $files = $dirs = [];
    foreach (scandir($dir) ?: [] as $name) {
        if ($name === '.' || $name === '..' || $name === $self) continue;
        if (in_array($name, COLLECT_SKIP, true)) continue;
        if ($name[0] === '.' && !in_array($name, COLLECT_DOTS, true)) continue;
        $full = rtrim($dir, '/') . '/' . $name;
        if (is_dir($full)) { if (!is_link($full)) $dirs[] = $full; continue; }
        if (collect_ok($name) && filesize($full) <= COLLECT_MAX) $files[] = $full;
    }
    $key = fn(string $p): string => (str_starts_with(basename($p), 'index.') ? '0' : '1') . basename($p);
    usort($files, fn($a, $b) => strnatcasecmp($key($a), $key($b)));
    usort($dirs, 'strnatcasecmp');
    foreach ($files as $f) $emit($f);
    foreach ($dirs as $d) collect_walk($d, $self, $emit);
}

function collect_ok(string $name): bool {
    $name = strtolower($name);
    if (preg_match('/\.min\.(js|css)$/', $name)) return false;
    return in_array(pathinfo($name, PATHINFO_EXTENSION), COLLECT_EXT, true);
}
