<?php
declare(strict_types=1);

/* ───────────────────────────────────────────────
   check.php — the waiting screen asks here whether the request was
   approved. Servable (wait.php fetches it), but useless without the
   nonce cookie: it only ever reports on YOUR own request.
   ─────────────────────────────────────────────── */

require __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$p = k_pending_mine();
if (!$p)             { echo json_encode(['state' => 'expired']); exit; }
if (empty($p['ok'])) { echo json_encode(['state' => 'waiting']); exit; }

k_pending_clear();
k_start();
k_log('approved ' . $p['code'] . ' from ' . $p['ip']);
echo json_encode(['state' => 'ok']);
