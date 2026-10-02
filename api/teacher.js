// Ustoz API (Face ID va joylashuv talab qilinmaydi — Telegram ID + rol yetarli)
//   GET  ?action=context                         -> guruhlar, hozirgi dars
//   POST ?action=qr-start {group, maxStudents, durationMin, subject?}
//   GET  ?action=live&session=<id>[&qr=1]         -> holat (+ yangi QR token)
//   POST ?action=stop {session}
//   GET  ?action=sheet&group=<code>               -> bugungi oxirgi dars + o'quvchilar ro'yxati
//   POST ?action=sheet-new {group, subject?}      -> qo'lda davomat uchun yangi dars
//   POST ?action=mark {session, student, present}
import { handler, requireRole, send, fail, body, HttpError } from '../lib/http.js';
import { db } from '../lib/db.js';
import { config } from '../lib/config.js';
import { makeQrToken } from '../lib/tokens.js';
import { currentLesson, tashkentDayStartIso } from '../lib/edupage.js';
import { teacherContext, assertGroup, pickSubject } from '../lib/teacher.js';

const UUID = /^[0-9a-f-]{36}$/i;
const DURATIONS = [1, 2, 3, 5, 10, 15];

export default handler(async (req, res) => {
  const ctx = await requireRole(req, res, ['teacher']);
  if (!ctx) return;
  const { user } = ctx;
  const action = req.query?.action;
  const b = req.method === 'POST' ? body(req) : {};

  if (action === 'context') {
    const t = await teacherContext(user);
    const counts = await studentCounts(t.groups.map((g) => g.code));
    const cur = currentLesson(t.lessons);
    return send(res, 200, {
      ok: true,
      linked: !!user.edupage_teacher_id,
      edupageOk: t.edupageOk,
      week: t.week,
      groups: t.groups.map((g) => ({ ...g, students: counts[g.code] || 0 })),
      current: cur,
      durations: DURATIONS,
    });
  }

  if (action === 'qr-start' && req.method === 'POST') {
    const t = await teacherContext(user);
    const g = assertGroup(t, b.group);
    const dur = Number(b.durationMin);
    if (!DURATIONS.includes(dur)) throw new HttpError(400, 'bad_duration');
    const max = Math.floor(Number(b.maxStudents));
    if (!(max >= 1 && max <= 500)) throw new HttpError(400, 'bad_max');
    const subject = pickSubject(t, user, g.code, b.subject);
    const now = new Date();
    const { data, error } = await db()
      .from('lesson_sessions')
      .insert({
        group_code: g.code,
        subject,
        teacher_id: user.telegram_id,
        mode: 'qr',
        max_students: max,
        started_at: now.toISOString(),
        ends_at: new Date(now.getTime() + dur * 60000).toISOString(),
        created_by: 'teacher:' + user.telegram_id,
      })
      .select('id')
      .single();
    if (error) throw error;
    const live = await liveStatus(user, data.id, true);
    return send(res, 200, { ok: true, ...live, refreshSec: config.qrRefreshSec });
  }

  if (action === 'live') {
    const id = String(req.query.session || '');
    if (!UUID.test(id)) throw new HttpError(400, 'bad_session');
    return send(res, 200, { ok: true, ...(await liveStatus(user, id, req.query.qr === '1')) });
  }

  if (action === 'stop' && req.method === 'POST') {
    const s = await ownSession(user, b.session);
    if (!s.closed_at) {
      const { error } = await db().from('lesson_sessions').update({ closed_at: new Date().toISOString() }).eq('id', s.id);
      if (error) throw error;
    }
    return send(res, 200, { ok: true });
  }

  if (action === 'sheet') {
    const t = await teacherContext(user);
    const g = assertGroup(t, req.query.group);
    const { data: s, error } = await db()
      .from('lesson_sessions')
      .select('id, group_code, subject, mode, started_at, ends_at, closed_at, max_students')
      .eq('teacher_id', user.telegram_id)
      .eq('group_code', g.code)
      .gte('started_at', tashkentDayStartIso())
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return send(res, 200, { ok: true, group: g.code, subjects: g.subjects, ...(await sheet(g.code, s)) });
  }

  if (action === 'sheet-new' && req.method === 'POST') {
    const t = await teacherContext(user);
    const g = assertGroup(t, b.group);
    const subject = pickSubject(t, user, g.code, b.subject);
    const now = new Date();
    const { data: s, error } = await db()
      .from('lesson_sessions')
      .insert({
        group_code: g.code,
        subject,
        teacher_id: user.telegram_id,
        mode: 'manual',
        started_at: now.toISOString(),
        ends_at: new Date(now.getTime() + config.sessionDefaultMin * 60000).toISOString(),
        created_by: 'teacher:' + user.telegram_id,
      })
      .select('id, group_code, subject, mode, started_at, ends_at, closed_at, max_students')
      .single();
    if (error) throw error;
    return send(res, 200, { ok: true, group: g.code, subjects: g.subjects, ...(await sheet(g.code, s)) });
  }

  if (action === 'mark' && req.method === 'POST') {
    const s = await ownSession(user, b.session);
    const student = Number(b.student);
    const { data: st, error: e1 } = await db()
      .from('bot_users')
      .select('telegram_id, group_code, role')
      .eq('telegram_id', student)
      .maybeSingle();
    if (e1) throw e1;
    if (!st || st.role !== 'student' || st.group_code !== s.group_code) throw new HttpError(400, 'not_in_group');
    if (b.present) {
      const { error } = await db()
        .from('attendance_records')
        .insert({ session_id: s.id, telegram_id: student, method: 'manual', marked_by: user.telegram_id });
      if (error && error.code !== '23505') throw error;
    } else {
      const { error } = await db().from('attendance_records').delete().eq('session_id', s.id).eq('telegram_id', student);
      if (error) throw error;
    }
    return send(res, 200, { ok: true });
  }

  fail(res, 400, 'bad_action');
});

async function studentCounts(codes) {
  if (!codes.length) return {};
  const { data, error } = await db().from('bot_users').select('group_code').eq('role', 'student').in('group_code', codes);
  if (error) throw error;
  const out = {};
  for (const r of data || []) out[r.group_code] = (out[r.group_code] || 0) + 1;
  return out;
}

async function ownSession(user, id) {
  if (!UUID.test(String(id || ''))) throw new HttpError(400, 'bad_session');
  const { data, error } = await db()
    .from('lesson_sessions')
    .select('id, group_code, subject, mode, started_at, ends_at, closed_at, max_students, teacher_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data || String(data.teacher_id) !== String(user.telegram_id)) throw new HttpError(404, 'session_not_found');
  return data;
}

async function liveStatus(user, id, withQr) {
  const s = await ownSession(user, id);
  const { data: recs, error } = await db()
    .from('attendance_records')
    .select('telegram_id, marked_at, bot_users(full_name)')
    .eq('session_id', s.id)
    .order('marked_at', { ascending: true });
  if (error) throw error;
  const now = Date.now();
  const count = recs.length;
  const closed = !!s.closed_at || now > Date.parse(s.ends_at) || (s.max_students != null && count >= s.max_students);
  return {
    session: { id: s.id, group: s.group_code, subject: s.subject, endsAt: s.ends_at, max: s.max_students },
    count,
    closed,
    remainingSec: closed ? 0 : Math.max(0, Math.round((Date.parse(s.ends_at) - now) / 1000)),
    students: recs.map((r) => ({ name: r.bot_users?.full_name || '?', at: r.marked_at })),
    qr: withQr && !closed ? makeQrToken(s.id) : null,
  };
}

async function sheet(groupCode, s) {
  const { data: students, error } = await db()
    .from('bot_users')
    .select('telegram_id, full_name')
    .eq('role', 'student')
    .eq('group_code', groupCode)
    .order('full_name', { ascending: true });
  if (error) throw error;
  let marks = {};
  if (s) {
    const { data: recs, error: e2 } = await db()
      .from('attendance_records')
      .select('telegram_id, method, marked_at')
      .eq('session_id', s.id);
    if (e2) throw e2;
    for (const r of recs || []) marks[String(r.telegram_id)] = { method: r.method, at: r.marked_at };
  }
  return {
    session: s ? { id: s.id, subject: s.subject, mode: s.mode, startedAt: s.started_at } : null,
    students: students.map((st) => ({
      id: String(st.telegram_id),
      name: st.full_name,
      present: !!marks[String(st.telegram_id)],
      method: marks[String(st.telegram_id)]?.method || null,
      at: marks[String(st.telegram_id)]?.at || null,
    })),
  };
}
