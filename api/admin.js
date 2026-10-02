// Admin va Ega API. Farq: faqat Ega admin qo'sha/o'chira oladi.
//   GET  ?action=overview
//   GET  ?action=edupage                         -> EduPage dagi guruhlar va ustozlar ro'yxati
//   GET  ?action=teacher-subjects&tid=<id>       -> shu ustozning EduPage dagi fanlari
//   GET  ?action=groups | ?action=group&code=
//   POST ?action=group-add {code} | group-delete {code}
//   GET  ?action=users[&role=]
//   POST ?action=user-add {role, id, name, group?, edupageTeacherId?, subjects?}
//   POST ?action=user-delete {id} | face-reset {id}
//   POST ?action=starosta {id, value}            -> o'quvchini starosta qilish / olib tashlash
//   POST ?action=setting {key, value}            -> geofence_enabled (bool), registration_mode (approve|auto|off)
//   GET  ?action=registrations                   -> o'quvchilarning kutilayotgan arizalari
//   POST ?action=reg-decide {id, approve}         -> arizani tasdiqlash / rad etish
import { handler, requireRole, send, fail, body, HttpError, ADMIN_ROLES, cleanText, isTgId } from '../lib/http.js';
import { db, isOwnerId, getSettings, setSetting, groupExists } from '../lib/db.js';
import { getFullTimetable, teacherSubjects, tashkentDayStartIso } from '../lib/edupage.js';
import { REG_MODES, pendingRegistrations, decideRegistration, clearRegistration, blockRegistration } from '../lib/registration.js';

// kalit -> qiymat to'g'riligini tekshiruvchi
const SETTINGS = {
  geofence_enabled: (v) => typeof v === 'boolean',
  registration_mode: (v) => REG_MODES.includes(v),
};

export default handler(async (req, res) => {
  const ctx = await requireRole(req, res, ADMIN_ROLES);
  if (!ctx) return;
  const { user } = ctx;
  const isOwner = user.role === 'owner';
  const action = req.query?.action;
  const b = req.method === 'POST' ? body(req) : {};

  if (action === 'overview') {
    const { data: users, error } = await db().from('bot_users').select('role');
    if (error) throw error;
    const counts = { student: 0, teacher: 0, admin: 0, owner: 0 };
    for (const u of users) counts[u.role] = (counts[u.role] || 0) + 1;
    const [{ count: groups }, { count: sessionsToday }, settings, pending] = await Promise.all([
      db().from('groups').select('code', { count: 'exact', head: true }),
      db().from('lesson_sessions').select('id', { count: 'exact', head: true }).gte('started_at', tashkentDayStartIso()),
      getSettings(true),
      pendingRegistrations(),
    ]);
    if (!REG_MODES.includes(settings.registration_mode)) settings.registration_mode = 'approve';
    return send(res, 200, {
      ok: true, isOwner, counts, groups: groups || 0, sessionsToday: sessionsToday || 0, settings, pendingRegs: pending.length,
    });
  }

  if (action === 'registrations') {
    return send(res, 200, { ok: true, registrations: await pendingRegistrations() });
  }

  if (action === 'reg-decide' && req.method === 'POST') {
    if (!isTgId(b.id) || typeof b.approve !== 'boolean') throw new HttpError(400, 'bad_request');
    const r = await decideRegistration(Number(String(b.id).trim()), b.approve, user);
    return send(res, 200, { ok: true, ...r });
  }

  if (action === 'edupage') {
    const tt = await getFullTimetable();
    return send(res, 200, {
      ok: true,
      week: tt.week,
      classes: tt.full.classes.map((c) => c.name),
      teachers: tt.full.teachers.filter((t) => t.name || t.short),
    });
  }

  if (action === 'teacher-subjects') {
    const tt = await getFullTimetable();
    return send(res, 200, { ok: true, subjects: teacherSubjects(tt.full, String(req.query.tid || '')) });
  }

  if (action === 'groups') {
    const [{ data: groups, error: e1 }, { data: studs, error: e2 }] = await Promise.all([
      db().from('groups').select('code, created_at').order('code'),
      db().from('bot_users').select('group_code').eq('role', 'student'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const counts = {};
    for (const s of studs) counts[s.group_code] = (counts[s.group_code] || 0) + 1;
    return send(res, 200, { ok: true, groups: groups.map((g) => ({ code: g.code, students: counts[g.code] || 0 })) });
  }

  if (action === 'group') {
    const code = String(req.query.code || '');
    if (!(await groupExists(code))) throw new HttpError(404, 'group_not_found');
    const { data, error } = await db()
      .from('bot_users')
      .select('telegram_id, full_name, role, group_code, face_enrolled_at, is_starosta, created_at')
      .eq('role', 'student')
      .eq('group_code', code)
      .order('full_name');
    if (error) throw error;
    return send(res, 200, { ok: true, code, students: data.map(publicUser) });
  }

  if (action === 'group-add' && req.method === 'POST') {
    const tt = await getFullTimetable();
    const want = cleanText(b.code, 40).toUpperCase();
    const cls = tt.full.classes.find((c) => c.name.toUpperCase() === want);
    if (!cls) throw new HttpError(400, 'not_in_edupage');
    const { error } = await db()
      .from('groups')
      .insert({ code: cls.name, edupage_class_id: cls.id, created_by: user.telegram_id });
    if (error) {
      if (error.code === '23505') throw new HttpError(409, 'group_exists');
      throw error;
    }
    return send(res, 200, { ok: true, code: cls.name });
  }

  if (action === 'group-delete' && req.method === 'POST') {
    const code = String(b.code || '');
    const { count, error: e1 } = await db()
      .from('bot_users')
      .select('telegram_id', { count: 'exact', head: true })
      .eq('group_code', code);
    if (e1) throw e1;
    if (count > 0) throw new HttpError(409, 'group_not_empty');
    const { error } = await db().from('groups').delete().eq('code', code);
    if (error) throw error;
    return send(res, 200, { ok: true });
  }

  if (action === 'users') {
    let q = db()
      .from('bot_users')
      .select('telegram_id, full_name, role, group_code, subjects, edupage_teacher_id, face_enrolled_at, is_starosta, created_at')
      .order('role')
      .order('full_name');
    if (req.query.role) q = q.eq('role', String(req.query.role));
    const { data, error } = await q;
    if (error) throw error;
    return send(res, 200, { ok: true, users: data.map(publicUser) });
  }

  if (action === 'user-add' && req.method === 'POST') {
    const role = String(b.role || '');
    if (!['student', 'teacher', 'admin'].includes(role)) throw new HttpError(400, 'bad_role');
    if (role === 'admin' && !isOwner) throw new HttpError(403, 'owner_only');
    if (!isTgId(b.id)) throw new HttpError(400, 'bad_id');
    const id = Number(String(b.id).trim());
    if (isOwnerId(id)) throw new HttpError(409, 'user_exists');
    const name = cleanText(b.name, 80);
    if (name.length < 3) throw new HttpError(400, 'bad_name');

    const row = { telegram_id: id, full_name: name, role, added_by: user.telegram_id, group_code: null, subjects: [] };
    if (role === 'student') {
      const g = cleanText(b.group, 40);
      if (!(await groupExists(g))) throw new HttpError(400, 'group_not_found');
      row.group_code = g;
    }
    if (role === 'teacher') {
      const tt = await getFullTimetable();
      const tid = String(b.edupageTeacherId || '');
      if (!tt.full.teachers.some((t) => t.id === tid)) throw new HttpError(400, 'bad_teacher');
      const allowed = teacherSubjects(tt.full, tid).map((s) => s.short);
      const subjects = [...new Set((Array.isArray(b.subjects) ? b.subjects : []).map(String))];
      if (!subjects.length) throw new HttpError(400, 'subjects_required');
      if (subjects.some((s) => !allowed.includes(s))) throw new HttpError(400, 'bad_subject');
      row.edupage_teacher_id = tid;
      row.subjects = subjects;
    }
    const { error } = await db().from('bot_users').insert(row);
    if (error) {
      if (error.code === '23505') throw new HttpError(409, 'user_exists');
      throw error;
    }
    await clearRegistration(id); // agar shu odamning arizasi bo'lsa — endi kerak emas
    return send(res, 200, { ok: true });
  }

  if ((action === 'user-delete' || action === 'face-reset') && req.method === 'POST') {
    if (!isTgId(b.id)) throw new HttpError(400, 'bad_id');
    const id = Number(String(b.id).trim());
    const { data: target, error: e1 } = await db()
      .from('bot_users')
      .select('telegram_id, role, full_name, group_code')
      .eq('telegram_id', id)
      .maybeSingle();
    if (e1) throw e1;
    if (!target) throw new HttpError(404, 'user_not_found');

    if (action === 'face-reset') {
      const { error } = await db().from('bot_users').update({ face_descriptor: null, face_enrolled_at: null }).eq('telegram_id', id);
      if (error) throw error;
      return send(res, 200, { ok: true });
    }

    if (target.role === 'owner' || isOwnerId(id)) throw new HttpError(403, 'cannot_delete_owner');
    if (String(id) === String(user.telegram_id)) throw new HttpError(403, 'cannot_delete_self');
    if (target.role === 'admin' && !isOwner) throw new HttpError(403, 'owner_only');
    const { error } = await db().from('bot_users').delete().eq('telegram_id', id);
    if (error) throw error;
    // O'chirilgan o'quvchi o'zi qayta ariza bera olmasin (admin qo'lda qo'shsa — yana kira oladi)
    await blockRegistration(target, user.telegram_id);
    return send(res, 200, { ok: true });
  }

  if (action === 'starosta' && req.method === 'POST') {
    if (!isTgId(b.id) || typeof b.value !== 'boolean') throw new HttpError(400, 'bad_request');
    const id = Number(String(b.id).trim());
    const { data: target, error: e1 } = await db().from('bot_users').select('telegram_id, role').eq('telegram_id', id).maybeSingle();
    if (e1) throw e1;
    if (!target) throw new HttpError(404, 'user_not_found');
    if (target.role !== 'student') throw new HttpError(400, 'students_only');
    const { error } = await db().from('bot_users').update({ is_starosta: b.value }).eq('telegram_id', id);
    if (error) throw error;
    return send(res, 200, { ok: true });
  }

  if (action === 'setting' && req.method === 'POST') {
    const key = String(b.key || '');
    if (!SETTINGS[key] || !SETTINGS[key](b.value)) throw new HttpError(400, 'bad_setting');
    await setSetting(key, b.value, user.telegram_id);
    return send(res, 200, { ok: true, settings: await getSettings(true) });
  }

  fail(res, 400, 'bad_action');
});

function publicUser(u) {
  return {
    id: String(u.telegram_id),
    name: u.full_name,
    role: u.role,
    group: u.group_code || null,
    subjects: u.subjects || [],
    edupageTeacherId: u.edupage_teacher_id || null,
    faceEnrolled: !!u.face_enrolled_at,
    starosta: !!u.is_starosta,
    createdAt: u.created_at,
  };
}
