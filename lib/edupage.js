import { config } from './config.js';

// Toshkent vaqti UTC+5 (yozgi vaqt yo'q)
export function tashkentNow(now = Date.now()) {
  return new Date(now + 5 * 3600 * 1000); // UTC metodlari bilan o'qiladi
}
export function tashkentDateStr(now = Date.now()) {
  return tashkentNow(now).toISOString().slice(0, 10);
}
/** Toshkent bo'yicha bugungi kun boshlanishi (UTC ISO) */
export function tashkentDayStartIso(now = Date.now()) {
  return new Date(Date.parse(tashkentDateStr(now) + 'T00:00:00Z') - 5 * 3600 * 1000).toISOString();
}

async function edupagePost(path, args) {
  const r = await fetch(config.edupageBase + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 TTPU-Attendance-Bot' },
    body: JSON.stringify({ __args: args, __gsh: '00000000' }),
  });
  if (!r.ok) throw new Error('EduPage HTTP ' + r.status);
  return r.json();
}

/** Bugungi sanaga mos haftalik jadvalni tanlaydi. */
export function pickTimetable(list, today) {
  const sorted = [...(list || [])].filter((t) => !t.hidden).sort((a, b) => a.datefrom.localeCompare(b.datefrom));
  let pick = null;
  for (const t of sorted) if (t.datefrom <= today) pick = t;
  return pick || sorted[0] || null;
}

const DAY_SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
// Jadvalda dars emas, belgi sifatida turadigan "fanlar"
const NON_SUBJECTS = /^(holiday|tutor hour)$/i;

/** EduPage regulartt javobini to'liq tahlil qiladi (barcha guruhlar, ustozlar, fanlar). */
export function parseFull(raw) {
  const tables = {};
  for (const t of raw?.r?.dbiAccessorRes?.tables || []) tables[t.id] = t.data_rows || [];
  const byId = (k) => Object.fromEntries((tables[k] || []).map((x) => [x.id, x]));

  const subjects = byId('subjects');
  const teachers = byId('teachers');
  const rooms = byId('classrooms');
  const classes = byId('classes');
  const groups = byId('groups');
  const lessonsById = byId('lessons');
  const periods = Object.fromEntries((tables.periods || []).map((p) => [String(p.period), p]));
  const days = tables.days || [];

  const lessons = [];
  for (const card of tables.cards || []) {
    const lesson = lessonsById[card.lessonid];
    if (!lesson || !card.days || !card.period) continue; // joylashtirilmagan kartochka
    const startP = periods[String(card.period)];
    if (!startP) continue;
    const endP = periods[String(Number(card.period) + (Number(lesson.durationperiods) || 1) - 1)] || startP;
    const subject = subjects[lesson.subjectid] || {};
    const teacherIds = lesson.teacherids || [];
    const classIds = lesson.classids || [];
    for (let d = 0; d < card.days.length; d++) {
      if (card.days[d] !== '1') continue;
      lessons.push({
        day: d,
        dayShort: days[d]?.short || DAY_SHORT[d],
        start: startP.starttime,
        end: endP.endtime,
        subjectId: lesson.subjectid,
        subject: subject.short || subject.name || '—',
        subjectFull: subject.name || '',
        teacherIds,
        teacher: teacherIds.map((id) => teachers[id]?.short).filter(Boolean).join(', '),
        classIds,
        classes: classIds.map((id) => classes[id]?.name).filter(Boolean),
        groupIds: lesson.groupids || [],
        room: (card.classroomids || []).map((id) => rooms[id]?.short).filter(Boolean).join(', '),
      });
    }
  }
  lessons.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));

  return {
    lessons,
    groups,
    classes: Object.values(classes).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    teachers: Object.values(teachers)
      .map((t) => ({ id: t.id, name: t.name, short: t.short }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    subjects: Object.values(subjects).map((s) => ({ id: s.id, name: s.name, short: s.short })),
  };
}

const findClass = (full, name) =>
  full.classes.find((c) => (c.name || '').toUpperCase() === String(name || '').toUpperCase()) || null;

/** Bitta guruh (sinf) jadvali — talaba sahifasi uchun. */
export function classLessons(full, groupName) {
  const cls = findClass(full, groupName);
  if (!cls) return null;
  const lessons = full.lessons
    .filter((l) => l.classIds.includes(cls.id))
    .map((l) => ({
      day: l.day,
      dayShort: l.dayShort,
      start: l.start,
      end: l.end,
      subject: l.subject,
      subjectFull: l.subjectFull,
      teacher: l.teacher,
      room: l.room,
      group: l.groupIds
        .map((g) => full.groups[g])
        .filter((g) => g && !g.entireclass && g.classid === cls.id)
        .map((g) => g.name)
        .join(', '),
    }));
  return { classId: cls.id, className: cls.name, lessons };
}

/** Eski nom (testlar va orqaga moslik uchun) */
export function parseClassTimetable(raw, groupName) {
  return classLessons(parseFull(raw), groupName);
}

/**
 * Ustoz jadvali: EduPage o'qituvchi ID si bo'yicha; fanlar berilgan bo'lsa faqat o'shalar.
 * Har bir dars qaysi guruh(lar)ga va qaysi xonada ekanini ko'rsatadi.
 */
export function teacherLessons(full, edupageTeacherId, subjects = []) {
  if (!edupageTeacherId) return [];
  const allow = (subjects || []).map((s) => s.toUpperCase());
  return full.lessons
    .filter((l) => l.teacherIds.includes(edupageTeacherId))
    .filter((l) => !allow.length || allow.includes(l.subject.toUpperCase()))
    .filter((l) => !NON_SUBJECTS.test(l.subjectFull || l.subject))
    .map((l) => ({
      day: l.day,
      dayShort: l.dayShort,
      start: l.start,
      end: l.end,
      subject: l.subject,
      subjectFull: l.subjectFull,
      teacher: '',
      room: l.room,
      group: l.classes.join(', '),
      classes: l.classes,
    }));
}

/** EduPage dagi o'qituvchining shu haftadagi fanlari (admin ustoz qo'shganda tanlash uchun) */
export function teacherSubjects(full, edupageTeacherId) {
  const set = new Map();
  for (const l of full.lessons) {
    if (!l.teacherIds.includes(edupageTeacherId)) continue;
    if (NON_SUBJECTS.test(l.subjectFull || l.subject)) continue;
    set.set(l.subject, l.subjectFull || l.subject);
  }
  return [...set.entries()].map(([short, name]) => ({ short, name })).sort((a, b) => a.short.localeCompare(b.short));
}

// Lambda ichida 30 daqiqalik kesh
let cache = null;
const TTL = 30 * 60 * 1000;

export async function getFullTimetable(now = Date.now()) {
  const today = tashkentDateStr(now);
  if (cache && cache.today === today && now - cache.at < TTL) return cache.data;

  const year = Number(today.slice(0, 4));
  let viewer = await edupagePost('/timetable/server/ttviewer.js?__func=getTTViewerData', [null, year]);
  let list = viewer?.r?.regular?.timetables || [];
  if (!list.length) {
    viewer = await edupagePost('/timetable/server/ttviewer.js?__func=getTTViewerData', [null, year - 1]);
    list = viewer?.r?.regular?.timetables || [];
  }
  const tt = pickTimetable(list, today);
  if (!tt) throw new Error('EduPage: jadval topilmadi');

  const raw = await edupagePost('/timetable/server/regulartt.js?__func=regularttGetData', [null, tt.tt_num]);
  const weekMatch = /week\s*(\d+)/i.exec(tt.text || '');
  const data = {
    week: weekMatch ? Number(weekMatch[1]) : null,
    title: tt.text,
    datefrom: tt.datefrom,
    full: parseFull(raw),
    fetchedAt: new Date(now).toISOString(),
  };
  cache = { at: now, today, data };
  return data;
}

export async function getGroupTimetable(groupName = config.defaultGroup, now = Date.now()) {
  const tt = await getFullTimetable(now);
  const parsed = classLessons(tt.full, groupName);
  if (!parsed) throw new Error('EduPage: guruh topilmadi: ' + groupName);
  return { group: parsed.className, week: tt.week, title: tt.title, datefrom: tt.datefrom, lessons: parsed.lessons, fetchedAt: tt.fetchedAt };
}

/** Hozir (yoki ±15 daqiqa ichida) bo'layotgan darsni topadi. */
export function currentLesson(lessons, now = Date.now(), graceMin = 15) {
  const t = tashkentNow(now);
  const day = (t.getUTCDay() + 6) % 7; // 0=Dushanba
  const mins = t.getUTCHours() * 60 + t.getUTCMinutes();
  const toMin = (s) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };
  return (
    (lessons || []).find(
      (l) => l.day === day && mins >= toMin(l.start) - graceMin && mins <= toMin(l.end) + graceMin
    ) || null
  );
}

/** Test uchun keshni tozalash */
export function _resetCache() {
  cache = null;
}
