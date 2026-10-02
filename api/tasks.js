// Vazifalar
//   GET  ?action=list                                   -> talaba: guruhi vazifalari; ustoz: o'zi yuklaganlari
//   POST ?action=upload-url {group, fileName, size}     -> (ustoz) faylni to'g'ridan-to'g'ri Supabase ga yuklash uchun URL
//   POST ?action=create {group, subject, description, file?: {path, name, size, mime}}
//   POST ?action=complete {id}                          -> (ustoz) vazifani yakunlash
//   POST ?action=delete {id}                            -> (ustoz) vazifani o'chirish
//   GET  ?action=file&id=<id>                           -> vaqtinchalik yuklab olish havolasi
import crypto from 'node:crypto';
import { handler, requireRole, send, fail, body, HttpError, cleanText, cleanMultiline } from '../lib/http.js';
import { db } from '../lib/db.js';
import { config } from '../lib/config.js';
import { teacherContext, assertGroup, pickSubject } from '../lib/teacher.js';

const UUID = /^[0-9a-f-]{36}$/i;
const TASK_COLS = 'id, group_code, teacher_id, teacher_name, subject, description, file_name, file_size, file_mime, file_path, status, created_at, completed_at';

export default handler(async (req, res) => {
  const ctx = await requireRole(req, res, ['student', 'teacher']);
  if (!ctx) return;
  const { user } = ctx;
  const action = req.query?.action;
  const b = req.method === 'POST' ? body(req) : {};
  const isTeacher = user.role === 'teacher';

  if (action === 'list') {
    let q = db().from('tasks').select(TASK_COLS).order('created_at', { ascending: false }).limit(100);
    q = isTeacher ? q.eq('teacher_id', user.telegram_id) : q.eq('group_code', user.group_code);
    const { data, error } = await q;
    if (error) throw error;
    return send(res, 200, { ok: true, tasks: data.map(publicTask) });
  }

  if (action === 'file') {
    const t = await getTask(req.query.id);
    const allowed = isTeacher ? String(t.teacher_id) === String(user.telegram_id) : t.group_code === user.group_code;
    if (!allowed) throw new HttpError(404, 'task_not_found');
    if (!t.file_path) throw new HttpError(404, 'no_file');
    const { data, error } = await db()
      .storage.from(config.tasksBucket)
      .createSignedUrl(t.file_path, 3600, { download: t.file_name || true });
    if (error) throw error;
    return send(res, 200, { ok: true, url: data.signedUrl, name: t.file_name });
  }

  if (!isTeacher) return fail(res, 403, 'wrong_role');

  if (action === 'upload-url' && req.method === 'POST') {
    const tctx = await teacherContext(user);
    assertGroup(tctx, b.group);
    const size = Number(b.size);
    if (!(size > 0) || size > config.maxTaskFileMb * 1024 * 1024) throw new HttpError(400, 'file_too_big');
    const ext = (/\.([a-z0-9]{1,8})$/i.exec(String(b.fileName || '')) || [, 'bin'])[1].toLowerCase();
    const path = `t${user.telegram_id}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await db().storage.from(config.tasksBucket).createSignedUploadUrl(path);
    if (error) throw error;
    return send(res, 200, { ok: true, path, signedUrl: data.signedUrl, maxMb: config.maxTaskFileMb });
  }

  if (action === 'create' && req.method === 'POST') {
    const tctx = await teacherContext(user);
    const g = assertGroup(tctx, b.group);
    const description = cleanMultiline(b.description, 4000);
    if (description.length < 3) throw new HttpError(400, 'description_required');
    let file = null;
    if (b.file && b.file.path) {
      // faqat shu ustozga berilgan yo'l (boshqa birovning faylini ulab bo'lmaydi)
      if (!new RegExp(`^t${user.telegram_id}/[0-9a-f-]{36}\\.[a-z0-9]{1,8}$`).test(b.file.path)) throw new HttpError(400, 'bad_file');
      file = {
        file_path: b.file.path,
        file_name: cleanText(b.file.name, 200) || 'fayl',
        file_size: Number(b.file.size) || null,
        file_mime: cleanText(b.file.mime, 100) || null,
      };
    }
    const { data, error } = await db()
      .from('tasks')
      .insert({
        group_code: g.code,
        teacher_id: user.telegram_id,
        teacher_name: user.full_name,
        subject: pickSubject(tctx, user, g.code, b.subject),
        description,
        ...(file || {}),
      })
      .select(TASK_COLS)
      .single();
    if (error) throw error;
    return send(res, 200, { ok: true, task: publicTask(data) });
  }

  if ((action === 'complete' || action === 'delete') && req.method === 'POST') {
    const t = await getTask(b.id);
    if (String(t.teacher_id) !== String(user.telegram_id)) throw new HttpError(404, 'task_not_found');
    if (action === 'complete') {
      const { error } = await db().from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', t.id);
      if (error) throw error;
    } else {
      if (t.file_path) await db().storage.from(config.tasksBucket).remove([t.file_path]);
      const { error } = await db().from('tasks').delete().eq('id', t.id);
      if (error) throw error;
    }
    return send(res, 200, { ok: true });
  }

  fail(res, 400, 'bad_action');
});

async function getTask(id) {
  if (!UUID.test(String(id || ''))) throw new HttpError(400, 'bad_task');
  const { data, error } = await db().from('tasks').select(TASK_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'task_not_found');
  return data;
}

function publicTask(t) {
  return {
    id: t.id,
    group: t.group_code,
    teacher: t.teacher_name,
    subject: t.subject,
    description: t.description,
    file: t.file_path ? { name: t.file_name, size: t.file_size, mime: t.file_mime } : null,
    status: t.status,
    createdAt: t.created_at,
    completedAt: t.completed_at,
  };
}
