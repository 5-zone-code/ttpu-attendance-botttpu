import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.APP_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.BOT_TOKEN = '123456:TEST_TOKEN';

const { verifyInitData } = await import('../lib/telegram.js');
const { makeFaceToken, checkFaceToken, makeQrToken, checkQrToken } = await import('../lib/tokens.js');
const { checkCampus, distanceM } = await import('../lib/geo.js');
const { buildEnrollment, verifyAgainst } = await import('../lib/face.js');
const { parseClassTimetable, pickTimetable, currentLesson, parseFull, teacherLessons, teacherSubjects, tashkentDayStartIso } = await import('../lib/edupage.js');

function signInitData(fields, token) {
  const p = new URLSearchParams(fields);
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

test('initData: to\'g\'ri imzo qabul qilinadi, soxtasi rad etiladi', () => {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAE',
    user: JSON.stringify({ id: 5491931116, first_name: 'Maqsud' }),
  };
  const good = signInitData(fields, '123456:TEST_TOKEN');
  assert.equal(verifyInitData(good).user.id, 5491931116);

  // boshqa foydalanuvchi ID siga almashtirish
  const tampered = good.replace('5491931116', '8712189674');
  assert.equal(verifyInitData(tampered), null);
  // boshqa bot tokeni bilan imzolangan
  assert.equal(verifyInitData(signInitData(fields, '999:OTHER')), null);
  // eskirgan
  const old = signInitData({ ...fields, auth_date: String(Math.floor(Date.now() / 1000) - 3 * 86400) }, '123456:TEST_TOKEN');
  assert.equal(verifyInitData(old), null);
  assert.equal(verifyInitData(''), null);
});

test('face token: faqat o\'z egasiga va muddat ichida', () => {
  const tok = makeFaceToken(111);
  assert.ok(checkFaceToken(tok, 111));
  assert.ok(!checkFaceToken(tok, 222));
  assert.ok(!checkFaceToken(tok, 111, Date.now() + 16 * 60 * 1000));
  assert.ok(!checkFaceToken(tok.slice(0, -2) + 'xx', 111));
});

test('QR token: 45 soniyadan keyin eskiradi, soxtasi rad', () => {
  const id = '3f2b1c4e-1111-2222-3333-444455556666';
  const now = Date.now();
  const q = makeQrToken(id, now);
  assert.deepEqual(checkQrToken(q, now + 40000), { ok: true, sessionId: id });
  assert.equal(checkQrToken(q, now + 50000).reason, 'qr_expired');
  assert.equal(checkQrToken('PAIR_abc123').reason, 'qr_invalid');
  const [pre, rest] = [q.slice(0, 6), q.slice(6)];
  const [body] = rest.split('.');
  const forged = pre + Buffer.from(JSON.stringify({ t: 'qr', s: id, i: Math.floor(now / 1000) + 9999 })).toString('base64url') + '.' + rest.split('.')[1];
  assert.equal(checkQrToken(forged, now).reason, 'qr_invalid');
  assert.ok(body);
});

test('geofence: TTPU ichida ok, tashqarida rad', () => {
  assert.ok(checkCampus({ lat: 41.35202, lon: 69.2221, accuracy: 20 }).ok);
  // kampus burchagi (OSM bbox) ~ 200 m
  assert.ok(checkCampus({ lat: 41.3532, lon: 69.2235, accuracy: 30 }).ok);
  // Amir Temur xiyoboni ~ 5 km
  const far = checkCampus({ lat: 41.3111, lon: 69.2797, accuracy: 10 });
  assert.equal(far.reason, 'outside_campus');
  assert.ok(far.distance > 4000);
  assert.equal(checkCampus({ lat: 41.35202, lon: 69.2221, accuracy: 900 }).reason, 'gps_inaccurate');
  assert.equal(checkCampus(null).reason, 'no_location');
  assert.equal(checkCampus({ lat: 'x', lon: 1 }).reason, 'no_location');
  assert.ok(Math.abs(distanceM(0, 0, 0, 1) - 111195) < 50);
});

function rnd(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2;
}
const face = (seed) => { const r = rnd(seed); return Array.from({ length: 128 }, r); };
const jitter = (d, amt, seed) => { const r = rnd(seed); return d.map((x) => x + r() * amt); };

test('face: ro\'yxatga olish va tekshirish', () => {
  const a = face(7);
  const b = face(99);
  const enroll = buildEnrollment([jitter(a, 0.1, 1), jitter(a, 0.1, 2), jitter(a, 0.1, 3), jitter(a, 0.1, 4)]);
  assert.ok(enroll.ok);
  assert.ok(verifyAgainst(enroll.descriptor, [jitter(a, 0.1, 5), jitter(a, 0.1, 6), jitter(a, 0.1, 7)]).ok);
  assert.ok(!verifyAgainst(enroll.descriptor, [b, jitter(b, 0.1, 8), jitter(b, 0.1, 9)]).ok);
  // aralash kadrlar bilan ro'yxatdan o'tib bo'lmaydi
  assert.equal(buildEnrollment([a, a, b]).reason, 'inconsistent_faces');
  assert.equal(buildEnrollment([a]).reason, 'need_samples');
  assert.equal(buildEnrollment([a, a, [1, 2]]).reason, 'bad_descriptor');
});

const fixture = {
  r: { dbiAccessorRes: { tables: [
    { id: 'periods', data_rows: [
      { period: '1', starttime: '09:00', endtime: '10:20' },
      { period: '2', starttime: '10:30', endtime: '11:50' },
      { period: '3', starttime: '12:00', endtime: '13:20' },
    ] },
    { id: 'days', data_rows: [{ id: '0', short: 'Mo' }, { id: '1', short: 'Tu' }] },
    { id: 'classes', data_rows: [{ id: '*106', name: 'CYB2-26' }, { id: '*107', name: 'CYB3-26' }] },
    { id: 'subjects', data_rows: [{ id: '*328', name: 'Mathematics I (prac)', short: 'MATH 1 (prac)' }, { id: '*458', name: 'HOLIDAY', short: 'HOLIDAY' }, { id: '*93', short: 'ENG 1', name: 'English Language I' }] },
    { id: 'teachers', data_rows: [{ id: '-144', short: 'M.ESHKOBILOVA' }, { id: '-14', short: 'L.NAZAROVA' }] },
    { id: 'classrooms', data_rows: [{ id: '-7', short: '305' }, { id: '-6', short: '304' }] },
    { id: 'groups', data_rows: [{ id: '*644', name: 'Entire class', classid: '*107', entireclass: true }] },
    { id: 'lessons', data_rows: [
      { id: '*77', subjectid: '*328', teacherids: ['-144'], groupids: ['*644'], classids: ['*107'], durationperiods: 1 },
      { id: '*244', subjectid: '*93', teacherids: ['-14'], groupids: ['*644'], classids: ['*107'], durationperiods: 1 },
      { id: '*1', subjectid: '*458', teacherids: [], groupids: [], classids: ['*107'], durationperiods: 8 },
      { id: '*999', subjectid: '*93', teacherids: ['-14'], groupids: [], classids: ['*106'], durationperiods: 1 },
    ] },
    { id: 'cards', data_rows: [
      { lessonid: '*77', period: '2', days: '100000', classroomids: ['-7'] },
      { lessonid: '*244', period: '3', days: '100000', classroomids: ['-6'] },
      { lessonid: '*1', period: '', days: '', classroomids: [] },
      { lessonid: '*999', period: '1', days: '100000', classroomids: ['-6'] },
    ] },
  ] } },
};

test('EduPage parser: CYB3-26 dushanba jadvali (dizayndagi bilan bir xil)', () => {
  const r = parseClassTimetable(fixture, 'CYB3-26');
  assert.equal(r.lessons.length, 2);
  assert.deepEqual(
    r.lessons.map((l) => [l.dayShort, l.subject, l.teacher, l.room, l.start, l.end]),
    [
      ['Mo', 'MATH 1 (prac)', 'M.ESHKOBILOVA', '305', '10:30', '11:50'],
      ['Mo', 'ENG 1', 'L.NAZAROVA', '304', '12:00', '13:20'],
    ]
  );
  assert.equal(parseClassTimetable(fixture, 'NOPE-1'), null);
});

test('EduPage: to\'g\'ri haftani tanlash va hozirgi dars', () => {
  const list = [
    { tt_num: '458', datefrom: '2026-09-20', text: 'week 6' },
    { tt_num: '460', datefrom: '2026-09-27', text: 'week 7' },
  ];
  assert.equal(pickTimetable(list, '2026-09-26').tt_num, '458');
  assert.equal(pickTimetable(list, '2026-09-28').tt_num, '460');
  assert.equal(pickTimetable(list, '2026-01-01').tt_num, '458');

  const lessons = parseClassTimetable(fixture, 'CYB3-26').lessons;
  // 2026-09-28 dushanba 11:00 Toshkent = 06:00 UTC
  assert.equal(currentLesson(lessons, Date.parse('2026-09-28T06:00:00Z')).subject, 'MATH 1 (prac)');
  assert.equal(currentLesson(lessons, Date.parse('2026-09-29T06:00:00Z')), null);
});

test("EduPage: ustoz jadvali (kun/xona/guruh) va fanlari", () => {
  const full = parseFull(fixture);
  const ls = teacherLessons(full, '-14');
  // L.NAZAROVA: CYB3-26 dushanba 12:00 (304) va CYB2-26 dushanba 09:00
  assert.deepEqual(ls.map((l) => [l.dayShort, l.start, l.subject, l.room, l.group]), [
    ['Mo', '09:00', 'ENG 1', '304', 'CYB2-26'],
    ['Mo', '12:00', 'ENG 1', '304', 'CYB3-26'],
  ]);
  assert.deepEqual(teacherSubjects(full, '-14'), [{ short: 'ENG 1', name: 'English Language I' }]);
  // fan filtri
  assert.equal(teacherLessons(full, '-14', ['MATH 1 (prac)']).length, 0);
  assert.equal(teacherLessons(full, '-144', ['math 1 (PRAC)']).length, 1);
  assert.deepEqual(teacherLessons(full, null), []);
  // HOLIDAY fanlar ro'yxatiga kirmaydi
  assert.ok(!teacherSubjects(full, '-144').some((s) => s.short === 'HOLIDAY'));
});

test('Toshkent kuni boshlanishi', () => {
  // 2026-09-26 03:00 Toshkent = 2026-09-25T22:00Z -> kun boshi 2026-09-25T19:00Z
  assert.equal(tashkentDayStartIso(Date.parse('2026-09-25T22:00:00Z')), '2026-09-25T19:00:00.000Z');
});
