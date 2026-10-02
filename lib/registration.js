// O'quvchining o'zi ro'yxatdan o'tishi (v4).
// Ro'yxatda yo'q odam ilovani ochadi -> ism-familiya + guruh -> ariza.
// Rejim (app_settings.registration_mode): approve (admin tasdiqlaydi) | auto (darhol) | off (faqat admin qo'shadi).
import { db, getSettings, groupExists, isOwnerId } from './db.js';
import { tg } from './telegram.js';
import { config } from './config.js';
import { HttpError, cleanText } from './http.js';

export const REG_MODES = ['approve', 'auto', 'off'];
const MISSING_TABLE = ['42P01', 'PGRST205'];

export async function regMode() {
  const s = await getSettings();
  return REG_MODES.includes(s.registration_mode) ? s.registration_mode : 'approve';
}

/** "subxonov   maqsud" -> "Subxonov Maqsud". Faqat harflar, apostrof va chiziqcha; kamida 2 so'z. */
export function normalizeName(raw) {
  const s = cleanText(raw, 80);
  const words = s.split(' ').filter(Boolean);
  if (words.length < 2 || s.length < 5) return null;
  const WORD = /^\p{L}[\p{L}'ʻʼ‘’`-]*$/u;
  if (!words.every((w) => WORD.test(w))) return null;
  return words.map((w) => w.charAt(0).toLocaleUpperCase('uz') + w.slice(1)).join(' ');
}

const tgName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim().slice(0, 80) || null;

async function getReg(id) {
  const { data, error } = await db()
    .from('registrations')
    .select('telegram_id, full_name, group_code, tg_username, tg_name, status, created_at')
    .eq('telegram_id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Ro'yxatda yo'q foydalanuvchi uchun: rejim, arizasi holati va tanlash mumkin bo'lgan guruhlar. */
export async function regInfo(id) {
  const mode = await regMode();
  if (mode === 'off') return { mode };
  try {
    const [reg, { data: groups, error }] = await Promise.all([
      getReg(id),
      db().from('groups').select('code').order('code'),
    ]);
    if (error) throw error;
    return {
      mode,
      status: reg?.status || null,
      name: reg?.full_name || null,
      group: reg?.group_code || null,
      groups: groups.map((g) => g.code),
    };
  } catch (e) {
    if (MISSING_TABLE.includes(e.code)) return { mode: 'off' }; // migration_v4.sql hali ishga tushirilmagan
    throw e;
  }
}

/** Ariza yuborish (yoki kutilayotgan arizani tahrirlash). */
export async function submitRegistration(tgUser, input) {
  const id = Number(tgUser.id);
  const mode = await regMode();
  if (mode === 'off' || isOwnerId(id)) throw new HttpError(403, 'registration_closed');

  const { data: existing, error: e0 } = await db().from('bot_users').select('telegram_id, active').eq('telegram_id', id).maybeSingle();
  if (e0) throw e0;
  if (existing) throw new HttpError(409, existing.active === false ? 'blocked' : 'already_registered');

  const name = normalizeName(input?.name);
  if (!name) throw new HttpError(400, 'bad_name');
  const group = cleanText(input?.group, 40);
  if (!group || !(await groupExists(group))) throw new HttpError(400, 'group_not_found');

  const prev = await getReg(id);
  if (prev?.status === 'rejected') throw new HttpError(403, 'rejected');

  const now = new Date().toISOString();
  const row = {
    telegram_id: id,
    full_name: name,
    group_code: group,
    tg_username: tgUser.username ? String(tgUser.username).slice(0, 64) : null,
    tg_name: tgName(tgUser),
    updated_at: now,
  };

  if (mode === 'auto') {
    const { error } = await db().from('bot_users').insert({ telegram_id: id, full_name: name, role: 'student', group_code: group });
    if (error && error.code !== '23505') throw error;
    const { error: e2 } = await db()
      .from('registrations')
      .upsert({ ...row, status: 'approved', decided_at: now, decided_by: null }, { onConflict: 'telegram_id' });
    if (e2) throw e2;
    return { state: 'approved', name, group };
  }

  const { error } = await db().from('registrations').upsert({ ...row, status: 'pending' }, { onConflict: 'telegram_id' });
  if (error) throw error;
  // Adminlarga faqat yangi yoki o'zgargan ariza haqida xabar
  if (!prev || prev.full_name !== name || prev.group_code !== group) {
    await notifyAdmins({ ...row, isEdit: !!prev }).catch((e) => console.error('notify admins', e));
  }
  return { state: 'pending', name, group };
}

/** Admin qarori. Allaqachon hal qilingan bo'lsa — hech narsa o'zgarmaydi. */
export async function decideRegistration(id, approve, admin) {
  const reg = await getReg(id);
  if (!reg) throw new HttpError(404, 'registration_not_found');
  const out = { name: reg.full_name, group: reg.group_code, id: String(reg.telegram_id) };
  if (reg.status !== 'pending') return { ...out, state: reg.status, already: true };

  if (approve && !(await groupExists(reg.group_code))) throw new HttpError(409, 'group_not_found');

  // Avval arizani "egallab olamiz": ikki admin bir vaqtda bossa, faqat bittasi o'tadi
  const status = approve ? 'approved' : 'rejected';
  const { data: claimed, error } = await db()
    .from('registrations')
    .update({ status, decided_by: admin.telegram_id, decided_at: new Date().toISOString() })
    .eq('telegram_id', reg.telegram_id)
    .eq('status', 'pending')
    .select('telegram_id');
  if (error) throw error;
  if (!claimed?.length) {
    const now = await getReg(id);
    return { ...out, state: now?.status || status, already: true };
  }

  if (approve) {
    const { error: e2 } = await db()
      .from('bot_users')
      .insert({ telegram_id: reg.telegram_id, full_name: reg.full_name, role: 'student', group_code: reg.group_code, added_by: admin.telegram_id });
    if (e2 && e2.code !== '23505') {
      await db().from('registrations').update({ status: 'pending', decided_by: null, decided_at: null }).eq('telegram_id', reg.telegram_id);
      throw e2;
    }
  }

  await notifyStudent(reg, approve).catch((e) => console.error('notify student', e));
  return { ...out, state: status };
}

export async function pendingRegistrations() {
  const { data, error } = await db()
    .from('registrations')
    .select('telegram_id, full_name, group_code, tg_username, tg_name, created_at')
    .eq('status', 'pending')
    .order('created_at');
  if (error) {
    if (MISSING_TABLE.includes(error.code)) return [];
    throw error;
  }
  return data.map((r) => ({
    id: String(r.telegram_id),
    name: r.full_name,
    group: r.group_code,
    username: r.tg_username,
    tgName: r.tg_name,
    createdAt: r.created_at,
  }));
}

/** Admin qo'lda qo'shgan yoki o'chirgan foydalanuvchining eski arizasini tozalash. */
export async function clearRegistration(id) {
  const { error } = await db().from('registrations').delete().eq('telegram_id', id);
  if (error && !MISSING_TABLE.includes(error.code)) throw error;
}

/** O'chirilgan o'quvchi: arizasi "rad etilgan" deb belgilanadi, o'zi qayta ro'yxatdan o'ta olmaydi. */
export async function blockRegistration(u, by) {
  if (u.role !== 'student' || !u.group_code) return clearRegistration(u.telegram_id);
  const now = new Date().toISOString();
  const { error } = await db().from('registrations').upsert(
    { telegram_id: u.telegram_id, full_name: u.full_name, group_code: u.group_code, status: 'rejected', decided_by: by, decided_at: now, updated_at: now },
    { onConflict: 'telegram_id' }
  );
  if (error && !MISSING_TABLE.includes(error.code)) throw error;
}

// ---- Telegram xabarlari ----
const esc = (s) => String(s ?? '').replace(/[<&>]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

export function regCardText(r) {
  return (
    `📝 <b>${r.isEdit ? 'Ariza tahrirlandi' : 'Yangi ariza'}</b>\n\n` +
    `👤 <b>${esc(r.full_name)}</b>\n` +
    `🎓 Guruh: <b>${esc(r.group_code)}</b>\n` +
    `🆔 <code>${r.telegram_id}</code>` +
    (r.tg_username ? `  •  @${esc(r.tg_username)}` : '') +
    (r.tg_name ? `\n💬 Telegramdagi ismi: ${esc(r.tg_name)}` : '')
  );
}

async function notifyAdmins(r) {
  const { data, error } = await db().from('bot_users').select('telegram_id').in('role', ['admin', 'owner']);
  if (error) throw error;
  const ids = new Set((data || []).map((a) => String(a.telegram_id)));
  if (config.ownerId) ids.add(String(config.ownerId));
  const markup = {
    inline_keyboard: [
      [
        { text: '✅ Tasdiqlash', callback_data: `reg:1:${r.telegram_id}` },
        { text: '❌ Rad etish', callback_data: `reg:0:${r.telegram_id}` },
      ],
    ],
  };
  await Promise.all(
    [...ids].map((chat_id) => tg('sendMessage', { chat_id, parse_mode: 'HTML', text: regCardText(r), reply_markup: markup }))
  );
}

async function notifyStudent(reg, approved) {
  if (approved) {
    const url = config.webAppUrl + '/';
    await tg('setChatMenuButton', { chat_id: reg.telegram_id, menu_button: { type: 'web_app', text: 'Davomat', web_app: { url } } });
    return tg('sendMessage', {
      chat_id: reg.telegram_id,
      parse_mode: 'HTML',
      text: `✅ Arizangiz tasdiqlandi!\n\n👤 <b>${esc(reg.full_name)}</b>\n🎓 Guruh: <b>${esc(reg.group_code)}</b>\n\nIlovani ochib, Face ID ni saqlang.`,
      reply_markup: { inline_keyboard: [[{ text: '📲 Davomat ilovasi', web_app: { url } }]] },
    });
  }
  return tg('sendMessage', {
    chat_id: reg.telegram_id,
    text: "❌ Ro'yxatdan o'tish arizangiz rad etildi.\nXato bo'lsa, guruh starostasi yoki administratorga murojaat qiling.",
  });
}
