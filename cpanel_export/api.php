<?php
/**
 * Asva Studio Simulation Camp - Universal API Engine (cPanel / PHP Edition)
 * پیاده‌سازی تمام ۱۷ اندپوینت و قواعد داوری، پلکانی، لاگ‌ها و مدیریت کاربران
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once 'db.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($_GET['endpoint'] ?? '');

// در صورتی که مسیر از طریق PATH_INFO یا ری‌رایت آمده باشد
if (!$action && isset($_SERVER['PATH_INFO'])) {
    $action = trim($_SERVER['PATH_INFO'], '/');
}
if (!$action && isset($_GET['q'])) {
    $action = trim($_GET['q'], '/');
}

// نرمال‌سازی نام اکشن‌ها
$action = strtolower($action);
$action = str_replace(['api/', 'superadmin/'], '', $action);

$rawBody = file_get_contents("php://input");
$data = json_decode($rawBody, true) ?: [];

// تابع فرمت‌بندی استاندارد اطلاعات مسابقه
function sanitizeCampData($camp) {
    if (!$camp) return null;

    $defaultPositiveTags = ['نظم', 'خلاقیت', 'کار تیمی', 'اخلاق ورزشی'];
    $defaultNegativeTags = ['بی‌نظمی', 'تاخیر', 'نقض قوانین', 'رفتار نامناسب'];
    $defaultFieldJudgingValues = [5, 10, 15, 20];
    $defaultTieredLadder = [500, 400, 300, 200, 100];

    $teams = is_string($camp['teams'] ?? null) ? json_decode($camp['teams'], true) : ($camp['teams'] ?? []);
    if (!is_array($teams)) $teams = [];

    $stages = is_string($camp['stages'] ?? null) ? json_decode($camp['stages'], true) : ($camp['stages'] ?? []);
    if (!is_array($stages)) $stages = [];

    $users = is_string($camp['users'] ?? null) ? json_decode($camp['users'], true) : ($camp['users'] ?? []);
    if (!is_array($users)) $users = [];

    $fjValues = is_string($camp['fieldJudgingValues'] ?? null) ? json_decode($camp['fieldJudgingValues'], true) : ($camp['fieldJudgingValues'] ?? $defaultFieldJudgingValues);
    if (!is_array($fjValues) || empty($fjValues)) $fjValues = $defaultFieldJudgingValues;

    $posTags = is_string($camp['positiveTags'] ?? null) ? json_decode($camp['positiveTags'], true) : ($camp['positiveTags'] ?? $defaultPositiveTags);
    if (!is_array($posTags) || empty($posTags)) $posTags = $defaultPositiveTags;

    $negTags = is_string($camp['negativeTags'] ?? null) ? json_decode($camp['negativeTags'], true) : ($camp['negativeTags'] ?? $defaultNegativeTags);
    if (!is_array($negTags) || empty($negTags)) $negTags = $defaultNegativeTags;

    $ladder = is_string($camp['tieredPointsLadder'] ?? null) ? json_decode($camp['tieredPointsLadder'], true) : ($camp['tieredPointsLadder'] ?? $defaultTieredLadder);
    if (!is_array($ladder) || empty($ladder)) $ladder = $defaultTieredLadder;

    $closedStages = is_string($camp['closedStages'] ?? null) ? json_decode($camp['closedStages'], true) : ($camp['closedStages'] ?? new stdClass());
    if (!is_array($closedStages) && !is_object($closedStages)) $closedStages = new stdClass();

    $stageTieredResults = is_string($camp['stageTieredResults'] ?? null) ? json_decode($camp['stageTieredResults'], true) : ($camp['stageTieredResults'] ?? new stdClass());
    if (!is_array($stageTieredResults) && !is_object($stageTieredResults)) $stageTieredResults = new stdClass();

    return [
        'id' => $camp['id'],
        'orgName' => $camp['orgName'] ?? '',
        'title' => $camp['title'] ?? '',
        'logo' => $camp['logo'] ?? '',
        'locked' => !empty($camp['locked']),
        'archived' => !empty($camp['archived']),
        'numLang' => $camp['numLang'] ?? 'fa',
        'dir' => $camp['dir'] ?? 'rtl',
        'teams' => $teams,
        'stages' => $stages,
        'users' => $users,
        'campType' => $camp['campType'] ?? 'simple',
        'tieredPointsLadder' => $ladder,
        'closedStages' => $closedStages,
        'stageTieredResults' => $stageTieredResults,
        'fieldJudgingMode' => $camp['fieldJudgingMode'] ?? 'free',
        'fieldJudgingValues' => $fjValues,
        'positiveTags' => $posTags,
        'negativeTags' => $negTags
    ];
}

function getCampRaw($conn, $id) {
    if (!$id) return null;
    $stmt = $conn->prepare("SELECT * FROM camps WHERE id = ?");
    $stmt->execute([$id]);
    return $stmt->fetch(PDO::FETCH_ASSOC);
}

// -------------------------------------------------------------------------
// ۱. اندپوینت‌های تنظیمات سامانه (Settings)
// -------------------------------------------------------------------------
if ($action === 'settings') {
    if ($method === 'GET') {
        $stmt = $conn->query("SELECT `key`, value FROM settings");
        $settings = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $settings[$row['key']] = $row['value'];
        }
        echo json_encode([
            'admin_password' => $settings['admin_password'] ?? null,
            'systemLogo' => $settings['systemLogo'] ?? null
        ]);
        exit;
    } elseif ($method === 'POST') {
        $key = $data['key'] ?? '';
        $value = $data['value'] ?? '';
        if (!$key) {
            http_response_code(400);
            echo json_encode(['error' => 'کلید معتبر نیست']);
            exit;
        }
        global $active_driver;
        if ($active_driver === 'mysql') {
            $stmt = $conn->prepare("INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)");
            $stmt->execute([$key, $value]);
        } else {
            $stmt = $conn->prepare("INSERT OR REPLACE INTO settings (`key`, value) VALUES (?, ?)");
            $stmt->execute([$key, $value]);
        }
        echo json_encode(['success' => true]);
        exit;
    }
}

// -------------------------------------------------------------------------
// ۲. ورود سوپرادمین (Superadmin Login)
// -------------------------------------------------------------------------
if ($action === 'superadmin_login' || $action === 'camps/login') {
    $inputPass = $data['password'] ?? '';
    // بررسی رمز سفارشی از دیتابیس
    $stmt = $conn->prepare("SELECT value FROM settings WHERE `key` = 'admin_password'");
    $stmt->execute();
    $customPass = $stmt->fetchColumn();
    $actualPass = (!empty($customPass)) ? $customPass : $superadmin_pass;

    if ($inputPass === $actualPass) {
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'message' => 'رمز عبور سوپرادمین اشتباه است!']);
    }
    exit;
}

// -------------------------------------------------------------------------
// ۳. لیست مسابقات سوپرادمین (Superadmin Camps List)
// -------------------------------------------------------------------------
if ($action === 'superadmin_camps' || $action === 'camps') {
    $stmt = $conn->query("SELECT id, orgName, title, locked, archived, campType FROM camps ORDER BY id DESC");
    $camps = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($camps as &$c) {
        $c['locked'] = !empty($c['locked']);
        $c['archived'] = !empty($c['archived']);
    }
    echo json_encode(['success' => true, 'camps' => $camps]);
    exit;
}

// -------------------------------------------------------------------------
// ۴. دریافت جزئیات یک مسابقه (Superadmin Single Camp)
// -------------------------------------------------------------------------
if ($action === 'superadmin_camp' || $action === 'camp') {
    $id = $_GET['id'] ?? ($data['id'] ?? '');
    $camp = getCampRaw($conn, $id);
    if ($camp) {
        echo json_encode(['success' => true, 'camp' => sanitizeCampData($camp)]);
    } else {
        echo json_encode(['success' => false, 'message' => 'مسابقه یافت نشد']);
    }
    exit;
}

// -------------------------------------------------------------------------
// ۵. قفل / باز کردن مسابقه
// -------------------------------------------------------------------------
if ($action === 'superadmin_camp_lock') {
    $id = $_GET['id'] ?? ($data['id'] ?? '');
    $isLocked = !empty($data['locked']) ? 1 : 0;
    $stmt = $conn->prepare("UPDATE camps SET locked = ? WHERE id = ?");
    $stmt->execute([$isLocked, $id]);
    echo json_encode(['success' => true]);
    exit;
}

// -------------------------------------------------------------------------
// ۶. آرشیو / خروج از آرشیو مسابقه
// -------------------------------------------------------------------------
if ($action === 'superadmin_camp_archive') {
    $id = $_GET['id'] ?? ($data['id'] ?? '');
    $isArchived = !empty($data['archived']) ? 1 : 0;
    $stmt = $conn->prepare("UPDATE camps SET archived = ? WHERE id = ?");
    $stmt->execute([$isArchived, $id]);
    echo json_encode(['success' => true]);
    exit;
}

// -------------------------------------------------------------------------
// ۷. ساخت یا ویرایش مسابقه (Setup)
// -------------------------------------------------------------------------
if ($action === 'setup') {
    $campId = $data['campId'] ?? '';
    $orgName = $data['orgName'] ?? '';
    $title = $data['title'] ?? '';
    $logo = $data['logo'] ?? '';
    $password = $data['password'] ?? '';
    $teams = json_encode($data['teams'] ?? []);
    $stages = json_encode($data['stages'] ?? []);
    $users = json_encode($data['users'] ?? []);
    $numLang = $data['numLang'] ?? 'fa';
    $dir = $data['dir'] ?? 'rtl';
    $campType = $data['campType'] ?? 'simple';
    
    $ladder = $data['tieredPointsLadder'] ?? [500, 400, 300, 200, 100];
    if (is_string($ladder)) {
        $ladder = array_values(array_filter(array_map('intval', explode(',', $ladder))));
    }
    $ladderJson = json_encode(!empty($ladder) ? $ladder : [500, 400, 300, 200, 100]);

    $fjMode = $data['fieldJudgingMode'] ?? 'free';
    $fjValues = json_encode($data['fieldJudgingValues'] ?? [5, 10, 15, 20]);
    $posTags = json_encode($data['positiveTags'] ?? ['نظم', 'خلاقیت', 'کار تیمی', 'اخلاق ورزشی']);
    $negTags = json_encode($data['negativeTags'] ?? ['بی‌نظمی', 'تاخیر', 'نقض قوانین', 'رفتار نامناسب']);

    if ($campId) {
        $stmt = $conn->prepare("UPDATE camps SET orgName=?, title=?, logo=?, password=?, teams=?, stages=?, users=?, numLang=?, dir=?, campType=?, tieredPointsLadder=?, fieldJudgingMode=?, fieldJudgingValues=?, positiveTags=?, negativeTags=? WHERE id=?");
        $stmt->execute([$orgName, $title, $logo, $password, $teams, $stages, $users, $numLang, $dir, $campType, $ladderJson, $fjMode, $fjValues, $posTags, $negTags, $campId]);
        echo json_encode(['success' => true, 'campId' => $campId]);
    } else {
        $newCampId = 'camp_' . substr(md5(uniqid(rand(), true)), 0, 9);
        $stmt = $conn->prepare("INSERT INTO camps (id, orgName, title, logo, password, teams, stages, users, locked, archived, numLang, dir, campType, tieredPointsLadder, closedStages, stageTieredResults, fieldJudgingMode, fieldJudgingValues, positiveTags, negativeTags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, '{}', '{}', ?, ?, ?, ?)");
        $stmt->execute([$newCampId, $orgName, $title, $logo, $password, $teams, $stages, $users, $numLang, $dir, $campType, $ladderJson, $fjMode, $fjValues, $posTags, $negTags]);
        echo json_encode(['success' => true, 'campId' => $newCampId]);
    }
    exit;
}

// -------------------------------------------------------------------------
// ۸. ورود اپراتور، سرداور و داوران (Multi-Role Login)
// -------------------------------------------------------------------------
if ($action === 'login') {
    $id = $data['id'] ?? '';
    $username = $data['username'] ?? '';
    $password = $data['password'] ?? '';

    if (!$username) {
        echo json_encode(['success' => false, 'message' => 'نام کاربری الزامی است!']);
        exit;
    }

    $camp = getCampRaw($conn, $id);
    if (!$camp) {
        echo json_encode(['success' => false, 'message' => 'مسابقه یافت نشد!']);
        exit;
    }

    $users = is_string($camp['users'] ?? null) ? json_decode($camp['users'], true) : ($camp['users'] ?? []);
    if (!is_array($users)) $users = [];

    $loggedUser = null;
    foreach ($users as $u) {
        if (($u['username'] ?? '') === $username && ($u['password'] ?? '') === $password) {
            $loggedUser = $u;
            break;
        }
    }

    // حالت اپراتور اصلی (Fallback)
    if (!$loggedUser && $username === 'admin' && ($camp['password'] ?? '') === $password) {
        $loggedUser = [
            'role' => 'operator',
            'firstName' => 'اپراتور',
            'lastName' => 'اصلی',
            'username' => 'admin',
            'profilePic' => ''
        ];
    }

    if ($loggedUser) {
        $clean = sanitizeCampData($camp);
        echo json_encode([
            'success' => true,
            'user' => $loggedUser,
            'teams' => $clean['teams'],
            'stages' => $clean['stages'],
            'orgName' => $clean['orgName'],
            'title' => $clean['title'],
            'logo' => $clean['logo'],
            'locked' => $clean['locked'],
            'numLang' => $clean['numLang'],
            'dir' => $clean['dir'],
            'campType' => $clean['campType'],
            'tieredPointsLadder' => $clean['tieredPointsLadder'],
            'closedStages' => $clean['closedStages'],
            'stageTieredResults' => $clean['stageTieredResults'],
            'fieldJudgingMode' => $clean['fieldJudgingMode'],
            'fieldJudgingValues' => $clean['fieldJudgingValues'],
            'positiveTags' => $clean['positiveTags'],
            'negativeTags' => $clean['negativeTags'],
            'users' => $clean['users']
        ]);
    } else {
        echo json_encode(['success' => false, 'message' => 'نام کاربری یا رمز عبور اشتباه است!']);
    }
    exit;
}

// -------------------------------------------------------------------------
// ۹. دریافت اطلاعات سربرگ مسابقه (Camp Info)
// -------------------------------------------------------------------------
if ($action === 'info') {
    $id = $_GET['id'] ?? ($data['id'] ?? '');
    $camp = getCampRaw($conn, $id);
    if ($camp) {
        echo json_encode([
            'success' => true,
            'orgName' => $camp['orgName'] ?? '',
            'title' => $camp['title'] ?? '',
            'logo' => $camp['logo'] ?? '',
            'campType' => $camp['campType'] ?? 'simple'
        ]);
    } else {
        echo json_encode(['success' => false]);
    }
    exit;
}

// -------------------------------------------------------------------------
// ۱۰. پولینگ زنده اطلاعات مسابقه (Live Polling for Board & Operator)
// -------------------------------------------------------------------------
if ($action === 'poll') {
    $id = $_GET['id'] ?? ($data['id'] ?? '');
    if (!$id) {
        http_response_code(400);
        echo json_encode(['error' => 'شناسه مسابقه وارد نشده است.']);
        exit;
    }
    $camp = getCampRaw($conn, $id);
    if ($camp) {
        echo json_encode(sanitizeCampData($camp));
    } else {
        http_response_code(404);
        echo json_encode(['error' => 'مسابقه یافت نشد']);
    }
    exit;
}

// -------------------------------------------------------------------------
// ۱۱. به‌روزرسانی تنظیمات و اطلاعات مسابقه توسط اپراتور (Update Camp)
// -------------------------------------------------------------------------
if ($action === 'update_camp' || ($action === '' && $method === 'POST')) {
    $id = $_GET['id'] ?? ($data['id'] ?? '');
    if (!$id) {
        http_response_code(400);
        echo json_encode(['error' => 'شناسه مسابقه الزامی است']);
        exit;
    }

    $camp = getCampRaw($conn, $id);
    if (!$camp) {
        http_response_code(404);
        echo json_encode(['error' => 'مسابقه یافت نشد']);
        exit;
    }
    if (!empty($camp['locked'])) {
        http_response_code(403);
        echo json_encode(['status' => 'error', 'message' => 'این مسابقه قفل شده است.']);
        exit;
    }

    $teams = isset($data['teams']) ? json_encode($data['teams']) : $camp['teams'];
    $stages = isset($data['stages']) ? json_encode($data['stages']) : $camp['stages'];
    $orgName = $data['orgName'] ?? $camp['orgName'];
    $title = $data['title'] ?? $camp['title'];
    $logo = $data['logo'] ?? $camp['logo'];
    $numLang = $data['numLang'] ?? ($camp['numLang'] ?: 'fa');
    $dir = $data['dir'] ?? ($camp['dir'] ?: 'rtl');
    $fjMode = $data['fieldJudgingMode'] ?? ($camp['fieldJudgingMode'] ?: 'free');
    $fjValues = isset($data['fieldJudgingValues']) ? json_encode($data['fieldJudgingValues']) : $camp['fieldJudgingValues'];
    $posTags = isset($data['positiveTags']) ? json_encode($data['positiveTags']) : $camp['positiveTags'];
    $negTags = isset($data['negativeTags']) ? json_encode($data['negativeTags']) : $camp['negativeTags'];
    $campType = $data['campType'] ?? ($camp['campType'] ?: 'simple');
    
    $ladder = isset($data['tieredPointsLadder']) ? $data['tieredPointsLadder'] : $camp['tieredPointsLadder'];
    if (is_string($ladder) && strpos($ladder, '[') === false) {
        $ladder = array_values(array_filter(array_map('intval', explode(',', $ladder))));
        $ladderJson = json_encode($ladder);
    } elseif (is_array($ladder)) {
        $ladderJson = json_encode($ladder);
    } else {
        $ladderJson = $ladder;
    }

    $closedStages = isset($data['closedStages']) ? json_encode($data['closedStages']) : $camp['closedStages'];
    $stageTieredResults = isset($data['stageTieredResults']) ? json_encode($data['stageTieredResults']) : $camp['stageTieredResults'];

    $stmt = $conn->prepare("UPDATE camps SET teams=?, stages=?, orgName=?, title=?, logo=?, numLang=?, dir=?, fieldJudgingMode=?, fieldJudgingValues=?, positiveTags=?, negativeTags=?, campType=?, tieredPointsLadder=?, closedStages=?, stageTieredResults=? WHERE id=?");
    $stmt->execute([$teams, $stages, $orgName, $title, $logo, $numLang, $dir, $fjMode, $fjValues, $posTags, $negTags, $campType, $ladderJson, $closedStages, $stageTieredResults, $id]);

    echo json_encode(['status' => 'success']);
    exit;
}

// -------------------------------------------------------------------------
// ۱۲. ثبت امتیاز لحظه‌ای (Instant Score + Tags + Splash)
// -------------------------------------------------------------------------
if ($action === 'instant') {
    $id = $_GET['id'] ?? ($data['id'] ?? '');
    $teamId = $data['teamId'] ?? '';
    $delta = intval($data['delta'] ?? 0);
    $user = $data['user'] ?? null;
    $tag = $data['tag'] ?? '';

    $camp = getCampRaw($conn, $id);
    if ($camp && empty($camp['locked'])) {
        $teams = is_string($camp['teams']) ? json_decode($camp['teams'], true) : ($camp['teams'] ?: []);
        $createdLogId = 'log_' . substr(md5(uniqid(rand(), true)), 0, 9);

        foreach ($teams as &$t) {
            if (($t['id'] ?? '') === $teamId) {
                if (!isset($t['scoreLogs']) || !is_array($t['scoreLogs'])) {
                    $t['scoreLogs'] = [];
                }
                $t['scoreLogs'][] = [
                    'id' => $createdLogId,
                    'type' => 'instant',
                    'value' => $delta,
                    'timestamp' => round(microtime(true) * 1000),
                    'user' => $user,
                    'tag' => $tag
                ];

                $stageSum = 0;
                if (isset($t['stageScores']) && is_array($t['stageScores'])) {
                    foreach ($t['stageScores'] as $s) $stageSum += intval($s);
                }
                $logsSum = 0;
                foreach ($t['scoreLogs'] as $l) {
                    if (($l['type'] ?? '') !== 'cancelled') {
                        $logsSum += intval($l['value'] ?? 0);
                    }
                }
                $t['score'] = $stageSum + $logsSum;
                break;
            }
        }
        $stmt = $conn->prepare("UPDATE camps SET teams = ? WHERE id = ?");
        $stmt->execute([json_encode($teams), $id]);
        echo json_encode(['success' => true, 'logId' => $createdLogId]);
    } else {
        http_response_code(403);
        echo json_encode(['error' => 'مسابقه قفل است یا یافت نشد']);
    }
    exit;
}

// -------------------------------------------------------------------------
// ۱۳. لغو امتیاز لحظه‌ای (Undo Instant)
// -------------------------------------------------------------------------
if ($action === 'undo_instant') {
    $id = $_GET['id'] ?? ($data['id'] ?? '');
    $logId = $data['logId'] ?? '';

    $camp = getCampRaw($conn, $id);
    if ($camp && empty($camp['locked'])) {
        $teams = is_string($camp['teams']) ? json_decode($camp['teams'], true) : ($camp['teams'] ?: []);
        $found = false;

        foreach ($teams as &$t) {
            if (isset($t['scoreLogs']) && is_array($t['scoreLogs'])) {
                foreach ($t['scoreLogs'] as &$l) {
                    if (($l['id'] ?? '') === $logId && ($l['type'] ?? '') === 'instant') {
                        $l['type'] = 'cancelled';
                        $l['timestamp'] = round(microtime(true) * 1000);
                        $found = true;
                        break;
                    }
                }
            }
            if ($found) {
                $stageSum = 0;
                if (isset($t['stageScores']) && is_array($t['stageScores'])) {
                    foreach ($t['stageScores'] as $s) $stageSum += intval($s);
                }
                $logsSum = 0;
                foreach ($t['scoreLogs'] as $l) {
                    if (($l['type'] ?? '') !== 'cancelled') {
                        $logsSum += intval($l['value'] ?? 0);
                    }
                }
                $t['score'] = $stageSum + $logsSum;
                break;
            }
        }
        $stmt = $conn->prepare("UPDATE camps SET teams = ? WHERE id = ?");
        $stmt->execute([json_encode($teams), $id]);
        echo json_encode(['success' => true]);
    } else {
        http_response_code(403);
        echo json_encode(['error' => 'مسابقه قفل است یا یافت نشد']);
    }
    exit;
}

// -------------------------------------------------------------------------
// ۱۴. ثبت نمرات داوری مراحل (Referee Stage Scoring)
// -------------------------------------------------------------------------
if ($action === 'judge_stage_score' || $action === 'stage/score') {
    $id = $_GET['id'] ?? ($data['id'] ?? '');
    $stageId = $data['stageId'] ?? '';
    $scores = $data['scores'] ?? null;
    $singleScore = $data['singleScore'] ?? null;
    $user = $data['user'] ?? null;
    $actionType = $data['action'] ?? '';
    $targetJudgeKey = $data['targetJudgeKey'] ?? '';

    if (!$id || !$stageId) {
        http_response_code(400);
        echo json_encode(['error' => 'شناسه مسابقه یا مرحله نامعتبر است.']);
        exit;
    }

    $camp = getCampRaw($conn, $id);
    if ($camp && empty($camp['locked'])) {
        $teams = is_string($camp['teams']) ? json_decode($camp['teams'], true) : ($camp['teams'] ?: []);
        $isTiered = ($camp['campType'] ?? 'simple') === 'tiered';

        $judgeKey = trim($targetJudgeKey ?: ($user ? ($user['username'] ?? $user['id'] ?? 'judge') : 'unknown_judge'));
        $judgeName = $user ? (($user['firstName'] ?? '') . ' ' . ($user['lastName'] ?? '')) : 'داور';
        $judgeName = trim($judgeName) ?: ($user['username'] ?? 'داور');
        $judgeRole = $user['role'] ?? 'referee';
        $judgePhoto = $user['profilePic'] ?? ($user['photo'] ?? ($user['avatar'] ?? ''));

        $scoreMap = $scores ?: ($singleScore ? [$singleScore['teamId'] => $singleScore['score']] : []);
        $dnfMap = ($singleScore && !empty($singleScore['dnf'])) ? [$singleScore['teamId'] => true] : [];

        foreach ($teams as &$team) {
            if (!isset($team['judgeStageScores']) || !is_array($team['judgeStageScores'])) {
                $team['judgeStageScores'] = [];
            }
            if (!isset($team['judgeStageScores'][$stageId]) || !is_array($team['judgeStageScores'][$stageId])) {
                $team['judgeStageScores'][$stageId] = [];
            }

            if ($actionType === 'delete') {
                if ($targetJudgeKey && isset($team['judgeStageScores'][$stageId][$targetJudgeKey])) {
                    unset($team['judgeStageScores'][$stageId][$targetJudgeKey]);
                }
            } elseif (isset($scoreMap[$team['id']])) {
                $rawVal = $scoreMap[$team['id']];
                $isDnf = ($rawVal === '-' || strtolower((string)$rawVal) === 'dnf' || !empty($dnfMap[$team['id']]));
                $scoreVal = $isDnf ? '-' : floatval($rawVal);

                $team['judgeStageScores'][$stageId][$judgeKey] = [
                    'judgeKey' => $judgeKey,
                    'judgeName' => $judgeName,
                    'judgeRole' => $judgeRole,
                    'judgePhoto' => $judgePhoto,
                    'score' => $scoreVal,
                    'dnf' => $isDnf,
                    'timestamp' => round(microtime(true) * 1000)
                ];
            }

            // اگر مسابقه پلکانی نباشد، جمع نمرات داوران بلافاصله در امتیاز تیم می‌نشیند
            if (!$isTiered) {
                $stageSumFromJudges = 0;
                $hasJudges = false;
                foreach ($team['judgeStageScores'][$stageId] as $jk => $entry) {
                    $sVal = is_array($entry) ? floatval($entry['score'] ?? 0) : floatval($entry);
                    $stageSumFromJudges += $sVal;
                    $hasJudges = true;
                }

                if (!isset($team['stageScores']) || !is_array($team['stageScores'])) {
                    $team['stageScores'] = [];
                }
                if ($hasJudges) {
                    $team['stageScores'][$stageId] = $stageSumFromJudges;
                } elseif ($actionType === 'delete') {
                    unset($team['stageScores'][$stageId]);
                }

                $totalStageSum = 0;
                foreach ($team['stageScores'] as $s) $totalStageSum += intval($s);
                $logsSum = 0;
                if (isset($team['scoreLogs']) && is_array($team['scoreLogs'])) {
                    foreach ($team['scoreLogs'] as $l) {
                        if (($l['type'] ?? '') !== 'cancelled') $logsSum += intval($l['value'] ?? 0);
                    }
                }
                $team['score'] = $totalStageSum + $logsSum;
            }
        }

        $stmt = $conn->prepare("UPDATE camps SET teams = ? WHERE id = ?");
        $stmt->execute([json_encode($teams), $id]);
        echo json_encode(['success' => true, 'teams' => $teams]);
    } else {
        http_response_code(403);
        echo json_encode(['error' => 'مسابقه قفل است یا یافت نشد']);
    }
    exit;
}

// -------------------------------------------------------------------------
// ۱۵. بستن / بازگشایی مرحله پلکانی و محاسبه امتیازات بر اساس ضریب و قوانین سه‌گانه
// -------------------------------------------------------------------------
if ($action === 'close_tiered' || $action === 'stage/close_tiered') {
    $id = $data['id'] ?? ($_GET['id'] ?? '');
    $stageId = $data['stageId'] ?? '';
    $reopen = !empty($data['reopen']);
    $customLadder = $data['customLadder'] ?? null;
    $customMultiplier = $data['customMultiplier'] ?? null;

    if (!$id || !$stageId) {
        http_response_code(400);
        echo json_encode(['error' => 'شناسه مسابقه یا مرحله الزامی است.']);
        exit;
    }

    $camp = getCampRaw($conn, $id);
    if (!$camp) {
        http_response_code(404);
        echo json_encode(['error' => 'مسابقه یافت نشد.']);
        exit;
    }
    if (!empty($camp['locked'])) {
        http_response_code(403);
        echo json_encode(['error' => 'مسابقه قفل است.']);
        exit;
    }

    $teams = is_string($camp['teams']) ? json_decode($camp['teams'], true) : ($camp['teams'] ?: []);
    $stages = is_string($camp['stages']) ? json_decode($camp['stages'], true) : ($camp['stages'] ?: []);
    $closedStages = is_string($camp['closedStages']) ? json_decode($camp['closedStages'], true) : ($camp['closedStages'] ?: []);
    if (!is_array($closedStages)) $closedStages = [];
    $stageTieredResults = is_string($camp['stageTieredResults']) ? json_decode($camp['stageTieredResults'], true) : ($camp['stageTieredResults'] ?: []);
    if (!is_array($stageTieredResults)) $stageTieredResults = [];

    $stage = null;
    foreach ($stages as &$s) {
        if (($s['id'] ?? '') === $stageId) {
            $stage = &$s;
            break;
        }
    }
    if (!$stage) {
        http_response_code(404);
        echo json_encode(['error' => 'مرحله یافت نشد.']);
        exit;
    }

    if ($reopen) {
        unset($closedStages[$stageId]);
        unset($stageTieredResults[$stageId]);
        foreach ($teams as &$t) {
            if (isset($t['stageScores'][$stageId])) {
                unset($t['stageScores'][$stageId]);
            }
            $totalStageSum = 0;
            if (isset($t['stageScores']) && is_array($t['stageScores'])) {
                foreach ($t['stageScores'] as $sc) $totalStageSum += intval($sc);
            }
            $logsSum = 0;
            if (isset($t['scoreLogs']) && is_array($t['scoreLogs'])) {
                foreach ($t['scoreLogs'] as $l) {
                    if (($l['type'] ?? '') !== 'cancelled') $logsSum += intval($l['value'] ?? 0);
                }
            }
            $t['score'] = $totalStageSum + $logsSum;
        }

        $stmt = $conn->prepare("UPDATE camps SET teams=?, closedStages=?, stageTieredResults=? WHERE id=?");
        $stmt->execute([json_encode($teams), json_encode($closedStages), json_encode($stageTieredResults), $id]);
        echo json_encode(['success' => true, 'reopened' => true, 'teams' => $teams, 'closedStages' => $closedStages]);
        exit;
    }

    // محاسبه جدول پلکانی
    $ladder = $customLadder ?: (is_string($camp['tieredPointsLadder']) ? json_decode($camp['tieredPointsLadder'], true) : ($camp['tieredPointsLadder'] ?: [500, 400, 300, 200, 100]));
    if (is_string($ladder)) {
        $ladder = array_values(array_filter(array_map('intval', explode(',', $ladder))));
    }
    if (empty($ladder)) $ladder = [500, 400, 300, 200, 100];

    $unit = $stage['unit'] ?? 'points';
    $timeOrder = $stage['timeOrder'] ?? ($unit === 'time_desc' ? 'desc' : 'asc');
    $isTime = ($unit === 'time' || $unit === 'time_asc' || $unit === 'time_desc');

    // قانون ۱: در آیتم‌های زمانی اولین داوری که زمان معتبر ثبت کرده ملاک است
    // قانون ۳: اگر دکمه - فشرده شده (عدم اتمام مرحله DNF)، امتیاز آن تیم ۰ در نظر گرفته می‌شود
    $teamData = [];
    foreach ($teams as $t) {
        $jMap = $t['judgeStageScores'][$stageId] ?? [];
        $entries = is_array($jMap) ? array_values($jMap) : [];

        $isDnf = false;
        $hasRecord = false;
        $rawValue = 0;

        if (!empty($entries)) {
            foreach ($entries as $e) {
                if (!empty($e['dnf']) || ($e['score'] ?? '') === '-' || strtolower((string)($e['score'] ?? '')) === 'dnf') {
                    $isDnf = true;
                    break;
                }
            }

            if (!$isDnf) {
                if ($isTime) {
                    $validTimes = [];
                    foreach ($entries as $e) {
                        if (is_numeric($e['score'] ?? '')) $validTimes[] = floatval($e['score']);
                    }
                    if (!empty($validTimes)) {
                        $hasRecord = true;
                        $rawValue = $validTimes[0]; // اولین داور ثبت کننده
                    } else {
                        $isDnf = true;
                    }
                } else {
                    $sum = 0;
                    $anyNum = false;
                    foreach ($entries as $e) {
                        if (is_numeric($e['score'] ?? '')) {
                            $sum += floatval($e['score']);
                            $anyNum = true;
                        }
                    }
                    if ($anyNum) {
                        $hasRecord = true;
                        $rawValue = $sum;
                    }
                }
            }
        } else {
            if ($isTime) $isDnf = true;
        }

        $teamData[] = [
            'teamId' => $t['id'],
            'teamName' => $t['name'],
            'teamColor' => $t['color'] ?? '#fff',
            'isDnf' => $isDnf,
            'hasRecord' => $hasRecord,
            'rawValue' => $rawValue,
            'rank' => null,
            'assignedScore' => 0
        ];
    }

    $completedTeams = [];
    $dnfTeams = [];
    foreach ($teamData as $td) {
        if (!$td['isDnf'] && $td['hasRecord']) {
            $completedTeams[] = $td;
        } else {
            $dnfTeams[] = $td;
        }
    }

    // مرتب‌سازی تیم‌های تکمیل کرده
    usort($completedTeams, function($a, $b) use ($isTime, $timeOrder) {
        if ($isTime && $timeOrder === 'asc') {
            return $a['rawValue'] <=> $b['rawValue']; // سرعت: زمان کمتر برتر است
        } else {
            return $b['rawValue'] <=> $a['rawValue']; // امتیاز یا استقامت: بیشتر برتر است
        }
    });

    if ($customMultiplier !== null && is_numeric($customMultiplier) && floatval($customMultiplier) > 0) {
        $stage['multiplier'] = floatval($customMultiplier);
    }
    $stageMultiplier = (isset($stage['multiplier']) && is_numeric($stage['multiplier']) && floatval($stage['multiplier']) > 0) ? floatval($stage['multiplier']) : 1;

    // قانون ۲: رده‌بندی فشرده (Dense Ranking)
    // اگر دو تیم امتیاز یا زمان مساوی داشتند، هر دو رتبه مساوی می‌گیرند و تیم بعدی رتبه بعدی است
    $denseRank = 1;
    $compCount = count($completedTeams);
    for ($i = 0; $i < $compCount; $i++) {
        if ($i > 0 && $completedTeams[$i]['rawValue'] == $completedTeams[$i - 1]['rawValue']) {
            $completedTeams[$i]['rank'] = $completedTeams[$i - 1]['rank'];
        } else {
            if ($i > 0) $denseRank++;
            $completedTeams[$i]['rank'] = $denseRank;
        }
        $rankIndex = $completedTeams[$i]['rank'] - 1;
        $baseTieredScore = ($rankIndex >= 0 && $rankIndex < count($ladder)) ? intval($ladder[$rankIndex]) : 0;
        $completedTeams[$i]['baseScore'] = $baseTieredScore;
        $completedTeams[$i]['multiplier'] = $stageMultiplier;
        $completedTeams[$i]['assignedScore'] = (int)round($baseTieredScore * $stageMultiplier);
    }

    // قانون ۳: تیم‌های دارای عدم اتمام (DNF) امتیازشان ۰ است
    foreach ($dnfTeams as &$td) {
        $td['rank'] = '-';
        $td['baseScore'] = 0;
        $td['multiplier'] = $stageMultiplier;
        $td['assignedScore'] = 0;
    }

    $allResults = array_merge($completedTeams, $dnfTeams);
    $assignedScoreMap = [];
    foreach ($allResults as $r) {
        $assignedScoreMap[$r['teamId']] = $r['assignedScore'];
    }

    // اعمال امتیازات در جدول تیم‌ها
    foreach ($teams as &$t) {
        if (!isset($t['stageScores']) || !is_array($t['stageScores'])) {
            $t['stageScores'] = [];
        }
        $t['stageScores'][$stageId] = $assignedScoreMap[$t['id']] ?? 0;

        $totalStageSum = 0;
        foreach ($t['stageScores'] as $sc) $totalStageSum += intval($sc);
        $logsSum = 0;
        if (isset($t['scoreLogs']) && is_array($t['scoreLogs'])) {
            foreach ($t['scoreLogs'] as $l) {
                if (($l['type'] ?? '') !== 'cancelled') $logsSum += intval($l['value'] ?? 0);
            }
        }
        $t['score'] = $totalStageSum + $logsSum;
    }

    $closedStages[$stageId] = true;
    $stageTieredResults[$stageId] = [
        'closedAt' => round(microtime(true) * 1000),
        'ladder' => $ladder,
        'multiplier' => $stageMultiplier,
        'results' => $allResults
    ];

    $stmt = $conn->prepare("UPDATE camps SET teams=?, stages=?, closedStages=?, stageTieredResults=? WHERE id=?");
    $stmt->execute([json_encode($teams), json_encode($stages), json_encode($closedStages), json_encode($stageTieredResults), $id]);

    echo json_encode([
        'success' => true,
        'closed' => true,
        'stageId' => $stageId,
        'ladder' => $ladder,
        'multiplier' => $stageMultiplier,
        'results' => $allResults,
        'teams' => $teams,
        'stages' => $stages,
        'closedStages' => $closedStages
    ]);
    exit;
}

// -------------------------------------------------------------------------
// ۱۶. آپلود / تغییر عکس پروفایل داور
// -------------------------------------------------------------------------
if ($action === 'user_profile_pic' || $action === 'user/profile-pic') {
    $campId = $data['campId'] ?? ($_GET['id'] ?? '');
    $username = $data['username'] ?? '';
    $profilePic = $data['profilePic'] ?? '';

    if (!$campId || !$username) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'شناسه مسابقه و نام کاربری الزامی است.']);
        exit;
    }

    $camp = getCampRaw($conn, $campId);
    if ($camp) {
        $users = is_string($camp['users']) ? json_decode($camp['users'], true) : ($camp['users'] ?: []);
        $found = false;
        foreach ($users as &$u) {
            if (($u['username'] ?? '') === $username) {
                $u['profilePic'] = $profilePic;
                $found = true;
                break;
            }
        }
        if ($found) {
            $stmt = $conn->prepare("UPDATE camps SET users = ? WHERE id = ?");
            $stmt->execute([json_encode($users), $campId]);
            echo json_encode(['success' => true, 'profilePic' => $profilePic]);
            exit;
        }
    }
    http_response_code(404);
    echo json_encode(['success' => false, 'message' => 'کاربر یا مسابقه یافت نشد.']);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'درخواست نامعتبر است: action=' . htmlspecialchars($action)]);
?>
