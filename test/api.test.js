// API oqimini soxta (in-memory) Supabase va EduPage bilan uchidan-uchigacha tekshirish (v2: rollar)
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.APP_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.BOT_TOKEN = '123456:TEST_TOKEN';
process.env.ADMIN_KEY = 'adm';
process.env.WEBAPP_URL = 'https://x.vercel.app';
process.env.OWNER_ID = '7317966615';

// ---------------- soxta Supabase ----------------
const T = {
  bot_users: [], groups: [], lesson_sessions: [], attendance_records: [], attendance_attempts: [],
  face_logs: [], tasks: [], app_settings: [{ key: 'geofence_enabled', value: true }], registrations: [],
};
const PK = { bot_users: 'telegram_id', groups: 'code', app_settings: 'key', registrations: 'telegram_id' };
const UNIQUE = { attendance_records: ['session_id', 'telegram_id'] };
const JOIN = {
  'attendance_records.bot_users': (r) => T.bot_users.find((u) => String(u.telegram_id) === String(r.telegram_id)),
  'attendance_records.lesson_sessions': (r) => T.lesson_sessions.find((s) => s.id === r.session_id),
};
const eq = (a, b) => String(a) === String(b);

function q(table) {
  const filters = [];
  let op = 'select', payload = null, single = false, head = false, returnRows = false, upsertKey = null, limitN = null;
  let sel = '*';
  const orders = [];
  const api = {
    select(s, o) { if (op === 'select') sel = s || '*'; else returnRows = true; head = !!o?.head; return api; },
    eq(k, v) { filters.push((r) => eq(r[k], v)); return api; },
    in(k, vs) { filters.push((r) => vs.map(String).includes(String(r[k]))); return api; },
    is(k, v) { filters.push((r) => (r[k] ?? null) === v); return api; },
    lte(k, v) { filters.push((r) => r[k] <= v); return api; },
    gte(k, v) { filters.push((r) => r[k] >= v); return api; },
    order(k, o) { orders.push([k, o?.ascending !== false]); return api; },
    limit(n) { limitN = n; return api; },
    insert(p) { op = 'insert'; payload = p; return api; },
    upsert(p, o) { op = 'upsert'; payload = p; upsertKey = o?.onConflict || PK[table]; return api; },
    update(p) { op = 'update'; payload = p; return api; },
    delete() { op = 'delete'; return api; },
    maybeSingle() { single = true; return api; },
    single() { single = true; return api; },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  const matches = () => T[table].filter((r) => filters.every((f) => f(r)));
  const shape = (r) => {
    const out = { ...r };
    for (const m of sel.matchAll(/(\w+)\(([^)]+)\)/g)) {
      const j = JOIN[`${table}.${m[1]}`]?.(r);
      out[m[1]] = j ? Object.fromEntries(m[2].split(',').map((c) => [c.trim(), j[c.trim()]])) : null;
    }
    return out;
  };
  function run() {
    if (op === 'insert' || op === 'upsert') {
      const rows = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
        ...(table === 'lesson_sessions' || table === 'tasks' ? { id: crypto.randomUUID() } : { id: T[table].length + 1 }),
        created_at: new Date().toISOString(), marked_at: new Date().toISOString(),
        ...(table === 'tasks' ? { status: 'active' } : {}),
        ...(table === 'attendance_records' ? { method: 'qr' } : {}),
        ...(table === 'bot_users' ? { active: true, subjects: [] } : {}),
        ...p,
      }));
      for (const row of rows) {
        const key = upsertKey || PK[table];
        const existing = key ? T[table].find((r) => eq(r[key], row[key])) : null;
        if (existing && op === 'upsert') { Object.assign(existing, row); continue; }
        if (existing) return { data: null, error: { code: '23505' } };
        const u = UNIQUE[table];
        if (u && T[table].some((r) => u.every((k) => eq(r[k], row[k])))) return { data: null, error: { code: '23505' } };
        T[table].push(row);
      }
      return { data: returnRows ? (single ? shape(rows[0]) : rows.map(shape)) : null, error: null };
    }
    if (op === 'update') {
      const m = matches();
      m.forEach((r) => Object.assign(r, payload));
      return { data: returnRows ? m.map(shape) : null, error: null };
    }
    if (op === 'delete') {
      const del = new Set(matches());
      T[table] = T[table].filter((r) => !del.has(r));
      if (table === 'bot_users') for (const r of del) T.attendance_records = T.attendance_records.filter((a) => !eq(a.telegram_id, r.telegram_id));
      if (table === 'groups') for (const r of del) T.registrations = T.registrations.filter((g) => g.group_code !== r.code); // FK on delete cascade
      return { data: null, error: null };
    }
    let out = matches();
    if (head) return { count: out.length, error: null };
    for (const [k, asc] of [...orders].reverse()) out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
    if (limitN) out = out.slice(0, limitN);
    out = out.map(shape);
    return { data: single ? out[0] || null : out, error: null };
  }
  return api;
}

// supabase/migration_v2.sql dagi mark_attendance ning JS nusxasi
function markAttendance({ p_session, p_user, p_lat, p_lon, p_acc, p_dist }) {
  const s = T.lesson_sessions.find((x) => x.id === p_session);
  if (!s) return { ok: false, error: 'session_not_found' };
  if (T.attendance_records.some((r) => r.session_id === p_session && eq(r.telegram_id, p_user))) return { ok: true, already: true, subject: s.subject };
  let n = T.attendance_records.filter((r) => r.session_id === p_session).length;
  if (s.max_students != null && n >= s.max_students) { s.closed_at ||= new Date().toISOString(); return { ok: false, error: 'session_full' }; }
  if (s.closed_at || Date.now() > Date.parse(s.ends_at)) return { ok: false, error: 'session_closed' };
  T.attendance_records.push({ id: T.attendance_records.length + 1, session_id: p_session, telegram_id: p_user, lat: p_lat, lon: p_lon, accuracy: p_acc, distance_m: p_dist, method: 'qr', marked_at: new Date().toISOString() });
  n++;
  if (s.max_students != null && n >= s.max_students) s.closed_at = new Date().toISOString();
  return { ok: true, subject: s.subject, count: n, max: s.max_students };
}

// supabase/migration_v3.sql dagi group_overview ning JS nusxasi
function groupOverview({ p_group, p_limit = 30 }) {
  const now = new Date().toISOString();
  const sess = T.lesson_sessions.filter((x) => x.group_code === p_group && x.started_at <= now);
  const ids = new Set(sess.map((x) => x.id));
  return {
    total: sess.length,
    students: T.bot_users.filter((u) => u.role === 'student' && u.group_code === p_group && u.active !== false)
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map((u) => ({ id: String(u.telegram_id), name: u.full_name, starosta: !!u.is_starosta,
        attended: T.attendance_records.filter((r) => eq(r.telegram_id, u.telegram_id) && ids.has(r.session_id)).length })),
    sessions: [...sess].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, p_limit).map((x) => ({
      id: x.id, subject: x.subject, startedAt: x.started_at, mode: x.mode,
      teacher: T.bot_users.find((u) => eq(u.telegram_id, x.teacher_id))?.full_name || null,
      present: T.attendance_records.filter((r) => r.session_id === x.id).length })),
  };
}

const storageOps = [];
const fakeDb = {
  from: q,
  rpc: async (name, args) => ({ data: name === 'mark_attendance' ? markAttendance(args) : name === 'group_overview' ? groupOverview(args) : null, error: null }),
  storage: {
    from: (bucket) => ({
      createSignedUploadUrl: async (path) => { storageOps.push(['upload', path]); return { data: { signedUrl: `https://sb/upload/${bucket}/${path}?token=x`, path, token: 'x' }, error: null }; },
      createSignedUrl: async (path) => ({ data: { signedUrl: `https://sb/dl/${bucket}/${path}` }, error: null }),
      remove: async (paths) => { storageOps.push(['remove', ...paths]); return { data: [], error: null }; },
    }),
    getBucket: async () => ({ data: { id: 'tasks' } }),
  },
};
(await import('../lib/db.js'))._setClient(fakeDb);

// ---------------- soxta EduPage ----------------
const P = (period, start, end) => ({ id: period, period, starttime: start, endtime: end });
const EDU = {
  r: { dbiAccessorRes: { tables: [
    { id: 'periods', data_rows: [P('1', '09:00', '10:20'), P('2', '10:30', '11:50'), P('3', '12:00', '13:20')] },
    { id: 'days', data_rows: [{ id: '0', short: 'Mo' }, { id: '1', short: 'Tu' }] },
    { id: 'classes', data_rows: [{ id: '*105', name: 'CYB1-26' }, { id: '*106', name: 'CYB2-26' }, { id: '*107', name: 'CYB3-26' }] },
    { id: 'subjects', data_rows: [{ id: 's1', short: 'PROG (prac)', name: 'Programming (prac)' }, { id: 's2', short: 'PROG (lec)', name: 'Programming (lec)' }, { id: 's3', short: 'ENG 1', name: 'English Language I' }] },
    { id: 'teachers', data_rows: [{ id: 't1', name: 'KHABIBULLAEV KHAMIDULLA', short: 'KH.KHAMIDULLA' }, { id: 't2', name: 'NAZAROVA LOLA', short: 'L.NAZAROVA' }] },
    { id: 'classrooms', data_rows: [{ id: 'r1', short: 'LAB 403' }, { id: 'r2', short: 'GREEN HALL' }] },
    { id: 'groups', data_rows: [] },
    { id: 'lessons', data_rows: [
      { id: 'l1', subjectid: 's1', teacherids: ['t1'], groupids: [], classids: ['*107'], durationperiods: 1 },
      { id: 'l2', subjectid: 's1', teacherids: ['t1'], groupids: [], classids: ['*105'], durationperiods: 1 },
      { id: 'l3', subjectid: 's2', teacherids: ['t1'], groupids: [], classids: ['*105', '*106', '*107'], durationperiods: 1 },
      { id: 'l4', subjectid: 's3', teacherids: ['t2'], groupids: [], classids: ['*106'], durationperiods: 1 },
    ] },
    { id: 'cards', data_rows: [
      { lessonid: 'l1', period: '1', days: '100000', classroomids: ['r1'] },
      { lessonid: 'l2', period: '2', days: '100000', classroomids: ['r1'] },
      { lessonid: 'l3', period: '3', days: '010000', classroomids: ['r2'] },
      { lessonid: 'l4', period: '1', days: '010000', classroomids: ['r1'] },
    ] },
  ] } },
};
const sentTg = [];
mock.method(globalThis, 'fetch', async (url, opts) => {
  const u = String(url);
  if (u.includes('getTTViewerData')) return { ok: true, json: async () => ({ r: { regular: { timetables: [{ tt_num: '1', datefrom: '2020-01-01', text: 'week 6' }] } } }) };
  if (u.includes('regularttGetData')) return { ok: true, json: async () => EDU };
  sentTg.push({ url: u, body: JSON.parse(opts?.body || '{}') });
  return { ok: true, json: async () => ({ ok: true, result: {} }) };
});

const H = {};
for (const n of ['face', 'attend', 'me', 'admin', 'teacher', 'tasks', 'timetable', 'stats', 'bot'])
  H[n] = (await import(`../api/${n}.js`)).default;
const { webhookSecret } = await import('../api/bot.js');

function initData(uid, extra = {}) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid, first_name: 'Test', ...extra }) });
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update('123456:TEST_TOKEN').digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}
async function call(h, uid, { method, body, query = {} } = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = s; } };
  await H[h]({ method: method || (body ? 'POST' : 'GET'), headers: uid ? { 'x-telegram-init-data': initData(uid) } : {}, body, query }, res);
  let json; try { json = JSON.parse(res.body); } catch { json = res.body; }
  return { status: res.statusCode, ...json };
}
const vec = (s) => Array.from({ length: 128 }, (_, i) => Math.sin(i * s) * 0.1);
const near = (v, e) => v.map((x, i) => x + (i % 2 ? e : -e));

const OWNER = 7317966615, ADMIN = 1111111, TEACHER = 2222222, TEACHER2 = 2222223, S1 = 5491931116, S2 = 8712189674, S3 = 8057331173;
const campus = { lat: 41.3521, lon: 69.2222, accuracy: 25 };
const home = { lat: 41.2756, lon: 69.2034, accuracy: 10 };
T.groups.push({ code: 'CYB3-26' });
T.bot_users.push(
  { telegram_id: S1, full_name: 'Subxonov Maqsud', role: 'student', group_code: 'CYB3-26', active: true, subjects: [] },
  { telegram_id: S2, full_name: 'Ismonaliyev Behruzbek', role: 'student', group_code: 'CYB3-26', active: true, subjects: [] },
);

const botMsg = (uid, extra = {}) => H.bot({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': webhookSecret() }, body: { message: { chat: { id: uid, type: 'private' }, from: { id: uid, ...extra }, text: '/start' } } }, { end() {}, setHeader() {} });
const botCb = (uid, data) => H.bot({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': webhookSecret() }, body: { callback_query: { id: 'cb1', from: { id: uid }, data, message: { chat: { id: uid }, message_id: 5 } } } }, { end() {}, setHeader() {} });

test("ro'yxatda yo'q odam: ilova ochilmaydi, botda ro'yxatdan o'tish tugmasi chiqadi", async () => {
  const r = await call('me', 777);
  assert.equal(r.status, 403);
  assert.equal(r.error, 'not_allowed');
  assert.equal(r.reg.mode, 'approve'); // standart rejim
  assert.deepEqual(r.reg.groups, ['CYB3-26']);
  assert.equal(r.reg.status, null);
  assert.equal((await call('me', null)).status, 401);
  // ro'yxatda yo'q odam boshqa API larga kira olmaydi
  assert.equal((await call('stats', 777)).error, 'not_allowed');
  assert.equal((await call('admin', 777, { query: { action: 'overview' } })).error, 'not_allowed');
  sentTg.length = 0;
  await botMsg(777);
  const m = sentTg.find((x) => x.url.endsWith('/sendMessage')).body;
  assert.match(m.text, /ro'yxatdan o'tmagansiz/);
  assert.equal(m.reply_markup.inline_keyboard[0][0].web_app.url, 'https://x.vercel.app/');
});

test('Ega: bazada bo\'lmasa ham kiradi, admin paneliga yo\'naltiriladi', async () => {
  const r = await call('me', OWNER);
  assert.equal(r.user.role, 'owner');
  assert.equal(r.page, '/admin.html');
  assert.equal(T.bot_users.find((u) => u.telegram_id === OWNER).role, 'owner');
  sentTg.length = 0;
  await H.bot({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': webhookSecret() }, body: { message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Mirzobek' } } } }, { end() {}, setHeader() {} });
  assert.equal(sentTg.find((x) => x.url.endsWith('/sendMessage')).body.reply_markup.inline_keyboard[0][0].web_app.url, 'https://x.vercel.app/admin.html');
});

test('Ega admin qo\'shadi; admin admin qo\'sha olmaydi', async () => {
  assert.equal((await call('admin', OWNER, { query: { action: 'user-add' }, body: { role: 'admin', id: ADMIN, name: 'Admin Bir' } })).ok, true);
  assert.equal((await call('admin', ADMIN, { query: { action: 'user-add' }, body: { role: 'admin', id: 999999, name: 'Admin Ikki' } })).error, 'owner_only');
  assert.equal((await call('admin', ADMIN, { query: { action: 'overview' } })).isOwner, false);
  assert.equal((await call('admin', S1, { query: { action: 'overview' } })).error, 'wrong_role');
});

test('Admin: guruh ochish faqat EduPage dagilar, o\'quvchi va ustoz qo\'shish', async () => {
  assert.equal((await call('admin', ADMIN, { query: { action: 'group-add' }, body: { code: 'FAKE-99' } })).error, 'not_in_edupage');
  assert.equal((await call('admin', ADMIN, { query: { action: 'group-add' }, body: { code: 'cyb1-26' } })).code, 'CYB1-26');
  assert.equal((await call('admin', ADMIN, { query: { action: 'group-add' }, body: { code: 'CYB1-26' } })).error, 'group_exists');

  assert.equal((await call('admin', ADMIN, { query: { action: 'user-add' }, body: { role: 'student', id: S3, name: 'Aliakbar Mominjonov', group: 'CYB1-26' } })).ok, true);
  assert.equal((await call('admin', ADMIN, { query: { action: 'user-add' }, body: { role: 'student', id: S3, name: 'X Y Z', group: 'CYB1-26' } })).error, 'user_exists');
  assert.equal((await call('admin', ADMIN, { query: { action: 'user-add' }, body: { role: 'student', id: 'abc', name: 'X Y Z', group: 'CYB1-26' } })).error, 'bad_id');
  assert.equal((await call('admin', ADMIN, { query: { action: 'user-add' }, body: { role: 'student', id: 1234567, name: 'X Y Z', group: 'NOPE' } })).error, 'group_not_found');

  const subj = await call('admin', ADMIN, { query: { action: 'teacher-subjects', tid: 't1' } });
  assert.deepEqual(subj.subjects.map((s) => s.short), ['PROG (lec)', 'PROG (prac)']);
  assert.equal((await call('admin', ADMIN, { query: { action: 'user-add' }, body: { role: 'teacher', id: TEACHER, name: 'Khabibullaev Khamidulla', edupageTeacherId: 't1', subjects: ['ENG 1'] } })).error, 'bad_subject');
  assert.equal((await call('admin', ADMIN, { query: { action: 'user-add' }, body: { role: 'teacher', id: TEACHER, name: 'Khabibullaev Khamidulla', edupageTeacherId: 't1', subjects: ['PROG (prac)'] } })).ok, true);
  assert.equal((await call('admin', ADMIN, { query: { action: 'user-add' }, body: { role: 'teacher', id: TEACHER2, name: 'Nazarova Lola', edupageTeacherId: 't2', subjects: ['ENG 1'] } })).ok, true);

  const g = await call('admin', ADMIN, { query: { action: 'groups' } });
  assert.deepEqual(g.groups.map((x) => [x.code, x.students]), [['CYB1-26', 1], ['CYB3-26', 2]]);
});

test("Ustoz: faqat o'z fani/guruhlari, Face ID siz ishlaydi", async () => {
  const me = await call('me', TEACHER);
  assert.equal(me.page, '/teacher.html');
  assert.equal(me.campus, undefined);
  const c = await call('teacher', TEACHER, { query: { action: 'context' } });
  // PROG (prac): CYB3-26 va CYB1-26; PROG (lec) filtrlangan
  assert.deepEqual(c.groups.map((g) => [g.code, g.subjects, g.students]), [['CYB1-26', ['PROG (prac)'], 1], ['CYB3-26', ['PROG (prac)'], 2]]);
  const tt = await call('timetable', TEACHER);
  assert.deepEqual(tt.lessons.map((l) => [l.dayShort, l.start, l.room, l.group]), [['Mo', '09:00', 'LAB 403', 'CYB3-26'], ['Mo', '10:30', 'LAB 403', 'CYB1-26']]);
  // Nazarova CYB2-26 da dars beradi, lekin guruh tizimda ochilmagan
  assert.deepEqual((await call('teacher', TEACHER2, { query: { action: 'context' } })).groups, []);
  assert.equal((await call('teacher', TEACHER2, { query: { action: 'qr-start' }, body: { group: 'CYB3-26', maxStudents: 5, durationMin: 5 } })).error, 'not_your_group');
  assert.equal((await call('teacher', S1, { query: { action: 'context' } })).error, 'wrong_role');
});

let tok1, tok2;
test("Talabalar Face ID (v1 kabi) — admin qayta o'rnata oladi", async () => {
  const f1 = vec(1), f2 = vec(2);
  tok1 = (await call('face', S1, { body: { mode: 'enroll', samples: [f1, near(f1, 0.01), near(f1, 0.02)] } })).faceToken;
  tok2 = (await call('face', S2, { body: { mode: 'enroll', samples: [f2, near(f2, 0.01), near(f2, 0.02)] } })).faceToken;
  assert.ok(tok1 && tok2);
  assert.equal((await call('face', S1, { body: { mode: 'verify', samples: [f2, f2] } })).error, 'face_mismatch');
  assert.equal((await call('admin', ADMIN, { query: { action: 'face-reset' }, body: { id: S1 } })).ok, true);
  assert.equal((await call('me', S1)).user.faceEnrolled, false);
  tok1 = (await call('face', S1, { body: { mode: 'enroll', samples: [f1, near(f1, 0.01), near(f1, 0.02)] } })).faceToken;
  assert.ok(tok1);
});

test("QR: o'quvchilar soni chegarasi, avtomatik yopilish, joylashuv sozlamasi", async () => {
  const bad = await call('teacher', TEACHER, { query: { action: 'qr-start' }, body: { group: 'CYB3-26', maxStudents: 1, durationMin: 7 } });
  assert.equal(bad.error, 'bad_duration');
  const s = await call('teacher', TEACHER, { query: { action: 'qr-start' }, body: { group: 'CYB3-26', maxStudents: 1, durationMin: 5 } });
  assert.ok(s.qr.startsWith('TTPU1:'));
  assert.equal(s.refreshSec, 30);
  assert.equal(s.session.max, 1);
  assert.equal(s.session.subject, 'PROG (prac)');

  // uydan — rad
  assert.equal((await call('attend', S1, { body: { qr: s.qr, faceToken: tok1, location: home } })).error, 'outside_campus');
  // boshqa guruh talabasi
  const other = (await call('face', S3, { body: { mode: 'enroll', samples: [vec(3), near(vec(3), 0.01), near(vec(3), 0.02)] } })).faceToken;
  assert.equal((await call('attend', S3, { body: { qr: s.qr, faceToken: other, location: campus } })).error, 'wrong_group');
  // birinchi talaba — ok, limit to'ldi
  const ok = await call('attend', S1, { body: { qr: s.qr, faceToken: tok1, location: campus } });
  assert.equal(ok.ok, true);
  assert.equal(ok.subject, 'PROG (prac)');
  // ikkinchisi — QR yopilgan (limit)
  assert.equal((await call('attend', S2, { body: { qr: s.qr, faceToken: tok2, location: campus } })).error, 'session_full');
  const live = await call('teacher', TEACHER, { query: { action: 'live', session: s.session.id, qr: '1' } });
  assert.equal(live.closed, true);
  assert.equal(live.qr, null);
  assert.deepEqual(live.students.map((x) => x.name), ['Subxonov Maqsud']);
  // boshqa ustoz bu sessiyani ko'ra olmaydi
  assert.equal((await call('teacher', TEACHER2, { query: { action: 'live', session: s.session.id } })).error, 'session_not_found');

  // Admin joylashuvni o'chiradi -> uydan ham ishlaydi
  assert.equal((await call('admin', ADMIN, { query: { action: 'setting' }, body: { key: 'geofence_enabled', value: false } })).ok, true);
  assert.equal((await call('me', S2)).campus.enabled, false);
  const s2 = await call('teacher', TEACHER, { query: { action: 'qr-start' }, body: { group: 'CYB3-26', maxStudents: 30, durationMin: 1 } });
  assert.equal((await call('attend', S2, { body: { qr: s2.qr, faceToken: tok2, location: null } })).ok, true);
  // ustoz qo'lda yopadi
  await call('teacher', TEACHER, { query: { action: 'stop' }, body: { session: s2.session.id } });
  assert.equal((await call('attend', S1, { body: { qr: s2.qr, faceToken: tok1, location: null } })).error, 'session_closed');
  await call('admin', ADMIN, { query: { action: 'setting' }, body: { key: 'geofence_enabled', value: true } });
  assert.equal((await call('attend', S1, { body: { qr: s2.qr, faceToken: tok1, location: home } })).error, 'outside_campus');
});

test("Qo'lda davomat jadvali", async () => {
  const sh = await call('teacher', TEACHER, { query: { action: 'sheet', group: 'CYB3-26' } });
  assert.ok(sh.session); // bugungi oxirgi dars (QR dan)
  const n = await call('teacher', TEACHER, { query: { action: 'sheet-new' }, body: { group: 'CYB3-26' } });
  assert.equal(n.session.mode, 'manual');
  assert.deepEqual(n.students.map((x) => x.present), [false, false]);
  await call('teacher', TEACHER, { query: { action: 'mark' }, body: { session: n.session.id, student: S2, present: true } });
  let again = await call('teacher', TEACHER, { query: { action: 'sheet', group: 'CYB3-26' } });
  assert.equal(again.session.id, n.session.id);
  assert.equal(again.students.find((x) => x.id === String(S2)).method, 'manual');
  await call('teacher', TEACHER, { query: { action: 'mark' }, body: { session: n.session.id, student: S2, present: false } });
  again = await call('teacher', TEACHER, { query: { action: 'sheet', group: 'CYB3-26' } });
  assert.equal(again.students.filter((x) => x.present).length, 0);
  // boshqa guruh talabasini belgilab bo'lmaydi
  assert.equal((await call('teacher', TEACHER, { query: { action: 'mark' }, body: { session: n.session.id, student: S3, present: true } })).error, 'not_in_group');
  // statistikaga qo'lda sessiyalar ham kiradi
  const st = await call('stats', S1);
  assert.equal(st.total, 3);
  assert.equal(st.attended, 1);
});

test('Vazifalar: ustoz yuklaydi, faqat o\'sha guruh ko\'radi, yakunlash', async () => {
  const up = await call('tasks', TEACHER, { query: { action: 'upload-url' }, body: { group: 'CYB3-26', fileName: 'Lab 3.pdf', size: 12345 } });
  assert.match(up.path, new RegExp(`^t${TEACHER}/[0-9a-f-]{36}\\.pdf$`));
  assert.equal((await call('tasks', TEACHER, { query: { action: 'upload-url' }, body: { group: 'CYB3-26', fileName: 'big.zip', size: 99e6 } })).error, 'file_too_big');
  // boshqa ustozning yo'lini ulab bo'lmaydi
  assert.equal((await call('tasks', TEACHER, { query: { action: 'create' }, body: { group: 'CYB3-26', description: 'abc def', file: { path: 't999/' + crypto.randomUUID() + '.pdf' } } })).error, 'bad_file');
  const c = await call('tasks', TEACHER, { query: { action: 'create' }, body: { group: 'CYB3-26', subject: 'PROG (prac)', description: '45-bet, 3-5 mashqlar', file: { path: up.path, name: 'Lab 3.pdf', size: 12345, mime: 'application/pdf' } } });
  assert.equal(c.ok, true);
  assert.equal(c.task.subject, 'PROG (prac)');
  assert.equal(c.task.teacher, 'Khabibullaev Khamidulla');

  const l1 = await call('tasks', S1, { query: { action: 'list' } });
  assert.equal(l1.tasks.length, 1);
  assert.equal(l1.tasks[0].file.name, 'Lab 3.pdf');
  assert.ok(!('file_path' in l1.tasks[0]));
  assert.match((await call('tasks', S1, { query: { action: 'file', id: c.task.id } })).url, /^https:\/\/sb\/dl\/tasks\/t2222222\//);
  // boshqa guruh
  assert.equal((await call('tasks', S3, { query: { action: 'list' } })).tasks.length, 0);
  assert.equal((await call('tasks', S3, { query: { action: 'file', id: c.task.id } })).error, 'task_not_found');
  // talaba yakunlay olmaydi, boshqa ustoz ham
  assert.equal((await call('tasks', S1, { query: { action: 'complete' }, body: { id: c.task.id } })).error, 'wrong_role');
  assert.equal((await call('tasks', TEACHER2, { query: { action: 'complete' }, body: { id: c.task.id } })).error, 'task_not_found');
  assert.equal((await call('tasks', TEACHER, { query: { action: 'complete' }, body: { id: c.task.id } })).ok, true);
  assert.equal((await call('tasks', S1, { query: { action: 'list' } })).tasks[0].status, 'done');
  assert.equal((await call('tasks', TEACHER, { query: { action: 'delete' }, body: { id: c.task.id } })).ok, true);
  assert.deepEqual(storageOps.at(-1), ['remove', up.path]);
});

test('Starosta: faqat admin tayinlaydi, faqat o\'z guruhini ko\'radi', async () => {
  // oddiy o'quvchi ko'ra olmaydi
  assert.equal((await call('stats', S2, { query: { view: 'class' } })).error, 'starosta_only');
  assert.equal((await call('me', S2)).user.starosta, false);
  // ustozni starosta qilib bo'lmaydi; o'quvchini — bo'ladi
  assert.equal((await call('admin', ADMIN, { query: { action: 'starosta' }, body: { id: TEACHER, value: true } })).error, 'students_only');
  assert.equal((await call('admin', ADMIN, { query: { action: 'starosta' }, body: { id: S2, value: true } })).ok, true);
  assert.equal((await call('me', S2)).user.starosta, true);
  assert.equal((await call('admin', ADMIN, { query: { action: 'users', role: 'student' } })).users.find((u) => u.id === String(S2)).starosta, true);

  const c = await call('stats', S2, { query: { view: 'class' } });
  assert.equal(c.group, 'CYB3-26');
  assert.equal(c.total, 3);
  assert.deepEqual(c.students.map((x) => [x.name, x.attended, x.missed, x.rate, x.starosta]), [
    ['Ismonaliyev Behruzbek', 1, 2, 33, true],
    ['Subxonov Maqsud', 1, 2, 33, false],
  ]);
  assert.equal(c.sessions.length, 3);
  assert.ok(c.sessions.every((x) => x.teacher === 'Khabibullaev Khamidulla' && x.of === 2));

  // birinchi QR darsi: Maqsud keldi, Behruzbek kelmadi
  const first = c.sessions.at(-1);
  const d = await call('stats', S2, { query: { view: 'session', id: first.id } });
  assert.deepEqual(d.present.map((x) => [x.name, x.method]), [['Subxonov Maqsud', 'qr']]);
  assert.deepEqual(d.absent.map((x) => x.name), ['Ismonaliyev Behruzbek']);
  assert.equal(d.session.teacher, 'Khabibullaev Khamidulla');

  // boshqa guruh darsini ko'ra olmaydi
  T.lesson_sessions.push({ id: crypto.randomUUID(), group_code: 'CYB1-26', subject: 'X', started_at: new Date().toISOString(), ends_at: new Date().toISOString() });
  assert.equal((await call('stats', S2, { query: { view: 'session', id: T.lesson_sessions.at(-1).id } })).error, 'session_not_found');

  // starostalikdan olish
  assert.equal((await call('admin', ADMIN, { query: { action: 'starosta' }, body: { id: S2, value: false } })).ok, true);
  assert.equal((await call('stats', S2, { query: { view: 'class' } })).error, 'starosta_only');
});

test("O'chirish qoidalari", async () => {
  assert.equal((await call('admin', ADMIN, { query: { action: 'user-delete' }, body: { id: OWNER } })).error, 'cannot_delete_owner');
  assert.equal((await call('admin', ADMIN, { query: { action: 'user-delete' }, body: { id: ADMIN } })).error, 'cannot_delete_self');
  assert.equal((await call('admin', ADMIN, { query: { action: 'group-delete' }, body: { code: 'CYB1-26' } })).error, 'group_not_empty');
  assert.equal((await call('admin', ADMIN, { query: { action: 'user-delete' }, body: { id: S3 } })).ok, true);
  assert.equal((await call('me', S3)).error, 'not_allowed');
  assert.equal((await call('admin', ADMIN, { query: { action: 'group-delete' }, body: { code: 'CYB1-26' } })).ok, true);
  assert.equal((await call('admin', OWNER, { query: { action: 'user-delete' }, body: { id: ADMIN } })).ok, true);
  assert.equal((await call('admin', ADMIN, { query: { action: 'overview' } })).error, 'not_allowed');
  const users = await call('admin', OWNER, { query: { action: 'users' } });
  assert.ok(users.users.every((u) => !('face_descriptor' in u)));
});


test("v4: o'quvchi o'zi ro'yxatdan o'tadi -> admin tasdiqlaydi / rad etadi", async () => {
  const N1 = 9000001, N2 = 9000002, N3 = 9000003;
  // oldingi testda ADMIN o'chirilgan — Ega qayta qo'shadi
  assert.equal((await call('admin', OWNER, { body: { role: 'admin', id: String(ADMIN), name: 'Admin Adminov' }, query: { action: 'user-add' } })).ok, true);
  // noto'g'ri ma'lumotlar
  assert.equal((await call('me', N1, { body: { action: 'register', name: 'Ali', group: 'CYB3-26' } })).error, 'bad_name');
  assert.equal((await call('me', N1, { body: { action: 'register', name: 'Ali <b>x</b>', group: 'CYB3-26' } })).error, 'bad_name');
  assert.equal((await call('me', N1, { body: { action: 'register', name: 'Aliyev Vali', group: 'CYB9-99' } })).error, 'group_not_found');
  // allaqachon ro'yxatdagi odam ariza bera olmaydi
  assert.equal((await call('me', S1, { body: { action: 'register', name: 'Boshqa Odam', group: 'CYB3-26' } })).error, 'already_registered');

  // ariza -> pending, adminlarga tugmali xabar
  sentTg.length = 0;
  let r = await call('me', N1, { body: { action: 'register', name: "  to'xtayev   o'tkir ", group: 'CYB3-26' } });
  assert.equal(r.state, 'pending');
  assert.equal(r.name, "To'xtayev O'tkir");
  const notes = sentTg.filter((x) => x.url.endsWith('/sendMessage'));
  const chats = notes.map((x) => String(x.body.chat_id)).sort();
  assert.ok(chats.includes(String(OWNER)) && chats.includes(String(ADMIN)), 'Ega va adminlarga xabar boradi');
  assert.ok(!chats.includes(String(TEACHER)), 'ustozga bormaydi');
  assert.equal(notes[0].body.reply_markup.inline_keyboard[0][0].callback_data, `reg:1:${N1}`);
  // hali o'quvchi emas: ilova ochilmaydi, holati "pending"
  r = await call('me', N1);
  assert.equal(r.error, 'not_allowed');
  assert.equal(r.reg.status, 'pending');
  assert.equal(r.reg.name, "To'xtayev O'tkir");
  // xuddi shu ariza qayta yuborilsa — adminlarga qayta xabar bormaydi
  sentTg.length = 0;
  await call('me', N1, { body: { action: 'register', name: "To'xtayev O'tkir", group: 'CYB3-26' } });
  assert.equal(sentTg.filter((x) => x.url.endsWith('/sendMessage')).length, 0);

  // admin panelida ko'rinadi
  let ov = await call('admin', ADMIN, { query: { action: 'overview' } });
  assert.equal(ov.pendingRegs, 1);
  let list = await call('admin', ADMIN, { query: { action: 'registrations' } });
  assert.equal(list.registrations[0].id, String(N1));

  // ustoz yoki begona odam tasdiqlay olmaydi
  assert.equal((await call('admin', TEACHER, { body: { id: N1, approve: true }, query: { action: 'reg-decide' } })).error, 'wrong_role');
  sentTg.length = 0;
  await botCb(TEACHER, `reg:1:${N1}`);
  assert.equal(sentTg.find((x) => x.url.endsWith('/answerCallbackQuery')).body.show_alert, true);
  assert.equal(T.registrations.find((g) => g.telegram_id === N1).status, 'pending');

  // Telegramdagi tugma orqali tasdiqlash
  sentTg.length = 0;
  await botCb(OWNER, `reg:1:${N1}`);
  const u = T.bot_users.find((x) => x.telegram_id === N1);
  assert.equal(u.role, 'student');
  assert.equal(u.group_code, 'CYB3-26');
  assert.equal(u.full_name, "To'xtayev O'tkir");
  assert.ok(sentTg.some((x) => x.url.endsWith('/editMessageText') && /Tasdiqlandi/.test(x.body.text)));
  const toStudent = sentTg.find((x) => x.url.endsWith('/sendMessage') && x.body.chat_id === N1);
  assert.match(toStudent.body.text, /tasdiqlandi/);
  // endi ilova ochiladi, Face ID hali yo'q
  r = await call('me', N1);
  assert.equal(r.user.role, 'student');
  assert.equal(r.user.faceEnrolled, false);
  // ikkinchi admin keyinroq bossa — hech narsa buzilmaydi
  sentTg.length = 0;
  await botCb(ADMIN, `reg:0:${N1}`);
  assert.match(sentTg.find((x) => x.url.endsWith('/answerCallbackQuery')).body.text, /Avvalroq/);
  assert.ok(T.bot_users.some((x) => x.telegram_id === N1));

  // rad etish (admin panelidan) -> qayta ariza bera olmaydi
  await call('me', N2, { body: { action: 'register', name: 'Soxta Odam', group: 'CYB3-26' } });
  r = await call('admin', ADMIN, { body: { id: String(N2), approve: false }, query: { action: 'reg-decide' } });
  assert.equal(r.state, 'rejected');
  assert.ok(!T.bot_users.some((x) => x.telegram_id === N2));
  assert.equal((await call('me', N2)).reg.status, 'rejected');
  assert.equal((await call('me', N2, { body: { action: 'register', name: 'Soxta Odam', group: 'CYB3-26' } })).error, 'rejected');
  sentTg.length = 0;
  await botMsg(N2);
  assert.match(sentTg.find((x) => x.url.endsWith('/sendMessage')).body.text, /rad etilgan/);
  // admin qo'lda qo'shsa — kira oladi
  assert.equal((await call('admin', ADMIN, { body: { role: 'student', id: String(N2), name: 'Haqiqiy Odam', group: 'CYB3-26' }, query: { action: 'user-add' } })).ok, true);
  assert.equal((await call('me', N2)).user.name, 'Haqiqiy Odam');
  // o'chirilgan o'quvchi o'zi qayta kira olmaydi
  assert.equal((await call('admin', ADMIN, { body: { id: String(N2) }, query: { action: 'user-delete' } })).ok, true);
  assert.equal((await call('me', N2)).reg.status, 'rejected');

  // rejimlar: avtomatik -> darhol o'quvchi; o'chirilgan -> eski tartib
  assert.equal((await call('admin', ADMIN, { body: { key: 'registration_mode', value: 'bad' }, query: { action: 'setting' } })).error, 'bad_setting');
  assert.equal((await call('admin', ADMIN, { body: { key: 'registration_mode', value: 'auto' }, query: { action: 'setting' } })).ok, true);
  r = await call('me', N3, { body: { action: 'register', name: 'Tez Qoshilgan', group: 'CYB3-26' } });
  assert.equal(r.state, 'approved');
  assert.equal((await call('me', N3)).user.role, 'student');
  assert.equal((await call('admin', ADMIN, { body: { key: 'registration_mode', value: 'off' }, query: { action: 'setting' } })).ok, true);
  r = await call('me', 9000004);
  assert.equal(r.reg.mode, 'off');
  assert.equal(r.reg.groups, undefined);
  assert.equal((await call('me', 9000004, { body: { action: 'register', name: 'Yopiq Rejim', group: 'CYB3-26' } })).error, 'registration_closed');
  sentTg.length = 0;
  await botMsg(9000004);
  assert.match(sentTg.find((x) => x.url.endsWith('/sendMessage')).body.text, /faqat TTPU/);
  await call('admin', ADMIN, { body: { key: 'registration_mode', value: 'approve' }, query: { action: 'setting' } });
});
