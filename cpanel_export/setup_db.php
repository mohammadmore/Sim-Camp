<?php
/**
 * Asva Studio Simulation Camp - Visual Setup & Database Verifier
 */
require 'db.php';
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>وضعیت پایگاه داده - سیمولیشن کمپ</title>
    <link rel="stylesheet" href="style.css">
    <style>
        body {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
            background: radial-gradient(circle at top, #1e293b, #0f172a);
            color: #f8fafc;
            font-family: system-ui, -apple-system, 'Vazirmatn', sans-serif;
        }
        .setup-card {
            background: rgba(30, 41, 59, 0.7);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 20px;
            padding: 35px;
            max-width: 580px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
        }
        .badge-success {
            background: rgba(16, 185, 129, 0.2);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.4);
            padding: 6px 14px;
            border-radius: 30px;
            font-size: 14px;
            font-weight: bold;
            display: inline-block;
            margin-bottom: 20px;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            margin-bottom: 10px;
            font-size: 14px;
        }
        .btn-link {
            display: inline-block;
            background: linear-gradient(135deg, #3b82f6, #2563eb);
            color: #fff;
            padding: 12px 24px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: bold;
            font-size: 15px;
            margin: 8px 4px;
            transition: transform 0.2s, box-shadow 0.2s;
            box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
        }
        .btn-link:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
        }
        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: #f8fafc;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: none;
        }
    </style>
</head>
<body>
    <div class="setup-card">
        <div class="badge-success">✓ پایگاه داده با موفقیت آماده و همگام‌سازی شد</div>
        <h2 style="margin-top: 0; margin-bottom: 12px; font-size: 24px;">سامانه سیمولیشن کمپ آماده بهره‌برداری است</h2>
        <p style="opacity: 0.8; font-size: 14px; line-height: 1.6; margin-bottom: 25px;">
            جداول دیتابیس با آخرین ساختار سامانه، شامل سیستم داوری میدانی، رده‌بندی پلکانی، کاربران چندسطحی و ضرایب مراحل ایجاد و به‌روزرسانی شدند.
        </p>

        <div class="info-row">
            <span>درایور فعال دیتابیس:</span>
            <strong style="color: #38bdf8;"><?php echo strtoupper($active_driver); ?> (<?php echo $active_driver === 'mysql' ? 'MySQL سی‌پنل' : 'فایل SQLite محلی خودکار'; ?>)</strong>
        </div>

        <div class="info-row">
            <span>رمز عبور پیش‌فرض سوپرادمین:</span>
            <strong style="color: #fbbf24; direction: ltr;"><?php echo htmlspecialchars($superadmin_pass); ?></strong>
        </div>

        <div style="margin-top: 30px;">
            <a href="superadmin.html" class="btn-link">ورود به پنل سوپرادمین</a>
            <a href="operator.html" class="btn-link btn-secondary">ورود به پنل اپراتور و داوران</a>
        </div>
    </div>
</body>
</html>
