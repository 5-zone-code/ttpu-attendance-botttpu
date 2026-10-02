import { db } from './db.js';
import { getFullTimetable, teacherLessons, currentLesson } from './edupage.js';
import { HttpError } from './http.js';

/**
 * Ustozning shu haftadagi darslari va guruhlari.
 * Guruhlar = EduPage jadvalidagi guruhlar ∩ tizimda ochilgan guruhlar.
 * EduPage ishlamay qolsa — ustoz ishsiz qolmasligi uchun tizimdagi barcha guruhlar beriladi.
 */
export async function teacherContext(user, now = Date.now()) {
  const { data: dbGroups, error } = await db().from('groups').select('code');
  if (error) throw error;
  const known = new Map((dbGroups || []).map((g) => [g.code.toUpperCase(), g.code]));

  let lessons = [];
  let week = null;
  let edupageOk = true;
  try {
    const tt = await getFullTimetable(now);
    week = tt.week;
    lessons = teacherLessons(tt.full, user.edupage_teacher_id, user.subjects);
  } catch (e) {
    console.error('edupage', e);
    edupageOk = false;
  }

  const bySubject = new Map(); // group -> Set(subject)
  for (const l of lessons)
    for (const c of l.classes) {
      const code = known.get(c.toUpperCase());
      if (!code) continue;
      if (!bySubject.has(code)) bySubject.set(code, new Set());
      bySubject.get(code).add(l.subject);
    }

  let groups = [...bySubject.entries()].map(([code, subs]) => ({ code, subjects: [...subs] }));
  if (!edupageOk) groups = [...known.values()].map((code) => ({ code, subjects: user.subjects || [] }));
  groups.sort((a, b) => a.code.localeCompare(b.code));
  return { lessons, groups, week, edupageOk };
}

export function assertGroup(ctx, group) {
  const g = ctx.groups.find((x) => x.code.toUpperCase() === String(group || '').toUpperCase());
  if (!g) throw new HttpError(403, 'not_your_group');
  return g;
}

/** Sessiya/vazifa uchun fan: hozirgi dars -> shu guruhdagi fan -> ustoz fani */
export function pickSubject(ctx, user, group, wanted, now = Date.now()) {
  const g = assertGroup(ctx, group);
  if (wanted && g.subjects.map((s) => s.toUpperCase()).includes(String(wanted).toUpperCase())) return wanted;
  if (wanted && !g.subjects.length && (user.subjects || []).includes(wanted)) return wanted;
  const cur = currentLesson(ctx.lessons.filter((l) => l.classes.some((c) => c.toUpperCase() === g.code.toUpperCase())), now);
  return cur?.subject || g.subjects[0] || (user.subjects || [])[0] || 'Dars';
}
