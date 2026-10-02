import { handler, requireRole, send, fail } from '../lib/http.js';
import { getGroupTimetable } from '../lib/edupage.js';
import { teacherContext } from '../lib/teacher.js';

// Talaba: o'z guruhining jadvali. Ustoz: o'zi dars beradigan kun/xona/guruhlar.
export default handler(async (req, res) => {
  if (req.method !== 'GET') return fail(res, 405, 'method');
  const ctx = await requireRole(req, res, ['student', 'teacher']);
  if (!ctx) return;
  const { user } = ctx;
  try {
    if (user.role === 'student') {
      const tt = await getGroupTimetable(user.group_code);
      return send(res, 200, { ok: true, ...tt });
    }
    const t = await teacherContext(user);
    if (!t.edupageOk) return fail(res, 502, 'timetable_unavailable');
    send(res, 200, {
      ok: true,
      week: t.week,
      lessons: t.lessons,
      groups: t.groups,
      linked: !!user.edupage_teacher_id,
    });
  } catch (e) {
    console.error('timetable', e);
    fail(res, 502, 'timetable_unavailable', { message: e.message });
  }
});
