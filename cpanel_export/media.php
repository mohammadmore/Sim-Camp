<?php
/**
 * Serves uploaded images (team pictures, logos, profile photos) from data/media.
 * The file name is the hash of its content, so browsers may cache it for a year.
 */
$name = (string)($_GET['f'] ?? '');
$types = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml'];
$path = __DIR__ . '/data/media/' . $name;
if (!preg_match('/^[a-f0-9]{32}\.(png|jpg|gif|webp|svg)$/', $name, $m) || !is_file($path)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Not found';
    exit;
}
$etag = '"' . $name . '"';
header('Cache-Control: public, max-age=31536000, immutable');
header('ETag: ' . $etag);
header('X-Content-Type-Options: nosniff');
// Uploaded SVGs must never run scripts when opened directly.
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox");
if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}
header('Content-Type: ' . $types[$m[1]]);
header('Content-Length: ' . filesize($path));
readfile($path);
