import crypto from 'node:crypto';
import { config } from '../lib/config.js';
import { tg } from '../lib/telegram.js';
import { getUser } from '../lib/db.js';
import { regInfo, decideRegistration, regCardText } from '../lib/registration.js';

export function webhookSecret() {
  return crypto.createHash('sha256').update('wh:' + config.appSecret).digest('hex').slice(0, 48);
}

const TXT = {
  denied:
    "⛔ Kechirasiz, bu bot faqat TTPU ro'yxatdagi talabalari va o'qituvchilari uchun.\n\n" +
    "Sizning ID: <code>{id}</code>\nShu ID ni administratorga yuboring.",
  register:
    "👋 Assalomu alaykum! Siz hali ro'yxatdan o'tmagansiz.\n\n" +
    "Pastdagi tugmani bosing va <b>ism-familiyangiz</b> hamda <b>guruhingizni</b> kiriting." +
    "{approveNote}",
  pending:
    "⏳ Arizangiz ko'rib chiqilmoqda.\n\n👤 <b>{name}</b>\n🎓 Guruh: <b>{group}</b>\n\n" +
    "Administrator tasdiqlashi bilan sizga xabar keladi. Xato yozgan bo'lsangiz, tugma orqali tahrirlashingiz mumkin.",
  rejected:
    "❌ Ro'yxatdan o'tish arizangiz rad etilgan.\n\nSizning ID: <code>{id}</code>\n" +
    "Xato bo'lsa, guruh starostasi yoki administratorga murojaat qiling.",
  student:
    'Assalomu alaykum, <b>{name}</b>! 👋\nGuruh: <b>{group}</b>{starosta}\n\n' +
    "Davomat va vazifalar uchun pastdagi tugmani bosing.",
  teacher:
    'Assalomu alaykum, ustoz <b>{name}</b>! 👋\n\n' +
    "Davomat (QR yoki qo'lda), dars jadvali va vazifa yuklash uchun pastdagi tugmani bosing.",
  admin: 'Assalomu alaykum, <b>{name}</b>! 👋\nSiz <b>{role}</b> sifatida kirdingiz.\n\nBoshqaruv paneli uchun pastdagi tugmani bosing.',
};
const BTN = {
  student: '📲 Davomat ilovasi',
  teacher: "👨‍🏫 Ustoz paneli",
  admin: '🛠 Admin paneli',
};
const PAGE = { student: '/', teacher: '/teacher.html', admin: '/admin.html', owner: '/admin.html' };

const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => String(o[k] ?? ''));
const esc = (s) => String(s).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

export default async function handler(req, res) {
  // Faqat Telegram yuborgan so'rovlar
  if (req.method !== 'POST' || req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret()) {
    res.statusCode = 401;
    return res.end('unauthorized');
  }
  try {
    const update = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const msg = update.message;
    if (msg && msg.chat?.type === 'private' && msg.from) {
      await onMessage(msg);
    } else if (update.callback_query) {
      await onCallback(update.callback_query);
    }
  } catch (e) {
    console.error('bot error', e);
  }
  // Telegram qayta yubormasligi uchun har doim 200
  res.statusCode = 200;
  res.end('ok');
}

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const user = await getUser(msg.from.id, msg.from);

  if (!user) return onUnknown(chatId, msg.from.id);

  const kind = user.role === 'owner' ? 'admin' : user.role;
  const url = config.webAppUrl + PAGE[user.role];
  await tg('setChatMenuButton', {
    chat_id: chatId,
    menu_button: { type: 'web_app', text: kind === 'student' ? 'Davomat' : 'Panel', web_app: { url } },
  });
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: fill(TXT[kind], {
      name: esc(user.full_name),
      group: esc(user.group_code || '—'),
      starosta: user.is_starosta ? ' • Starosta ⭐' : '',
      role: user.role === 'owner' ? 'Ega' : 'Admin',
    }),
    reply_markup: { inline_keyboard: [[{ text: BTN[kind], web_app: { url } }]] },
  });
}

/** Ro'yxatda yo'q foydalanuvchi: rejimga qarab ro'yxatdan o'tish tugmasi yoki rad xabari */
async function onUnknown(chatId, id) {
  const reg = await regInfo(id);
  const url = config.webAppUrl + '/';
  if (reg.mode === 'off' || reg.status === 'rejected') {
    await tg('setChatMenuButton', { chat_id: chatId, menu_button: { type: 'commands' } });
    return tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: fill(reg.mode === 'off' ? TXT.denied : TXT.rejected, { id }) });
  }
  await tg('setChatMenuButton', {
    chat_id: chatId,
    menu_button: { type: 'web_app', text: "Ro'yxatdan o'tish", web_app: { url } },
  });
  const pending = reg.status === 'pending';
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: pending
      ? fill(TXT.pending, { name: esc(reg.name), group: esc(reg.group) })
      : fill(TXT.register, { approveNote: reg.mode === 'approve' ? '\n\nArizangizni administrator tasdiqlagach, ilova ochiladi.' : '' }),
    reply_markup: { inline_keyboard: [[{ text: pending ? '✏️ Arizani tahrirlash' : "📝 Ro'yxatdan o'tish", web_app: { url } }]] },
  });
}

/** Admin xabaridagi "Tasdiqlash / Rad etish" tugmalari */
async function onCallback(cq) {
  const m = /^reg:([01]):(\d{5,15})$/.exec(cq.data || '');
  if (!m) return tg('answerCallbackQuery', { callback_query_id: cq.id });
  const admin = await getUser(cq.from.id, cq.from);
  if (!admin || !['admin', 'owner'].includes(admin.role)) {
    return tg('answerCallbackQuery', { callback_query_id: cq.id, text: "Ruxsat yo'q", show_alert: true });
  }
  let r;
  try {
    r = await decideRegistration(Number(m[2]), m[1] === '1', admin);
  } catch (e) {
    const text = e.code === 'group_not_found' ? "Bu guruh o'chirilgan — o'quvchini qo'lda qo'shing" : e.code === 'registration_not_found' ? 'Ariza topilmadi' : 'Xatolik';
    if (!e.status) console.error('decide', e);
    return tg('answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: true });
  }
  const verdict =
    r.state === 'approved' ? '✅ Tasdiqlandi' : r.state === 'rejected' ? '❌ Rad etildi' : r.state;
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: r.already ? `Avvalroq hal qilingan: ${verdict}` : verdict });
  if (cq.message) {
    await tg('editMessageText', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      parse_mode: 'HTML',
      text:
        regCardText({ full_name: r.name, group_code: r.group, telegram_id: r.id }) +
        `\n\n<b>${verdict}</b>` + (r.already ? '' : ` — ${esc(admin.full_name)}`),
    });
  }
}
