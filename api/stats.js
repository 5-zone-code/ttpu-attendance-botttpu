// O'quvchi statistikasi + Starosta uchun guruh davomati
//   GET /api/stats                          -> o'zining statistikasi
//   GET /api/stats?view=class               -> (starosta) sinf ro'yxati va so'nggi darslar
//   GET /api/stats?view=session&id=<uuid>   -> (starosta) shu darsga kim keldi / kelmadi
import { handler, requireStudent, send, fail, HttpError } from '../lib/http.js';
import { db } from '../lib/db.js';

const UUID = /^[0-9a-f-]{36}$/i;

export default handler(async (req, res) => {
  if (req.method !== 'GET') return fail(res, 405, 'method');
  const ctx = await requireStudent(req, res);
  if (!ctx) return;
  const { user } = ctx;
  const view = req.query?.view;

  if (view === 'class' || view === 'session') {
    if (!user.is_starosta) return fail(res, 403, 'starosta_only');
    return view === 'class' ? classView(res, user) : sessionView(res, user, req.query.id);
  }

  const nowIso = new Date().toISOString();
  const [{ count: total, error: e1 }, { data: records, error: e2 }] = await Promise.all([
    db()
      .from('lesson_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('group_code', user.group_code)
      .lte('started_at', nowIso),
    db()
      .from('attendance_records')
      .select('marked_at, lesson_sessions(subject)')
      .eq('telegram_id', user.telegram_id)
      .order('marked_at', { ascending: false })
      .limit(50),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const attended = records.length >= 50 ? await countAll(user.telegram_id) : records.length;
  const totalN = Math.max(total || 0, attended);
  const missed = Math.max(0, totalN - attended);
  const rate = totalN ? Math.round((attended / totalN) * 100) : 0;

  send(res, 200, {
    ok: true,
    attended,
    missed,
    total: totalN,
    rate,
    recent: records.slice(0, 10).map((r) => ({ at: r.marked_at, subject: r.lesson_sessions?.subject || '' })),
  });
});

async function countAll(telegramId) {
  const { count, error } = await db()
    .from('attendance_records')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId);
  if (error) throw error;
  return count || 0;
}

async function classView(res, user) {
  const { data, error } = await db().rpc('group_overview', { p_group: user.group_code, p_limit: 40 });
  if (error) throw error;
  const total = Number(data?.total) || 0;
  const count = (data?.students || []).length;
  send(res, 200, {
    ok: true,
    group: user.group_code,
    total,
    students: (data?.students || []).map((s) => {
      const attended = Number(s.attended) || 0;
      return { ...s, attended, missed: Math.max(0, total - attended), rate: total ? Math.round((attended / total) * 100) : 0 };
    }),
    sessions: (data?.sessions || []).map((s) => ({ ...s, present: Number(s.present) || 0, of: count })),
  });
}

async function sessionView(res, user, id) {
  if (!UUID.test(String(id || ''))) throw new HttpError(400, 'bad_session');
  const { data: s, error } = await db()
    .from('lesson_sessions')
    .select('id, group_code, subject, mode, started_at, teacher_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  // Starosta faqat o'z guruhining darslarini ko'radi
  if (!s || s.group_code !== user.group_code) throw new HttpError(404, 'session_not_found');

  const [{ data: students, error: e1 }, { data: recs, error: e2 }] = await Promise.all([
    db().from('bot_users').select('telegram_id, full_name').eq('role', 'student').eq('group_code', user.group_code).order('full_name'),
    db().from('attendance_records').select('telegram_id, method, marked_at').eq('session_id', s.id),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  let teacher = null;
  if (s.teacher_id) {
    const { data: t } = await db().from('bot_users').select('full_name').eq('telegram_id', s.teacher_id).maybeSingle();
    teacher = t?.full_name || null;
  }
  const marks = new Map((recs || []).map((r) => [String(r.telegram_id), r]));
  const present = [];
  const absent = [];
  for (const st of students || []) {
    const m = marks.get(String(st.telegram_id));
    if (m) present.push({ id: String(st.telegram_id), name: st.full_name, at: m.marked_at, method: m.method });
    else absent.push({ id: String(st.telegram_id), name: st.full_name });
  }
  present.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  send(res, 200, {
    ok: true,
    session: { id: s.id, subject: s.subject, mode: s.mode, startedAt: s.started_at, teacher },
    present,
    absent,
  });
}
