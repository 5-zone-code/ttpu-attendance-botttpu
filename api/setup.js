// Bir martalik sozlash: brauzerda oching
//   https://<sizning-domen>.vercel.app/api/setup?key=<ADMIN_KEY>
import { config, assertConfig } from '../lib/config.js';
import { tg } from '../lib/telegram.js';
import { db } from '../lib/db.js';
import { checkAdminKey } from '../lib/http.js';
import { webhookSecret } from './bot.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!checkAdminKey(req.query?.key)) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false, error: 'bad_admin_key' }));
  }
  try {
    assertConfig(['botToken', 'appSecret', 'webAppUrl', 'supabaseUrl', 'supabaseServiceKey']);
    const hook = await tg('setWebhook', {
      url: config.webAppUrl + '/api/bot',
      secret_token: webhookSecret(),
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
    const cmds = await tg('setMyCommands', { commands: [{ command: 'start', description: 'Botni ishga tushirish' }] });
    // Umumiy menyu tugmasi — oddiy buyruqlar. Web App tugmasi har kimga o'z roli bo'yicha /start da beriladi.
    const menu = await tg('setChatMenuButton', { menu_button: { type: 'commands' } });
    const info = await tg('getWebhookInfo', {});

    // Vazifa fayllari uchun bucket (migratsiya SQL yaratmagan bo'lsa)
    let bucket = 'ok';
    const { data: b } = await db().storage.getBucket(config.tasksBucket);
    if (!b) {
      const { error } = await db().storage.createBucket(config.tasksBucket, { public: false, fileSizeLimit: 26214400 });
      bucket = error ? 'error: ' + error.message : 'created';
    }
    const { error: gErr } = await db().from('groups').select('code').limit(1);
    const { error: sErr } = await db().from('bot_users').select('is_starosta').limit(1);
    const { error: rErr } = await db().from('registrations').select('telegram_id').limit(1);

    res.end(
      JSON.stringify(
        {
          ok: true,
          webhook: hook,
          commands: cmds,
          menu,
          info: info.result,
          storage: bucket,
          migration_v2: gErr ? "YO'Q — supabase/migration_v2.sql ni ishga tushiring" : 'ok',
          migration_v3: sErr ? "YO'Q — supabase/migration_v3.sql ni ishga tushiring" : 'ok',
          migration_v4: rErr ? "YO'Q — supabase/migration_v4.sql ni ishga tushiring" : 'ok',
        },
        null,
        2
      )
    );
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}
