<?php
/**
 * Asva Studio Simulation Camp - API (cPanel / PHP Edition)
 * Mirrors server.js: same endpoints, scoring rules, authentication and permissions.
 */

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

require_once 'db.php';

const DEFAULT_POSITIVE_TAGS = ['نظم', 'خلاقیت', 'کار تیمی', 'اخلاق ورزشی'];
const DEFAULT_NEGATIVE_TAGS = ['بی‌نظمی', 'تاخیر', 'نقض قوانین', 'رفتار نامناسب'];
const DEFAULT_FJ_VALUES = [5, 10, 15, 20];
const DEFAULT_LADDER = [500, 400, 300, 200, 100];
const OVERRIDE_KEY = '__override__';
const ROLES = ['operator', 'head_referee', 'referee'];
const MANAGER_ROLES = ['operator', 'head_referee'];
const MAX_CAMP_BYTES = 15 * 1024 * 1024;

class HttpError extends Exception {
    public $status;
    public function __construct($status, $message) { parent::__construct($message); $this->status = $status; }
}

function out($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = strtolower($_GET['action'] ?? '');
// Clean URL "POST /api?id=..." (see .htaccess) is the camp settings update.
if ($action === '' && $method === 'POST') $action = 'update_camp';
$data = json_decode(file_get_contents('php://input'), true);
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
    $conn->prepare("DELETE FROM login_attempts WHERE started < ?")->execute([$now - $window]);
    $stmt = $conn->prepare("SELECT attempts FROM login_attempts WHERE k = ?");
    $stmt->execute([$key]);
    $attempts = $stmt->fetchColumn();
    if ($attempts === false) {
        $conn->prepare("INSERT INTO login_attempts (k, started, attempts) VALUES (?, ?, 1)")->execute([$key, $now]);
        return true;
    }
    $conn->prepare("UPDATE login_attempts SET attempts = attempts + 1 WHERE k = ?")->execute([$key]);
    return ((int)$attempts + 1) <= $max;
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

// Keep the server's scores for existing teams; take only definitions from the client.
function merge_teams($serverTeams, $clientTeams) {
    $byId = [];
    foreach ($serverTeams as $t) $byId[$t['id']] = $t;
    $out = [];
    foreach ($clientTeams as $ct) {
        $m = $ct;
        foreach (['score', 'scoreLogs', 'stageScores', 'judgeStageScores'] as $f) unset($m[$f]);
        if (isset($byId[$ct['id']])) {
            foreach (['scoreLogs', 'stageScores', 'judgeStageScores'] as $f) {
                if (isset($byId[$ct['id']][$f])) $m[$f] = $byId[$ct['id']][$f];
            }
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
    $c['locked'] = !empty($raw['locked']);
    $c['archived'] = !empty($raw['archived']);
    foreach ($c['teams'] as &$t) normalize_team($t);
    unset($t);
    return $c;
}

// JSON objects (not lists) must stay objects even when empty or numerically keyed.
function as_map($v) {
    return (object)(is_array($v) ? $v : []);
}

function teams_for_json($teams) {
    $out = [];
    foreach ($teams as $t) {
        $t['stageScores'] = as_map($t['stageScores'] ?? []);
        $j = [];
        foreach (($t['judgeStageScores'] ?? []) as $sId => $m) $j[$sId] = as_map($m);
        $t['judgeStageScores'] = as_map($j);
        $out[] = $t;
    }
    return $out;
}

function enc($v) {
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function public_state($c) {
    $teams = [];
    foreach ($c['teams'] as $t) {
        foreach ($t['scoreLogs'] as &$l) {
            if (is_array($l) && isset($l['user'])) $l['user'] = public_user($l['user']);
        }
        unset($l);
        $teams[] = $t;
    }
    $s = $c;
    unset($s['password'], $s['users']);
    $s['teams'] = teams_for_json($teams);
    $s['closedStages'] = as_map($c['closedStages']);
    $s['stageTieredResults'] = as_map($c['stageTieredResults']);
    return $s;
}

function admin_state($c) {
    $s = public_state($c);
    $s['password'] = '';
    $s['hasPassword'] = !empty($c['password']);
    $s['users'] = array_map(function ($u) {
        $has = !empty($u['password']);
        $u['password'] = '';
        $u['hasPassword'] = $has;
        return $u;
    }, $c['users']);
    return $s;
}

function load_camp($id) {
    global $conn;
    if (!is_valid_id($id)) return null;
    $stmt = $conn->prepare("SELECT * FROM camps WHERE id = ?");
    $stmt->execute([$id]);
    return parse_camp($stmt->fetch(PDO::FETCH_ASSOC));
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
            default: $vals[$k] = $v;
        }
    }
    return $vals;
}

const CAMP_COLUMNS = ['orgName', 'password', 'title', 'logo', 'locked', 'archived', 'numLang', 'dir', 'teams', 'stages', 'users',
    'campType', 'tieredPointsLadder', 'closedStages', 'stageTieredResults', 'fieldJudgingMode', 'fieldJudgingValues', 'positiveTags', 'negativeTags'];

function save_camp_changes($id, $changes) {
    global $conn;
    $vals = column_values(array_intersect_key($changes, array_flip(CAMP_COLUMNS)));
    if (!$vals) return;
    $total = 0;
    foreach ($vals as $v) $total += is_string($v) ? strlen($v) : 8;
    if ($total > MAX_CAMP_BYTES) throw new HttpError(413, 'حجم اطلاعات مسابقه (به‌ویژه تصاویر) بیش از حد مجاز است.');
    $sets = implode(', ', array_map(function ($k) { return "$k = ?"; }, array_keys($vals)));
    $stmt = $conn->prepare("UPDATE camps SET $sets WHERE id = ?");
    $stmt->execute(array_merge(array_values($vals), [$id]));
}

// Load → mutate → save inside one transaction holding a write lock on the camp.
function mutate_camp($id, $allowLocked, callable $fn) {
    global $conn, $active_driver;
    require_id($id, 'شناسه مسابقه');
    if ($active_driver === 'mysql') $conn->beginTransaction();
    else $conn->exec('BEGIN IMMEDIATE');
    try {
        if ($active_driver === 'mysql') {
            $stmt = $conn->prepare("SELECT * FROM camps WHERE id = ? FOR UPDATE");
            $stmt->execute([$id]);
            $camp = parse_camp($stmt->fetch(PDO::FETCH_ASSOC));
        } else {
            $camp = load_camp($id);
        }
        if (!$camp) throw new HttpError(404, 'مسابقه یافت نشد.');
        if (!$allowLocked && $camp['locked']) throw new HttpError(403, 'این مسابقه قفل شده است.');
        $result = $fn($camp) ?: [];
        if (!empty($result['changes'])) {
            save_camp_changes($id, $result['changes']);
            $camp = array_merge($camp, $result['changes']);
        }
        if ($active_driver === 'mysql') $conn->commit(); else $conn->exec('COMMIT');
        $result['camp'] = $camp;
        return $result;
    } catch (Throwable $e) {
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
function clean_stages($stages) {
    if (!is_array($stages)) throw new HttpError(400, 'فهرست مراحل نامعتبر است.');
    $out = [];
    foreach ($stages as $s) {
        require_id($s['id'] ?? null, 'شناسه مرحله');
        $m = (float)($s['multiplier'] ?? 1);
        $out[] = array_merge($s, [
            'name' => str_or_empty($s['name'] ?? '', 200),
            'unit' => in_array($s['unit'] ?? '', ['points', 'time', 'time_asc', 'time_desc'], true) ? $s['unit'] : 'points',
            'timeOrder' => ($s['timeOrder'] ?? '') === 'desc' ? 'desc' : 'asc',
            'multiplier' => $m > 0 ? $m : 1
        ]);
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

function now_ms() {
    return (int)round(microtime(true) * 1000);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
try {
    switch ($action) {

    case 'settings':
        if ($method === 'GET') out(['systemLogo' => get_setting('systemLogo')]);
        require_superadmin();
        if (($data['key'] ?? '') !== 'systemLogo') throw new HttpError(400, 'کلید تنظیمات مجاز نیست.');
        if (!is_string($data['value'] ?? null) || strlen($data['value']) > 2000000) throw new HttpError(400, 'مقدار نامعتبر است.');
        set_setting('systemLogo', $data['value']);
        out(['success' => true]);

    case 'superadmin_login':
        $secret = superadmin_secret();
        if (!$secret) out(['success' => false, 'message' => 'رمز سوپرادمین هنوز تعیین نشده است. ابتدا صفحه setup_db.php را باز کنید.']);
        $rk = 'sa:' . client_ip();
        if (!rate_limit_check($rk)) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر دوباره امتحان کنید.');
        if (!verify_password($data['password'] ?? '', $secret)) out(['success' => false, 'message' => 'رمز عبور سوپرادمین اشتباه است!']);
        rate_limit_reset($rk);
        out(['success' => true, 'token' => create_token(['t' => 'sa', 'pv' => fingerprint($secret)])]);

    case 'superadmin_camps':
        require_superadmin();
        $rows = $conn->query("SELECT id, orgName, title, locked, archived, campType FROM camps ORDER BY id DESC")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$c) {
            $c['locked'] = !empty($c['locked']);
            $c['archived'] = !empty($c['archived']);
        }
        unset($c);
        out(['success' => true, 'camps' => $rows]);

    case 'superadmin_camp':
        require_superadmin();
        $camp = load_camp($_GET['id'] ?? '');
        if (!$camp) out(['success' => false, 'message' => 'مسابقه یافت نشد']);
        out(['success' => true, 'camp' => admin_state($camp)]);

    case 'superadmin_camp_lock':
        require_superadmin();
        mutate_camp($_GET['id'] ?? '', true, function () use ($data) { return ['changes' => ['locked' => !empty($data['locked'])]]; });
        out(['success' => true]);

    case 'superadmin_camp_archive':
        require_superadmin();
        mutate_camp($_GET['id'] ?? '', true, function () use ($data) { return ['changes' => ['archived' => !empty($data['archived'])]]; });
        out(['success' => true]);

    case 'setup':
        require_superadmin();
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
        if (!empty($data['campId'])) {
            $id = require_id($data['campId']);
            mutate_camp($id, true, function ($camp) use ($base, $teamDefs, $data) {
                $changes = $base;
                $changes['teams'] = merge_teams($camp['teams'], $teamDefs);
                $changes['users'] = clean_users($data['users'] ?? [], $camp['users']);
                if (is_string($data['password'] ?? null) && $data['password'] !== '') $changes['password'] = make_hash($data['password']);
                return ['changes' => $changes];
            });
            out(['success' => true, 'campId' => $id]);
        }
        if (!is_string($data['password'] ?? null) || $data['password'] === '') throw new HttpError(400, 'رمز عبور اپراتور الزامی است.');
        $id = 'camp_' . bin2hex(random_bytes(6));
        $conn->prepare("INSERT INTO camps (id, locked, archived, closedStages, stageTieredResults) VALUES (?, 0, 0, '{}', '{}')")->execute([$id]);
        save_camp_changes($id, array_merge($base, [
            'password' => make_hash($data['password']),
            'teams' => merge_teams([], $teamDefs),
            'users' => clean_users($data['users'] ?? [], [])
        ]));
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
            out(array_merge(public_state($camp), ['success' => true, 'token' => $data['token'], 'user' => public_user($user)]));
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
        out(array_merge(public_state($res['camp']), ['success' => true, 'token' => $token, 'user' => public_user($res['user'])]));

    case 'info':
        $camp = load_camp($_GET['id'] ?? '');
        if (!$camp) out(['success' => false]);
        out(['success' => true, 'orgName' => $camp['orgName'] ?? '', 'title' => $camp['title'] ?? '', 'logo' => $camp['logo'] ?? '', 'campType' => $camp['campType']]);

    case 'poll':
        $id = require_id($_GET['id'] ?? '', 'شناسه مسابقه');
        $camp = load_camp($id);
        if (!$camp) throw new HttpError(404, 'مسابقه یافت نشد');
        out(public_state($camp));

    case 'update_camp':
        if ($method !== 'POST') throw new HttpError(405, 'Method not allowed');
        mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($data) {
            require_camp_user($camp, MANAGER_ROLES);
            $c = [];
            if (isset($data['teams'])) $c['teams'] = merge_teams($camp['teams'], clean_team_defs($data['teams']));
            if (isset($data['stages'])) $c['stages'] = clean_stages($data['stages']);
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
            return ['changes' => $c];
        });
        out(['success' => true, 'status' => 'success']);

    case 'instant':
        $teamId = require_id($data['teamId'] ?? null, 'شناسه تیم');
        $value = $data['delta'] ?? null;
        if (!is_numeric($value) || (float)$value == 0 || abs((float)$value) > 1000000) throw new HttpError(400, 'مقدار امتیاز نامعتبر است.');
        $logId = 'log_' . bin2hex(random_bytes(6));
        mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($teamId, $value, $logId, $data) {
            $user = require_camp_user($camp);
            $teams = $camp['teams'];
            foreach ($teams as &$t) {
                if ($t['id'] !== $teamId) continue;
                $t['scoreLogs'][] = [
                    'id' => $logId, 'type' => 'instant', 'value' => r2((float)$value), 'timestamp' => now_ms(),
                    'user' => public_user($user), 'tag' => str_or_empty($data['tag'] ?? '', 100)
                ];
                recompute_score($t);
                return ['changes' => ['teams' => $teams]];
            }
            throw new HttpError(404, 'تیم یافت نشد.');
        });
        out(['success' => true, 'logId' => $logId]);

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
                foreach ($teams as &$t) {
                    if ($onlyTeam && $t['id'] !== $onlyTeam) continue;
                    if (!isset($t['judgeStageScores'][$stageId][$target])) continue;
                    unset($t['judgeStageScores'][$stageId][$target]);
                    if (!$isTiered) { apply_judges_to_stage($t, $stageId, true); recompute_score($t); }
                }
                unset($t);
                return ['changes' => ['teams' => $teams]];
            }

            $target = $data['targetJudgeKey'] ?? null;
            $judgeKey = ($isManager && is_safe_key($target)) ? $target : $user['username'];
            $scores = is_array($data['scores'] ?? null) ? $data['scores'] : ($single && isset($single['teamId']) ? [$single['teamId'] => $single['score'] ?? 0] : []);
            $dnfTeam = ($single && !empty($single['dnf'])) ? ($single['teamId'] ?? null) : null;
            foreach ($teams as &$t) {
                if (!array_key_exists($t['id'], $scores)) continue;
                $t['judgeStageScores'][$stageId][$judgeKey] = judge_entry_for($user, $scores[$t['id']], $dnfTeam === $t['id'], $judgeKey);
                if (!$isTiered) { apply_judges_to_stage($t, $stageId); recompute_score($t); }
            }
            unset($t);
            return ['changes' => ['teams' => $teams]];
        });
        out(['success' => true, 'teams' => public_state($res['camp'])['teams']]);

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
            return ['changes' => ['teams' => $teams]];
        });
        out(['success' => true, 'teams' => public_state($res['camp'])['teams']]);

    case 'team_logs':
        $teamId = require_id($data['teamId'] ?? null, 'شناسه تیم');
        $res = mutate_camp($_GET['id'] ?? '', false, function ($camp) use ($teamId, $data) {
            require_camp_user($camp, MANAGER_ROLES);
            $teams = $camp['teams'];
            foreach ($teams as &$t) {
                if ($t['id'] !== $teamId) continue;
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
                return ['changes' => ['teams' => $teams]];
            }
            throw new HttpError(404, 'تیم یافت نشد.');
        });
        out(['success' => true, 'teams' => public_state($res['camp'])['teams']]);

    case 'close_tiered':
        $stageId = require_id($data['stageId'] ?? null, 'شناسه مرحله');
        $res = mutate_camp($data['id'] ?? ($_GET['id'] ?? ''), false, function ($camp) use ($stageId, $data) {
            require_camp_user($camp, MANAGER_ROLES);
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
                    'payload' => ['success' => true, 'reopened' => true, 'closedStages' => as_map($closed)]
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
                              'results' => $rows, 'stages' => $stages, 'closedStages' => as_map($closed)]
            ];
        });
        out(array_merge($res['payload'], ['teams' => public_state($res['camp'])['teams']]));

    case 'user_profile_pic':
        $pic = is_string($data['profilePic'] ?? null) ? $data['profilePic'] : '';
        if (strlen($pic) > 500000) throw new HttpError(413, 'حجم عکس پروفایل بیش از حد مجاز است.');
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

    default:
        throw new HttpError(400, 'درخواست نامعتبر است.');
    }
} catch (HttpError $e) {
    out(['success' => false, 'status' => 'error', 'error' => $e->getMessage(), 'message' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('api.php: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    out(['success' => false, 'status' => 'error', 'error' => 'خطای داخلی سرور', 'message' => 'خطای داخلی سرور'], 500);
}
