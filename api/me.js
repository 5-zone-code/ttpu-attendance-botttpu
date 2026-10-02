import { handler, authTelegram, send, fail, body, HttpError } from '../lib/http.js';
import { config } from '../lib/config.js';
import { getSettings, getUser } from '../lib/db.js';
import { regInfo, submitRegistration } from '../lib/registration.js';

// GET  /api/me  — kim ekani va qaysi sahifa kerakligi.
//                 Ro'yxatda yo'q bo'lsa: 403 not_allowed + { reg } (ro'yxatdan o'tish holati va guruhlar).
// POST /api/me  {action:'register', name, group} — o'quvchining o'zi ro'yxatdan o'tishi.
export default handler(async (req, res) => {
  const auth = authTelegram(req);
  if (!auth) return fail(res, 401, 'unauthorized');
  const user = await getUser(auth.user.id, auth.user);

  if (req.method === 'POST') {
    const b = body(req);
    if (b.action !== 'register') throw new HttpError(400, 'bad_action');
    if (user) throw new HttpError(409, 'already_registered');
    const r = await submitRegistration(auth.user, b);
    return send(res, 200, { ok: true, ...r });
  }
  if (req.method !== 'GET') return fail(res, 405, 'method');

  if (!user) return fail(res, 403, 'not_allowed', { reg: await regInfo(auth.user.id) });

  const settings = await getSettings();
  const out = {
    ok: true,
    user: {
      id: String(user.telegram_id),
      name: user.full_name,
      role: user.role,
      group: user.group_code || null,
      subjects: user.subjects || [],
      faceEnrolled: Array.isArray(user.face_descriptor) && user.face_descriptor.length === 128,
      starosta: user.role === 'student' && !!user.is_starosta,
    },
    page: user.role === 'student' ? '/' : user.role === 'teacher' ? '/teacher.html' : '/admin.html',
  };
  if (user.role === 'student') {
    // Faqat oldindan ogohlantirish uchun; yakuniy tekshiruv serverda.
    out.campus = {
      enabled: settings.geofence_enabled !== false,
      lat: config.campusLat,
      lon: config.campusLon,
      radius: config.campusRadiusM,
      maxAccuracy: config.maxGpsAccuracyM,
    };
  }
  send(res, 200, out);
});
