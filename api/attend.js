import { handler, requireStudent, send, fail, body } from '../lib/http.js';
import { db, getSettings } from '../lib/db.js';
import { checkFaceToken, checkQrToken } from '../lib/tokens.js';
import { checkCampus } from '../lib/geo.js';

// POST { qr, faceToken, location: { lat, lon, accuracy } }
export default handler(async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'method');
  const ctx = await requireStudent(req, res);
  if (!ctx) return;
  const { user } = ctx;
  const { qr, faceToken, location } = body(req);

  const reject = async (status, reason, extra = {}) => {
    await logAttempt(user.telegram_id, reason, extra.distance ?? null, extra.sessionId ?? null);
    return fail(res, status, reason, extra);
  };

  // 1) Face ID yaqinda tasdiqlanganmi
  if (!checkFaceToken(faceToken, user.telegram_id)) return reject(401, 'face_required');

  // 2) TTPU hududidami (admin o'chirib qo'ygan bo'lishi mumkin)
  const settings = await getSettings();
  const geofence = settings.geofence_enabled !== false;
  let geo = { ok: true, distance: null };
  if (geofence) {
    geo = checkCampus(location);
    if (!geo.ok) return reject(403, geo.reason, { distance: geo.distance, accuracy: geo.accuracy });
  }

  // 3) QR kod haqiqiy va yangi
  const q = checkQrToken(qr);
  if (!q.ok) return reject(400, q.reason, { distance: geo.distance });

  // 4) Sessiya talabaning guruhiga tegishlimi
  const { data: session, error: sErr } = await db()
    .from('lesson_sessions')
    .select('id, group_code, subject')
    .eq('id', q.sessionId)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!session) return reject(404, 'session_not_found', { sessionId: q.sessionId });
  if (session.group_code.toUpperCase() !== String(user.group_code).toUpperCase())
    return reject(403, 'wrong_group', { sessionId: session.id });

  // 5) Atomik yozish: sessiya ochiq, joy bor (o'quvchilar soni chegarasi), takror emas
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const { data: r, error } = await db().rpc('mark_attendance', {
    p_session: session.id,
    p_user: user.telegram_id,
    p_lat: num(location?.lat),
    p_lon: num(location?.lon),
    p_acc: num(location?.accuracy),
    p_dist: geo.distance,
  });
  if (error) throw error;
  if (!r?.ok) return reject(r?.error === 'session_not_found' ? 404 : 400, r?.error || 'server_error', { sessionId: session.id });
  send(res, 200, { ok: true, already: !!r.already, subject: r.subject || session.subject, distance: geo.distance });
});

async function logAttempt(telegramId, reason, distance, sessionId) {
  try {
    await db().from('attendance_attempts').insert({ telegram_id: telegramId, reason, distance_m: distance, session_id: sessionId });
  } catch (e) {
    console.error('attempt log', e);
  }
}
