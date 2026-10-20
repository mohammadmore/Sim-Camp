<?php
/**
 * Asva Studio Simulation Camp - Database Connection (cPanel / Shared Host Edition)
 * پشتیبانی هوشمند از هر دو دیتابیس MySQL سی‌پنل و SQLite محلی خودکار
 */

// =========================================================================
// ۱. مشخصات اتصال به MySQL سی‌پنل (در صورت تمایل به استفاده از MySQL):
// =========================================================================
$servername = "localhost";
$username   = "asvashop_admin";     // نام کاربری دیتابیس در cPanel
$password   = "your_password_here"; // رمز عبور دیتابیس در cPanel
$dbname     = "asvashop_simul";     // نام دیتابیس در cPanel

// رمز عبور پیش‌فرض سوپرادمین (در پنل تنظیمات نیز قابل تغییر است):
$superadmin_pass = "admin123";

// حالت درایور دیتابیس:
// 'auto'   : ابتدا تلاش برای اتصال به MySQL؛ در صورت عدم اتصال خودکار از SQLite محلی استفاده می‌کند (کمترین زحمت ممکن - بدون نیاز به ساخت دیتابیس!)
// 'mysql'  : اجبار به استفاده از MySQL
// 'sqlite' : استفاده مستقیم از فایل دیتابیس محلی بدون نیاز به MySQL
$db_driver = "auto";

$conn = null;
$active_driver = null;

// تلاش برای اتصال به MySQL
if ($db_driver === 'mysql' || $db_driver === 'auto') {
    $can_try_mysql = ($db_driver === 'mysql') || ($password !== "your_password_here" && !empty($dbname));
    if ($can_try_mysql) {
        try {
            $conn = new PDO("mysql:host=$servername;dbname=$dbname;charset=utf8mb4", $username, $password, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
            ]);
            $active_driver = 'mysql';
        } catch(PDOException $e) {
            if ($db_driver === 'mysql') {
                http_response_code(500);
                die(json_encode(["error" => "خطا در اتصال به MySQL: " . $e->getMessage()]));
            }
        }
    }
}

// در صورت عدم اتصال به MySQL، استفاده از SQLite محلی (کمترین دردسر ممکن روی سی‌پنل)
if (!$conn) {
    $db_dir = __DIR__ . '/data';
    if (!is_dir($db_dir)) {
        @mkdir($db_dir, 0755, true);
    }
    $sqlite_file = $db_dir . '/simul_camp.sqlite';
    try {
        $conn = new PDO("sqlite:" . $sqlite_file, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]);
        $active_driver = 'sqlite';
    } catch(PDOException $e) {
        http_response_code(500);
        die(json_encode(["error" => "خطا در راه‌اندازی دیتابیس محلی SQLite: " . $e->getMessage()]));
    }
}

// راه‌اندازی و بررسی خودکار ساختار جداول
function ensure_database_schema($conn, $active_driver) {
    static $schema_checked = false;
    if ($schema_checked) return;

    try {
        if ($active_driver === 'mysql') {
            $conn->exec("CREATE TABLE IF NOT EXISTS camps (
                id VARCHAR(50) PRIMARY KEY,
                orgName TEXT,
                password TEXT,
                title TEXT,
                logo LONGTEXT,
                locked TINYINT DEFAULT 0,
                archived TINYINT DEFAULT 0,
                numLang VARCHAR(10) DEFAULT 'fa',
                dir VARCHAR(10) DEFAULT 'rtl',
                teams LONGTEXT,
                stages LONGTEXT,
                users LONGTEXT,
                campType VARCHAR(20) DEFAULT 'simple',
                tieredPointsLadder TEXT,
                closedStages LONGTEXT,
                stageTieredResults LONGTEXT,
                fieldJudgingMode VARCHAR(20) DEFAULT 'free',
                fieldJudgingValues TEXT,
                positiveTags TEXT,
                negativeTags TEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;");

            $conn->exec("CREATE TABLE IF NOT EXISTS settings (
                `key` VARCHAR(50) PRIMARY KEY,
                value LONGTEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;");

            // ارتقاء خودکار ستون‌های اضافه شده
            $columns_to_check = [
                'users' => 'LONGTEXT',
                'campType' => "VARCHAR(20) DEFAULT 'simple'",
                'tieredPointsLadder' => 'TEXT',
                'closedStages' => 'LONGTEXT',
                'stageTieredResults' => 'LONGTEXT',
                'fieldJudgingMode' => "VARCHAR(20) DEFAULT 'free'",
                'fieldJudgingValues' => 'TEXT',
                'positiveTags' => 'TEXT',
                'negativeTags' => 'TEXT',
                'archived' => 'TINYINT DEFAULT 0'
            ];
            foreach ($columns_to_check as $col => $type) {
                try {
                    $conn->exec("ALTER TABLE camps ADD COLUMN $col $type");
                } catch (Exception $ex) {
                    // ستون از قبل وجود دارد
                }
            }
        } else {
            // ساختار SQLite
            $conn->exec("CREATE TABLE IF NOT EXISTS camps (
                id TEXT PRIMARY KEY,
                orgName TEXT,
                password TEXT,
                title TEXT,
                logo TEXT,
                locked INTEGER DEFAULT 0,
                archived INTEGER DEFAULT 0,
                numLang TEXT DEFAULT 'fa',
                dir TEXT DEFAULT 'rtl',
                teams TEXT,
                stages TEXT,
                users TEXT,
                campType TEXT DEFAULT 'simple',
                tieredPointsLadder TEXT,
                closedStages TEXT,
                stageTieredResults TEXT,
                fieldJudgingMode TEXT DEFAULT 'free',
                fieldJudgingValues TEXT,
                positiveTags TEXT,
                negativeTags TEXT
            );");

            $conn->exec("CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );");

            $sqlite_cols = [
                'users' => 'TEXT',
                'campType' => "TEXT DEFAULT 'simple'",
                'tieredPointsLadder' => 'TEXT',
                'closedStages' => 'TEXT',
                'stageTieredResults' => 'TEXT',
                'fieldJudgingMode' => "TEXT DEFAULT 'free'",
                'fieldJudgingValues' => 'TEXT',
                'positiveTags' => 'TEXT',
                'negativeTags' => 'TEXT',
                'archived' => 'INTEGER DEFAULT 0'
            ];
            foreach ($sqlite_cols as $col => $type) {
                try {
                    $conn->exec("ALTER TABLE camps ADD COLUMN $col $type");
                } catch (Exception $ex) {
                    // ستون از قبل وجود دارد
                }
            }
        }
    } catch (Exception $e) {
        // نادیده گرفتن خطاهای احتمالی ارتقاء
    }
    $schema_checked = true;
}

ensure_database_schema($conn, $active_driver);
?>
