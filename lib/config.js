// Barcha sozlamalar Vercel Environment Variables orqali beriladi.
// Hech qanday maxfiy kalit kod ichida saqlanmaydi.

const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  // QR va Face tokenlarini imzolash uchun (kamida 32 belgi)
  appSecret: process.env.APP_SECRET || '',
  // admin.html (vaqtinchalik o'qituvchi paneli) uchun parol
  adminKey: process.env.ADMIN_KEY || '',
  // Mini App manzili, masalan https://ttpu-attendance.vercel.app
  webAppUrl: (process.env.WEBAPP_URL || '').replace(/\/$/, ''),

  // TTPU hududi (OpenStreetMap: kampus markazi). Kerak bo'lsa env orqali aniqlashtiring.
  campusLat: num(process.env.CAMPUS_LAT, 41.35202),
  campusLon: num(process.env.CAMPUS_LON, 69.22210),
  campusRadiusM: num(process.env.CAMPUS_RADIUS_M, 300),
  // GPS aniqligi bundan yomon bo'lsa, joylashuv qabul qilinmaydi
  maxGpsAccuracyM: num(process.env.MAX_GPS_ACCURACY_M, 150),

  // Face ID: face-api.js descriptorlari orasidagi Evklid masofasi chegarasi
  faceThreshold: num(process.env.FACE_THRESHOLD, 0.5),
  faceTokenTtlSec: num(process.env.FACE_TOKEN_TTL_SEC, 15 * 60),

  // QR ustoz ekranida har 30 soniyada yangilanadi; token 45 soniya amal qiladi
  // (skanerlash + joylashuvni aniqlash uchun zaxira vaqt)
  qrRefreshSec: num(process.env.QR_REFRESH_SEC, 30),
  qrTtlSec: num(process.env.QR_TTL_SEC, 45),
  sessionDefaultMin: num(process.env.SESSION_DEFAULT_MIN, 90),

  // Ega (owner) — faqat u admin qo'sha oladi
  ownerId: String(process.env.OWNER_ID || '7317966615'),
  tasksBucket: process.env.TASKS_BUCKET || 'tasks',
  maxTaskFileMb: num(process.env.MAX_TASK_FILE_MB, 20),

  edupageBase: process.env.EDUPAGE_BASE || 'https://ttpu.edupage.org',
  defaultGroup: process.env.DEFAULT_GROUP || 'CYB3-26',
  timezone: 'Asia/Tashkent',
};

export function assertConfig(keys) {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) {
    const err = new Error('Server sozlanmagan: ' + missing.join(', '));
    err.status = 500;
    throw err;
  }
}
