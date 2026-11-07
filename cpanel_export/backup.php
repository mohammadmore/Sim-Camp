<?php
/**
 * Automatic backup (command line only), e.g. a daily cPanel cron job:
 *
 *   php /home/USER/public_html/backup.php            -> data/backups/, keeps the newest 14 files
 *   php /home/USER/public_html/backup.php /home/USER/simcamp-backups 30
 *
 * Each file contains every camp (trash included), the images and the system logo, and can be
 * restored from the superadmin panel ("بازیابی از فایل پشتیبان") of either edition.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Run from the command line (cron).');
}
define('SIMCAMP_CLI', true);
require __DIR__ . '/api.php';

$dir = $argv[1] ?? (__DIR__ . '/data/backups');
$keep = max(1, (int)($argv[2] ?? 14));
if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
    fwrite(STDERR, "Cannot create $dir\n");
    exit(1);
}
if (strpos(realpath($dir), realpath(__DIR__)) === 0 && !file_exists(__DIR__ . '/data/.htaccess')) {
    @file_put_contents(__DIR__ . '/data/.htaccess', "Require all denied\nDeny from all\n");
}

$backup = build_backup(all_camp_ids(), true);
$file = rtrim($dir, '/') . '/sim-camp-backup-' . gmdate('Y-m-d-His') . '.json';
$json = json_encode($backup, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($json === false || file_put_contents($file . '.tmp', $json) === false || !rename($file . '.tmp', $file)) {
    fwrite(STDERR, "Writing $file failed\n");
    exit(1);
}
@chmod($file, 0600);

// Rotation: only the newest $keep backups are kept.
$all = glob(rtrim($dir, '/') . '/sim-camp-backup-*.json');
sort($all);
foreach (array_slice($all, 0, max(0, count($all) - $keep)) as $old) @unlink($old);

echo 'Backup written: ' . $file . ' (' . count($backup['camps']) . ' camps, ' . count((array)$backup['media']) . " images)\n";
