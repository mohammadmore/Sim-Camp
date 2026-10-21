# Sim-Camp — سامانه امتیازدهی زنده سیمولیشن کمپ

پنل سوپرادمین (ساخت مسابقه)، پنل اپراتور/سرداور/داور (ثبت امتیاز) و تابلوی زنده نتایج.

دو نسخه‌ی بک‌اند با رفتار یکسان وجود دارد:

| نسخه | مسیر | دیتابیس |
|---|---|---|
| Node.js | `server.js` + `public/` | Firebase Firestore (یا `memory` برای تست) |
| PHP (سی‌پنل) | `cpanel_export/` | SQLite خودکار یا MySQL — راهنما: [`cpanel_export/README.md`](cpanel_export/README.md) |

## اجرای نسخه Node

```bash
npm install
cp .env.example .env   # و مقادیر را تنظیم کنید
SUPERADMIN_PASS='یک-رمز-قوی' FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" npm start
```

- **رمز سوپرادمین:** از `SUPERADMIN_PASS` خوانده می‌شود. اگر تنظیم نشده باشد، یک رمز تصادفی ساخته و یک‌بار در لاگ سرور چاپ می‌شود.
- **Firebase:** فایل `firestore.rules` همه‌ی دسترسی‌های مستقیم را می‌بندد؛ سرور با **Firebase Admin SDK** کار می‌کند و به یک Service Account نیاز دارد
  (Firebase Console ← Project settings ← Service accounts ← Generate new private key). محتوای JSON را در `FIREBASE_SERVICE_ACCOUNT` قرار دهید
  یا مسیر فایل را در `GOOGLE_APPLICATION_CREDENTIALS`. سپس rules را منتشر کنید: `firebase deploy --only firestore:rules`.
  بدون Service Account سرور با هشدار به SDK وب برمی‌گردد که فقط با rules باز کار می‌کند (ناامن).
- **تست محلی بدون Firebase:** `DB_ADAPTER=memory SUPERADMIN_PASS=test npm start`

## توسعه

```bash
npm test               # تست‌های API روی هر دو بک‌اند (Node و PHP، در صورت نصب بودن php)
npm run build:cpanel   # ساخت cpanel_export/ از روی public/
```

فرانت‌اند فقط در `public/` ویرایش شود؛ `cpanel_export/*.html` و فایل‌های استاتیک آن خروجی build هستند.

## امنیت و نقش‌ها

- ورود سوپرادمین و کاربران مسابقه یک توکن نشست امضاشده (۱۲ ساعته) می‌دهد که در هدر `X-Auth-Token` ارسال می‌شود؛ رمز عبور در مرورگر ذخیره نمی‌شود.
- رمزها به صورت هش ذخیره می‌شوند (رمزهای متنی قدیمی در اولین ورود موفق هش می‌شوند). تغییر رمز یک کاربر نشست‌های فعلی او را باطل می‌کند.
- **داور:** ثبت امتیاز لحظه‌ای، نمره مرحله با نام خودش، لغو امتیازهای خودش.
- **اپراتور / سرداور:** موارد بالا + تنظیمات مسابقه، اصلاح دستی نمرات و تاریخچه، حذف نمره داوران، بستن/بازگشایی مراحل پلکانی.
- تابلوی زنده و صفحه‌ی ورود فقط داده‌ی عمومی (بدون رمز و فهرست کاربران) دریافت می‌کنند.
