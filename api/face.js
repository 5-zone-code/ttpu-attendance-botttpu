import { handler, requireStudent, send, fail, body } from '../lib/http.js';
import { db } from '../lib/db.js';
import { config } from '../lib/config.js';
import { buildEnrollment, verifyAgainst } from '../lib/face.js';
import { makeFaceToken } from '../lib/tokens.js';

// POST { mode: 'enroll' | 'verify', samples: number[128][] }
export default handler(async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'method');
  const ctx = await requireStudent(req, res);
  if (!ctx) return;
  const { user } = ctx;
  const { mode, samples } = body(req);
  const enrolled = Array.isArray(user.face_descriptor) && user.face_descriptor.length === 128;

  if (mode === 'enroll') {
    // Yuz faqat BIR MARTA saqlanadi. Qayta ro'yxatdan o'tkazish faqat admin orqali (SQL).
    if (enrolled) return fail(res, 409, 'already_enrolled');
    const r = buildEnrollment(samples);
    if (!r.ok) return fail(res, 400, r.reason);
    const { error } = await db()
      .from('bot_users')
      .update({ face_descriptor: r.descriptor, face_enrolled_at: new Date().toISOString() })
      .eq('telegram_id', user.telegram_id)
      .is('face_descriptor', null); // poyga holatidan himoya
    if (error) throw error;
    await logFace(user.telegram_id, 'enroll', true, null);
    return send(res, 200, { ok: true, faceToken: makeFaceToken(user.telegram_id), ttl: config.faceTokenTtlSec });
  }

  if (mode === 'verify') {
    if (!enrolled) return fail(res, 409, 'not_enrolled');
    const r = verifyAgainst(user.face_descriptor, samples, config.faceThreshold);
    await logFace(user.telegram_id, 'verify', r.ok, r.distance ?? null);
    if (!r.ok) return fail(res, 403, r.reason || 'face_mismatch', { distance: r.distance });
    return send(res, 200, { ok: true, faceToken: makeFaceToken(user.telegram_id), ttl: config.faceTokenTtlSec });
  }

  return fail(res, 400, 'bad_mode');
});

async function logFace(telegramId, kind, ok, distance) {
  try {
    await db().from('face_logs').insert({ telegram_id: telegramId, kind, ok, distance });
  } catch (e) {
    console.error('face log', e);
  }
}
