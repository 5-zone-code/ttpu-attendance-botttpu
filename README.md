# TTPU Attendance Bot — v4 (O'quvchi / Starosta / Ustoz / Admin / Ega + o'zi ro'yxatdan o'tish)

Bitta Telegram bot, 3 ta sahifa. Bot foydalanuvchining roliga qarab o'z sahifasini ochadi.

| Rol | Sahifa | Kirish | Nima qila oladi |
|---|---|---|---|
| O'quvchi | `/` | Face ID + (yoqilgan bo'lsa) TTPU joylashuvi | QR skan, jadval, **Vazifalar**, statistika |
| Starosta | `/` | O'quvchi bilan bir xil | O'quvchining hammasi + **Sinf davomati**: har bir darsda kim kelgan/kelmagan, sinf ro'yxati va har bir o'quvchi foizi |
| Ustoz | `/teacher.html` | Faqat Telegram ID | QR yaratish (soni + muddati), qo'lda davomat, o'z dars jadvali, vazifa yuklash/yakunlash |
| Admin | `/admin.html` | Faqat Telegram ID | Guruh ochish (EduPage dan), o'quvchi/ustoz qo'shish-o'chirish, **starosta tayinlash**, Face ID ni qayta o'rnatish, joylashuv tekshiruvini yoqish/o'chirish |
| Ega (`7317966615`) | `/admin.html` | Faqat Telegram ID | Admin bilan bir xil + **admin qo'shish/o'chirish** |
| Ro'yxatda yo'q odam | `/` | Telegram ID avtomatik | **Ism-familiya + guruh** yuboradi → admin tasdiqlaydi → o'quvchi bo'ladi (v4) |

## Yangilash (3 qadam)

1. **Supabase → SQL Editor** → **Run**: `migration_v4.sql`. (Yangi o'rnatishda: `schema.sql` → `migration_v2.sql` → `migration_v3.sql` → `migration_v4.sql`.)
2. **GitHub** → reponi oching → **Add file → Upload files** → shu papkadagi hamma narsani (`.env` dan tashqari) sudrab tashlang → **Commit**. Papkalar (`api/`, `lib/`, `public/`...) papka bo'lib tushganini tekshiring. Vercel o'zi qayta deploy qiladi.
3. Brauzerda **albatta qayta**: `https://<domen>.vercel.app/api/setup?key=<ADMIN_KEY>` → `"migration_v4": "ok"`. Bu adminlar "✅ Tasdiqlash" tugmasini bosganda bot javob berishi uchun kerak (webhook `callback_query` ni ham oladi).

## Mahalliy ishga tushirish (o'z kompyuteringizda, Vercel'siz)

Bir xil kod, faqat server sizning kompyuteringizda. Baza (Supabase) o'z joyida qoladi.

**Bir martalik tayyorgarlik (Windows):**
1. Node.js LTS: https://nodejs.org
2. PowerShell'da: `winget install --id Cloudflare.cloudflared` (bepul, hisob ochish shart emas)
3. Loyiha papkasida `.env.example` ni nusxalab `.env` qiling va to'ldiring: `BOT_TOKEN`, `SUPABASE_URL` (`https://xxxx.supabase.co`), `SUPABASE_SERVICE_ROLE_KEY`, `APP_SECRET`, `ADMIN_KEY`. `WEBAPP_URL` ga tegmang, u o'zi almashadi.

**Ishga tushirish:** `start-local.bat` ni ikki marta bosing (yoki `npm install`, keyin `npm run local`).
Dastur HTTPS tunnel ochadi, webhook va menyu tugmasini o'zi sozlaydi va oxirida "✅ Bot mahalliy ishga tushdi" deb baza holatini ko'rsatadi. Xatolar shu oynada chiqadi.

**Bilib qo'ying:**
- HTTPS shart: Telegram Mini App, kamera (Face ID) va joylashuv oddiy `http://192.168...` manzilda ishlamaydi, shuning uchun tunnel kerak.
- Kompyuter yoqilgan, internetda va uxlamagan bo'lishi kerak, aks holda bot ishlamaydi. (Windows: Sozlamalar → Quvvat → "Uxlash" ni "Hech qachon" qiling.)
- Tunnel manzili **har ishga tushirishda o'zgaradi**: undan keyin foydalanuvchilar botga `/start` ni qayta yozishi kerak (eski tugmalar eski manzilga olib boradi). Doimiy manzil kerak bo'lsa, o'zingizning tunnelingizni ochib `.env` ga `LOCAL_URL=https://...` yozing.
- Webhook bittagina bo'ladi: mahalliy ishga tushirsangiz Vercel'dagi bot to'xtaydi. Vercel'ga qaytish uchun `https://<vercel-domen>/api/setup?key=<ADMIN_KEY>` ni oching.

## O'zi ro'yxatdan o'tish (v4)

1. Ro'yxatda yo'q odam botga `/start` yozadi → "📝 Ro'yxatdan o'tish" tugmasi.
2. Ilovada: ism-familiya (kamida 2 so'z, faqat harflar) + guruh (faqat admin ochgan guruhlar). Telegram ID avtomatik olinadi.
3. Ega va barcha adminlarga botda xabar keladi: **✅ Tasdiqlash / ❌ Rad etish**. Admin panelida ham "Yangi arizalar" bo'limi bor.
4. Tasdiqlansa — o'quvchiga xabar keladi, ilova ochiladi va birinchi kirishda Face ID saqlanadi (eski tartib).

**Rejimlar** (Admin → Bosh sahifa yoki Sozlamalar → "O'quvchilar ro'yxatdan o'tishi"):

| Rejim | Nima bo'ladi |
|---|---|
| Admin tasdiqlaydi (standart) | Ariza → admin tasdiqlaydi |
| Avtomatik | Darhol o'quvchi bo'ladi. **Tekshiruv yo'q** — istalgan odam o'zini istalgan guruhga, istalgan ism bilan qo'sha oladi |
| O'chirilgan | Eski tartib: faqat admin qo'shadi |

Rad etilgan yoki admin o'chirgan o'quvchi o'zi qayta ariza bera olmaydi — kerak bo'lsa admin qo'lda qo'shadi.

**Starosta tayinlash:** Admin → Guruhlar → guruh → o'quvchini bosing → "Starosta qilish". O'quvchi ilovani qayta ochganda tepada ⭐ Starosta va "Sinf davomati" bo'limi paydo bo'ladi.

Keyin Ega botga `/start` yozadi → "🛠 Admin paneli".

## Ishlash tartibi

**Ustoz qo'shish:** Admin → "+" → Ustoz qo'shish → EduPage dan ustozni tanlaydi (ism avtomatik) → fanlarini belgilaydi (faqat EduPage da shu ustozga biriktirilgan fanlar) → Telegram ID. Ustoz jadvali shu EduPage ustozi + fanlar bo'yicha avtomatik chiqadi.

**Guruh ochish:** faqat shu haftadagi EduPage jadvalida bor guruhlar. Ustoz faqat tizimda ochilgan va o'zi dars beradigan guruhlarni ko'radi.

**QR:** ustoz guruh → o'quvchilar soni → muddat (1–15 daq) tanlaydi. QR har 30 soniyada yangilanadi (token 45 soniya amal qiladi). Belgilangan son to'lsa yoki muddat tugasa — avtomatik yopiladi (bazada atomik, bir vaqtda 35 kishi skanerlasa ham ortiqcha o'tmaydi).

**Vazifa fayllari:** Supabase Storage dagi yopiq `tasks` bucket (20 MB gacha). Fayl Vercel orqali emas, to'g'ridan-to'g'ri Supabase ga yuklanadi; o'quvchi 1 soatlik vaqtinchalik havola bilan ochadi.

## Env (Vercel)

`BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (yoki yangi `sb_secret_...`), `APP_SECRET`, `ADMIN_KEY`, `WEBAPP_URL`.
Ixtiyoriy: `OWNER_ID` (standart 7317966615), `CAMPUS_LAT/LON/RADIUS_M`, `MAX_GPS_ACCURACY_M`, `FACE_THRESHOLD`, `QR_REFRESH_SEC`, `QR_TTL_SEC`.

## Tuzilma

```
local/      mahalliy server (npm run local) + start-local.bat
api/        10 ta funksiya (Vercel Hobby limiti 12)
  bot, setup, me, face, attend, stats, timetable, tasks, teacher, admin
lib/        config, db, edupage, face, geo, http, registration, teacher, telegram, tokens
public/     app.css + app.js (umumiy), index.html (o'quvchi), teacher.html, admin.html
supabase/   schema.sql (v1), migration_v2.sql, migration_v3.sql (starosta), migration_v4.sql (ro'yxatdan o'tish)
test/       npm test
```

## Cheklovlar (halol)

- Face ID da liveness yo'q — suratni kameraga ko'rsatib aldash mumkin.
- Android "Fake GPS" ni aniqlab bo'lmaydi. Admin joylashuvni o'chirsa, QR skrinshotini 45 soniya ichida uydagi do'stga yuborish ishlaydi.
- Ustoz va admin kirishi faqat Telegram hisobiga bog'liq: telefon qo'lga tushsa, panel ham ochiq.
- Foydalanuvchini o'chirish uning davomat tarixini ham o'chiradi.
- O'zi ro'yxatdan o'tishda ism va guruhni hech kim avtomatik tekshirmaydi — himoya faqat admin tasdig'i. Adminga arizada Telegram @username va Telegramdagi ismi ham ko'rsatiladi, shu bilan solishtiring.

## Cloudflare Workers'da ishga tushirish

`wrangler.jsonc` + `cloudflare/worker.js` tayyor (kod Vercel'dagi bilan bir xil, faqat ko'prik qo'shilgan).
1. GitHub'ga yuklang (Worker nomi `wrangler.jsonc` dagi `name` bilan bir xil bo'lishi kerak: `ttpu-attendance-botttpu`).
2. Cloudflare → Worker → Settings → **Variables and secrets**: `BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_SECRET`, `ADMIN_KEY`, `OWNER_ID` (Secret turida). `WEBAPP_URL` kerak emas — manzil avtomatik aniqlanadi.
3. Deploy tugagach `https://<worker>.<akkaunt>.workers.dev/api/setup?key=<ADMIN_KEY>` ni oching (webhook o'rnatiladi).
