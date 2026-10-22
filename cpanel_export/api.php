<?php
/**
 * Asva Studio Simulation Camp - API (cPanel / PHP Edition)
 * Mirrors server.js: same endpoints, scoring rules, authentication and permissions.
 */

ini_set('display_errors', '0');
// backup.php includes this file only for its functions (command line, no request).
$isCli = defined('SIMCAMP_CLI');
if (!$isCli) {
@set_time_limit(30); // a stuck request is stopped instead of holding a PHP worker
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
}

// ---- Request size and rate limits (checked before the database is touched) ----
const BODY_LIMIT_SMALL = 256 * 1024;
const BODY_LIMIT_LARGE = 10 * 1024 * 1024;
const BODY_LIMIT_IMPORT = 100 * 1024 * 1024; // restoring a backup file (images included)
const RATE_READ_PER_MIN = 3000;   // per IP; a whole venue often shares one public IP
const RATE_WRITE_PER_MIN = 1200;
const TRASH_DAYS = 30;            // deleted camps can be restored for this long

function early_fail($status, $message, $retryAfter = null) {
    http_response_code($status);
    if ($retryAfter) header('Retry-After: ' . $retryAfter);
    echo json_encode(['success' => false, 'status' => 'error', 'error' => $message, 'message' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$earlyAction = strtolower($_GET['action'] ?? '');
if ($earlyAction === '' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') $earlyAction = 'update_camp';
if ($isCli) $earlyAction = 'health';
@set_time_limit($earlyAction === 'superadmin_import' || $earlyAction === 'superadmin_backup' ? 300 : 30);
// Only the forms that carry images may send large bodies.
$bodyLimit = $earlyAction === 'superadmin_import' ? BODY_LIMIT_IMPORT
    : (in_array($earlyAction, ['setup', 'update_camp', 'settings', 'user_profile_pic', 'instant', 'advanced', 'superadmin_settings'], true) ? BODY_LIMIT_LARGE : BODY_LIMIT_SMALL);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > $bodyLimit) {
    early_fail(413, 'حجم اطلاعات ارسالی بیش از حد مجاز است. تصاویر کوچک‌تر انتخاب کنید.');
}
$rawBody = $isCli ? '' : file_get_contents('php://input', false, null, 0, $bodyLimit + 1);
if ($rawBody !== false && strlen($rawBody) > $bodyLimit) {
    early_fail(413, 'حجم اطلاعات ارسالی بیش از حد مجاز است. تصاویر کوچک‌تر انتخاب کنید.');
}

// Per-IP rate limit in shared memory (APCu). Hosts without APCu skip it; use the host's
// own protection (cPanel / Cloudflare) there - a database-backed counter would cost a write per request.
if (!$isCli && $earlyAction !== 'health' && function_exists('apcu_inc') && ini_get('apc.enabled')) {
    $isRead = $_SERVER['REQUEST_METHOD'] === 'GET';
    $key = 'simcamp_rl_' . ($isRead ? 'r' : 'w') . '_' . ($_SERVER['REMOTE_ADDR'] ?? '-') . '_' . intdiv(time(), 60);
    apcu_add($key, 0, 120);
    $count = apcu_inc($key);
    if ($count !== false && $count > ($isRead ? RATE_READ_PER_MIN : RATE_WRITE_PER_MIN)) {
        early_fail(429, 'تعداد درخواست‌ها بیش از حد مجاز است. یک دقیقه بعد دوباره تلاش کنید.', 60);
    }
}

require_once 'db.php';

const DEFAULT_POSITIVE_TAGS = ['نظم', 'خلاقیت', 'کار تیمی', 'اخلاق ورزشی'];
const DEFAULT_NEGATIVE_TAGS = ['بی‌نظمی', 'تاخیر', 'نقض قوانین', 'رفتار نامناسب'];
const DEFAULT_FJ_VALUES = [5, 10, 15, 20];
const DEFAULT_LADDER = [500, 400, 300, 200, 100];
const OVERRIDE_KEY = '__override__';
const ROLES = ['operator', 'head_referee', 'referee'];
const MANAGER_ROLES = ['operator', 'head_referee'];
const MAX_CAMP_BYTES = 15 * 1024 * 1024;
const AUDIT_LIMIT = 500;
const MIN_PASSWORD = 6;

class HttpError extends Exception {
    public $status;
    public function __construct($status, $message) { parent::__construct($message); $this->status = $status; }
}

function out($data, $status = 200) {
    global $notify_queue;
    http_response_code($status);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!empty($notify_queue)) {
        // Notifications are sent after the response: let the client finish reading it first.
        header('Content-Length: ' . strlen($json));
        header('Connection: close');
    }
    echo $json;
    if (function_exists('flush_notifications')) flush_notifications();
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = strtolower($_GET['action'] ?? '');
// Clean URL "POST /api?id=..." (see .htaccess) is the camp settings update.
if ($action === '' && $method === 'POST') $action = 'update_camp';
$data = json_decode($rawBody === false ? '' : $rawBody, true);
if (!is_array($data)) $data = [];

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------
function is_valid_id($id) {
    return is_string($id) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id) === 1;
}

function require_id($id, $label = 'شناسه') {
    if (!is_valid_id($id)) throw new HttpError(400, "$label نامعتبر است.");
    return $id;
}

function is_safe_key($k) {
    return is_string($k) && $k !== '' && mb_strlen($k) <= 100 && !in_array($k, ['__proto__', 'constructor', 'prototype'], true);
}

function str_or_empty($v, $max = 500) {
    return is_string($v) ? mb_substr($v, 0, $max) : '';
}

function is_dnf_value($v) {
    return $v === '-' || (is_string($v) && strtolower($v) === 'dnf');
}

function num($v) {
    if (is_dnf_value($v)) return 0.0;
    if (is_bool($v) || is_array($v) || $v === null) return 0.0;
    $n = (float)$v;
    return is_finite($n) ? $n : 0.0;
}

function r2($n) {
    $r = round($n, 2);
    return ($r == (int)$r) ? (int)$r : $r;
}

function json_field($v, $fallback) {
    if ($v === null || $v === '') return $fallback;
    if (is_string($v)) {
        $d = json_decode($v, true);
        return $d === null ? $fallback : $d;
    }
    return $v;
}

function parse_ladder($l) {
    if (is_string($l)) {
        $t = trim($l);
        $l = (strpos($t, '[') === 0) ? json_decode($t, true) : explode(',', $t);
    }
    if (!is_array($l)) return DEFAULT_LADDER;
    $clean = [];
    foreach ($l as $x) {
        if (is_numeric(is_string($x) ? trim($x) : $x)) $clean[] = (int)$x;
    }
    return $clean ?: DEFAULT_LADDER;
}

function client_ip() {
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function fingerprint($secret) {
    return substr(hash('sha256', (string)$secret), 0, 12);
}

// ---------------------------------------------------------------------------
// Settings & security primitives
// ---------------------------------------------------------------------------
function get_setting($key) {
    global $conn;
    $stmt = $conn->prepare("SELECT value FROM settings WHERE `key` = ?");
    $stmt->execute([$key]);
    $v = $stmt->fetchColumn();
    return $v === false ? null : $v;
}

function set_setting($key, $value) {
    global $conn, $active_driver;
    if ($active_driver === 'mysql') {
        $stmt = $conn->prepare("INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)");
    } else {
        $stmt = $conn->prepare("INSERT OR REPLACE INTO settings (`key`, value) VALUES (?, ?)");
    }
    $stmt->execute([$key, $value]);
}

function session_secret() {
    static $secret = null;
    if ($secret === null) {
        $secret = get_setting('session_secret');
        if (!$secret) {
            $secret = bin2hex(random_bytes(32));
            set_setting('session_secret', $secret);
        }
    }
    return $secret;
}

function b64u($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec($s) { return base64_decode(strtr($s, '-_', '+/')); }

function create_token($payload, $ttl = 43200) {
    $payload['exp'] = time() + $ttl;
    $body = b64u(json_encode($payload, JSON_UNESCAPED_UNICODE));
    return $body . '.' . b64u(hash_hmac('sha256', $body, session_secret(), true));
}

function verify_token($token) {
    if (!is_string($token) || strpos($token, '.') === false) return null;
    [$body, $sig] = explode('.', $token, 2);
    if (!hash_equals(b64u(hash_hmac('sha256', $body, session_secret(), true)), $sig)) return null;
    $p = json_decode(b64u_dec($body), true);
    if (!is_array($p) || empty($p['exp']) || $p['exp'] < time()) return null;
    return $p;
}

function request_token() {
    return $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
}

function is_hashed($stored) {
    return is_string($stored) && preg_match('/^\$(2y|argon2i|argon2id)\$/', $stored) === 1;
}

function verify_password($plain, $stored) {
    if (!is_string($plain) || $plain === '' || !$stored) return false;
    if (is_hashed($stored)) return password_verify($plain, $stored);
    // A scrypt hash from the Node edition (imported backup) cannot be checked here: never compare it as plain text.
    if (strpos((string)$stored, 'scrypt$') === 0) return false;
    return hash_equals((string)$stored, $plain); // legacy plain-text value
}

function make_hash($plain) {
    return password_hash($plain, PASSWORD_DEFAULT);
}

// Superadmin secret: hash set via setup_db.php, or the password written in db.php.
function superadmin_secret() {
    global $superadmin_pass;
    $hash = get_setting('superadmin_password_hash');
    if ($hash) return $hash;
    if (is_string($superadmin_pass) && $superadmin_pass !== '' && $superadmin_pass !== 'admin123') return $superadmin_pass;
    return null;
}

function rate_limit_check($key, $max = 10, $window = 300) {
    global $conn, $active_driver;
    $now = time();
    // Old counters of every kind are cleaned up; each key has its own window.
    $conn->prepare("DELETE FROM login_attempts WHERE started < ?")->execute([$now - max($window, 3600)]);
    $stmt = $conn->prepare("SELECT attempts, started FROM login_attempts WHERE k = ?");
    $stmt->execute([$key]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || (int)$row['started'] < $now - $window) {
        $conn->prepare("DELETE FROM login_attempts WHERE k = ?")->execute([$key]);
        $conn->prepare("INSERT INTO login_attempts (k, started, attempts) VALUES (?, ?, 1)")->execute([$key, $now]);
        return true;
    }
    $conn->prepare("UPDATE login_attempts SET attempts = attempts + 1 WHERE k = ?")->execute([$key]);
    return ((int)$row['attempts'] + 1) <= $max;
}

function rate_limit_reset($key) {
    global $conn;
    $conn->prepare("DELETE FROM login_attempts WHERE k = ?")->execute([$key]);
}

function require_superadmin() {
    $p = verify_token(request_token());
    $secret = superadmin_secret();
    if (!$p || ($p['t'] ?? '') !== 'sa' || !$secret || ($p['pv'] ?? '') !== fingerprint($secret)) {
        throw new HttpError(401, 'نشست سوپرادمین نامعتبر یا منقضی شده است. دوباره وارد شوید.');
    }
}

// ---------------------------------------------------------------------------
// Camp data
// ---------------------------------------------------------------------------
function normalize_team(&$t) {
    if (!isset($t['scoreLogs']) || !is_array($t['scoreLogs'])) $t['scoreLogs'] = [];
    $t['scoreLogs'] = array_values($t['scoreLogs']);
    $t['records'] = is_array($t['records'] ?? null) ? array_values($t['records']) : [];
    if (!isset($t['stageScores']) || !is_array($t['stageScores'])) $t['stageScores'] = [];
    if (!isset($t['judgeStageScores']) || !is_array($t['judgeStageScores'])) $t['judgeStageScores'] = [];
    foreach ($t['judgeStageScores'] as $sId => $m) {
        if (!is_array($m)) $t['judgeStageScores'][$sId] = [];
    }
    // Older versions stored the whole user object (including the password) in each log.
    foreach ($t['scoreLogs'] as &$lg) {
        if (is_array($lg) && is_array($lg['user'] ?? null) && array_key_exists('password', $lg['user'])) $lg['user'] = public_user($lg['user']);
    }
    unset($lg);
    // Legacy: stage scores stored as logs are moved back into stageScores.
    $kept = [];
    foreach ($t['scoreLogs'] as $log) {
        if (is_array($log) && ($log['type'] ?? '') === 'stage' && !empty($log['stageId'])) {
            $sid = $log['stageId'];
            $t['stageScores'][$sid] = r2(num($t['stageScores'][$sid] ?? 0) + num($log['value'] ?? 0));
        } else {
            $kept[] = $log;
        }
    }
    $t['scoreLogs'] = $kept;
}

function recompute_score(&$t) {
    $sum = 0.0;
    foreach ($t['stageScores'] as $v) $sum += num($v);
    foreach ($t['scoreLogs'] as $l) {
        if (is_array($l) && ($l['type'] ?? '') !== 'cancelled') $sum += num($l['value'] ?? 0);
    }
    $t['score'] = r2($sum);
}

function entry_is_dnf($e) {
    return is_array($e) && (!empty($e['dnf']) || is_dnf_value($e['score'] ?? null));
}

function judge_entries($t, $stageId) {
    $map = $t['judgeStageScores'][$stageId] ?? [];
    $entries = [];
    foreach ($map as $k => $e) {
        $entries[] = is_array($e) ? array_merge(['judgeKey' => (string)$k], $e, ['judgeKey' => (string)$k]) : ['judgeKey' => (string)$k, 'score' => $e, 'timestamp' => 0];
    }
    usort($entries, function ($a, $b) { return ($a['timestamp'] ?? 0) <=> ($b['timestamp'] ?? 0); });
    return $entries;
}

function find_override($entries) {
    foreach ($entries as $e) if ($e['judgeKey'] === OVERRIDE_KEY) return $e;
    return null;
}

function apply_judges_to_stage(&$t, $stageId, $entryRemoved = false) {
    $entries = judge_entries($t, $stageId);
    if (!$entries) {
        if ($entryRemoved) unset($t['stageScores'][$stageId]);
        return;
    }
    $override = find_override($entries);
    if ($override) {
        $t['stageScores'][$stageId] = entry_is_dnf($override) ? 0 : r2(num($override['score'] ?? 0));
        return;
    }
    $sum = 0.0;
    foreach ($entries as $e) if (!entry_is_dnf($e)) $sum += num($e['score'] ?? 0);
    $t['stageScores'][$stageId] = r2($sum);
}

function stage_is_time($stage) {
    $u = $stage['unit'] ?? 'points';
    return $u === 'time' || $u === 'time_asc' || $u === 'time_desc';
}

function tiered_raw_result($t, $stage) {
    $isTime = stage_is_time($stage);
    $entries = judge_entries($t, $stage['id']);
    $override = find_override($entries);
    $relevant = $override ? [$override] : $entries;
    if (!$relevant) return ['isDnf' => $isTime, 'hasRecord' => false, 'rawValue' => 0];
    foreach ($relevant as $e) if (entry_is_dnf($e)) return ['isDnf' => true, 'hasRecord' => false, 'rawValue' => 0];
    $numeric = array_values(array_filter($relevant, function ($e) { return is_numeric($e['score'] ?? null); }));
    if (!$numeric) return ['isDnf' => $isTime, 'hasRecord' => false, 'rawValue' => 0];
    if ($isTime) return ['isDnf' => false, 'hasRecord' => true, 'rawValue' => (float)$numeric[0]['score']];
    $sum = 0.0;
    foreach ($numeric as $e) $sum += (float)$e['score'];
    return ['isDnf' => false, 'hasRecord' => true, 'rawValue' => r2($sum)];
}

function compute_tiered_results($teams, $stage, $ladder, $multiplier) {
    $isTime = stage_is_time($stage);
    $unit = $stage['unit'] ?? 'points';
    $timeOrder = $stage['timeOrder'] ?? ($unit === 'time_desc' ? 'desc' : 'asc');
    $asc = $isTime && $timeOrder === 'asc';
    $completed = [];
    $dnf = [];
    foreach ($teams as $t) {
        $row = array_merge(['teamId' => $t['id'], 'teamName' => $t['name'] ?? '', 'teamColor' => $t['color'] ?? ''], tiered_raw_result($t, $stage), ['rank' => null, 'assignedScore' => 0]);
        if (!$row['isDnf'] && $row['hasRecord']) $completed[] = $row; else $dnf[] = $row;
    }
    usort($completed, function ($a, $b) use ($asc) {
        return $asc ? ($a['rawValue'] <=> $b['rawValue']) : ($b['rawValue'] <=> $a['rawValue']);
    });
    $rank = 0;
    foreach ($completed as $i => &$r) {
        if ($i === 0 || $r['rawValue'] != $completed[$i - 1]['rawValue']) $rank++;
        $r['rank'] = $rank;
        $base = ($rank - 1 < count($ladder)) ? (int)$ladder[$rank - 1] : 0;
        $r['baseScore'] = $base;
        $r['multiplier'] = $multiplier;
        $r['assignedScore'] = (int)round($base * $multiplier);
    }
    unset($r);
    foreach ($dnf as &$d) {
        $d['rank'] = '-';
        $d['baseScore'] = 0;
        $d['multiplier'] = $multiplier;
        $d['assignedScore'] = 0;
    }
    unset($d);
    return array_merge($completed, $dnf);
}

// Keep the server's scores (and other server-owned fields) for existing teams; take only definitions from the client.
const TEAM_SERVER_FIELDS = ['score', 'scoreLogs', 'stageScores', 'judgeStageScores', 'records', 'pin', 'secretCards'];
function merge_teams($serverTeams, $clientTeams) {
    $byId = [];
    foreach ($serverTeams as $t) $byId[$t['id']] = $t;
    $out = [];
    foreach ($clientTeams as $ct) {
        $m = $ct;
        foreach (TEAM_SERVER_FIELDS as $f) unset($m[$f]);
        if (isset($byId[$ct['id']])) {
            $st = $byId[$ct['id']];
            foreach (TEAM_SERVER_FIELDS as $f) if (isset($st[$f])) $m[$f] = $st[$f];
            // Fields a form may leave out: the stored value is kept.
            foreach (['members', 'division'] as $f) if (!array_key_exists($f, $m) && isset($st[$f])) $m[$f] = $st[$f];
        }
        normalize_team($m);
        recompute_score($m);
        $out[] = $m;
    }
    return $out;
}

function public_user($u) {
    if (!is_array($u)) return null;
    return [
        'id' => $u['id'] ?? '',
        'username' => $u['username'] ?? '',
        'firstName' => $u['firstName'] ?? '',
        'lastName' => $u['lastName'] ?? '',
        'role' => $u['role'] ?? 'referee',
        'profilePic' => $u['profilePic'] ?? ''
    ];
}

function display_name($u) {
    $full = trim(($u['firstName'] ?? '') . ' ' . ($u['lastName'] ?? ''));
    return $full !== '' ? $full : ($u['username'] ?? 'داور');
}

function parse_camp($raw) {
    if (!$raw) return null;
    $c = $raw;
    // Feature fields are stored together in the "extras" column (backups carry them at the top level).
    $extras = json_field($raw['extras'] ?? null, []);
    unset($c['extras']);
    if (is_array($extras)) foreach (EXTRA_KEYS as $k) if (array_key_exists($k, $extras)) $c[$k] = $extras[$k];
    foreach (['teams', 'stages', 'users'] as $f) {
        $c[$f] = json_field($raw[$f] ?? null, []);
        if (!is_array($c[$f])) $c[$f] = [];
        $c[$f] = array_values($c[$f]);
    }
    $c['fieldJudgingMode'] = $raw['fieldJudgingMode'] ?: 'free';
    $c['fieldJudgingValues'] = json_field($raw['fieldJudgingValues'] ?? null, null);
    if (!is_array($c['fieldJudgingValues']) || !$c['fieldJudgingValues']) $c['fieldJudgingValues'] = DEFAULT_FJ_VALUES;
    $c['positiveTags'] = json_field($raw['positiveTags'] ?? null, null);
    if (!is_array($c['positiveTags']) || !$c['positiveTags']) $c['positiveTags'] = DEFAULT_POSITIVE_TAGS;
    $c['negativeTags'] = json_field($raw['negativeTags'] ?? null, null);
    if (!is_array($c['negativeTags']) || !$c['negativeTags']) $c['negativeTags'] = DEFAULT_NEGATIVE_TAGS;
    $c['campType'] = $raw['campType'] ?: 'simple';
    $c['tieredPointsLadder'] = parse_ladder(json_field($raw['tieredPointsLadder'] ?? null, DEFAULT_LADDER));
    $c['closedStages'] = json_field($raw['closedStages'] ?? null, []);
    if (!is_array($c['closedStages'])) $c['closedStages'] = [];
    $c['stageTieredResults'] = json_field($raw['stageTieredResults'] ?? null, []);
    if (!is_array($c['stageTieredResults'])) $c['stageTieredResults'] = [];
    $c['numLang'] = $raw['numLang'] ?: 'fa';
    $c['dir'] = $raw['dir'] ?: 'rtl';
    $c['auditLog'] = json_field($raw['auditLog'] ?? null, []);
    if (!is_array($c['auditLog'])) $c['auditLog'] = [];
    $c['announcement'] = json_field($raw['announcement'] ?? null, null);
    if (!is_array($c['announcement'])) $c['announcement'] = null;
    $c['activeStageId'] = !empty($raw['activeStageId']) ? $raw['activeStageId'] : null;
    $c['locked'] = !empty($raw['locked']);
    $c['archived'] = !empty($raw['archived']);
    $c['deletedAt'] = !empty($raw['deletedAt']) ? (int)$raw['deletedAt'] : null;
    foreach ($c['teams'] as &$t) { normalize_team($t); recompute_score($t); } // the total is always derived from the scores
    unset($t);
    return parse_extras($c);
}

// JSON objects (not lists) must stay objects even when empty or numerically keyed.
function as_map($v) {
    if (is_object($v)) return $v;
    return (object)(is_array($v) ? $v : []);
}

function teams_for_json($teams) {
    $out = [];
    foreach ($teams as $t) {
        $t['stageScores'] = as_map($t['stageScores'] ?? []);
        $j = [];
        foreach (($t['judgeStageScores'] ?? []) as $sId => $m) {
            if (is_array($m)) foreach ($m as $k => $e) if (is_array($e) && array_key_exists('criteria', $e)) $m[$k]['criteria'] = as_map($e['criteria']);
            $j[$sId] = as_map($m);
        }
        $t['judgeStageScores'] = as_map($j);
        $out[] = $t;
    }
    return $out;
}

function enc($v) {
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

// A team as others may see it: no PIN, secret cards or private records; the budget as one number.
function public_team($t, $showNotes = true) {
    $budget = team_budget($t);
    unset($t['pin'], $t['secretCards'], $t['records']);
    $t['budget'] = $budget;
    foreach ($t['scoreLogs'] as &$l) {
        if (!is_array($l)) continue;
        if (isset($l['user'])) $l['user'] = public_user($l['user']);
        if (!$showNotes) unset($l['note'], $l['photo']);
    }
    unset($l);
    return $t;
}

// While the standings are frozen ("hidden table"), the public sees them as they were at that moment.
function frozen_teams($c) {
    $snap = [];
    foreach (($c['frozen']['teams'] ?? []) as $s) if (is_array($s) && isset($s['id'])) $snap[$s['id']] = $s;
    $at = $c['frozen']['at'] ?? 0;
    return array_map(function ($t) use ($snap, $at) {
        $s = $snap[$t['id']] ?? null;
        $t['score'] = $s ? ($s['score'] ?? 0) : 0;
        $t['stageScores'] = $s && is_array($s['stageScores'] ?? null) ? $s['stageScores'] : [];
        $t['judgeStageScores'] = [];
        $t['scoreLogs'] = array_values(array_filter($t['scoreLogs'], function ($l) use ($at) {
            return is_array($l) && ($l['createdAt'] ?? $l['timestamp'] ?? 0) <= $at;
        }));
        return $t;
    }, $c['teams']);
}

const PRIVATE_CAMP_FIELDS = ['password', 'users', 'auditLog', 'deletedAt', 'clientKey', 'ownerId', 'notify', 'assignments', 'chanceCards',
    'judgeMessage', 'appeals', 'moments', 'decisions', 'rounds', 'registration', 'calibration', 'scoreCap', 'frozen'];

// What the live board and everyone with the link may see ('public'), or what signed-in referees
// and managers get from the poll ('member'): never passwords, PINs, tokens or the user list.
function public_state($c, $view = 'public') {
    $member = $view === 'member';
    $display = effective_display($c['display']);
    $frozen = $c['frozen'] ?? null;
    $masked = $frozen && !$member;
    $showNotes = $display['notes'] || $member;
    $teams = array_map(function ($t) use ($showNotes) { return public_team($t, $showNotes); }, $masked ? frozen_teams($c) : $c['teams']);
    $s = $c;
    foreach (PRIVATE_CAMP_FIELDS as $k) unset($s[$k]);
    $s['locked'] = !empty($c['locked']);
    $s['archived'] = !empty($c['archived']);
    $s['teams'] = teams_for_json($teams);
    $s['display'] = $display;
    $s['features'] = effective_features($c['features']);
    $s['frozen'] = $frozen ? ['at' => $frozen['at'] ?? 0] : null;
    $s['registration'] = ['open' => !empty($c['registration']['open'])];
    $s['varOpen'] = [];
    foreach ($c['appeals'] as $a) {
        if (($a['status'] ?? '') === 'open') $s['varOpen'][] = ['id' => $a['id'] ?? '', 'teamId' => $a['teamId'] ?? null, 'stageId' => $a['stageId'] ?? null];
    }
    $s['rounds'] = array_map(function ($r) use ($c) {
        $d = is_array($c['decisions'][$r['id']] ?? null) ? $c['decisions'][$r['id']] : [];
        $out = ['id' => $r['id'], 'title' => $r['title'] ?? '', 'question' => $r['question'] ?? '', 'options' => $r['options'] ?? [],
            'status' => $r['status'] ?? 'draft', 'revealed' => !empty($r['revealed']), 'submitted' => count($d)];
        if (!empty($r['revealed'])) {
            $m = [];
            foreach ($d as $tid => $x) $m[$tid] = $x['optionId'] ?? null;
            $out['decisions'] = as_map($m);
        }
        return $out;
    }, $c['rounds']);
    $s['closedStages'] = as_map($masked ? ($frozen['closedStages'] ?? []) : $c['closedStages']);
    $s['stageTieredResults'] = as_map($masked ? ($frozen['stageTieredResults'] ?? []) : $c['stageTieredResults']);
    if ($member) {
        $s['judgeMessage'] = $c['judgeMessage'] ?? null;
        $s['assignments'] = $c['assignments'];
        $s['scoreCap'] = $c['scoreCap'];
        $s['appeals'] = $c['appeals'];
        $cases = [];
        foreach ($c['calibration']['cases'] as $cs) if (!empty($cs['open'])) { unset($cs['expected']); $cases[] = $cs; }
        $s['calibration'] = ['cases' => $cases];
    }
    return extras_maps($s);
}

// Superadmin edit form: everything except password hashes and notification tokens.
function admin_state($c) {
    $s = public_state($c, 'member');
    $s['password'] = '';
    $s['hasPassword'] = !empty($c['password']);
    $s['users'] = array_map(function ($u) {
        $has = !empty($u['password']);
        $u['password'] = '';
        $u['hasPassword'] = $has;
        return $u;
    }, $c['users']);
    $s['teams'] = teams_for_json(array_map(function ($t) {
        $p = public_team($t);
        $p['pin'] = $t['pin'] ?? '';
        $p['secretCards'] = $t['secretCards'] ?? [];
        return $p;
    }, $c['teams']));
    $s['notify'] = mask_notify($c['notify']);
    $s['clientKey'] = $c['clientKey'] ?? '';
    $s['chanceCards'] = $c['chanceCards'];
    $s['rounds'] = $c['rounds'];
    $s['calibration'] = ['cases' => $c['calibration']['cases']];
    $s['registration'] = ['open' => !empty($c['registration']['open']), 'requests' => $c['registration']['requests']];
    return $s;
}

// ---------------------------------------------------------------------------
// Images: stored once as files in data/media (name = hash of the content) and served by
// media.php with a one-year cache, instead of being repeated inside every poll response.
// ---------------------------------------------------------------------------
const MEDIA_NAME_RE = '/^[a-f0-9]{32}\.(png|jpg|gif|webp|svg)$/';
const MEDIA_REF_RE = '#^(?:/media/|media\.php\?f=)([a-f0-9]{32}\.(?:png|jpg|gif|webp|svg))$#';
const DATA_URL_RE = '#^data:image/(png|jpe?g|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$#i';

function media_dir() {
    $dir = __DIR__ . '/data/media';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
        if (!file_exists(__DIR__ . '/data/.htaccess')) @file_put_contents(__DIR__ . '/data/.htaccess', "Require all denied\nDeny from all\n");
    }
    return $dir;
}

function media_put($name, $bytes) {
    $path = media_dir() . '/' . $name;
    if (file_exists($path)) return;
    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $bytes) === false) throw new HttpError(500, 'ذخیره تصویر ممکن نشد (پوشه data قابل نوشتن نیست).');
    @rename($tmp, $path);
}

function media_get($name) {
    if (!preg_match(MEDIA_NAME_RE, $name)) return null;
    $path = __DIR__ . '/data/media/' . $name;
    return is_file($path) ? file_get_contents($path) : null;
}

// Replaces embedded images (data: URLs) with media links; Node-style links become PHP links.
function externalize($v) {
    if (is_string($v)) {
        if (strncmp($v, 'data:image/', 11) === 0 && preg_match(DATA_URL_RE, $v, $m)) {
            $ext = ['png' => 'png', 'jpeg' => 'jpg', 'jpg' => 'jpg', 'gif' => 'gif', 'webp' => 'webp', 'svg+xml' => 'svg'][strtolower($m[1])];
            $bytes = base64_decode(preg_replace('/\s+/', '', $m[2]));
            $name = substr(hash('sha256', $bytes), 0, 32) . '.' . $ext;
            media_put($name, $bytes);
            return 'media.php?f=' . $name;
        }
        if (preg_match(MEDIA_REF_RE, $v, $m)) return 'media.php?f=' . $m[1];
        return $v;
    }
    if (is_array($v)) {
        foreach ($v as $k => $x) $v[$k] = externalize($x);
        return $v;
    }
    return $v;
}

function collect_media_names($v, &$into) {
    if (is_string($v)) { if (preg_match(MEDIA_REF_RE, $v, $m)) $into[$m[1]] = true; }
    elseif (is_array($v) || is_object($v)) foreach ($v as $x) collect_media_names($x, $into);
}

$in_mutation = false;

// $includeDeleted: camps in the trash are invisible except to the superadmin's trash actions.
function load_camp($id, $includeDeleted = false) {
    global $conn, $in_mutation;
    if (!is_valid_id($id)) return null;
    $stmt = $conn->prepare("SELECT * FROM camps WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || (!$includeDeleted && !empty($row['deletedAt']))) return null;
    // Camps saved before images moved to files are converted on first use.
    if (!$in_mutation) {
        foreach (['logo', 'teams', 'users'] as $col) {
            if (is_string($row[$col] ?? null) && strpos($row[$col], 'data:image/') !== false) {
                $res = mutate_camp($id, true, function ($c) { return ['changes' => ['logo' => $c['logo'] ?? '', 'teams' => $c['teams'], 'users' => $c['users']]]; }, true);
                return $res['camp'];
            }
        }
    }
    return parse_camp($row);
}

// Serialises a set of changed camp fields into DB columns.
function column_values($changes) {
    $vals = [];
    foreach ($changes as $k => $v) {
        switch ($k) {
            case 'teams': $vals[$k] = enc(teams_for_json($v)); break;
            case 'closedStages':
            case 'stageTieredResults': $vals[$k] = enc(as_map($v)); break;
            case 'stages': case 'users': case 'tieredPointsLadder':
            case 'fieldJudgingValues': case 'positiveTags': case 'negativeTags':
                $vals[$k] = enc(array_values($v)); break;
            case 'locked': case 'archived': $vals[$k] = $v ? 1 : 0; break;
            case 'auditLog': $vals[$k] = enc(array_values($v)); break;
            case 'announcement': $vals[$k] = $v === null ? null : enc($v); break;
            case 'deletedAt': $vals[$k] = $v ? (int)$v : null; break;
            default: $vals[$k] = $v;
        }
    }
    return $vals;
}

const CAMP_COLUMNS = ['orgName', 'password', 'title', 'logo', 'locked', 'archived', 'numLang', 'dir', 'teams', 'stages', 'users',
    'campType', 'tieredPointsLadder', 'closedStages', 'stageTieredResults', 'fieldJudgingMode', 'fieldJudgingValues', 'positiveTags', 'negativeTags',
    'auditLog', 'announcement', 'activeStageId', 'deletedAt'];

// DB column values for a set of changes; feature fields are merged into the stored "extras" object.
function camp_row_values($changes, $row) {
    $vals = column_values(array_intersect_key($changes, array_flip(CAMP_COLUMNS)));
    $ex = array_intersect_key($changes, array_flip(EXTRA_KEYS));
    if ($ex) {
        $stored = json_field($row['extras'] ?? null, []);
        if (!is_array($stored)) $stored = [];
        foreach ($ex as $k => $v) $stored[$k] = $v;
        $vals['extras'] = enc(as_map(extras_maps($stored)));
    }
    return $vals;
}

function write_camp_values($id, $vals) {
    global $conn;
    if (!$vals) return;
    $total = 0;
    foreach ($vals as $v) $total += is_string($v) ? strlen($v) : 8;
    if ($total > MAX_CAMP_BYTES) throw new HttpError(413, 'حجم اطلاعات مسابقه (به‌ویژه تصاویر) بیش از حد مجاز است.');
    $sets = implode(', ', array_map(function ($k) { return "$k = ?"; }, array_keys($vals)));
    $stmt = $conn->prepare("UPDATE camps SET $sets WHERE id = ?");
    $stmt->execute(array_merge(array_values($vals), [$id]));
}

// Returns the changes as stored (images replaced by media links).
function save_camp_changes($id, $changes, $row = null) {
    global $conn;
    $changes = externalize($changes);
    if ($row === null && array_intersect_key($changes, array_flip(EXTRA_KEYS))) {
        $stmt = $conn->prepare("SELECT extras FROM camps WHERE id = ?");
        $stmt->execute([$id]);
        $row = ['extras' => $stmt->fetchColumn() ?: null];
    }
    write_camp_values($id, camp_row_values($changes, $row ?? []));
    return $changes;
}

// Load → mutate → save inside one transaction holding a write lock on the camp.
// Audited changes get an id and (when small) what they replaced, so they can be undone.
function mutate_camp($id, $allowLocked, callable $fn, $allowDeleted = false) {
    global $conn, $active_driver, $in_mutation;
    require_id($id, 'شناسه مسابقه');
    if ($active_driver === 'mysql') $conn->beginTransaction();
    else $conn->exec('BEGIN IMMEDIATE');
    $in_mutation = true;
    try {
        $stmt = $conn->prepare("SELECT * FROM camps WHERE id = ?" . ($active_driver === 'mysql' ? ' FOR UPDATE' : ''));
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $camp = $row ? parse_camp($row) : null;
        if (!$camp || (!$allowDeleted && !empty($camp['deletedAt']))) throw new HttpError(404, 'مسابقه یافت نشد.');
        if (!$allowLocked && $camp['locked']) throw new HttpError(403, 'این مسابقه قفل شده است.');
        $result = $fn($camp) ?: [];
        $changes = $result['changes'] ?? [];
        if ($changes) {
            $changes = externalize($changes);
            if (!empty($result['audit'])) {
                $a = $result['audit'];
                $item = [
                    'id' => rid('a'),
                    'ts' => now_ms(),
                    'by' => ['username' => $a['user']['username'] ?? '', 'name' => display_name($a['user']), 'role' => $a['user']['role'] ?? ''],
                    'action' => $a['action'],
                    'details' => (object)($a['details'] ?? [])
                ];
                if (empty($result['noUndo'])) {
                    $plain = $changes;
                    unset($plain['auditLog']);
                    $after = parse_camp(array_merge($row, camp_row_values($plain, $row)));
                    $undo = build_undo($camp, $plain, $after);
                    if ($undo) $item['undo'] = $undo;
                }
                $log = array_values($changes['auditLog'] ?? $camp['auditLog']);
                $log[] = $item;
                $log = array_slice($log, -AUDIT_LIMIT);
                for ($i = 0, $n = count($log); $i < $n - UNDO_KEEP; $i++) unset($log[$i]['undo']);
                $changes['auditLog'] = $log;
            }
            write_camp_values($id, camp_row_values($changes, $row));
            $camp = array_merge($camp, $changes);
        }
        if ($active_driver === 'mysql') $conn->commit(); else $conn->exec('COMMIT');
        $in_mutation = false;
        $result['camp'] = $camp;
        return $result;
    } catch (Throwable $e) {
        $in_mutation = false;
        if ($active_driver === 'mysql') { if ($conn->inTransaction()) $conn->rollBack(); }
        else { try { $conn->exec('ROLLBACK'); } catch (Throwable $ignored) {} }
        throw $e;
    }
}

function find_camp_user($camp, $username) {
    foreach ($camp['users'] as $u) {
        if (is_array($u) && ($u['username'] ?? null) === $username) return ['user' => $u, 'secret' => $u['password'] ?? ''];
    }
    if ($username === 'admin' && !empty($camp['password'])) {
        return [
            'user' => ['id' => 'admin', 'role' => 'operator', 'firstName' => 'اپراتور', 'lastName' => 'اصلی', 'username' => 'admin', 'profilePic' => get_setting('admin_pic_' . $camp['id']) ?? ''],
            'secret' => $camp['password'],
            'builtin' => true
        ];
    }
    return null;
}

function require_camp_user($camp, $roles = ROLES, $token = null) {
    $p = verify_token($token ?? request_token());
    if (!$p || ($p['t'] ?? '') !== 'camp' || ($p['campId'] ?? '') !== $camp['id']) throw new HttpError(401, 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.');
    $found = find_camp_user($camp, $p['username'] ?? '');
    if (!$found || ($p['pv'] ?? '') !== fingerprint($found['secret'])) throw new HttpError(401, 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.');
    $user = $found['user'];
    $user['role'] = in_array($user['role'] ?? '', ROLES, true) ? $user['role'] : 'referee';
    if (!in_array($user['role'], $roles, true)) throw new HttpError(403, 'شما دسترسی لازم برای این عملیات را ندارید.');
    return $user;
}

// ---------------------------------------------------------------------------
// Input sanitising
// ---------------------------------------------------------------------------
// A stage sent without criteria / schedule (a form that does not know them) keeps the stored values.
function clean_stages($stages, $existing = []) {
    if (!is_array($stages)) throw new HttpError(400, 'فهرست مراحل نامعتبر است.');
    $prev = [];
    foreach (($existing ?: []) as $e) if (is_array($e) && isset($e['id'])) $prev[$e['id']] = $e;
    $out = [];
    foreach ($stages as $s) {
        require_id($s['id'] ?? null, 'شناسه مرحله');
        $old = $prev[$s['id']] ?? [];
        foreach (['criteria', 'startAt', 'durationMin'] as $k) if (!array_key_exists($k, $s) && !empty($old[$k])) $s[$k] = $old[$k];
        $m = (float)($s['multiplier'] ?? 1);
        $out[] = array_merge($s, [
            'name' => str_or_empty($s['name'] ?? '', 200),
            'unit' => in_array($s['unit'] ?? '', ['points', 'time', 'time_asc', 'time_desc'], true) ? $s['unit'] : 'points',
            'timeOrder' => ($s['timeOrder'] ?? '') === 'desc' ? 'desc' : 'asc',
            'multiplier' => $m > 0 ? $m : 1,
            'criteria' => clean_criteria($s['criteria'] ?? null)
        ], clean_schedule($s));
    }
    return $out;
}

function clean_team_defs($teams) {
    if (!is_array($teams)) throw new HttpError(400, 'فهرست تیم‌ها نامعتبر است.');
    $seen = [];
    $out = [];
    foreach ($teams as $t) {
        require_id($t['id'] ?? null, 'شناسه تیم');
        if (isset($seen[$t['id']])) throw new HttpError(400, 'شناسه تیم تکراری است.');
        $seen[$t['id']] = true;
        $out[] = array_merge($t, [
            'name' => str_or_empty($t['name'] ?? '', 200),
            'color' => str_or_empty($t['color'] ?? '', 64),
            'image' => str_or_empty($t['image'] ?? '', 2000000),
            'happyImage' => str_or_empty($t['happyImage'] ?? '', 2000000),
            'sadImage' => str_or_empty($t['sadImage'] ?? '', 2000000)
        ]);
        // Left out by a form → the stored value is kept (see merge_teams).
        $i = count($out) - 1;
        if (array_key_exists('members', $t)) $out[$i]['members'] = clean_members($t['members']); else unset($out[$i]['members']);
        if (array_key_exists('division', $t)) $out[$i]['division'] = str_or_empty($t['division'], 64); else unset($out[$i]['division']);
    }
    return $out;
}

function clean_string_list($list, $fallback) {
    if (!is_array($list)) return $fallback;
    $out = [];
    foreach ($list as $x) if (is_string($x) && trim($x) !== '') $out[] = mb_substr(trim($x), 0, 100);
    return $out ?: $fallback;
}

function clean_number_list($list, $fallback) {
    if (!is_array($list)) return $fallback;
    $out = [];
    foreach ($list as $x) if (is_numeric($x) && (int)$x > 0) $out[] = (int)$x;
    return $out ?: $fallback;
}

// Users from the superadmin form: an empty password keeps the existing one.
function clean_users($users, $existing) {
    if (!is_array($users)) return [];
    $byName = [];
    $byId = [];
    foreach ($existing as $u) {
        $byName[$u['username'] ?? ''] = $u;
        if (!empty($u['id'])) $byId[$u['id']] = $u;
    }
    $seen = [];
    $out = [];
    foreach ($users as $u) {
        $username = trim(str_or_empty($u['username'] ?? '', 100));
        if ($username === '') throw new HttpError(400, 'نام کاربری خالی است.');
        if (isset($seen[$username])) throw new HttpError(400, "نام کاربری «{$username}» تکراری است.");
        $seen[$username] = true;
        $prev = (!empty($u['id']) && isset($byId[$u['id']])) ? $byId[$u['id']] : ($byName[$username] ?? null);
        if (is_string($u['password'] ?? null) && $u['password'] !== '') $password = make_hash($u['password']);
        elseif ($prev && !empty($prev['password'])) $password = $prev['password'];
        else throw new HttpError(400, "رمز عبور کاربر «{$username}» الزامی است.");
        $out[] = [
            'id' => is_valid_id($u['id'] ?? null) ? $u['id'] : 'u_' . bin2hex(random_bytes(5)),
            'firstName' => str_or_empty($u['firstName'] ?? '', 100),
            'lastName' => str_or_empty($u['lastName'] ?? '', 100),
            'username' => $username,
            'password' => $password,
            'role' => in_array($u['role'] ?? '', ROLES, true) ? $u['role'] : 'referee',
            'profilePic' => str_or_empty($u['profilePic'] ?? '', 2000000)
        ];
    }
    return $out;
}

function judge_entry_for($user, $rawVal, $dnfFlag, $judgeKey) {
    $isDnf = is_dnf_value($rawVal) || $dnfFlag;
    return [
        'judgeKey' => $judgeKey,
        'judgeName' => display_name($user),
        'judgeRole' => $user['role'],
        'judgePhoto' => $user['profilePic'] ?? '',
        'score' => $isDnf ? '-' : r2(num($rawVal)),
        'dnf' => $isDnf,
        'timestamp' => (int)round(microtime(true) * 1000)
    ];
}

// Camp links: chosen by the superadmin (optional) or random.
const CAMP_ID_RE = '/^[A-Za-z0-9_-]{3,64}$/';
const CAMP_ID_HELP = 'لینک اختصاصی فقط می‌تواند شامل حروف انگلیسی، عدد، خط تیره (-) و زیرخط (_) و بین ۳ تا ۶۴ کاراکتر باشد.';

function new_random_camp_id() {
    return 'camp_' . bin2hex(random_bytes(6));
}

// The cleaned custom id, or null when none was requested.
function requested_camp_id($raw) {
    if ($raw === null || trim((string)$raw) === '') return null;
    $id = trim((string)$raw);
    if (!preg_match(CAMP_ID_RE, $id)) throw new HttpError(400, CAMP_ID_HELP);
    return $id;
}

// Creates the camp row; the primary key makes a taken id fail instead of overwriting it.
function insert_new_camp($id) {
    global $conn;
    try {
        $conn->prepare("INSERT INTO camps (id, locked, archived, closedStages, stageTieredResults) VALUES (?, 0, 0, '{}', '{}')")->execute([$id]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000' || stripos($e->getMessage(), 'UNIQUE') !== false || stripos($e->getMessage(), 'Duplicate') !== false) {
            throw new HttpError(409, "لینک «{$id}» قبلاً برای مسابقه دیگری استفاده شده است. لینک دیگری انتخاب کنید.");
        }
        throw $e;
    }
}

function stage_name($camp, $stageId) {
    foreach ($camp['stages'] as $s) if (($s['id'] ?? '') === $stageId) return $s['name'] ?? $stageId;
    return $stageId;
}

function require_new_password($pw) {
    if (!is_string($pw) || mb_strlen($pw) < MIN_PASSWORD) throw new HttpError(400, 'رمز عبور جدید باید حداقل ' . MIN_PASSWORD . ' کاراکتر باشد.');
    return $pw;
}

function reset_team_scores(&$t) {
    $t['scoreLogs'] = [];
    $t['records'] = [];
    $t['stageScores'] = [];
    $t['judgeStageScores'] = [];
    $t['score'] = 0;
}

function now_ms() {
    return (int)round(microtime(true) * 1000);
}

// ---------------------------------------------------------------------------
// Optional features: display switches, feature settings and their sanitising (mirrors lib/features.js)
// ---------------------------------------------------------------------------
const DISPLAY_KEYS = [
    'confetti', 'splash', 'moodImages', 'sound', 'ranks', 'trendChart', 'badges', 'ticker', 'timer', 'schedule',
    'individual', 'roles', 'budget', 'varBanner', 'chanceCards', 'decisions', 'brand', 'divisions', 'bracket',
    'judgeTimer', 'judgeRemaining', 'judgeMessages', 'notes',
    'teamPage', 'teamHistory', 'teamSkills'
];
const FEATURE_KEYS = [
    'assignments', 'rubric', 'individual', 'scoreCap', 'appeals', 'divisions', 'bracket', 'roles',
    'budget', 'decisions', 'secretCards', 'peerReview', 'chanceCards', 'calibration', 'registration'
];
const DISPLAY_PRESETS = [
    'full' => [],
    'formal' => ['confetti' => false, 'moodImages' => false, 'sound' => false, 'splash' => true, 'badges' => false]
];
const DEFAULT_SKILLS = [
    ['id' => 'leadership', 'name' => 'رهبری'],
    ['id' => 'communication', 'name' => 'ارتباط'],
    ['id' => 'decision', 'name' => 'تصمیم‌گیری'],
    ['id' => 'teamwork', 'name' => 'کار تیمی'],
    ['id' => 'creativity', 'name' => 'خلاقیت'],
    ['id' => 'discipline', 'name' => 'نظم و مدیریت زمان']
];
const DEFAULT_TAG_SKILLS = [
    'نظم' => ['discipline'], 'خلاقیت' => ['creativity'], 'کار تیمی' => ['teamwork'], 'اخلاق ورزشی' => ['teamwork'],
    'بی‌نظمی' => ['discipline'], 'تاخیر' => ['discipline'], 'نقض قوانین' => ['discipline'], 'رفتار نامناسب' => ['teamwork'],
    'ابتکار عمل' => ['leadership'], 'هدایت تیم' => ['leadership'], 'گوش دادن فعال' => ['communication'],
    'ارتباط مؤثر' => ['communication'], 'تصمیم سریع و درست' => ['decision'], 'تحلیل داده' => ['decision'],
    'تقسیم کار' => ['teamwork'], 'حمایت از هم‌تیمی' => ['teamwork'], 'ایده نو' => ['creativity'],
    'بی‌توجهی به هم‌تیمی' => ['communication'], 'تصمیم شتاب‌زده' => ['decision'], 'کار تک‌نفره' => ['teamwork']
];
const TAG_PACKS = [
    'sport' => ['name' => 'ورزشی', 'positive' => ['نظم', 'خلاقیت', 'کار تیمی', 'اخلاق ورزشی'], 'negative' => ['بی‌نظمی', 'تاخیر', 'نقض قوانین', 'رفتار نامناسب']],
    'team' => [
        'name' => 'مهارت‌های تیمی',
        'positive' => ['ابتکار عمل', 'هدایت تیم', 'گوش دادن فعال', 'ارتباط مؤثر', 'تصمیم سریع و درست', 'تحلیل داده', 'تقسیم کار', 'حمایت از هم‌تیمی', 'ایده نو'],
        'negative' => ['بی‌توجهی به هم‌تیمی', 'تصمیم شتاب‌زده', 'کار تک‌نفره', 'تاخیر']
    ]
];
const LIMITS = [
    'moments' => 300, 'appeals' => 200, 'budgetNote' => 200, 'registrations' => 200, 'text' => 300, 'members' => 30, 'cards' => 50,
    'rounds' => 50, 'options' => 8, 'criteria' => 12, 'calibrationCases' => 30, 'channels' => 5
];
// Camp fields kept in the JSON column "extras".
const EXTRA_KEYS = ['display', 'features', 'skills', 'tagSkills', 'divisions', 'roles', 'assignments', 'scoreCap', 'chanceCards', 'rounds',
    'decisions', 'appeals', 'moments', 'timer', 'ticker', 'judgeMessage', 'ceremony', 'frozen', 'lastChance', 'bracket', 'peerReview',
    'calibration', 'registration', 'notify', 'brand', 'uiLang', 'certificate', 'clientKey', 'ownerId'];
const CHANNEL_TYPES = ['telegram', 'bale', 'eitaa', 'webhook'];
const TEMPLATE_KEYS = [
    'campType', 'tieredPointsLadder', 'fieldJudgingMode', 'fieldJudgingValues', 'positiveTags', 'negativeTags', 'stages',
    'display', 'features', 'skills', 'tagSkills', 'divisions', 'roles', 'chanceCards', 'rounds', 'scoreCap', 'brand', 'uiLang', 'numLang', 'dir'
];
// Settings of the optional features accepted from the superadmin form.
const ADVANCED_FORM_KEYS = ['display', 'features', 'skills', 'tagSkills', 'divisions', 'roles', 'chanceCards', 'rounds', 'brand', 'uiLang',
    'calibrationCases', 'registrationOpen', 'scoreCap', 'assignments', 'teamsExtra', 'stagesExtra', 'certificate'];
const UNDO_MAX_BYTES = 30000; // larger changes (e.g. resetting everything) are not undoable
const UNDO_KEEP = 30;         // only the newest audit entries keep their undo data

// JSON object (decoded as an associative array; an empty one is []).
function is_obj($v) { return is_array($v) && ($v === [] || !array_is_list($v)); }
function is_list($v) { return is_array($v) && array_is_list($v); }
function g($a, $k) { return is_array($a) && array_key_exists($k, $a) ? $a[$k] : null; }
function sstr($v, $max = 200) { return is_string($v) ? mb_substr(trim($v), 0, $max) : ''; }
function bool_v($v) { return $v === true || $v === 1 || $v === '1' || $v === 'true'; }
function rid($prefix) { return $prefix . '_' . bin2hex(random_bytes(5)); }
function id_or($v, $prefix) { return is_valid_id($v) ? $v : rid($prefix); }

// JavaScript parseFloat / parseInt (null for NaN).
function parse_float($v) {
    if (is_int($v) || is_float($v)) return is_finite((float)$v) ? (float)$v : null;
    if (is_string($v) && preg_match('/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/', $v, $m)) return (float)$m[0];
    return null;
}
function parse_int($v) {
    if (is_int($v)) return $v;
    if (is_float($v)) return is_finite($v) ? (int)$v : null;
    if (is_string($v) && preg_match('/^\s*[+-]?\d+/', $v, $m)) return (int)$m[0];
    return null;
}

function effective_display($d) {
    $out = [];
    foreach (DISPLAY_KEYS as $k) $out[$k] = !(is_obj($d) && array_key_exists($k, $d) && $d[$k] === false);
    return $out;
}

function effective_features($f) {
    $out = [];
    foreach (FEATURE_KEYS as $k) $out[$k] = is_obj($f) && ($f[$k] ?? null) === true;
    return $out;
}

function clean_display($d) {
    $out = [];
    if (is_obj($d)) foreach (DISPLAY_KEYS as $k) if (array_key_exists($k, $d) && !bool_v($d[$k])) $out[$k] = false;
    return $out;
}

function clean_features($f) {
    $out = [];
    if (is_obj($f)) foreach (FEATURE_KEYS as $k) if (array_key_exists($k, $f) && bool_v($f[$k])) $out[$k] = true;
    return $out;
}

function clean_skills($list) {
    if (!is_list($list)) return DEFAULT_SKILLS;
    $seen = [];
    $out = [];
    foreach (array_slice($list, 0, 20) as $s) {
        $x = ['id' => id_or(g($s, 'id'), 'sk'), 'name' => sstr(g($s, 'name'), 60)];
        if ($x['name'] === '' || isset($seen[$x['id']])) continue;
        $seen[$x['id']] = true;
        $out[] = $x;
    }
    return $out;
}

function clean_tag_skills($map, $skills) {
    $ids = [];
    foreach ((is_array($skills) ? $skills : []) as $s) $ids[g($s, 'id')] = true;
    $out = [];
    if (!is_obj($map)) return $out;
    foreach (array_slice($map, 0, 200, true) as $tag => $list) {
        $t = sstr((string)$tag, 100);
        if ($t === '' || in_array($t, ['__proto__', 'constructor', 'prototype'], true) || !is_list($list)) continue;
        $v = array_slice(array_values(array_filter($list, function ($x) use ($ids) { return is_string($x) && isset($ids[$x]); })), 0, 5);
        if ($v) $out[$t] = $v;
    }
    return $out;
}

function clean_named_list($list, $prefix, $max = 30) {
    if (!is_list($list)) return [];
    $out = [];
    foreach (array_slice($list, 0, $max) as $x) {
        $n = ['id' => id_or(g($x, 'id'), $prefix), 'name' => sstr(g($x, 'name'), 80)];
        if ($n['name'] !== '') $out[] = $n;
    }
    return $out;
}

function clean_roles($list) {
    if (!is_list($list)) return ['کاپیتان'];
    $out = [];
    foreach ($list as $x) { $r = sstr($x, 40); if ($r !== '') $out[] = $r; }
    return array_slice($out, 0, 15);
}

function clean_members($list) {
    if (!is_list($list)) return [];
    $seen = [];
    $out = [];
    foreach (array_slice($list, 0, LIMITS['members']) as $m) {
        $x = ['id' => id_or(g($m, 'id'), 'm'), 'name' => sstr(g($m, 'name'), 80), 'role' => sstr(g($m, 'role'), 40)];
        if ($x['name'] === '' || isset($seen[$x['id']])) continue;
        $seen[$x['id']] = true;
        $out[] = $x;
    }
    return $out;
}

function clean_secret_cards($list) {
    if (!is_list($list)) return [];
    $out = [];
    foreach (array_slice($list, 0, 20) as $c) {
        $x = ['id' => id_or(g($c, 'id'), 'sc'), 'title' => sstr(g($c, 'title'), 80), 'text' => sstr(g($c, 'text'), 1000)];
        if ($x['title'] !== '' || $x['text'] !== '') $out[] = $x;
    }
    return $out;
}

function clean_criteria($list) {
    if (!is_list($list)) return [];
    $out = [];
    foreach (array_slice($list, 0, LIMITS['criteria']) as $c) {
        $w = parse_float(g($c, 'weight'));
        $x = ['id' => id_or(g($c, 'id'), 'cr'), 'name' => sstr(g($c, 'name'), 60), 'weight' => ($w !== null && $w > 0 && $w <= 100) ? r2($w) : 1];
        if ($x['name'] !== '') $out[] = $x;
    }
    return $out;
}

function clean_assignments($map, $teamIds, $stageIds) {
    $out = [];
    if (!is_obj($map)) return $out;
    foreach (array_slice($map, 0, 200, true) as $user => $a) {
        $user = (string)$user;
        if (sstr($user, 100) === '' || in_array($user, ['__proto__', 'constructor', 'prototype'], true) || !is_obj($a)) continue;
        $teams = is_list($a['teams'] ?? null) ? array_values(array_filter($a['teams'], function ($t) use ($teamIds) { return is_string($t) && isset($teamIds[$t]); })) : [];
        $stages = is_list($a['stages'] ?? null) ? array_values(array_filter($a['stages'], function ($s) use ($stageIds) { return is_string($s) && isset($stageIds[$s]); })) : [];
        if ($teams || $stages) $out[$user] = ['teams' => $teams, 'stages' => $stages];
    }
    return $out;
}

function clean_score_cap($c) {
    $per = is_obj($c) ? parse_float($c['perHour'] ?? null) : null;
    return ['perHour' => ($per !== null && $per > 0) ? r2($per) : null];
}

function clean_chance_cards($list) {
    if (!is_list($list)) return [];
    $out = [];
    foreach (array_slice($list, 0, LIMITS['cards']) as $c) {
        $x = ['id' => id_or(g($c, 'id'), 'cc'), 'title' => sstr(g($c, 'title'), 80), 'text' => sstr(g($c, 'text'), 500),
            'points' => r2(num(g($c, 'points'))), 'budget' => r2(num(g($c, 'budget')))];
        if ($x['title'] !== '') $out[] = $x;
    }
    return $out;
}

function clean_rounds($list, $prev = []) {
    if (!is_list($list)) return [];
    $old = [];
    foreach ((is_array($prev) ? $prev : []) as $r) if (is_array($r) && isset($r['id'])) $old[$r['id']] = $r;
    $out = [];
    foreach (array_slice($list, 0, LIMITS['rounds']) as $r) {
        $rId = g($r, 'id');
        $before = (is_string($rId) && isset($old[$rId])) ? $old[$rId] : [];
        $options = [];
        foreach (array_slice(is_list(g($r, 'options')) ? $r['options'] : [], 0, LIMITS['options']) as $o) {
            $x = ['id' => id_or(g($o, 'id'), 'op'), 'label' => sstr(g($o, 'label'), 120), 'points' => r2(num(g($o, 'points'))), 'budget' => r2(num(g($o, 'budget')))];
            if ($x['label'] !== '') $options[] = $x;
        }
        $x = [
            'id' => id_or($rId, 'rd'), 'title' => sstr(g($r, 'title'), 100), 'question' => sstr(g($r, 'question'), 500), 'options' => $options,
            // Status changes only through the round actions.
            'status' => in_array($before['status'] ?? null, ['draft', 'open', 'closed'], true) ? $before['status'] : 'draft',
            'revealed' => !empty($before['revealed'])
        ];
        if ($x['title'] !== '' && count($options) >= 2) $out[] = $x;
    }
    return $out;
}

function clean_calibration_cases($list, $prev = []) {
    if (!is_list($list)) return [];
    $old = [];
    foreach ((is_array($prev) ? $prev : []) as $c) if (is_array($c) && isset($c['id'])) $old[$c['id']] = $c;
    $out = [];
    foreach (array_slice($list, 0, LIMITS['calibrationCases']) as $c) {
        $cId = g($c, 'id');
        $exp = g($c, 'expected');
        $expF = ($exp !== null && $exp !== '') ? parse_float($exp) : null;
        $x = [
            'id' => id_or($cId, 'cal'), 'title' => sstr(g($c, 'title'), 100), 'description' => sstr(g($c, 'description'), 2000),
            'media' => sstr(g($c, 'media'), 2000000),
            'open' => (is_array($c) && array_key_exists('open', $c)) ? bool_v($c['open']) : !empty(((is_string($cId) ? ($old[$cId] ?? []) : []))['open']),
            'expected' => $expF !== null ? r2($expF) : null
        ];
        if ($x['title'] !== '') $out[] = $x;
    }
    return $out;
}

function clean_brand($b) {
    if (!is_obj($b)) return [];
    $accent = sstr($b['accent'] ?? null, 20);
    return [
        'clientLogo' => sstr($b['clientLogo'] ?? null, 2000000),
        'accent' => preg_match('/^#[0-9a-fA-F]{3,8}$/', $accent) ? $accent : '',
        'background' => sstr($b['background'] ?? null, 2000000),
        'sponsor' => sstr($b['sponsor'] ?? null, 120)
    ];
}

// Certificate design (the background image is stored as a media file when saved).
function clean_certificate($c) {
    if (!is_obj($c)) return null;
    $color = sstr($c['color'] ?? null, 20);
    return [
        'background' => sstr($c['background'] ?? null, 2000000),
        'heading' => sstr($c['heading'] ?? null, 120),
        'body' => sstr($c['body'] ?? null, 600),
        'signer' => sstr($c['signer'] ?? null, 80),
        'signerRole' => sstr($c['signerRole'] ?? null, 80),
        'color' => preg_match('/^#[0-9a-fA-F]{3,8}$/', $color) ? $color : '',
        'showLogo' => array_key_exists('showLogo', $c) ? bool_v($c['showLogo']) : true
    ];
}

// Notification channels. An empty token keeps the stored one (the form never receives secrets).
function clean_notify($n, $prev) {
    $old = [];
    foreach ((is_array($prev) && is_array($prev['channels'] ?? null) ? $prev['channels'] : []) as $c) if (is_array($c) && isset($c['id'])) $old[$c['id']] = $c;
    $channels = [];
    foreach (array_slice(is_obj($n) && is_list($n['channels'] ?? null) ? $n['channels'] : [], 0, LIMITS['channels']) as $c) {
        $cId = g($c, 'id');
        $before = is_string($cId) && isset($old[$cId]) ? $old[$cId] : [];
        $type = in_array(g($c, 'type'), CHANNEL_TYPES, true) ? $c['type'] : 'webhook';
        $url = sstr(g($c, 'url'), 500);
        $token = sstr(g($c, 'token'), 200);
        if ($token === '') $token = (($before['type'] ?? null) === $type) ? (string)($before['token'] ?? '') : '';
        $x = ['id' => id_or($cId, 'ch'), 'type' => $type, 'token' => $token, 'chatId' => sstr(g($c, 'chatId'), 100),
            'url' => preg_match('#^https?://#i', $url) ? $url : ''];
        if ($type === 'webhook' ? $x['url'] !== '' : ($x['token'] !== '' && $x['chatId'] !== '')) $channels[] = $x;
    }
    $ev = is_obj($n) && is_obj($n['events'] ?? null) ? $n['events'] : [];
    $events = [];
    foreach (['stage_close', 'finish', 'ceremony', 'chance', 'round'] as $k) $events[$k] = array_key_exists($k, $ev) ? bool_v($ev[$k]) : true;
    return ['channels' => $channels, 'events' => $events];
}

// What the superadmin form sees of the channels (no tokens).
function mask_notify($n) {
    if (!is_obj($n)) return ['channels' => [], 'events' => (object)[]];
    $channels = [];
    foreach (($n['channels'] ?? []) as $c) { $c['hasToken'] = !empty($c['token']); $c['token'] = ''; $channels[] = $c; }
    return ['channels' => $channels, 'events' => as_map($n['events'] ?? [])];
}

function clean_schedule($stage) {
    $t = sstr(g($stage, 'startAt'), 5);
    $d = parse_int(g($stage, 'durationMin'));
    return [
        'startAt' => preg_match('/^([01]?\d|2[0-3]):[0-5]\d$/', $t) ? $t : '',
        'durationMin' => ($d !== null && $d > 0 && $d <= 1440) ? $d : null
    ];
}

function new_pin() { return (string)random_int(100000, 999999); }
function new_key() { return b64u(random_bytes(18)); }

// Teams without a PIN (team page actions) get one.
function ensure_pins($teams) {
    foreach ($teams as &$t) if (!preg_match('/^\d{6}$/', (string)($t['pin'] ?? ''))) $t['pin'] = new_pin();
    unset($t);
    return $teams;
}

function team_budget($t) {
    $b = 0.0;
    foreach (($t['records'] ?? []) as $r) if (is_array($r) && ($r['kind'] ?? '') === 'budget') $b += num($r['value'] ?? 0);
    return r2($b);
}

// Defaults for the feature fields of a camp (used by parse_camp).
function parse_extras($c) {
    $obj = function ($k, $d) use (&$c) { $c[$k] = is_array($c[$k] ?? null) ? $c[$k] : $d; };
    $obj('display', []);
    $obj('features', []);
    $c['skills'] = is_array($c['skills'] ?? null) && $c['skills'] ? array_values($c['skills']) : DEFAULT_SKILLS;
    $obj('tagSkills', DEFAULT_TAG_SKILLS);
    foreach (['divisions', 'chanceCards', 'rounds', 'appeals', 'moments'] as $k) $c[$k] = is_array($c[$k] ?? null) ? array_values($c[$k]) : [];
    $c['roles'] = is_array($c['roles'] ?? null) ? array_values($c['roles']) : ['کاپیتان'];
    $obj('assignments', []);
    $obj('decisions', []);
    $obj('scoreCap', ['perHour' => null]);
    $obj('peerReview', ['open' => null]);
    $obj('calibration', ['cases' => [], 'scores' => []]);
    $c['calibration']['cases'] = is_array($c['calibration']['cases'] ?? null) ? array_values($c['calibration']['cases']) : [];
    $c['calibration']['scores'] = is_array($c['calibration']['scores'] ?? null) ? $c['calibration']['scores'] : [];
    $obj('registration', ['open' => false, 'requests' => []]);
    $c['registration']['requests'] = is_array($c['registration']['requests'] ?? null) ? array_values($c['registration']['requests']) : [];
    $obj('notify', ['channels' => [], 'events' => []]);
    $obj('brand', []);
    foreach (['timer', 'ticker', 'judgeMessage', 'ceremony', 'frozen', 'lastChance', 'bracket', 'certificate'] as $k) {
        $c[$k] = is_array($c[$k] ?? null) && $c[$k] ? $c[$k] : null;
    }
    $c['uiLang'] = ($c['uiLang'] ?? '') === 'en' ? 'en' : 'fa';
    if (!array_key_exists('clientKey', $c)) $c['clientKey'] = '';
    if (!array_key_exists('ownerId', $c)) $c['ownerId'] = null;
    foreach ($c['teams'] as &$t) {
        $t['members'] = is_array($t['members'] ?? null) ? array_values($t['members']) : [];
        $t['division'] = is_string($t['division'] ?? null) ? $t['division'] : '';
        $t['secretCards'] = is_array($t['secretCards'] ?? null) ? array_values($t['secretCards']) : [];
    }
    unset($t);
    return $c;
}

// JSON objects among the feature fields stay objects when empty.
function extras_maps($c) {
    foreach (['display', 'features', 'tagSkills', 'assignments', 'scoreCap', 'peerReview', 'brand', 'certificate'] as $k) {
        if (is_array($c[$k] ?? null)) $c[$k] = as_map($c[$k]);
    }
    if (is_array($c['decisions'] ?? null)) {
        $d = [];
        foreach ($c['decisions'] as $rId => $m) $d[$rId] = as_map($m);
        $c['decisions'] = as_map($d);
    }
    if (is_array($c['calibration'] ?? null) && array_key_exists('scores', $c['calibration'])) {
        $s = [];
        foreach ((is_array($c['calibration']['scores']) ? $c['calibration']['scores'] : []) as $cId => $m) $s[$cId] = as_map($m);
        $c['calibration']['scores'] = as_map($s);
    }
    if (is_array($c['notify'] ?? null) && array_key_exists('events', $c['notify'])) $c['notify']['events'] = as_map($c['notify']['events']);
    if (is_array($c['frozen'] ?? null)) {
        foreach (['closedStages', 'stageTieredResults'] as $k) if (array_key_exists($k, $c['frozen'])) $c['frozen'][$k] = as_map($c['frozen'][$k]);
        if (is_array($c['frozen']['teams'] ?? null)) {
            foreach ($c['frozen']['teams'] as &$ft) $ft['stageScores'] = as_map($ft['stageScores'] ?? []);
            unset($ft);
        }
    }
    return $c;
}

function builtin_templates() {
    return [
        ['id' => 'builtin_sport', 'builtin' => true, 'name' => 'مسابقه ورزشی (پیش‌فرض)',
            'data' => ['campType' => 'simple', 'positiveTags' => TAG_PACKS['sport']['positive'], 'negativeTags' => TAG_PACKS['sport']['negative'], 'features' => (object)[]]],
        ['id' => 'builtin_team', 'builtin' => true, 'name' => 'شبیه‌سازی تیمی (مهارت‌ها، کاپیتان، بودجه، تصمیم‌گیری)',
            'data' => [
                'campType' => 'simple', 'positiveTags' => TAG_PACKS['team']['positive'], 'negativeTags' => TAG_PACKS['team']['negative'],
                'features' => ['roles' => true, 'budget' => true, 'decisions' => true, 'peerReview' => true, 'chanceCards' => true, 'appeals' => true],
                'roles' => ['کاپیتان', 'زمان‌نگه‌دار', 'مستندساز', 'سخنگو'],
                'chanceCards' => [
                    ['title' => 'تغییر قوانین بازی', 'text' => 'از این لحظه هر تیم فقط ۲ دقیقه برای تصمیم دارد.', 'points' => 0, 'budget' => 0],
                    ['title' => 'بودجه اضطراری', 'text' => 'به همه تیم‌ها بودجه اضافه رسید.', 'points' => 0, 'budget' => 100]
                ]
            ]],
        ['id' => 'builtin_assessment', 'builtin' => true, 'name' => 'کانون ارزیابی (چندمعیاره، امتیاز فردی، هماهنگی داوران)',
            'data' => [
                'campType' => 'professional', 'positiveTags' => TAG_PACKS['team']['positive'], 'negativeTags' => TAG_PACKS['team']['negative'],
                'features' => ['rubric' => true, 'individual' => true, 'calibration' => true, 'assignments' => true, 'peerReview' => true, 'roles' => true],
                'roles' => ['کاپیتان', 'تحلیل‌گر', 'هماهنگ‌کننده']
            ]]
    ];
}

function template_from_camp($camp) {
    $data = [];
    foreach (TEMPLATE_KEYS as $k) if (array_key_exists($k, $camp)) $data[$k] = $camp[$k];
    $data['teams'] = array_map(function ($t) {
        return ['id' => $t['id'], 'name' => $t['name'] ?? '', 'color' => $t['color'] ?? '', 'image' => $t['image'] ?? '', 'members' => $t['members'] ?? [], 'division' => $t['division'] ?? ''];
    }, $camp['teams'] ?? []);
    if (is_array($data['rounds'] ?? null)) {
        $data['rounds'] = array_map(function ($r) { return array_merge($r, ['status' => 'draft', 'revealed' => false, 'applied' => false]); }, $data['rounds']);
    }
    return extras_maps($data);
}

function clean_leagues($list, $campIds) {
    if (!is_list($list)) return [];
    $out = [];
    foreach (array_slice($list, 0, 50) as $l) {
        $pts = [];
        foreach ((is_list(g($l, 'rankPoints')) ? $l['rankPoints'] : []) as $x) { $n = parse_int($x); if ($n !== null && $n >= 0) $pts[] = $n; }
        $pts = array_slice($pts, 0, 50);
        $ids = [];
        foreach ((is_list(g($l, 'campIds')) ? $l['campIds'] : []) as $cid) if (is_string($cid) && isset($campIds[$cid])) $ids[] = $cid;
        $x = [
            'id' => id_or(g($l, 'id'), 'lg'), 'name' => sstr(g($l, 'name'), 100),
            'campIds' => array_slice($ids, 0, 100),
            'mode' => g($l, 'mode') === 'score' ? 'score' : 'rank',
            'rankPoints' => $pts ?: [10, 8, 6, 5, 4, 3, 2, 1]
        ];
        if ($x['name'] !== '') $out[] = $x;
    }
    return $out;
}

// Settings stored as JSON in the settings table.
function get_json_setting($key) {
    $v = get_setting($key);
    if ($v === null || $v === '') return null;
    $d = json_decode($v, true);
    return $d;
}

function set_json_setting($key, $value) {
    set_setting($key, enc($value));
}

// ---------------------------------------------------------------------------
// Undo for audited changes (mirrors lib/undo.js)
// ---------------------------------------------------------------------------
// Key-sorted JSON; objects and arrays compare the same way they are stored (an empty map is []).
function stable_json($v) {
    if (is_object($v)) $v = (array)$v;
    if (is_array($v)) {
        if (array_is_list($v)) return '[' . implode(',', array_map('stable_json', $v)) . ']';
        ksort($v, SORT_STRING);
        $parts = [];
        foreach ($v as $k => $x) $parts[] = json_encode((string)$k, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . ':' . stable_json($x);
        return '{' . implode(',', $parts) . '}';
    }
    if (is_float($v) && is_finite($v) && floor($v) == $v && abs($v) < 1e15) return (string)(int)$v;
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function undo_strip($t) {
    unset($t['scoreLogs'], $t['records'], $t['score'], $t['budget']);
    return $t;
}

function undo_logs_of($teams) {
    $m = [];
    foreach (($teams ?: []) as $t) {
        foreach (($t['scoreLogs'] ?? []) as $l) if (is_array($l) && !empty($l['id'])) $m[$l['id']] = array_merge($l, ['teamId' => $t['id']]);
        foreach (($t['records'] ?? []) as $r) if (is_array($r) && !empty($r['id'])) $m[$r['id']] = array_merge($r, ['teamId' => $t['id']]);
    }
    return $m;
}

function undo_probe($camp, $u) {
    $teams = [];
    foreach ($camp['teams'] as $t) $teams[$t['id']] = $t;
    $logs = undo_logs_of($camp['teams']);
    $f = [];
    foreach (array_keys($u['fields'] ?: []) as $k) $f[] = [$k, $camp[$k] ?? null];
    $tt = [];
    foreach (array_keys($u['teams'] ?: []) as $id) $tt[] = [$id, isset($teams[$id]) ? undo_strip($teams[$id]) : null];
    $l = [];
    foreach (array_merge(array_map(function ($x) { return $x['id']; }, $u['restore'] ?: []), $u['remove'] ?: []) as $id) $l[] = [$id, $logs[$id] ?? null];
    return b64u(sha1(stable_json([
        'f' => $f, 't' => $tt, 'o' => $u['order'] ? array_column($camp['teams'], 'id') : null, 'l' => $l
    ]), true));
}

// $before: the camp before the change; $after: the camp as stored after it.
function build_undo($before, $changes, $after) {
    $u = ['fields' => [], 'teams' => [], 'order' => null, 'removedTeams' => [], 'restore' => [], 'remove' => []];
    foreach ($changes as $k => $v) {
        if ($k === 'teams' || $k === 'auditLog') continue;
        $u['fields'][$k] = $before[$k] ?? null;
    }
    if (array_key_exists('teams', $changes)) {
        $prev = [];
        foreach ($before['teams'] as $t) $prev[$t['id']] = $t;
        $next = [];
        foreach ($changes['teams'] as $t) $next[$t['id']] = $t;
        $beforeIds = array_column($before['teams'], 'id');
        if (stable_json($beforeIds) !== stable_json(array_column($changes['teams'], 'id'))) {
            $u['order'] = $beforeIds;
            foreach ($before['teams'] as $t) if (!isset($next[$t['id']])) $u['removedTeams'][] = undo_strip($t);
        }
        foreach ($next as $id => $t) {
            if (isset($prev[$id]) && stable_json(undo_strip($prev[$id])) !== stable_json(undo_strip($t))) $u['teams'][$id] = undo_strip($prev[$id]);
        }
        $a = undo_logs_of($before['teams']);
        $b = undo_logs_of($changes['teams']);
        foreach ($a as $id => $l) if (!isset($b[$id]) || stable_json($b[$id]) !== stable_json($l)) $u['restore'][] = $l;
        foreach (array_keys($b) as $id) if (!isset($a[$id])) $u['remove'][] = (string)$id;
    }
    if (!$u['fields'] && !$u['teams'] && !$u['order'] && !$u['restore'] && !$u['remove']) return null;
    $u['check'] = undo_probe($after, $u);
    $u['fields'] = as_map($u['fields']);
    $u['teams'] = as_map($u['teams']);
    return strlen(enc($u)) <= UNDO_MAX_BYTES ? $u : null;
}

// Changes that restore the state before the audited change, or null when the data has changed since.
function apply_undo($camp, $u) {
    $u['fields'] = is_array($u['fields'] ?? null) ? $u['fields'] : [];
    $u['teams'] = is_array($u['teams'] ?? null) ? $u['teams'] : [];
    foreach (['removedTeams', 'restore', 'remove'] as $k) $u[$k] = is_array($u[$k] ?? null) ? $u[$k] : [];
    $u['order'] = $u['order'] ?? null;
    if (undo_probe($camp, $u) !== ($u['check'] ?? null)) return null;
    $changes = [];
    foreach ($u['fields'] as $k => $v) $changes[$k] = $v;
    if (!$u['order'] && !$u['teams'] && !$u['restore'] && !$u['remove']) return $changes;
    $teams = array_map(function ($t) { $t['scoreLogs'] = $t['scoreLogs'] ?? []; $t['records'] = $t['records'] ?? []; return $t; }, $camp['teams']);
    if ($u['order']) {
        $byId = [];
        foreach ($teams as $t) $byId[$t['id']] = $t;
        foreach ($u['removedTeams'] as $t) $byId[$t['id']] = array_merge($t, ['scoreLogs' => [], 'records' => []]);
        $teams = [];
        foreach ($u['order'] as $id) if (isset($byId[$id])) $teams[] = $byId[$id];
    }
    $pos = [];
    foreach ($teams as $i => $t) $pos[$t['id']] = $i;
    foreach ($u['teams'] as $id => $prev) {
        if (!isset($pos[$id])) continue;
        $t = $teams[$pos[$id]];
        $teams[$pos[$id]] = array_merge($t, $prev, ['scoreLogs' => $t['scoreLogs'], 'records' => $t['records']]);
    }
    $drop = array_fill_keys(array_merge($u['remove'], array_map(function ($l) { return $l['id']; }, $u['restore'])), true);
    foreach ($teams as &$t) {
        $t['scoreLogs'] = array_values(array_filter($t['scoreLogs'], function ($l) use ($drop) { return !(is_array($l) && isset($drop[$l['id'] ?? ''])); }));
        $t['records'] = array_values(array_filter($t['records'], function ($r) use ($drop) { return !(is_array($r) && isset($drop[$r['id'] ?? ''])); }));
    }
    unset($t);
    foreach ($u['restore'] as $l) {
        $teamId = $l['teamId'] ?? null;
        unset($l['teamId']);
        if (!isset($pos[$teamId])) continue;
        if (!empty($l['kind'])) $teams[$pos[$teamId]]['records'][] = $l;
        else $teams[$pos[$teamId]]['scoreLogs'][] = $l;
    }
    foreach ($teams as &$t) {
        usort($t['scoreLogs'], function ($a, $b) {
            return ($a['createdAt'] ?? $a['timestamp'] ?? 0) <=> ($b['createdAt'] ?? $b['timestamp'] ?? 0);
        });
    }
    unset($t);
    $changes['teams'] = $teams;
    return $changes;
}

// ---------------------------------------------------------------------------
// Notifications (mirrors lib/notify.js): sent after the response, failures only logged
// ---------------------------------------------------------------------------
$notify_queue = [];

function standings_text($camp, $n = 5) {
    $teams = $camp['teams'];
    usort($teams, function ($a, $b) { return num($b['score'] ?? 0) <=> num($a['score'] ?? 0); });
    $medals = ['🥇', '🥈', '🥉'];
    $lines = [];
    foreach (array_slice($teams, 0, $n) as $i => $t) $lines[] = ($medals[$i] ?? (($i + 1) . '.')) . ' ' . ($t['name'] ?? '') . ': ' . ($t['score'] ?? 0);
    return implode("\n", $lines);
}

function notify_camp($camp, $event, $text = null) {
    global $notify_queue;
    $n = is_array($camp['notify'] ?? null) ? $camp['notify'] : [];
    $channels = is_array($n['channels'] ?? null) ? $n['channels'] : [];
    if (!$channels) return;
    if (is_array($n['events'] ?? null) && ($n['events'][$event] ?? null) === false) return;
    if ($text === null) $text = standings_text($camp);
    $payload = ['event' => $event, 'campId' => $camp['id'], 'title' => $camp['title'] ?? '', 'text' => '🏆 ' . ($camp['title'] ?? '') . "\n" . $text];
    foreach ($channels as $ch) if (is_array($ch)) $notify_queue[] = [$ch, $payload];
}

function notify_post($url, $body, $form = false) {
    $content = $form ? http_build_query($body) : json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $type = $form ? 'application/x-www-form-urlencoded' : 'application/json';
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $content, CURLOPT_HTTPHEADER => ['Content-Type: ' . $type],
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 3
        ]);
        curl_exec($ch);
        $err = curl_error($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($err !== '') throw new Exception($err);
        if ($code < 200 || $code >= 300) throw new Exception('HTTP ' . $code);
        return;
    }
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => 'Content-Type: ' . $type, 'content' => $content, 'timeout' => 3, 'ignore_errors' => true]]);
    $res = @file_get_contents($url, false, $ctx);
    if ($res === false) throw new Exception('request failed');
}

function send_to_channel($ch, $payload) {
    $type = $ch['type'] ?? 'webhook';
    $text = $payload['text'];
    if ($type === 'webhook') return notify_post($ch['url'] ?? '', $payload);
    $token = $ch['token'] ?? '';
    if ($type === 'eitaa') return notify_post((getenv('NOTIFY_EITAA_API') ?: 'https://eitaayar.ir/api') . '/' . $token . '/sendMessage', ['chat_id' => $ch['chatId'] ?? '', 'text' => $text], true);
    $base = $type === 'bale' ? (getenv('NOTIFY_BALE_API') ?: 'https://tapi.bale.ai') : (getenv('NOTIFY_TELEGRAM_API') ?: 'https://api.telegram.org');
    return notify_post($base . '/bot' . $token . '/sendMessage', ['chat_id' => $ch['chatId'] ?? '', 'text' => $text]);
}

// Called after the response has been written.
function flush_notifications() {
    global $notify_queue;
    if (!$notify_queue) return;
    $queue = $notify_queue;
    $notify_queue = [];
    ignore_user_abort(true);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    else { while (ob_get_level() > 0) @ob_end_flush(); @flush(); }
    foreach ($queue as [$ch, $payload]) {
        try { send_to_channel($ch, $payload); }
        catch (Throwable $e) { error_log('[notify] ' . ($ch['type'] ?? '?') . ' failed for camp ' . $payload['campId'] . ': ' . $e->getMessage()); }
    }
}

// ---------------------------------------------------------------------------
// Admins: the superadmin, or organizers who only see and manage their own camps
// ---------------------------------------------------------------------------
function get_organizers() {
    $list = get_json_setting('organizers');
    return is_list($list) ? $list : [];
}

function require_admin() {
    $p = verify_token(request_token());
    if ($p && ($p['t'] ?? '') === 'org') {
        $org = null;
        foreach (get_organizers() as $o) if (($o['id'] ?? null) === ($p['oid'] ?? '')) $org = $o;
        if (!$org || !empty($org['disabled']) || ($p['pv'] ?? '') !== fingerprint($org['password'] ?? '')) {
            throw new HttpError(401, 'نشست نامعتبر یا منقضی شده است. دوباره وارد شوید.');
        }
        return ['super' => false, 'orgId' => $org['id'], 'name' => ($org['name'] ?? '') !== '' ? $org['name'] : ($org['username'] ?? '')];
    }
    require_superadmin();
    return ['super' => true, 'orgId' => null, 'name' => ''];
}

function camp_visible($admin, $camp) {
    return $admin['super'] || ($camp && ($camp['ownerId'] ?? null) === $admin['orgId']);
}

function assert_camp_access($admin, $camp) {
    if (!camp_visible($admin, $camp)) throw new HttpError(404, 'مسابقه یافت نشد.');
}

function admin_mutate($admin, $id, $allowLocked, callable $fn, $allowDeleted = false) {
    return mutate_camp($id, $allowLocked, function ($camp) use ($admin, $fn) { assert_camp_access($admin, $camp); return $fn($camp); }, $allowDeleted);
}

function verify_client_key($camp, $key) {
    $k = (string)($camp['clientKey'] ?? '');
    return $k !== '' && hash_equals($k, (string)$key);
}

// ---------------------------------------------------------------------------
// Feature helpers used by the routes (mirrors routes/features.js)
// ---------------------------------------------------------------------------
function camp_features($camp) { return effective_features($camp['features'] ?? []); }

function need_feature($camp, $key, $label) {
    if (empty(camp_features($camp)[$key])) throw new HttpError(409, "امکان «{$label}» برای این مسابقه فعال نیست.");
}

function team_index($camp, $teamId) {
    foreach ($camp['teams'] as $i => $t) if (($t['id'] ?? null) === $teamId) return $i;
    throw new HttpError(404, 'تیم یافت نشد.');
}

function push_capped($list, $item, $max) {
    $list = array_values($list);
    $list[] = $item;
    return array_slice($list, -$max);
}

function instant_log($user, $value, $tag, $extra = []) {
    $now = now_ms();
    return array_merge(['id' => rid('log'), 'type' => 'instant', 'value' => r2($value), 'timestamp' => $now, 'createdAt' => $now, 'user' => public_user($user), 'tag' => $tag], $extra);
}

function budget_record($user, $value, $note, $extra = []) {
    return array_merge(['id' => rid('bud'), 'kind' => 'budget', 'value' => r2($value), 'note' => sstr($note, LIMITS['budgetNote']), 'createdAt' => now_ms(),
        'by' => $user ? ($user['username'] ?? '') : ''], $extra);
}

// Referees split between teams / stages only score their own share (managers are not limited).
function check_assignment($camp, $user, $teamId, $stageId) {
    if (empty(camp_features($camp)['assignments']) || in_array($user['role'], MANAGER_ROLES, true)) return;
    $a = $camp['assignments'][$user['username']] ?? null;
    if (!is_array($a)) return;
    $teams = $a['teams'] ?? [];
    $stages = $a['stages'] ?? [];
    if ($teamId && $teams && !in_array($teamId, $teams, true)) throw new HttpError(403, 'این تیم به شما سپرده نشده است.');
    if ($stageId && $stages && !in_array($stageId, $stages, true)) throw new HttpError(403, 'این مرحله به شما سپرده نشده است.');
}

// Optional cap on the instant points a referee can give within one hour (positive and negative together).
function check_score_cap($camp, $user, $value) {
    $cap = $camp['scoreCap']['perHour'] ?? null;
    if (empty(camp_features($camp)['scoreCap']) || !$cap || in_array($user['role'], MANAGER_ROLES, true)) return;
    $since = now_ms() - 3600000;
    $used = 0.0;
    foreach ($camp['teams'] as $t) foreach ($t['scoreLogs'] as $l) {
        if (is_array($l) && ($l['type'] ?? '') === 'instant' && is_array($l['user'] ?? null) && ($l['user']['username'] ?? null) === $user['username']
            && ($l['createdAt'] ?? $l['timestamp'] ?? 0) > $since) $used += abs(num($l['value'] ?? 0));
    }
    if ($used + abs($value) > $cap) {
        throw new HttpError(429, "سقف امتیاز شما در یک ساعت ({$cap}) پر شده است. " . max(0, r2($cap - $used)) . ' امتیاز دیگر می‌توانید ثبت کنید.');
    }
}

// Applies the advanced settings shared by the operator panel and the superadmin form.
function apply_advanced($camp, $b) {
    $changes = [];
    $teamIds = array_fill_keys(array_column($camp['teams'], 'id'), true);
    $stageIds = array_fill_keys(array_column($camp['stages'], 'id'), true);
    $has = function ($k) use ($b) { return array_key_exists($k, $b); };
    if ($has('display')) $changes['display'] = clean_display($b['display']);
    if ($has('features')) $changes['features'] = clean_features($b['features']);
    if ($has('skills')) $changes['skills'] = clean_skills($b['skills']);
    if ($has('tagSkills')) $changes['tagSkills'] = clean_tag_skills($b['tagSkills'], $changes['skills'] ?? $camp['skills']);
    if ($has('divisions')) $changes['divisions'] = clean_named_list($b['divisions'], 'dv', 20);
    if ($has('roles')) $changes['roles'] = clean_roles($b['roles']);
    if ($has('assignments')) $changes['assignments'] = clean_assignments($b['assignments'], $teamIds, $stageIds);
    if ($has('scoreCap')) $changes['scoreCap'] = clean_score_cap($b['scoreCap']);
    if ($has('chanceCards')) $changes['chanceCards'] = clean_chance_cards($b['chanceCards']);
    if ($has('rounds')) $changes['rounds'] = clean_rounds($b['rounds'], $camp['rounds']);
    if ($has('brand')) $changes['brand'] = clean_brand($b['brand']);
    if ($has('certificate')) $changes['certificate'] = clean_certificate($b['certificate']);
    if ($has('uiLang')) $changes['uiLang'] = $b['uiLang'] === 'en' ? 'en' : 'fa';
    if ($has('calibrationCases')) $changes['calibration'] = array_merge($camp['calibration'], ['cases' => clean_calibration_cases($b['calibrationCases'], $camp['calibration']['cases'])]);
    if ($has('registrationOpen')) $changes['registration'] = array_merge($camp['registration'], ['open' => !empty($b['registrationOpen'])]);
    if (is_obj($b['teamsExtra'] ?? null) || is_list($b['regeneratePins'] ?? null)) {
        $extra = is_obj($b['teamsExtra'] ?? null) ? $b['teamsExtra'] : [];
        $regen = [];
        foreach ((is_list($b['regeneratePins'] ?? null) ? $b['regeneratePins'] : []) as $x) if (is_string($x)) $regen[$x] = true;
        $teams = $camp['teams'];
        foreach ($teams as &$t) {
            $e = $extra[$t['id']] ?? null;
            if (is_obj($e)) {
                if (array_key_exists('members', $e)) $t['members'] = clean_members($e['members']);
                if (array_key_exists('division', $e)) $t['division'] = sstr($e['division'], 64);
                if (array_key_exists('secretCards', $e)) $t['secretCards'] = clean_secret_cards($e['secretCards']);
            }
            if (isset($regen[$t['id']])) $t['pin'] = new_pin();
        }
        unset($t);
        $changes['teams'] = ensure_pins($teams);
    }
    if (is_obj($b['stagesExtra'] ?? null)) {
        $stages = $camp['stages'];
        foreach ($stages as &$s) {
            $e = $b['stagesExtra'][$s['id']] ?? null;
            if (!is_obj($e)) continue;
            if (array_key_exists('criteria', $e)) $s['criteria'] = clean_criteria($e['criteria']);
            if (array_key_exists('startAt', $e) || array_key_exists('durationMin', $e)) {
                $s = array_merge($s, clean_schedule(['startAt' => $e['startAt'] ?? ($s['startAt'] ?? null), 'durationMin' => $e['durationMin'] ?? ($s['durationMin'] ?? null)]));
            }
        }
        unset($s);
        $changes['stages'] = $stages;
    }
    return $changes;
}

// Winners move to the next round; a changed result clears what depended on it.
function propagate_bracket(&$bracket) {
    $n = count($bracket['rounds']);
    for ($r = 0; $r < $n - 1; $r++) {
        foreach ($bracket['rounds'][$r]['matches'] as $i => $m) {
            $next = &$bracket['rounds'][$r + 1]['matches'][intdiv($i, 2)];
            $slot = $i % 2 === 0 ? 'a' : 'b';
            $w = $m['winner'] ?? null;
            if (($next[$slot] ?? null) !== $w) {
                $next[$slot] = $w;
                if (!empty($next['winner']) && $next['winner'] !== ($next['a'] ?? null) && $next['winner'] !== ($next['b'] ?? null)) $next['winner'] = null;
            }
            unset($next);
        }
    }
}

function team_private_view($camp, $team) {
    $f = camp_features($camp);
    $open = $camp['peerReview']['open'] ?? null;
    $done = [];
    foreach ($team['records'] as $r) {
        if (is_array($r) && ($r['kind'] ?? '') === 'feedback' && ($r['stageId'] ?? null) === $open) $done[$r['from'] ?? ''] = true;
    }
    $rounds = [];
    if ($f['decisions']) {
        foreach ($camp['rounds'] as $r) {
            if (($r['status'] ?? '') !== 'open') continue;
            $rounds[] = [
                'id' => $r['id'], 'title' => $r['title'] ?? '', 'question' => $r['question'] ?? '',
                'options' => array_map(function ($o) { return ['id' => $o['id'], 'label' => $o['label'] ?? '']; }, $r['options'] ?? []),
                'choice' => $camp['decisions'][$r['id']][$team['id']]['optionId'] ?? null
            ];
        }
    }
    $stageName = 'کل مسابقه';
    foreach ($camp['stages'] as $s) if (($s['id'] ?? null) === $open) $stageName = $s['name'] ?? $stageName;
    return [
        'team' => ['id' => $team['id'], 'name' => $team['name'] ?? '', 'color' => $team['color'] ?? '', 'members' => $team['members'], 'budget' => team_budget($team)],
        'secretCards' => $f['secretCards'] ? $team['secretCards'] : [],
        'rounds' => $rounds,
        'peer' => ($f['peerReview'] && $open) ? ['stageId' => $open, 'stageName' => $stageName, 'skills' => $camp['skills'], 'done' => array_map('strval', array_keys($done))] : null
    ];
}

function analysis_data($camp) {
    $rest = $camp;
    unset($rest['password'], $rest['users'], $rest['auditLog'], $rest['deletedAt'], $rest['clientKey'], $rest['ownerId'], $rest['notify'], $rest['registration']);
    $teams = [];
    foreach ($camp['teams'] as $t) {
        $budget = team_budget($t);
        unset($t['pin'], $t['secretCards']);
        $t['budget'] = $budget;
        foreach ($t['scoreLogs'] as &$l) if (is_array($l) && isset($l['user'])) $l['user'] = public_user($l['user']);
        unset($l);
        $teams[] = $t;
    }
    $rest['teams'] = teams_for_json($teams);
    $rest['closedStages'] = as_map($camp['closedStages']);
    $rest['stageTieredResults'] = as_map($camp['stageTieredResults']);
    $rest['users'] = array_map(function ($u) {
        return ['username' => $u['username'] ?? '', 'name' => display_name($u), 'role' => $u['role'] ?? 'referee', 'profilePic' => $u['profilePic'] ?? ''];
    }, $camp['users']);
    $rest['audit'] = array_map(function ($e) { unset($e['undo']); $e['details'] = as_map($e['details'] ?? []); return $e; }, $camp['auditLog']);
    return extras_maps($rest);
}

// ---------------------------------------------------------------------------
// Trash and backups
// ---------------------------------------------------------------------------
const BACKUP_FORMAT = 'sim-camp-backup';

// Camps deleted more than TRASH_DAYS ago are removed for good (checked at most once an hour).
function purge_expired_trash() {
    global $conn;
    $last = (int)get_setting('trash_purged_at');
    if (time() - $last < 3600) return;
    set_setting('trash_purged_at', (string)time());
    $limit = now_ms() - TRASH_DAYS * 86400000;
    $stmt = $conn->prepare("SELECT id FROM camps WHERE deletedAt IS NOT NULL AND deletedAt > 0 AND deletedAt < ?");
    $stmt->execute([$limit]);
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $id) purge_camp($id);
}

function purge_camp($id) {
    global $conn;
    $conn->prepare("DELETE FROM camps WHERE id = ?")->execute([$id]);
    $conn->prepare("DELETE FROM settings WHERE `key` = ?")->execute(['admin_pic_' . $id]);
}

// One camp in the backup format shared with the Node edition (scores inside the teams).
function export_camp($id) {
    $c = load_camp($id, true);
    if (!$c) return null;
    unset($c['deletedAt']);
    $c['teams'] = teams_for_json($c['teams']);
    $c['closedStages'] = as_map($c['closedStages']);
    $c['stageTieredResults'] = as_map($c['stageTieredResults']);
    $c['locked'] = $c['locked'] ? 1 : 0;
    $c = extras_maps($c);
    $pic = get_setting('admin_pic_' . $id);
    if ($pic) $c['adminProfilePic'] = $pic;
    return $c;
}

function build_backup($ids, $includeSettings) {
    $camps = [];
    foreach ($ids as $id) { $c = export_camp($id); if ($c) $camps[] = $c; }
    $settings = [];
    if ($includeSettings) { $logo = get_setting('systemLogo'); if ($logo) $settings['systemLogo'] = $logo; }
    $names = [];
    collect_media_names([$camps, $settings], $names);
    $media = [];
    foreach (array_keys($names) as $name) { $bytes = media_get($name); if ($bytes !== null) $media[$name] = base64_encode($bytes); }
    return ['format' => BACKUP_FORMAT, 'version' => 1, 'source' => 'php', 'exportedAt' => gmdate('c'), 'camps' => $camps, 'settings' => (object)$settings, 'media' => (object)$media];
}

function send_backup($backup, $name) {
    header('Content-Disposition: attachment; filename="' . $name . '-' . gmdate('Y-m-d-H-i-s') . '.json"');
    header('Cache-Control: no-store');
    out($backup);
}

function all_camp_ids() {
    global $conn;
    return $conn->query("SELECT id FROM camps ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
}

// Restores camps from a backup file; existing camps are never overwritten.
function import_backup($b, $admin = null) {
    $admin = $admin ?: ['super' => true, 'orgId' => null];
    $orgIds = array_fill_keys(array_column(get_organizers(), 'id'), true);
    if (($b['format'] ?? null) !== BACKUP_FORMAT || !is_array($b['camps'] ?? null)) throw new HttpError(400, 'این فایل، فایل پشتیبان سیم‌کمپ نیست.');
    $mediaCount = 0;
    foreach ((is_array($b['media'] ?? null) ? $b['media'] : []) as $name => $data) {
        if (!preg_match(MEDIA_NAME_RE, (string)$name) || !is_string($data)) continue;
        $bytes = base64_decode($data, true);
        if ($bytes === false || substr(hash('sha256', $bytes), 0, 32) !== substr($name, 0, 32)) continue; // corrupted
        media_put($name, $bytes);
        $mediaCount++;
    }
    $imported = [];
    $foreign = false;
    foreach ($b['camps'] as $raw) {
        if (!is_array($raw) || !is_array($raw['teams'] ?? null)) continue;
        $c = parse_camp(array_merge(['fieldJudgingMode' => '', 'campType' => '', 'numLang' => '', 'dir' => ''], $raw));
        $secrets = array_filter(array_merge([$c['password'] ?? ''], array_map(function ($u) { return $u['password'] ?? ''; }, $c['users'])));
        foreach ($secrets as $h) if (strpos((string)$h, 'scrypt$') === 0) $foreign = true;
        $orig = (string)($raw['id'] ?? '');
        $id = preg_match(CAMP_ID_RE, $orig) ? $orig : new_random_camp_id();
        for ($i = 0; ; $i++) {
            try { insert_new_camp($id); break; }
            catch (HttpError $e) {
                if ($e->status !== 409 || $i > 5) throw $e;
                $id = substr($orig !== '' ? $orig : 'camp', 0, 50) . '-' . bin2hex(random_bytes(3));
            }
        }
        $fields = array_intersect_key($c, array_flip(array_merge(CAMP_COLUMNS, EXTRA_KEYS)));
        unset($fields['deletedAt']);
        $fields['clientKey'] = ''; // report links are not carried over
        $owner = $raw['ownerId'] ?? null;
        $fields['ownerId'] = $admin['super'] ? ((is_string($owner) && isset($orgIds[$owner])) ? $owner : null) : $admin['orgId'];
        save_camp_changes($id, $fields);
        if (!empty($raw['adminProfilePic']) && is_string($raw['adminProfilePic'])) set_setting('admin_pic_' . $id, externalize($raw['adminProfilePic']));
        $imported[] = ['id' => $id, 'originalId' => $orig !== '' ? $orig : null, 'title' => $c['title'] ?? ''];
    }
    if ($admin['super'] && is_array($b['settings'] ?? null) && is_string($b['settings']['systemLogo'] ?? null) && $b['settings']['systemLogo'] !== '' && !get_setting('systemLogo')) {
        set_setting('systemLogo', externalize($b['settings']['systemLogo']));
    }
    return ['success' => true, 'imported' => $imported, 'media' => $mediaCount, 'foreignPasswords' => $foreign];
}

if ($isCli) return; // backup.php: functions only

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
try {
    switch ($action) {

    case 'health':
        // For uptime monitors: 200 when PHP and the database work, otherwise 503.
        $t0 = microtime(true);
        $dbOk = false;
        try { $dbOk = $conn->query('SELECT 1')->fetchColumn() == 1; } catch (Throwable $e) { $dbOk = false; }
        $warnings = [];
        if (!superadmin_secret()) $warnings[] = 'Superadmin password is not set: open setup_db.php.';
        if ($active_driver === 'sqlite' && !is_writable(__DIR__ . '/data')) $warnings[] = 'The data/ folder is not writable.';
        if (!function_exists('apcu_inc') || !ini_get('apc.enabled')) $warnings[] = 'APCu is not available: per-IP rate limiting is off (use the host firewall / Cloudflare).';
        out([
            'status' => $dbOk ? 'ok' : 'degraded',
            'db' => ['ok' => $dbOk, 'driver' => $active_driver, 'latencyMs' => (int)round((microtime(true) - $t0) * 1000)],
            'php' => PHP_VERSION,
            'warnings' => $warnings
        ], $dbOk ? 200 : 503);

    case 'settings':
        if ($method === 'GET') {
            $logo = get_setting('systemLogo');
            if (is_string($logo) && strncmp($logo, 'data:image/', 11) === 0) { $logo = externalize($logo); set_setting('systemLogo', $logo); }
            out(['systemLogo' => $logo]);
        }
        require_superadmin();
        if (($data['key'] ?? '') !== 'systemLogo') throw new HttpError(400, 'کلید تنظیمات مجاز نیست.');
        if (!is_string($data['value'] ?? null) || strlen($data['value']) > 2000000) throw new HttpError(400, 'مقدار نامعتبر است.');
        $stored = externalize($data['value']);
        set_setting('systemLogo', $stored);
        out(['success' => true, 'value' => $stored]);

    case 'superadmin_login':
        $rk = 'sa:' . client_ip();
        $orgUser = is_string($data['username'] ?? null) ? trim($data['username']) : '';
        if ($orgUser !== '') {
            if (!rate_limit_check($rk)) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر دوباره امتحان کنید.');
            $org = null;
            foreach (get_organizers() as $o) if (($o['username'] ?? null) === $orgUser && empty($o['disabled'])) $org = $o;
            if (!$org || !verify_password($data['password'] ?? '', $org['password'] ?? '')) out(['success' => false, 'message' => 'نام کاربری یا رمز عبور اشتباه است!']);
            rate_limit_reset($rk);
            out(['success' => true, 'role' => 'organizer', 'name' => ($org['name'] ?? '') !== '' ? $org['name'] : $org['username'],
                'token' => create_token(['t' => 'org', 'oid' => $org['id'], 'pv' => fingerprint($org['password'])])]);
        }
        $secret = superadmin_secret();
        if (!$secret) out(['success' => false, 'message' => 'رمز سوپرادمین هنوز تعیین نشده است. ابتدا صفحه setup_db.php را باز کنید.']);
        if (!rate_limit_check($rk)) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر دوباره امتحان کنید.');
        if (!verify_password($data['password'] ?? '', $secret)) out(['success' => false, 'message' => 'رمز عبور سوپرادمین اشتباه است!']);
        rate_limit_reset($rk);
        out(['success' => true, 'role' => 'superadmin', 'token' => create_token(['t' => 'sa', 'pv' => fingerprint($secret)])]);

    // Who is signed in to the superadmin panel.
    case 'superadmin_me':
        $admin = require_admin();
        out(['success' => true, 'role' => $admin['super'] ? 'superadmin' : 'organizer', 'name' => $admin['name']]);

    case 'superadmin_camps':
        $admin = require_admin();
        purge_expired_trash();
        $rows = $conn->query("SELECT id, orgName, title, locked, archived, campType, deletedAt, extras FROM camps ORDER BY id DESC")->fetchAll(PDO::FETCH_ASSOC);
        $orgNames = [];
        if ($admin['super']) foreach (get_organizers() as $o) $orgNames[$o['id']] = ($o['name'] ?? '') !== '' ? $o['name'] : ($o['username'] ?? '');
        $camps = [];
        $trash = 0;
        foreach ($rows as $c) {
            $ex = json_field($c['extras'] ?? null, []);
            $c['ownerId'] = is_array($ex) ? ($ex['ownerId'] ?? null) : null;
            if (!camp_visible($admin, $c)) continue;
            if (!empty($c['deletedAt'])) { $trash++; continue; }
            $c['owner'] = $c['ownerId'] ? ($orgNames[$c['ownerId']] ?? '') : '';
            unset($c['deletedAt'], $c['extras'], $c['ownerId']);
            $c['locked'] = !empty($c['locked']);
            $c['archived'] = !empty($c['archived']);
            $camps[] = $c;
        }
        out(['success' => true, 'camps' => $camps, 'trashCount' => $trash]);

    case 'superadmin_trash':
        $admin = require_admin();
        purge_expired_trash();
        $limit = now_ms() - TRASH_DAYS * 86400000;
        $stmt = $conn->prepare("SELECT id, orgName, title, campType, deletedAt, extras FROM camps WHERE deletedAt IS NOT NULL AND deletedAt >= ? ORDER BY deletedAt DESC");
        $stmt->execute([$limit]);
        $camps = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $ex = json_field($c['extras'] ?? null, []);
            if (!camp_visible($admin, ['ownerId' => is_array($ex) ? ($ex['ownerId'] ?? null) : null])) continue;
            unset($c['extras']);
            $c['deletedAt'] = (int)$c['deletedAt'];
            $c['orgName'] = $c['orgName'] ?? '';
            $c['title'] = $c['title'] ?? '';
            $c['purgeAt'] = $c['deletedAt'] + TRASH_DAYS * 86400000;
            $camps[] = $c;
        }
        out(['success' => true, 'camps' => $camps, 'trashDays' => TRASH_DAYS]);

    case 'superadmin_camp_restore':
        $admin = require_admin();
        admin_mutate($admin, $_GET['id'] ?? '', true, function ($camp) {
            if (empty($camp['deletedAt'])) throw new HttpError(400, 'این مسابقه در سطل زباله نیست.');
            return ['changes' => ['deletedAt' => null]];
        }, true);
        out(['success' => true]);

    case 'superadmin_camp_purge':
        $admin = require_admin();
        $id = require_id($_GET['id'] ?? '');
        $camp = load_camp($id, true);
        if (!$camp || !camp_visible($admin, $camp)) throw new HttpError(404, 'مسابقه یافت نشد.');
        if (empty($camp['deletedAt'])) throw new HttpError(400, 'فقط مسابقه‌های داخل سطل زباله را می‌توان برای همیشه حذف کرد.');
        purge_camp($id);
        out(['success' => true]);

    case 'superadmin_camp_export':
        $admin = require_admin();
        $id = require_id($_GET['id'] ?? '');
        if (!camp_visible($admin, load_camp($id, true))) throw new HttpError(404, 'مسابقه یافت نشد.');
        $backup = build_backup([$id], false);
        if (!$backup['camps']) throw new HttpError(404, 'مسابقه یافت نشد.');
        send_backup($backup, 'sim-camp-' . $id);

    case 'superadmin_backup':
        require_superadmin();
        send_backup(build_backup(all_camp_ids(), true), 'sim-camp-backup');

    case 'superadmin_import':
        $admin = require_admin();
        out(import_backup($data, $admin));

    case 'superadmin_camp':
        $admin = require_admin();
        $camp = load_camp($_GET['id'] ?? '');
        if (!$camp || !camp_visible($admin, $camp)) out(['success' => false, 'message' => 'مسابقه یافت نشد']);
        out(['success' => true, 'camp' => admin_state($camp)]);

    case 'superadmin_camp_lock':
        $admin = require_admin();
        admin_mutate($admin, $_GET['id'] ?? '', true, function () use ($data) { return ['changes' => ['locked' => !empty($data['locked'])]]; });
        out(['success' => true]);

    case 'superadmin_camp_archive':
        $admin = require_admin();
        admin_mutate($admin, $_GET['id'] ?? '', true, function () use ($data) { return ['changes' => ['archived' => !empty($data['archived'])]]; });
        out(['success' => true]);

    // Read-only report link for the client organisation (analysis room without signing in).
    case 'superadmin_camp_client_key':
        $admin = require_admin();
        $key = ($data['op'] ?? '') === 'revoke' ? '' : new_key();
        admin_mutate($admin, $_GET['id'] ?? '', true, function () use ($key) { return ['changes' => ['clientKey' => $key]]; });
        out(['success' => true, 'key' => $key]);

    case 'setup':
        $admin = require_admin();
        $base = [
            'orgName' => str_or_empty($data['orgName'] ?? '', 200),
            'title' => str_or_empty($data['title'] ?? '', 200),
            'logo' => str_or_empty($data['logo'] ?? '', 2000000),
            'stages' => clean_stages($data['stages'] ?? []),
            'numLang' => ($data['numLang'] ?? '') === 'en' ? 'en' : 'fa',
            'dir' => ($data['dir'] ?? '') === 'ltr' ? 'ltr' : 'rtl',
            'campType' => in_array($data['campType'] ?? '', ['simple', 'professional', 'tiered'], true) ? $data['campType'] : 'simple',
            'tieredPointsLadder' => parse_ladder($data['tieredPointsLadder'] ?? DEFAULT_LADDER),
            'fieldJudgingMode' => ($data['fieldJudgingMode'] ?? '') === 'restricted' ? 'restricted' : 'free',
            'fieldJudgingValues' => clean_number_list($data['fieldJudgingValues'] ?? null, DEFAULT_FJ_VALUES),
            'positiveTags' => clean_string_list($data['positiveTags'] ?? null, DEFAULT_POSITIVE_TAGS),
            'negativeTags' => clean_string_list($data['negativeTags'] ?? null, DEFAULT_NEGATIVE_TAGS)
        ];
        $teamDefs = clean_team_defs($data['teams'] ?? []);
        $advancedInput = array_intersect_key($data, array_flip(ADVANCED_FORM_KEYS));
        $ownerFor = function () use ($admin, $data) {
            if (!$admin['super']) return $admin['orgId'];
            $want = $data['ownerId'] ?? null;
            if (!$want) return null;
            foreach (get_organizers() as $o) if (($o['id'] ?? null) === $want) return $want;
            return null;
        };
        if (!empty($data['campId'])) {
            $id = require_id($data['campId']);
            $setOwner = $admin['super'] && array_key_exists('ownerId', $data);
            $ownerId = $setOwner ? $ownerFor() : null;
            admin_mutate($admin, $id, true, function ($camp) use ($base, $teamDefs, $data, $advancedInput, $setOwner, $ownerId) {
                $changes = $base;
                $changes['stages'] = clean_stages($data['stages'] ?? [], $camp['stages']);
                $changes['teams'] = ensure_pins(merge_teams($camp['teams'], $teamDefs));
                $changes['users'] = clean_users($data['users'] ?? [], $camp['users']);
                if (is_string($data['password'] ?? null) && $data['password'] !== '') $changes['password'] = make_hash($data['password']);
                if (array_key_exists('notify', $data)) $changes['notify'] = clean_notify($data['notify'], $camp['notify']);
                if ($setOwner) $changes['ownerId'] = $ownerId;
                $extra = apply_advanced(array_merge($camp, $changes), $advancedInput);
                return ['changes' => array_merge($changes, $extra)];
            });
            out(['success' => true, 'campId' => $id]);
        }
        if (!is_string($data['password'] ?? null) || $data['password'] === '') throw new HttpError(400, 'رمز عبور اپراتور الزامی است.');
        $id = requested_camp_id($data['customId'] ?? null) ?? new_random_camp_id();
        $camp = array_merge($base, [
            'id' => $id,
            'password' => make_hash($data['password']),
            'teams' => ensure_pins(merge_teams([], $teamDefs)),
            'users' => clean_users($data['users'] ?? [], []),
            'ownerId' => $ownerFor()
        ]);
        // New camps start from the superadmin's defaults (visible elements, skills).
        $defaults = get_json_setting('displayDefaults');
        if (is_obj($defaults) && !array_key_exists('display', $data)) $camp['display'] = clean_display($defaults);
        $skills = get_json_setting('defaultSkills');
        if (is_list($skills) && $skills && !array_key_exists('skills', $data)) $camp['skills'] = clean_skills($skills);
        if (array_key_exists('notify', $data)) $camp['notify'] = clean_notify($data['notify'], null);
        $camp = array_merge($camp, apply_advanced(parse_extras($camp), $advancedInput));
        insert_new_camp($id);
        save_camp_changes($id, array_intersect_key($camp, array_flip(array_merge(CAMP_COLUMNS, EXTRA_KEYS))));
        out(['success' => true, 'campId' => $id]);

    case 'login':
        $id = $data['id'] ?? '';
        $fail = function ($msg = null) { out(['success' => false, 'message' => $msg ?: 'نام کاربری یا رمز عبور اشتباه است یا مسابقه یافت نشد!']); };
        if (!is_valid_id($id)) $fail();
        if (!empty($data['token'])) {
            $camp = load_camp($id);
            if (!$camp) $fail();
            try { $user = require_camp_user($camp, ROLES, $data['token']); }
            catch (HttpError $e) { $fail('نشست منقضی شده است. لطفاً دوباره وارد شوید.'); }
            out(array_merge(public_state($camp, 'member'), ['success' => true, 'token' => $data['token'], 'user' => public_user($user)]));
        }
        $username = $data['username'] ?? '';
        $password = $data['password'] ?? '';
        if (!is_string($username) || $username === '') $fail('نام کاربری الزامی است!');
        $rk = 'camp:' . $id . ':' . client_ip();
        if (!rate_limit_check($rk)) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر دوباره امتحان کنید.');
        try {
            $res = mutate_camp($id, true, function ($camp) use ($username, $password) {
                $found = find_camp_user($camp, $username);
                if (!$found || !verify_password($password, $found['secret'])) return ['ok' => false];
                $secret = $found['secret'];
                if (is_hashed($secret)) return ['ok' => true, 'user' => $found['user'], 'secret' => $secret];
                // Upgrade legacy plain-text passwords on first successful login.
                $secret = make_hash($password);
                if (!empty($found['builtin'])) return ['ok' => true, 'user' => $found['user'], 'secret' => $secret, 'changes' => ['password' => $secret]];
                $users = $camp['users'];
                foreach ($users as &$u) if (($u['username'] ?? null) === $username) $u['password'] = $secret;
                unset($u);
                return ['ok' => true, 'user' => $found['user'], 'secret' => $secret, 'changes' => ['users' => $users]];
            });
        } catch (HttpError $e) {
            if ($e->status === 404) $fail();
            throw $e;
        }
        if (empty($res['ok'])) $fail();
        rate_limit_reset($rk);
        $token = create_token(['t' => 'camp', 'campId' => $id, 'username' => $res['user']['username'], 'pv' => fingerprint($res['secret'])]);
        out(array_merge(public_state($res['camp'], 'member'), ['success' => true, 'token' => $token, 'user' => public_user($res['user'])]));

    case 'info':
        $camp = load_camp($_GET['id'] ?? '');
        if (!$camp) out(['success' => false]);
        out(['success' => true, 'orgName' => $camp['orgName'] ?? '', 'title' => $camp['title'] ?? '', 'logo' => $camp['logo'] ?? '', 'campType' => $camp['campType']]);

    case 'poll':
        $id = require_id($_GET['id'] ?? '', 'شناسه مسابقه');
        $camp = load_camp($id);
        if (!$camp) throw new HttpError(404, 'مسابقه یافت نشد');
        // Signed-in referees and managers get the member view (messages, assignments, real standings while frozen).
        $view = 'public';
        if (request_token() !== '') { try { require_camp_user($camp); $view = 'member'; } catch (HttpError $e) { /* public */ } }
        // Unchanged data costs a "304 Not Modified" without a body.
        $json = json_encode(public_state($camp, $view), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $etag = '"' . sha1($view . $json) . '"';
        header('Cache-Control: no-cache');
        header('Vary: X-Auth-Token');
        header('ETag: ' . $etag);
        if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
        echo $json;
        exit;

    case 'update_camp':
        if ($method !== 'POST') throw new HttpError(405, 'Method not allowed');
        mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $c = [];
            if (isset($data['teams'])) $c['teams'] = merge_teams($camp['teams'], clean_team_defs($data['teams']));
            if (isset($data['stages'])) $c['stages'] = clean_stages($data['stages'], $camp['stages']);
            if (is_string($data['orgName'] ?? null) && $data['orgName'] !== '') $c['orgName'] = str_or_empty($data['orgName'], 200);
            if (is_string($data['title'] ?? null)) $c['title'] = str_or_empty($data['title'], 200);
            if (is_string($data['logo'] ?? null)) $c['logo'] = str_or_empty($data['logo'], 2000000);
            if (isset($data['numLang'])) $c['numLang'] = $data['numLang'] === 'en' ? 'en' : 'fa';
            if (isset($data['dir'])) $c['dir'] = $data['dir'] === 'ltr' ? 'ltr' : 'rtl';
            if (isset($data['fieldJudgingMode'])) $c['fieldJudgingMode'] = $data['fieldJudgingMode'] === 'restricted' ? 'restricted' : 'free';
            if (isset($data['fieldJudgingValues'])) $c['fieldJudgingValues'] = clean_number_list($data['fieldJudgingValues'], DEFAULT_FJ_VALUES);
            if (isset($data['positiveTags'])) $c['positiveTags'] = clean_string_list($data['positiveTags'], DEFAULT_POSITIVE_TAGS);
            if (isset($data['negativeTags'])) $c['negativeTags'] = clean_string_list($data['negativeTags'], DEFAULT_NEGATIVE_TAGS);
            if (isset($data['campType'])) $c['campType'] = in_array($data['campType'], ['simple', 'professional', 'tiered'], true) ? $data['campType'] : $camp['campType'];
            if (isset($data['tieredPointsLadder'])) $c['tieredPointsLadder'] = parse_ladder($data['tieredPointsLadder']);
            $details = [];
            if (isset($c['teams'])) {
                $before = array_column($camp['teams'], 'name', 'id');
                $after = array_column($c['teams'], 'name', 'id');
                $details['addedTeams'] = array_values(array_diff_key($after, $before));
                $details['removedTeams'] = array_values(array_diff_key($before, $after));
            }
            return ['changes' => $c, 'audit' => ['user' => $user, 'action' => 'settings', 'details' => $details]];
        });
        out(['success' => true, 'status' => 'success']);

    case 'instant':
        $teamId = require_id($data['teamId'] ?? null, 'شناسه تیم');
        $photo = $data['photo'] ?? null;
        if (array_key_exists('photo', $data) && $photo !== '' && (!is_string($photo) || strlen($photo) > 700000 || strncmp($photo, 'data:image/', 11) !== 0)) {
            throw new HttpError(400, 'عکس نامعتبر یا بیش از حد بزرگ است.');
        }
        $value = $data['delta'] ?? null;
        if (!is_numeric($value) || (float)$value == 0 || abs((float)$value) > 1000000) throw new HttpError(400, 'مقدار امتیاز نامعتبر است.');
        // Offline clients send their own id so a retried request is never counted twice.
        $clientLogId = $data['clientLogId'] ?? null;
        $logId = (is_string($clientLogId) && preg_match('/^log_[A-Za-z0-9_-]{6,40}$/', $clientLogId)) ? $clientLogId : 'log_' . bin2hex(random_bytes(6));
        $res = mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($teamId, $value, $logId, $data, $photo) {
            $user = require_camp_user($camp);
            $ti = team_index($camp, $teamId);
            foreach ($camp['teams'] as $tt) {
                foreach ($tt['scoreLogs'] as $ll) if (is_array($ll) && ($ll['id'] ?? null) === $logId) return ['duplicate' => true];
            }
            check_assignment($camp, $user, $teamId, null);
            check_score_cap($camp, $user, (float)$value);
            $teams = $camp['teams'];
            $now = now_ms();
            $log = [
                'id' => $logId, 'type' => 'instant', 'value' => r2((float)$value), 'timestamp' => $now, 'createdAt' => $now,
                'user' => public_user($user), 'tag' => str_or_empty($data['tag'] ?? '', 100)
            ];
            $memberId = $data['memberId'] ?? null;
            if ($memberId && !empty(camp_features($camp)['individual'])) {
                if (!in_array($memberId, array_column($teams[$ti]['members'], 'id'), true)) throw new HttpError(404, 'بازیکن در این تیم پیدا نشد.');
                $log['memberId'] = $memberId;
            }
            if (is_string($data['note'] ?? null) && trim($data['note']) !== '') $log['note'] = mb_substr(trim($data['note']), 0, 300);
            if ($photo) $log['photo'] = $photo; // stored as a media file when saved
            $teams[$ti]['scoreLogs'][] = $log;
            recompute_score($teams[$ti]);
            return ['changes' => ['teams' => $teams], 'score' => $teams[$ti]['score']];
        });
        if (!empty($res['duplicate'])) out(['success' => true, 'logId' => $logId, 'duplicate' => true]);
        out(['success' => true, 'logId' => $logId, 'score' => $res['score']]);

    case 'undo_instant':
        $logId = require_id($data['logId'] ?? null, 'شناسه امتیاز');
        mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($logId) {
            $user = require_camp_user($camp);
            $teams = $camp['teams'];
            foreach ($teams as $ti => $t) {
                foreach ($t['scoreLogs'] as $li => $l) {
                    if (!is_array($l) || ($l['id'] ?? '') !== $logId || ($l['type'] ?? '') !== 'instant') continue;
                    if ($user['role'] === 'referee' && (($l['user']['username'] ?? null) !== $user['username'])) {
                        throw new HttpError(403, 'فقط امتیازهای ثبت‌شده توسط خودتان را می‌توانید لغو کنید.');
                    }
                    $teams[$ti]['scoreLogs'][$li]['type'] = 'cancelled';
                    $teams[$ti]['scoreLogs'][$li]['timestamp'] = now_ms();
                    recompute_score($teams[$ti]);
                    return ['changes' => ['teams' => $teams]];
                }
            }
            throw new HttpError(404, 'امتیاز مورد نظر یافت نشد یا قبلاً لغو شده است.');
        });
        out(['success' => true]);

    case 'judge_stage_score':
        $stageId = require_id($data['stageId'] ?? null, 'شناسه مرحله');
        $res = mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($stageId, $data) {
            $user = require_camp_user($camp);
            $isManager = in_array($user['role'], MANAGER_ROLES, true);
            $stageFound = false;
            foreach ($camp['stages'] as $s) if (($s['id'] ?? '') === $stageId) $stageFound = true;
            if (!$stageFound) throw new HttpError(404, 'مرحله یافت نشد.');
            if (!empty($camp['closedStages'][$stageId])) throw new HttpError(409, 'این مرحله بسته شده است. برای ثبت نمره ابتدا آن را بازگشایی کنید.');
            $isTiered = $camp['campType'] === 'tiered';
            $teams = $camp['teams'];
            $single = is_array($data['singleScore'] ?? null) ? $data['singleScore'] : null;

            if (($data['action'] ?? '') === 'delete') {
                if (!$isManager) throw new HttpError(403, 'فقط اپراتور یا سرداور می‌تواند نمره داوران را حذف کند.');
                $target = $data['targetJudgeKey'] ?? null;
                if (!is_safe_key($target)) throw new HttpError(400, 'شناسه داور نامعتبر است.');
                $onlyTeam = $single['teamId'] ?? null;
                $affected = [];
                foreach ($teams as &$t) {
                    if ($onlyTeam && $t['id'] !== $onlyTeam) continue;
                    if (!isset($t['judgeStageScores'][$stageId][$target])) continue;
                    unset($t['judgeStageScores'][$stageId][$target]);
                    $affected[] = $t['name'] ?? '';
                    if (!$isTiered) { apply_judges_to_stage($t, $stageId, true); recompute_score($t); }
                }
                unset($t);
                return ['changes' => ['teams' => $teams], 'audit' => ['user' => $user, 'action' => 'judge_score_delete', 'details' => ['stage' => stage_name($camp, $stageId), 'judge' => $target, 'teams' => $affected]]];
            }

            $target = $data['targetJudgeKey'] ?? null;
            $judgeKey = ($isManager && is_safe_key($target)) ? $target : $user['username'];
            $scores = is_array($data['scores'] ?? null) ? $data['scores'] : ($single && isset($single['teamId']) ? [$single['teamId'] => $single['score'] ?? 0] : []);
            $dnfTeam = ($single && !empty($single['dnf'])) ? ($single['teamId'] ?? null) : null;
            // Multi-criteria judging: the stage value is the weighted sum of the criteria.
            $stage = null;
            foreach ($camp['stages'] as $st) if (($st['id'] ?? '') === $stageId) $stage = $st;
            $breakdowns = [];
            if (!empty(camp_features($camp)['rubric']) && !empty($stage['criteria'])) {
                $bd = is_obj($data['breakdown'] ?? null) ? $data['breakdown']
                    : (($single && is_obj($single['breakdown'] ?? null)) ? [$single['teamId'] ?? '' => $single['breakdown']] : []);
                foreach ($bd as $tid => $map) {
                    $tid = (string)$tid;
                    if (!is_obj($map) || $dnfTeam === $tid) continue;
                    $clean = [];
                    $total = 0.0;
                    foreach ($stage['criteria'] as $cr) {
                        if (!array_key_exists($cr['id'], $map) || $map[$cr['id']] === '' || $map[$cr['id']] === null) continue;
                        $clean[$cr['id']] = r2(num($map[$cr['id']]));
                        $total += $clean[$cr['id']] * (float)$cr['weight'];
                    }
                    $breakdowns[$tid] = $clean;
                    $scores[$tid] = r2($total);
                }
            }
            foreach ($teams as &$t) {
                if (!array_key_exists($t['id'], $scores)) continue;
                check_assignment($camp, $user, $t['id'], $stageId);
                $entry = judge_entry_for($user, $scores[$t['id']], $dnfTeam === $t['id'], $judgeKey);
                if (isset($breakdowns[$t['id']])) $entry['criteria'] = $breakdowns[$t['id']];
                $t['judgeStageScores'][$stageId][$judgeKey] = $entry;
                if (!$isTiered) { apply_judges_to_stage($t, $stageId); recompute_score($t); }
            }
            unset($t);
            return ['changes' => ['teams' => $teams]];
        });
        out(['success' => true, 'teams' => public_state($res['camp'], 'member')['teams']]);

    case 'stage_scores':
        $stageId = require_id($data['stageId'] ?? null, 'شناسه مرحله');
        $scores = $data['scores'] ?? null;
        if (!is_array($scores)) throw new HttpError(400, 'نمرات نامعتبر است.');
        $res = mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($stageId, $scores) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $stageFound = false;
            foreach ($camp['stages'] as $s) if (($s['id'] ?? '') === $stageId) $stageFound = true;
            if (!$stageFound) throw new HttpError(404, 'مرحله یافت نشد.');
            if (!empty($camp['closedStages'][$stageId])) throw new HttpError(409, 'این مرحله بسته شده است. برای تغییر ابتدا آن را بازگشایی کنید.');
            $isTiered = $camp['campType'] === 'tiered';
            $teams = $camp['teams'];
            foreach ($teams as &$t) {
                if (!array_key_exists($t['id'], $scores)) continue;
                $entry = judge_entry_for($user, $scores[$t['id']], false, OVERRIDE_KEY);
                $entry['judgeName'] = display_name($user) . ' (اصلاح دستی)';
                $entry['override'] = true;
                $t['judgeStageScores'][$stageId][OVERRIDE_KEY] = $entry;
                if (!$isTiered) { apply_judges_to_stage($t, $stageId); recompute_score($t); }
            }
            unset($t);
            $changed = [];
            foreach ($teams as $t) if (array_key_exists($t['id'], $scores)) $changed[] = ['team' => $t['name'] ?? '', 'value' => $scores[$t['id']]];
            return ['changes' => ['teams' => $teams], 'audit' => ['user' => $user, 'action' => 'stage_scores', 'details' => ['stage' => stage_name($camp, $stageId), 'changed' => $changed]]];
        });
        out(['success' => true, 'teams' => public_state($res['camp'], 'member')['teams']]);

    case 'team_logs':
        $teamId = require_id($data['teamId'] ?? null, 'شناسه تیم');
        $res = mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($teamId, $data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $teams = $camp['teams'];
            foreach ($teams as &$t) {
                if ($t['id'] !== $teamId) continue;
                $scoreBefore = $t['score'] ?? 0;
                $removed = is_array($data['removed'] ?? null) ? $data['removed'] : [];
                $t['scoreLogs'] = array_values(array_filter($t['scoreLogs'], function ($l) use ($removed) {
                    return !(is_array($l) && in_array($l['id'] ?? null, $removed, true));
                }));
                $values = is_array($data['values'] ?? null) ? $data['values'] : [];
                foreach ($t['scoreLogs'] as &$l) {
                    if (is_array($l) && isset($l['id']) && array_key_exists($l['id'], $values)) $l['value'] = r2(num($values[$l['id']]));
                }
                unset($l);
                foreach ((is_array($data['stageValues'] ?? null) ? $data['stageValues'] : []) as $sId => $v) {
                    if (is_valid_id((string)$sId)) $t['stageScores'][$sId] = is_dnf_value($v) ? '-' : r2(num($v));
                }
                foreach ((is_array($data['removedStages'] ?? null) ? $data['removedStages'] : []) as $sId) {
                    unset($t['stageScores'][$sId]);
                }
                recompute_score($t);
                return ['changes' => ['teams' => $teams], 'audit' => ['user' => $user, 'action' => 'team_logs', 'details' => ['team' => $t['name'] ?? '', 'scoreBefore' => $scoreBefore, 'scoreAfter' => $t['score']]]];
            }
            throw new HttpError(404, 'تیم یافت نشد.');
        });
        out(['success' => true, 'teams' => public_state($res['camp'], 'member')['teams']]);

    case 'close_tiered':
        $stageId = require_id($data['stageId'] ?? null, 'شناسه مرحله');
        $res = mutate_camp($data['id'] ?? ($_GET['id'] ?? ''), false, function ($camp) use ($stageId, $data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $stages = $camp['stages'];
            $idx = null;
            foreach ($stages as $i => $s) if (($s['id'] ?? '') === $stageId) $idx = $i;
            if ($idx === null) throw new HttpError(404, 'مرحله یافت نشد.');
            $teams = $camp['teams'];
            $closed = $camp['closedStages'];
            $results = $camp['stageTieredResults'];

            if (!empty($data['reopen'])) {
                unset($closed[$stageId], $results[$stageId]);
                foreach ($teams as &$t) { unset($t['stageScores'][$stageId]); recompute_score($t); }
                unset($t);
                return [
                    'changes' => ['teams' => $teams, 'closedStages' => $closed, 'stageTieredResults' => $results],
                    'payload' => ['success' => true, 'reopened' => true, 'closedStages' => as_map($closed)],
                    'audit' => ['user' => $user, 'action' => 'stage_reopen', 'details' => ['stage' => $stages[$idx]['name'] ?? '']]
                ];
            }

            $ladder = parse_ladder(isset($data['customLadder']) && $data['customLadder'] !== null ? $data['customLadder'] : $camp['tieredPointsLadder']);
            $cm = $data['customMultiplier'] ?? null;
            if (is_numeric($cm) && (float)$cm > 0) $stages[$idx]['multiplier'] = (float)$cm;
            $sm = $stages[$idx]['multiplier'] ?? 1;
            $multiplier = (is_numeric($sm) && (float)$sm > 0) ? (float)$sm : 1;

            $rows = compute_tiered_results($teams, $stages[$idx], $ladder, $multiplier);
            $assigned = [];
            foreach ($rows as $r) $assigned[$r['teamId']] = $r['assignedScore'];
            foreach ($teams as &$t) { $t['stageScores'][$stageId] = $assigned[$t['id']] ?? 0; recompute_score($t); }
            unset($t);
            $closed[$stageId] = true;
            $results[$stageId] = ['closedAt' => now_ms(), 'ladder' => $ladder, 'multiplier' => $multiplier, 'results' => $rows];
            return [
                'changes' => ['teams' => $teams, 'stages' => $stages, 'closedStages' => $closed, 'stageTieredResults' => $results],
                'payload' => ['success' => true, 'closed' => true, 'stageId' => $stageId, 'ladder' => $ladder, 'multiplier' => $multiplier,
                              'results' => $rows, 'stages' => $stages, 'closedStages' => as_map($closed)],
                'audit' => ['user' => $user, 'action' => 'stage_close', 'details' => ['stage' => $stages[$idx]['name'] ?? '', 'multiplier' => $multiplier]]
            ];
        });
        if (!empty($res['payload']['closed'])) {
            $lines = [];
            foreach (array_slice($res['payload']['results'], 0, 5) as $r) $lines[] = $r['rank'] . '. ' . $r['teamName'] . ': ' . $r['assignedScore'];
            notify_camp($res['camp'], 'stage_close', 'نتایج مرحله «' . stage_name($res['camp'], $stageId) . "»:\n" . implode("\n", $lines));
        }
        out(array_merge($res['payload'], ['teams' => public_state($res['camp'], 'member')['teams']]));

    case 'user_profile_pic':
        $pic = is_string($data['profilePic'] ?? null) ? $data['profilePic'] : '';
        if (strlen($pic) > 500000) throw new HttpError(413, 'حجم عکس پروفایل بیش از حد مجاز است.');
        $pic = externalize($pic);
        mutate_camp($data['campId'] ?? ($_GET['id'] ?? ''), true, function ($camp) use ($pic) {
            $me = require_camp_user($camp);
            $users = $camp['users'];
            foreach ($users as &$u) {
                if (($u['username'] ?? null) === $me['username']) {
                    $u['profilePic'] = $pic;
                    return ['changes' => ['users' => $users]];
                }
            }
            unset($u);
            set_setting('admin_pic_' . $camp['id'], $pic); // built-in "admin" operator
            return [];
        });
        out(['success' => true, 'profilePic' => $pic]);

    case 'superadmin_id_available':
        require_admin();
        $id = trim((string)($_GET['id'] ?? ''));
        if (!preg_match(CAMP_ID_RE, $id)) out(['success' => true, 'available' => false, 'reason' => 'invalid', 'message' => CAMP_ID_HELP]);
        $existing = load_camp($id, true);
        if (!$existing) out(['success' => true, 'available' => true, 'reason' => null, 'message' => '']);
        $inTrash = !empty($existing['deletedAt']);
        out(['success' => true, 'available' => false, 'reason' => $inTrash ? 'trash' : 'taken',
            'message' => $inTrash ? 'این لینک متعلق به مسابقه‌ای در سطل زباله است.' : 'این لینک قبلاً برای مسابقه دیگری استفاده شده است.']);

    // Deleting moves the camp to the trash; it can be restored for TRASH_DAYS days.
    case 'superadmin_camp_delete':
        $admin = require_admin();
        admin_mutate($admin, $_GET['id'] ?? '', true, function () { return ['changes' => ['deletedAt' => now_ms()]]; });
        out(['success' => true, 'trashDays' => TRASH_DAYS]);

    case 'superadmin_camp_duplicate':
        $admin = require_admin();
        $src = load_camp(require_id($_GET['id'] ?? ''));
        if (!$src) throw new HttpError(404, 'مسابقه یافت نشد.');
        assert_camp_access($admin, $src);
        $newId = requested_camp_id($data['customId'] ?? null) ?? new_random_camp_id();
        $title = (is_string($data['title'] ?? null) && trim($data['title']) !== '') ? str_or_empty(trim($data['title']), 200) : (($src['title'] ?? '') . ' (کپی)');
        $teams = $src['teams'];
        foreach ($teams as &$t) { reset_team_scores($t); $t['pin'] = ''; }
        unset($t);
        $teams = ensure_pins($teams);
        insert_new_camp($newId);
        // The definition and feature settings are copied; scores and everything that happened are not.
        save_camp_changes($newId, [
            'orgName' => $src['orgName'] ?? '', 'title' => $title, 'logo' => $src['logo'] ?? '', 'password' => $src['password'] ?? '',
            'teams' => $teams, 'stages' => $src['stages'], 'users' => $src['users'], 'numLang' => $src['numLang'], 'dir' => $src['dir'],
            'campType' => $src['campType'], 'tieredPointsLadder' => $src['tieredPointsLadder'], 'fieldJudgingMode' => $src['fieldJudgingMode'],
            'fieldJudgingValues' => $src['fieldJudgingValues'], 'positiveTags' => $src['positiveTags'], 'negativeTags' => $src['negativeTags'],
            'auditLog' => [],
            'display' => $src['display'], 'features' => $src['features'], 'skills' => $src['skills'], 'tagSkills' => $src['tagSkills'],
            'divisions' => $src['divisions'], 'roles' => $src['roles'], 'assignments' => $src['assignments'], 'scoreCap' => $src['scoreCap'],
            'chanceCards' => $src['chanceCards'], 'brand' => $src['brand'], 'uiLang' => $src['uiLang'], 'notify' => $src['notify'],
            'certificate' => $src['certificate'],
            'rounds' => array_map(function ($r) { return array_merge($r, ['status' => 'draft', 'revealed' => false, 'applied' => false]); }, $src['rounds']),
            'calibration' => ['cases' => array_map(function ($c) { $c['open'] = false; return $c; }, $src['calibration']['cases']), 'scores' => []],
            'registration' => ['open' => false, 'requests' => []],
            'ownerId' => $src['ownerId'] ?? null
        ]);
        out(['success' => true, 'campId' => $newId]);

    case 'superadmin_password':
        require_superadmin();
        if (!verify_password($data['currentPassword'] ?? '', superadmin_secret())) throw new HttpError(400, 'رمز عبور فعلی اشتباه است.');
        set_setting('superadmin_password_hash', make_hash(require_new_password($data['newPassword'] ?? null)));
        out(['success' => true, 'token' => create_token(['t' => 'sa', 'pv' => fingerprint(superadmin_secret())])]);

    case 'user_password':
        $newPassword = require_new_password($data['newPassword'] ?? null);
        $id = require_id($data['campId'] ?? '', 'شناسه مسابقه');
        $res = mutate_camp($id, true, function ($camp) use ($data, $newPassword) {
            $me = require_camp_user($camp);
            $found = find_camp_user($camp, $me['username']);
            if (!verify_password($data['currentPassword'] ?? '', $found['secret'])) throw new HttpError(400, 'رمز عبور فعلی اشتباه است.');
            $hash = make_hash($newPassword);
            $audit = ['user' => $me, 'action' => 'password_change', 'details' => []];
            if (!empty($found['builtin'])) return ['secret' => $hash, 'username' => $me['username'], 'changes' => ['password' => $hash], 'audit' => $audit];
            $users = $camp['users'];
            foreach ($users as &$u) if (($u['username'] ?? null) === $me['username']) $u['password'] = $hash;
            unset($u);
            return ['secret' => $hash, 'username' => $me['username'], 'changes' => ['users' => $users], 'audit' => $audit];
        });
        out(['success' => true, 'token' => create_token(['t' => 'camp', 'campId' => $id, 'username' => $res['username'], 'pv' => fingerprint($res['secret'])])]);

    case 'users_reset_password':
        $newPassword = require_new_password($data['newPassword'] ?? null);
        mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data, $newPassword) {
            $me = require_camp_user($camp, MANAGER_ROLES);
            $allowed = $me['role'] === 'operator' ? ['head_referee', 'referee'] : ['referee'];
            $users = $camp['users'];
            foreach ($users as &$u) {
                if (($u['username'] ?? null) !== ($data['username'] ?? '')) continue;
                if (!in_array($u['role'] ?? '', $allowed, true)) throw new HttpError(403, 'شما اجازه تغییر رمز این کاربر را ندارید.');
                $u['password'] = make_hash($newPassword);
                $name = display_name($u);
                unset($u);
                return ['changes' => ['users' => $users], 'audit' => ['user' => $me, 'action' => 'password_reset', 'details' => ['target' => $name]]];
            }
            unset($u);
            throw new HttpError(404, 'کاربر یافت نشد.');
        });
        out(['success' => true]);

    case 'users':
        $camp = load_camp($_GET['id'] ?? '');
        if (!$camp) throw new HttpError(404, 'مسابقه یافت نشد.');
        $me = require_camp_user($camp, MANAGER_ROLES);
        $allowed = $me['role'] === 'operator' ? ['head_referee', 'referee'] : ['referee'];
        $list = [];
        foreach ($camp['users'] as $u) {
            $pu = public_user($u);
            $pu['canReset'] = in_array($pu['role'], $allowed, true);
            $list[] = $pu;
        }
        out(['success' => true, 'users' => $list]);

    case 'stage_reset':
        $stageId = require_id($data['stageId'] ?? null, 'شناسه مرحله');
        $res = mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($stageId) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $found = false;
            foreach ($camp['stages'] as $st) if (($st['id'] ?? '') === $stageId) $found = true;
            if (!$found) throw new HttpError(404, 'مرحله یافت نشد.');
            $closed = $camp['closedStages'];
            $results = $camp['stageTieredResults'];
            unset($closed[$stageId], $results[$stageId]);
            $teams = $camp['teams'];
            foreach ($teams as &$t) {
                unset($t['judgeStageScores'][$stageId], $t['stageScores'][$stageId]);
                recompute_score($t);
            }
            unset($t);
            return ['changes' => ['teams' => $teams, 'closedStages' => $closed, 'stageTieredResults' => $results],
                    'audit' => ['user' => $user, 'action' => 'stage_reset', 'details' => ['stage' => stage_name($camp, $stageId)]]];
        });
        out(['success' => true, 'teams' => public_state($res['camp'], 'member')['teams']]);

    case 'scores_reset':
        if (($data['confirm'] ?? '') !== 'RESET') throw new HttpError(400, 'تأیید بازنشانی دریافت نشد.');
        $res = mutate_camp($_GET['id'] ?? '', false, function ($camp) {
            $user = require_camp_user($camp, ['operator']);
            $teams = $camp['teams'];
            foreach ($teams as &$t) reset_team_scores($t);
            unset($t);
            return ['changes' => [
                        'teams' => $teams, 'closedStages' => [], 'stageTieredResults' => [], 'announcement' => null,
                        // Everything that happened during the competition starts over too.
                        'decisions' => [], 'rounds' => array_map(function ($r) { return array_merge($r, ['status' => 'draft', 'revealed' => false, 'applied' => false]); }, $camp['rounds']),
                        'appeals' => [], 'moments' => [], 'bracket' => null, 'lastChance' => null, 'frozen' => null, 'ceremony' => null, 'timer' => null
                    ],
                    'audit' => ['user' => $user, 'action' => 'scores_reset', 'details' => []]];
        });
        out(['success' => true, 'teams' => public_state($res['camp'], 'member')['teams']]);

    case 'board':
        mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $c = [];
            $details = [];
            if (array_key_exists('activeStageId', $data)) {
                $sid = $data['activeStageId'];
                if ($sid !== null) {
                    $found = false;
                    foreach ($camp['stages'] as $st) if (($st['id'] ?? '') === $sid) $found = true;
                    if (!$found) throw new HttpError(404, 'مرحله یافت نشد.');
                }
                $c['activeStageId'] = $sid;
                $details['activeStage'] = $sid === null ? null : stage_name($camp, $sid);
            }
            if (($data['announcement'] ?? '') === 'show') $c['announcement'] = ['active' => true, 'at' => now_ms()];
            if (($data['announcement'] ?? '') === 'hide') $c['announcement'] = null;
            if (isset($data['announcement'])) $details['announcement'] = $data['announcement'];
            return ['changes' => $c, 'audit' => ['user' => $user, 'action' => 'board', 'details' => $details]];
        });
        out(['success' => true]);

    case 'finish':
        $res = mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $c = ['locked' => true];
            if (!empty($data['announce'])) $c['announcement'] = ['active' => true, 'at' => now_ms()];
            return ['changes' => $c, 'audit' => ['user' => $user, 'action' => 'finish', 'details' => []]];
        });
        notify_camp($res['camp'], 'finish', "نتایج نهایی:\n" . standings_text($res['camp']));
        out(['success' => true]);

    case 'audit':
        $camp = load_camp($_GET['id'] ?? '');
        if (!$camp) throw new HttpError(404, 'مسابقه یافت نشد.');
        require_camp_user($camp, MANAGER_ROLES);
        out(['success' => true, 'entries' => array_map(function ($e) {
            $can = !empty($e['undo']) && empty($e['undone']);
            unset($e['undo']);
            $e['details'] = as_map($e['details'] ?? []);
            $e['canUndo'] = $can;
            return $e;
        }, array_reverse($camp['auditLog']))]);

    // -----------------------------------------------------------------------
    // Optional features (mirrors routes/features.js)
    // -----------------------------------------------------------------------
    // Server clock, used to keep live timers in sync.
    case 'time':
        header('Cache-Control: no-store');
        out(['now' => now_ms()]);

    // Manager view of the configuration (advanced settings tab)
    case 'manage':
        $camp = load_camp(require_id($_GET['id'] ?? '', 'شناسه مسابقه'));
        if (!$camp) throw new HttpError(404, 'مسابقه یافت نشد.');
        require_camp_user($camp, MANAGER_ROLES);
        out(array_merge(['success' => true], extras_maps([
            'display' => $camp['display'], 'features' => $camp['features'], 'skills' => $camp['skills'], 'tagSkills' => $camp['tagSkills'],
            'divisions' => $camp['divisions'], 'roles' => $camp['roles'], 'assignments' => $camp['assignments'], 'scoreCap' => $camp['scoreCap'],
            'chanceCards' => $camp['chanceCards'], 'rounds' => $camp['rounds'], 'decisions' => $camp['decisions'], 'appeals' => $camp['appeals'],
            'registration' => $camp['registration'], 'peerReview' => $camp['peerReview'], 'bracket' => $camp['bracket'], 'brand' => $camp['brand'], 'uiLang' => $camp['uiLang'], 'certificate' => $camp['certificate'],
            'calibration' => ['cases' => $camp['calibration']['cases'], 'scores' => $camp['calibration']['scores']],
            'teams' => array_map(function ($t) {
                return ['id' => $t['id'], 'name' => $t['name'] ?? '', 'color' => $t['color'] ?? '', 'pin' => $t['pin'] ?? '', 'members' => $t['members'], 'division' => $t['division'], 'secretCards' => $t['secretCards']];
            }, $camp['teams']),
            'stages' => array_map(function ($s) {
                return ['id' => $s['id'], 'name' => $s['name'] ?? '', 'criteria' => $s['criteria'] ?? [], 'startAt' => $s['startAt'] ?? '', 'durationMin' => ($s['durationMin'] ?? null) ?: null];
            }, $camp['stages']),
            'users' => array_map(function ($u) { return ['username' => $u['username'] ?? '', 'name' => display_name($u), 'role' => $u['role'] ?? 'referee']; }, $camp['users'])
        ])));

    case 'advanced':
        mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $changes = apply_advanced($camp, $data);
            return ['changes' => $changes, 'audit' => ['user' => $user, 'action' => 'advanced', 'details' => ['keys' => array_keys($changes)]]];
        });
        out(['success' => true]);

    // Live controls: timer, news ticker, message to referees, hidden table, key moments, award ceremony
    case 'live':
        $res = mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $now = now_ms();
            $op = $data['op'] ?? null;
            switch ($data['action'] ?? null) {
                case 'timer':
                    $t = $camp['timer'];
                    if ($op === 'start') {
                        $minutes = parse_float($data['minutes'] ?? null);
                        if (!($minutes !== null && $minutes > 0 && $minutes <= 1440)) throw new HttpError(400, 'مدت زمان نامعتبر است.');
                        $durationMs = (int)round($minutes * 60000);
                        $timer = ['label' => sstr($data['label'] ?? null, 80), 'durationMs' => $durationMs, 'endsAt' => $now + $durationMs, 'remainingMs' => null, 'running' => true, 'startedAt' => $now];
                    } elseif ($op === 'pause' && $t && !empty($t['running'])) {
                        $timer = array_merge($t, ['running' => false, 'remainingMs' => max(0, ($t['endsAt'] ?? 0) - $now), 'endsAt' => null]);
                    } elseif ($op === 'resume' && $t && empty($t['running'])) {
                        $timer = array_merge($t, ['running' => true, 'endsAt' => $now + (int)($t['remainingMs'] ?? 0), 'remainingMs' => null]);
                    } elseif ($op === 'add' && $t) {
                        $ms = (int)round((parse_float($data['minutes'] ?? null) ?? 0) * 60000);
                        $timer = !empty($t['running']) ? array_merge($t, ['endsAt' => max($now, ($t['endsAt'] ?? 0) + $ms)])
                            : array_merge($t, ['remainingMs' => max(0, (int)($t['remainingMs'] ?? 0) + $ms)]);
                    } elseif ($op === 'stop') {
                        $timer = null;
                    } else throw new HttpError(400, 'عملیات تایمر نامعتبر است.');
                    return ['changes' => ['timer' => $timer], 'payload' => ['timer' => $timer]];
                case 'ticker':
                    $text = sstr($data['text'] ?? null, LIMITS['text']);
                    $ticker = $text !== '' ? ['text' => $text, 'at' => $now] : null;
                    return ['changes' => ['ticker' => $ticker], 'payload' => ['ticker' => $ticker]];
                case 'message':
                    $text = sstr($data['text'] ?? null, LIMITS['text']);
                    $msg = $text !== '' ? ['text' => $text, 'at' => $now, 'by' => display_name($user)] : null;
                    return ['changes' => ['judgeMessage' => $msg], 'payload' => ['judgeMessage' => $msg]];
                case 'freeze':
                    if (empty($data['on'])) return ['changes' => ['frozen' => null], 'payload' => ['frozen' => null], 'audit' => ['user' => $user, 'action' => 'unfreeze', 'details' => []]];
                    if ($camp['frozen']) return ['payload' => ['frozen' => ['at' => $camp['frozen']['at'] ?? 0]]];
                    $frozen = [
                        'at' => $now,
                        'teams' => array_map(function ($t) { return ['id' => $t['id'], 'score' => $t['score'], 'stageScores' => $t['stageScores']]; }, $camp['teams']),
                        'closedStages' => $camp['closedStages'], 'stageTieredResults' => $camp['stageTieredResults']
                    ];
                    return ['changes' => ['frozen' => $frozen], 'payload' => ['frozen' => ['at' => $now]], 'audit' => ['user' => $user, 'action' => 'freeze', 'details' => []]];
                case 'moment':
                    $tid = $data['teamId'] ?? null;
                    $teamId = ($tid && in_array($tid, array_column($camp['teams'], 'id'), true)) ? $tid : null;
                    $m = ['id' => rid('mo'), 'at' => $now, 'kind' => 'moment', 'text' => sstr($data['text'] ?? null, LIMITS['text']), 'teamId' => $teamId,
                        'stageId' => $camp['activeStageId'] ?: null, 'by' => display_name($user)];
                    return ['changes' => ['moments' => push_capped($camp['moments'], $m, LIMITS['moments'])], 'payload' => ['moment' => $m]];
                case 'ceremony':
                    $total = count($camp['teams']);
                    $c = $camp['ceremony'];
                    if ($op === 'start') $ceremony = ['active' => true, 'revealed' => 0, 'total' => $total, 'at' => $now];
                    elseif ($op === 'next' && $c) $ceremony = array_merge($c, ['revealed' => min($total, (int)$c['revealed'] + 1), 'at' => $now]);
                    elseif ($op === 'prev' && $c) $ceremony = array_merge($c, ['revealed' => max(0, (int)$c['revealed'] - 1), 'at' => $now]);
                    elseif ($op === 'all' && $c) $ceremony = array_merge($c, ['revealed' => $total, 'at' => $now]);
                    elseif ($op === 'end') $ceremony = null;
                    else throw new HttpError(400, 'عملیات مراسم نامعتبر است.');
                    $done = $ceremony && $ceremony['revealed'] === $total && (!$c || (int)$c['revealed'] < $total);
                    $r = ['changes' => ['ceremony' => $ceremony], 'payload' => ['ceremony' => $ceremony], 'notice' => $done ? 'ceremony' : null];
                    if ($op === 'start') $r['audit'] = ['user' => $user, 'action' => 'ceremony', 'details' => []];
                    return $r;
                default:
                    throw new HttpError(400, 'عملیات نامعتبر است.');
            }
        });
        if (($res['notice'] ?? null) === 'ceremony') notify_camp($res['camp'], 'ceremony');
        out(array_merge(['success' => true], $res['payload'] ?? []));

    // Appeals ("VAR"): any signed-in user files, a manager decides
    case 'appeal':
        $res = mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data) {
            $user = require_camp_user($camp);
            need_feature($camp, 'appeals', 'اعتراض و بازبینی');
            $team = $camp['teams'][team_index($camp, $data['teamId'] ?? null)];
            $text = sstr($data['text'] ?? null, 1000);
            if ($text === '') throw new HttpError(400, 'متن اعتراض را بنویسید.');
            $sid = $data['stageId'] ?? null;
            $appeal = [
                'id' => rid('ap'), 'at' => now_ms(), 'by' => ['username' => $user['username'], 'name' => display_name($user), 'role' => $user['role']],
                'teamId' => $team['id'], 'stageId' => ($sid && in_array($sid, array_column($camp['stages'], 'id'), true)) ? $sid : null,
                'logId' => is_valid_id($data['logId'] ?? null) ? $data['logId'] : null, 'text' => $text, 'status' => 'open'
            ];
            $open = 0;
            foreach ($camp['appeals'] as $a) if (($a['status'] ?? '') === 'open') $open++;
            if ($open >= 50) throw new HttpError(429, 'تعداد اعتراض‌های باز زیاد است.');
            return ['appeal' => $appeal, 'changes' => ['appeals' => push_capped($camp['appeals'], $appeal, LIMITS['appeals'])]];
        });
        out(['success' => true, 'appeal' => $res['appeal']]);

    case 'appeal_resolve':
        mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $appeals = $camp['appeals'];
            $idx = null;
            foreach ($appeals as $i => $a) if (($a['id'] ?? null) === ($data['appealId'] ?? '')) $idx = $i;
            if ($idx === null) throw new HttpError(404, 'اعتراض یافت نشد.');
            $status = $data['status'] ?? null;
            if (!in_array($status, ['accepted', 'rejected', 'open'], true)) throw new HttpError(400, 'وضعیت نامعتبر است.');
            $appeals[$idx] = array_merge($appeals[$idx], ['status' => $status, 'resolution' => sstr($data['resolution'] ?? null, 1000), 'resolvedAt' => now_ms(), 'resolvedBy' => display_name($user)]);
            $teamName = '';
            foreach ($camp['teams'] as $t) if ($t['id'] === ($appeals[$idx]['teamId'] ?? null)) $teamName = $t['name'] ?? '';
            return ['changes' => ['appeals' => $appeals], 'audit' => ['user' => $user, 'action' => 'appeal', 'details' => ['team' => $teamName, 'status' => $status]]];
        });
        out(['success' => true]);

    // Chance cards: a surprise event shown on the board, optionally with points / budget
    case 'chance':
        $res = mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            need_feature($camp, 'chanceCards', 'کارت شانس');
            $card = null;
            foreach ($camp['chanceCards'] as $c) if (($c['id'] ?? null) === ($data['cardId'] ?? '')) $card = $c;
            if (!$card) throw new HttpError(404, 'کارت یافت نشد.');
            $allIds = array_column($camp['teams'], 'id');
            $ids = (is_list($data['teamIds'] ?? null) && $data['teamIds'])
                ? array_values(array_filter($data['teamIds'], function ($t) use ($allIds) { return in_array($t, $allIds, true); })) : $allIds;
            $now = now_ms();
            $teams = $camp['teams'];
            $names = [];
            foreach ($teams as &$t) {
                if (!in_array($t['id'], $ids, true)) continue;
                $names[] = $t['name'] ?? '';
                if (!empty($card['points'])) { $t['scoreLogs'][] = instant_log($user, $card['points'], 'کارت شانس: ' . $card['title'], ['chance' => $card['id']]); recompute_score($t); }
                if (!empty($card['budget'])) $t['records'][] = budget_record($user, $card['budget'], 'کارت شانس: ' . $card['title'], ['chance' => $card['id']]);
            }
            unset($t);
            $lastChance = ['id' => rid('ch'), 'cardId' => $card['id'], 'title' => $card['title'], 'text' => $card['text'] ?? '', 'points' => $card['points'] ?? 0,
                'budget' => $card['budget'] ?? 0, 'teamIds' => $ids, 'at' => $now];
            $moment = ['id' => rid('mo'), 'at' => $now, 'kind' => 'chance', 'text' => $card['title'], 'teamId' => count($ids) === 1 ? $ids[0] : null,
                'stageId' => $camp['activeStageId'] ?: null, 'by' => display_name($user)];
            return [
                'card' => $card,
                'changes' => ['teams' => $teams, 'lastChance' => $lastChance, 'moments' => push_capped($camp['moments'], $moment, LIMITS['moments'])],
                'audit' => ['user' => $user, 'action' => 'chance', 'details' => ['card' => $card['title'], 'teams' => $names]]
            ];
        });
        notify_camp($res['camp'], 'chance', $res['card']['title'] . (($res['card']['text'] ?? '') !== '' ? ' — ' . $res['card']['text'] : ''));
        out(['success' => true]);

    // Team budgets (records of kind "budget"; never part of the score)
    case 'budget':
        $res = mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            need_feature($camp, 'budget', 'بودجه تیم‌ها');
            $teams = $camp['teams'];
            if (!empty($data['from']) || !empty($data['to'])) {
                $fi = team_index($camp, $data['from'] ?? null);
                $ti = team_index($camp, $data['to'] ?? null);
                $amount = r2(num($data['amount'] ?? 0));
                if (!($amount > 0) || $fi === $ti) throw new HttpError(400, 'مبلغ یا تیم‌ها نامعتبر است.');
                $note = sstr($data['note'] ?? null, LIMITS['budgetNote']);
                if ($note === '') $note = 'انتقال ' . ($teams[$fi]['name'] ?? '') . ' ← ' . ($teams[$ti]['name'] ?? '');
                $transfer = rid('tr');
                $teams[$fi]['records'][] = budget_record($user, -$amount, $note, ['transfer' => $transfer]);
                $teams[$ti]['records'][] = budget_record($user, $amount, $note, ['transfer' => $transfer]);
                return ['changes' => ['teams' => $teams], 'audit' => ['user' => $user, 'action' => 'budget', 'details' => ['team' => ($teams[$fi]['name'] ?? '') . ' ← ' . ($teams[$ti]['name'] ?? ''), 'amount' => $amount]]];
            }
            $i = team_index($camp, $data['teamId'] ?? null);
            $delta = r2(num($data['delta'] ?? 0));
            if (!$delta || abs($delta) > 1e9) throw new HttpError(400, 'مبلغ نامعتبر است.');
            $teams[$i]['records'][] = budget_record($user, $delta, $data['note'] ?? null);
            return ['changes' => ['teams' => $teams], 'audit' => ['user' => $user, 'action' => 'budget', 'details' => ['team' => $teams[$i]['name'] ?? '', 'amount' => $delta]]];
        });
        $budgets = [];
        foreach ($res['camp']['teams'] as $t) $budgets[$t['id']] = team_budget($t);
        out(['success' => true, 'budgets' => as_map($budgets)]);

    // Decision rounds ("choose your tactic"): teams decide on their team page
    case 'rounds':
        $op = $data['op'] ?? null;
        $res = mutate_camp($_GET['id'] ?? '', $op === 'reveal' || $op === 'hide', function ($camp) use ($data, $op) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            need_feature($camp, 'decisions', 'دور تصمیم‌گیری');
            $rounds = $camp['rounds'];
            $idx = null;
            foreach ($rounds as $i => $r) if (($r['id'] ?? null) === ($data['roundId'] ?? '')) $idx = $i;
            if ($idx === null) throw new HttpError(404, 'دور یافت نشد.');
            $r = &$rounds[$idx];
            $changes = [];
            $decisions = $camp['decisions'];
            if ($op === 'open') $r['status'] = 'open';
            elseif ($op === 'close') {
                if (($r['status'] ?? '') !== 'closed' && empty($r['applied'])) {
                    // Each team's choice takes effect once, when the round closes.
                    $teams = $camp['teams'];
                    foreach ($teams as &$t) {
                        $d = $decisions[$r['id']][$t['id']] ?? null;
                        $o = null;
                        if ($d) foreach ($r['options'] as $x) if ($x['id'] === ($d['optionId'] ?? null)) $o = $x;
                        if (!$o) continue;
                        $tag = 'تصمیم «' . $r['title'] . '»: ' . $o['label'];
                        if (!empty($o['points'])) { $t['scoreLogs'][] = instant_log($user, $o['points'], $tag, ['round' => $r['id']]); recompute_score($t); }
                        if (!empty($o['budget'])) $t['records'][] = budget_record($user, $o['budget'], $tag, ['round' => $r['id']]);
                    }
                    unset($t);
                    $r['applied'] = true;
                    $changes['teams'] = $teams;
                }
                $r['status'] = 'closed';
            } elseif ($op === 'reveal') $r['revealed'] = true;
            elseif ($op === 'hide') $r['revealed'] = false;
            elseif ($op === 'reset') {
                unset($decisions[$r['id']]);
                $r = array_merge($r, ['status' => 'draft', 'revealed' => false, 'applied' => false]);
                $changes['decisions'] = $decisions;
            } else throw new HttpError(400, 'عملیات نامعتبر است.');
            $round = $r;
            unset($r);
            $changes['rounds'] = $rounds;
            return ['changes' => $changes, 'revealed' => $op === 'reveal' ? $round : null, 'audit' => ['user' => $user, 'action' => 'round', 'details' => ['round' => $round['title'] ?? '', 'op' => $op]]];
        });
        if (!empty($res['revealed'])) {
            $rv = $res['revealed'];
            $counts = [];
            foreach (($res['camp']['decisions'][$rv['id']] ?? []) as $d) { $o = $d['optionId'] ?? ''; $counts[$o] = ($counts[$o] ?? 0) + 1; }
            notify_camp($res['camp'], 'round', $rv['title'] . ': ' . implode('، ', array_map(function ($o) use ($counts) { return $o['label'] . ' (' . ($counts[$o['id']] ?? 0) . ')'; }, $rv['options'])));
        }
        out(['success' => true]);

    // Knockout bracket
    case 'bracket':
        $res = mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            need_feature($camp, 'bracket', 'جدول حذفی');
            $bracket = $camp['bracket'];
            $op = $data['op'] ?? null;
            if ($op === 'generate') {
                $allIds = array_column($camp['teams'], 'id');
                if (is_list($data['teamIds'] ?? null) && $data['teamIds']) {
                    $seeds = array_values(array_filter($data['teamIds'], function ($t) use ($allIds) { return in_array($t, $allIds, true); }));
                } else {
                    $sorted = $camp['teams'];
                    usort($sorted, function ($x, $y) { return num($y['score']) <=> num($x['score']); });
                    $seeds = array_column($sorted, 'id');
                }
                $want = parse_int($data['size'] ?? null) ?: count($seeds);
                $size = 2;
                foreach ([2, 4, 8, 16, 32] as $n) if ($n >= min(count($seeds), $want)) { $size = $n; break; }
                $seeds = array_slice($seeds, 0, $size);
                if (count($seeds) < 2) throw new HttpError(400, 'برای جدول حذفی دست‌کم دو تیم لازم است.');
                // Standard seeding: 1 v N, 2 v N-1, ... (missing teams are byes).
                $order = [1];
                while (count($order) < $size) {
                    $n = count($order) * 2 + 1;
                    $next = [];
                    foreach ($order as $x) { $next[] = $x; $next[] = $n - $x; }
                    $order = $next;
                }
                $first = [];
                for ($i = 0; $i < $size; $i += 2) {
                    $a = $seeds[$order[$i] - 1] ?? null;
                    $c = $seeds[$order[$i + 1] - 1] ?? null;
                    $first[] = ['id' => rid('m'), 'a' => $a, 'b' => $c, 'winner' => ($a && !$c) ? $a : ((!$a && $c) ? $c : null)];
                }
                $rounds = [['matches' => $first]];
                for ($n = intdiv($size, 4); $n >= 1; $n = intdiv($n, 2)) {
                    $ms = [];
                    for ($k = 0; $k < $n; $k++) $ms[] = ['id' => rid('m'), 'a' => null, 'b' => null, 'winner' => null];
                    $rounds[] = ['matches' => $ms];
                }
                $bracket = ['title' => sstr($data['title'] ?? null, 80) ?: 'جدول حذفی', 'rounds' => $rounds];
                propagate_bracket($bracket);
            } elseif ($op === 'winner') {
                if (!$bracket) throw new HttpError(404, 'جدول حذفی ساخته نشده است.');
                $found = false;
                foreach ($bracket['rounds'] as $ri => $round) foreach ($round['matches'] as $mi => $m) {
                    if (($m['id'] ?? null) !== ($data['matchId'] ?? '')) continue;
                    $found = true;
                    $tid = array_key_exists('teamId', $data) ? $data['teamId'] : false;
                    if ($tid !== null && ($tid === false || ($tid !== ($m['a'] ?? null) && $tid !== ($m['b'] ?? null)))) throw new HttpError(400, 'این تیم در این بازی نیست.');
                    $bracket['rounds'][$ri]['matches'][$mi]['winner'] = $tid ?: null;
                }
                if (!$found) throw new HttpError(404, 'بازی یافت نشد.');
                propagate_bracket($bracket);
            } elseif ($op === 'clear') $bracket = null;
            else throw new HttpError(400, 'عملیات نامعتبر است.');
            $r = ['bracket' => $bracket, 'changes' => ['bracket' => $bracket]];
            if ($op !== 'winner') $r['audit'] = ['user' => $user, 'action' => 'bracket', 'details' => ['op' => $op]];
            return $r;
        });
        out(['success' => true, 'bracket' => $res['bracket']]);

    // Peer review / self-assessment window (answered on the team page)
    case 'peer':
        mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            need_feature($camp, 'peerReview', 'ارزیابی هم‌تیمی');
            $o = $data['open'] ?? null;
            $open = ($o === null || $o === '') ? null : (($o === 'general' || (is_string($o) && in_array($o, array_column($camp['stages'], 'id'), true))) ? $o : null);
            return ['changes' => ['peerReview' => ['open' => $open, 'at' => now_ms()]], 'audit' => ['user' => $user, 'action' => 'peer', 'details' => ['open' => $open]]];
        });
        out(['success' => true]);

    // Undo from the history
    case 'undo':
        mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $log = $camp['auditLog'];
            $idx = null;
            foreach ($log as $i => $e) if (is_array($e) && ($e['id'] ?? null) !== null && ($e['id'] ?? null) === ($data['auditId'] ?? '')) $idx = $i;
            if ($idx === null || empty($log[$idx]['undo']) || !empty($log[$idx]['undone'])) throw new HttpError(404, 'این تغییر قابل برگرداندن نیست.');
            $changes = apply_undo($camp, $log[$idx]['undo']);
            if ($changes === null) throw new HttpError(409, 'پس از این تغییر، تغییرات دیگری روی همین بخش ثبت شده است؛ برگرداندن آن ممکن نیست.');
            if (isset($changes['teams'])) foreach ($changes['teams'] as &$t) { normalize_team($t); recompute_score($t); }
            unset($t);
            $log[$idx]['undone'] = true;
            $changes['auditLog'] = $log;
            return ['changes' => $changes, 'noUndo' => true, 'audit' => ['user' => $user, 'action' => 'undo', 'details' => ['of' => $log[$idx]['action'] ?? '']]];
        });
        out(['success' => true]);

    // Team page actions (team PIN): decisions, secret cards, peer review
    case 'team':
        $id = require_id($_GET['id'] ?? '', 'شناسه مسابقه');
        $op = $data['op'] ?? null;
        $pinKey = 'pin:' . $id . ':' . client_ip();
        // Counted outside the transaction, so a wrong PIN still counts.
        if (!rate_limit_check($pinKey, 20, 300)) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر دوباره امتحان کنید.');
        $teamAuth = function ($camp) use ($data) {
            foreach ($camp['teams'] as $i => $t) {
                if ($t['id'] !== ($data['teamId'] ?? null)) continue;
                if (empty($t['pin']) || !is_scalar($data['pin'] ?? null) || !hash_equals((string)$t['pin'], (string)$data['pin'])) break;
                return $i;
            }
            throw new HttpError(401, 'کد تیم اشتباه است.');
        };
        if (!$op || $op === 'view') {
            $camp = load_camp($id);
            if (!$camp) throw new HttpError(404, 'مسابقه یافت نشد.');
            $view = team_private_view($camp, $camp['teams'][$teamAuth($camp)]);
            rate_limit_reset($pinKey);
            out(array_merge(['success' => true], $view));
        }
        $res = mutate_camp($id, $op === 'feedback', function ($camp) use ($data, $op, $teamAuth) {
            $ti = $teamAuth($camp);
            $team = $camp['teams'][$ti];
            if ($op === 'decide') {
                need_feature($camp, 'decisions', 'دور تصمیم‌گیری');
                $r = null;
                foreach ($camp['rounds'] as $x) if (($x['id'] ?? null) === ($data['roundId'] ?? '') && ($x['status'] ?? '') === 'open') $r = $x;
                if (!$r) throw new HttpError(409, 'این دور تصمیم‌گیری باز نیست.');
                if (!in_array($data['optionId'] ?? null, array_column($r['options'], 'id'), true)) throw new HttpError(400, 'گزینه نامعتبر است.');
                $decisions = $camp['decisions'];
                $decisions[$r['id']] = is_array($decisions[$r['id']] ?? null) ? $decisions[$r['id']] : [];
                $decisions[$r['id']][$team['id']] = ['optionId' => $data['optionId'], 'at' => now_ms()];
                $camp['decisions'] = $decisions;
                return ['changes' => ['decisions' => $decisions], 'view' => team_private_view($camp, $team)];
            }
            if ($op === 'feedback') {
                need_feature($camp, 'peerReview', 'ارزیابی هم‌تیمی');
                $stageId = $camp['peerReview']['open'] ?? null;
                if (!$stageId) throw new HttpError(409, 'ارزیابی هم‌تیمی‌ها الان باز نیست.');
                $members = array_fill_keys(array_column($team['members'], 'id'), true);
                $from = $data['from'] ?? null;
                if (!is_string($from) || !isset($members[$from])) throw new HttpError(400, 'نام خودتان را از فهرست انتخاب کنید.');
                $skillIds = array_fill_keys(array_column($camp['skills'], 'id'), true);
                $ratings = [];
                foreach ((is_obj($data['ratings'] ?? null) ? $data['ratings'] : []) as $mid => $map) {
                    $mid = (string)$mid;
                    if (!isset($members[$mid]) || !is_obj($map)) continue;
                    $r = [];
                    foreach ($map as $sk => $v) { $n = parse_int($v); if (isset($skillIds[(string)$sk]) && $n !== null && $n >= 1 && $n <= 5) $r[(string)$sk] = $n; }
                    if ($r) $ratings[$mid] = $r;
                }
                if (!$ratings) throw new HttpError(400, 'دست‌کم به یک نفر امتیاز بدهید.');
                $recId = substr('fb_' . mb_substr((string)$stageId, 0, 30) . '_' . $from, 0, 64);
                $records = array_values(array_filter($team['records'], function ($r) use ($recId) { return !(is_array($r) && ($r['id'] ?? null) === $recId); }));
                $mvp = $data['mvp'] ?? null;
                $records[] = ['id' => $recId, 'kind' => 'feedback', 'stageId' => $stageId, 'from' => $from, 'ratings' => $ratings,
                    'mvp' => (is_string($mvp) && isset($members[$mvp]) && $mvp !== $from) ? $mvp : null, 'createdAt' => now_ms()];
                $team['records'] = $records;
                $teams = $camp['teams'];
                $teams[$ti] = $team;
                return ['changes' => ['teams' => $teams], 'view' => team_private_view($camp, $team)];
            }
            throw new HttpError(400, 'عملیات نامعتبر است.');
        });
        rate_limit_reset($pinKey);
        out(array_merge(['success' => true], $res['view']));

    // Referee calibration workshop
    case 'calibration':
        mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data) {
            $user = require_camp_user($camp);
            need_feature($camp, 'calibration', 'کارگاه هماهنگی داوران');
            $case = null;
            foreach ($camp['calibration']['cases'] as $c) if (($c['id'] ?? null) === ($data['caseId'] ?? '')) $case = $c;
            if (!$case || empty($case['open'])) throw new HttpError(409, 'این نمونه برای نمره‌دادن باز نیست.');
            $v = parse_float($data['score'] ?? null);
            if ($v === null) throw new HttpError(400, 'نمره نامعتبر است.');
            $cal = $camp['calibration'];
            $cal['scores'][$case['id']] = is_array($cal['scores'][$case['id']] ?? null) ? $cal['scores'][$case['id']] : [];
            $cal['scores'][$case['id']][$user['username']] = r2($v);
            return ['changes' => ['calibration' => $cal]];
        });
        out(['success' => true]);

    // Online team registration
    case 'register':
        $id = require_id($_GET['id'] ?? '', 'شناسه مسابقه');
        if (!rate_limit_check('reg:' . $id . ':' . client_ip(), 5, 600)) throw new HttpError(429, 'تعداد ثبت‌نام‌ها از این دستگاه زیاد است. کمی بعد دوباره تلاش کنید.');
        mutate_camp($id, false, function ($camp) use ($data) {
            if (empty(camp_features($camp)['registration']) || empty($camp['registration']['open'])) throw new HttpError(409, 'ثبت‌نام این مسابقه باز نیست.');
            $name = sstr($data['name'] ?? null, 100);
            if ($name === '') throw new HttpError(400, 'نام تیم را بنویسید.');
            if (count($camp['registration']['requests']) >= LIMITS['registrations']) throw new HttpError(409, 'ظرفیت ثبت‌نام پر شده است.');
            $color = (is_string($data['color'] ?? null) && preg_match('/^#[0-9a-fA-F]{6}$/', $data['color'])) ? $data['color'] : '';
            $members = [];
            foreach ((is_list($data['members'] ?? null) ? $data['members'] : []) as $m) { $m = sstr($m, 80); if ($m !== '') $members[] = $m; }
            $request = ['id' => rid('rq'), 'at' => now_ms(), 'name' => $name, 'color' => $color, 'members' => array_slice($members, 0, LIMITS['members']), 'contact' => sstr($data['contact'] ?? null, 120)];
            $reg = $camp['registration'];
            $reg['requests'][] = $request;
            return ['changes' => ['registration' => $reg]];
        });
        out(['success' => true, 'message' => 'ثبت‌نام شما دریافت شد و پس از تأیید برگزارکننده در فهرست تیم‌ها قرار می‌گیرد.']);

    case 'register_review':
        mutate_camp($_GET['id'] ?? '', true, function ($camp) use ($data) {
            $user = require_camp_user($camp, MANAGER_ROLES);
            $rq = null;
            foreach ($camp['registration']['requests'] as $r) if (($r['id'] ?? null) === ($data['requestId'] ?? '')) $rq = $r;
            if (!$rq) throw new HttpError(404, 'درخواست یافت نشد.');
            $reg = $camp['registration'];
            $reg['requests'] = array_values(array_filter($reg['requests'], function ($r) use ($rq) { return ($r['id'] ?? null) !== $rq['id']; }));
            if (empty($data['approve'])) return ['changes' => ['registration' => $reg]];
            $palette = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];
            $team = [
                'id' => rid('t'), 'name' => $rq['name'], 'color' => ($rq['color'] ?? '') !== '' ? $rq['color'] : $palette[count($camp['teams']) % count($palette)],
                'image' => '', 'happyImage' => '', 'sadImage' => '',
                'members' => array_map(function ($n) { return ['id' => rid('m'), 'name' => $n, 'role' => '']; }, $rq['members'] ?? []),
                'division' => '', 'scoreLogs' => [], 'records' => [], 'stageScores' => [], 'judgeStageScores' => [], 'secretCards' => [], 'score' => 0
            ];
            $teams = $camp['teams'];
            $teams[] = $team;
            return ['changes' => ['registration' => $reg, 'teams' => ensure_pins($teams)], 'audit' => ['user' => $user, 'action' => 'register_approve', 'details' => ['team' => $rq['name']]]];
        });
        out(['success' => true]);

    // Analysis room data: managers, the superadmin / organizer, or the client report link
    case 'analysis':
        $camp = load_camp(require_id($_GET['id'] ?? '', 'شناسه مسابقه'));
        if (!$camp) throw new HttpError(404, 'مسابقه یافت نشد.');
        $access = null;
        if (isset($_GET['key']) && $_GET['key'] !== '') {
            if (verify_client_key($camp, $_GET['key'])) $access = 'client';
        } else {
            try { require_camp_user($camp, MANAGER_ROLES); $access = 'manager'; }
            catch (HttpError $e) {
                try { $admin = require_admin(); if (camp_visible($admin, $camp)) $access = 'admin'; else throw new HttpError(404, 'مسابقه یافت نشد.'); }
                catch (HttpError $e2) { if ($e2->status === 404) throw $e2; }
            }
        }
        if (!$access) throw new HttpError(401, 'برای دیدن آنالیز باید وارد شوید یا لینک گزارش معتبر داشته باشید.');
        out(array_merge(['success' => true, 'access' => $access], analysis_data($camp)));

    // Public standings of a league (several camps added up; teams are matched by name).
    case 'league':
        $leagues = get_json_setting('leagues');
        $league = null;
        foreach ((is_list($leagues) ? $leagues : []) as $l) if (($l['id'] ?? null) === ($_GET['id'] ?? '')) $league = $l;
        if (!$league) throw new HttpError(404, 'لیگ یافت نشد.');
        $camps = [];
        $rows = [];
        foreach ($league['campIds'] as $cid) {
            $camp = load_camp($cid);
            if (!$camp) continue;
            $camps[] = ['id' => $camp['id'], 'title' => $camp['title'] ?? '', 'orgName' => $camp['orgName'] ?? ''];
            $sorted = $camp['teams'];
            usort($sorted, function ($a, $b) { return num($b['score']) <=> num($a['score']); });
            $rank = 0;
            foreach ($sorted as $i => $t) {
                if ($i === 0 || num($t['score']) != num($sorted[$i - 1]['score'])) $rank = $i + 1;
                $key = mb_strtolower(preg_replace('/\s+/u', ' ', trim($t['name'] ?? '')));
                if ($key === '') continue;
                $value = ($league['mode'] ?? 'rank') === 'score' ? $t['score'] : ($league['rankPoints'][$rank - 1] ?? 0);
                $row = $rows[$key] ?? ['name' => $t['name'], 'color' => $t['color'] ?? '', 'total' => 0, 'played' => 0, 'perCamp' => [], 'best' => null];
                $row['total'] = r2($row['total'] + $value);
                $row['played']++;
                $row['perCamp'][$camp['id']] = ['value' => $value, 'rank' => $rank];
                $row['best'] = $row['best'] === null ? $rank : min($row['best'], $rank);
                $rows[$key] = $row;
            }
        }
        $list = array_values($rows);
        usort($list, function ($a, $b) { return ($b['total'] <=> $a['total']) ?: ($a['best'] <=> $b['best']); });
        foreach ($list as &$row) $row['perCamp'] = as_map($row['perCamp']);
        unset($row);
        header('Cache-Control: no-cache');
        out(['success' => true, 'league' => ['id' => $league['id'], 'name' => $league['name'], 'mode' => $league['mode'], 'rankPoints' => $league['rankPoints']], 'camps' => $camps, 'rows' => $list]);

    // -----------------------------------------------------------------------
    // Superadmin: defaults for new camps, templates, organizers, leagues
    // -----------------------------------------------------------------------
    case 'superadmin_settings':
        if ($method === 'GET') {
            $admin = require_admin();
            $skills = get_json_setting('defaultSkills');
            out([
                'success' => true, 'role' => $admin['super'] ? 'superadmin' : 'organizer',
                'displayDefaults' => effective_display(get_json_setting('displayDefaults')),
                'presets' => array_map('as_map', DISPLAY_PRESETS),
                'defaultSkills' => (is_list($skills) && $skills) ? $skills : DEFAULT_SKILLS,
                'displayKeys' => DISPLAY_KEYS, 'featureKeys' => FEATURE_KEYS, 'tagPacks' => TAG_PACKS, 'defaultTagSkills' => DEFAULT_TAG_SKILLS
            ]);
        }
        require_superadmin();
        if (array_key_exists('displayDefaults', $data)) set_json_setting('displayDefaults', as_map(clean_display($data['displayDefaults'])));
        if (array_key_exists('defaultSkills', $data)) set_json_setting('defaultSkills', clean_skills($data['defaultSkills']));
        out(['success' => true]);

    case 'superadmin_templates':
        $admin = require_admin();
        $list = get_json_setting('templates');
        $list = is_list($list) ? $list : [];
        if ($method === 'GET') {
            $own = array_values(array_filter($list, function ($t) use ($admin) { return $admin['super'] || empty($t['ownerId']) || $t['ownerId'] === $admin['orgId']; }));
            out(['success' => true, 'templates' => array_merge(builtin_templates(), array_map(function ($t) {
                $t['data'] = extras_maps(is_array($t['data'] ?? null) ? $t['data'] : []);
                return $t;
            }, $own))]);
        }
        if (($data['op'] ?? null) === 'delete') {
            $found = null;
            foreach ($list as $t) if (($t['id'] ?? null) === ($data['id'] ?? '')) $found = $t;
            if (!$found || (!$admin['super'] && ($found['ownerId'] ?? null) !== $admin['orgId'])) throw new HttpError(404, 'قالب یافت نشد.');
            $list = array_values(array_filter($list, function ($t) use ($data) { return ($t['id'] ?? null) !== $data['id']; }));
        } else {
            $camp = load_camp(require_id($data['campId'] ?? null, 'شناسه مسابقه'));
            if (!$camp) throw new HttpError(404, 'مسابقه یافت نشد.');
            assert_camp_access($admin, $camp);
            $name = trim(str_or_empty($data['name'] ?? '', 100));
            if ($name === '') $name = ($camp['title'] ?? '') !== '' ? $camp['title'] : 'قالب';
            if (count($list) >= 100) throw new HttpError(409, 'تعداد قالب‌ها به حداکثر رسیده است؛ چند قالب قدیمی را حذف کنید.');
            $tpl = template_from_camp($camp);
            if (strlen(enc($tpl)) > 400000) throw new HttpError(413, 'این مسابقه برای ذخیره به‌عنوان قالب بیش از حد بزرگ است.');
            $list[] = ['id' => rid('tpl'), 'name' => $name, 'createdAt' => now_ms(), 'ownerId' => $admin['super'] ? null : $admin['orgId'], 'data' => $tpl];
        }
        set_json_setting('templates', $list);
        out(['success' => true]);

    case 'superadmin_organizers':
        require_superadmin();
        $list = get_organizers();
        if ($method === 'GET') {
            out(['success' => true, 'organizers' => array_map(function ($o) {
                return ['id' => $o['id'], 'username' => $o['username'], 'name' => $o['name'] ?? '', 'disabled' => !empty($o['disabled'])];
            }, $list)]);
        }
        if (($data['op'] ?? null) === 'delete') {
            $list = array_values(array_filter($list, function ($o) use ($data) { return $o['id'] !== ($data['id'] ?? null); }));
        } else {
            $username = trim(str_or_empty($data['username'] ?? '', 60));
            if (!preg_match('/^[A-Za-z0-9_.@-]{3,60}$/', $username)) throw new HttpError(400, 'نام کاربری برگزارکننده باید ۳ تا ۶۰ حرف انگلیسی، عدد یا . _ - @ باشد.');
            $existing = null;
            foreach ($list as $o) if ($o['id'] === ($data['id'] ?? null)) $existing = $o;
            foreach ($list as $o) if ($o['username'] === $username && $o['id'] !== ($data['id'] ?? null)) throw new HttpError(409, 'این نام کاربری قبلاً استفاده شده است.');
            $password = $existing ? $existing['password'] : null;
            if (is_string($data['password'] ?? null) && $data['password'] !== '') $password = make_hash(require_new_password($data['password']));
            if (!$password) throw new HttpError(400, 'رمز عبور برگزارکننده الزامی است.');
            $org = ['id' => $existing ? $existing['id'] : rid('org'), 'username' => $username, 'name' => str_or_empty($data['name'] ?? '', 100), 'password' => $password, 'disabled' => !empty($data['disabled'])];
            if ($existing) $list = array_map(function ($o) use ($org) { return $o['id'] === $org['id'] ? $org : $o; }, $list);
            else $list[] = $org;
        }
        set_json_setting('organizers', array_values($list));
        out(['success' => true]);

    // An organizer changes their own password.
    case 'superadmin_org_password':
        $admin = require_admin();
        if ($admin['super']) throw new HttpError(400, 'برای سوپرادمین از «تنظیمات» استفاده کنید.');
        $list = get_organizers();
        foreach ($list as &$o) {
            if ($o['id'] !== $admin['orgId']) continue;
            if (!verify_password($data['currentPassword'] ?? '', $o['password'])) throw new HttpError(400, 'رمز عبور فعلی اشتباه است.');
            $o['password'] = make_hash(require_new_password($data['newPassword'] ?? null));
            $token = create_token(['t' => 'org', 'oid' => $o['id'], 'pv' => fingerprint($o['password'])]);
        }
        unset($o);
        set_json_setting('organizers', $list);
        out(['success' => true, 'token' => $token]);

    case 'superadmin_leagues':
        require_superadmin();
        if ($method === 'GET') {
            $l = get_json_setting('leagues');
            out(['success' => true, 'leagues' => is_list($l) ? $l : []]);
        }
        $ids = array_fill_keys(all_camp_ids(), true);
        set_json_setting('leagues', clean_leagues($data['leagues'] ?? null, $ids));
        out(['success' => true]);

    default:
        throw new HttpError(400, 'درخواست نامعتبر است.');
    }
} catch (HttpError $e) {
    out(['success' => false, 'status' => 'error', 'error' => $e->getMessage(), 'message' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('api.php: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    // Another request held the camp too long (SQLite busy / InnoDB lock wait): ask the client to retry.
    if ($e instanceof PDOException && preg_match('/database is locked|Lock wait timeout|deadlock/i', $e->getMessage())) {
        header('Retry-After: 2');
        out(['success' => false, 'status' => 'error', 'error' => 'سرور مشغول ثبت تغییرات دیگر است. چند لحظه بعد دوباره تلاش کنید.', 'message' => 'سرور مشغول ثبت تغییرات دیگر است. چند لحظه بعد دوباره تلاش کنید.'], 503);
    }
    out(['success' => false, 'status' => 'error', 'error' => 'خطای داخلی سرور', 'message' => 'خطای داخلی سرور'], 500);
}
