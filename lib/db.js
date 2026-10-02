import { createClient } from '@supabase/supabase-js';
import { config, assertConfig } from './config.js';

let client = null;

/** Faqat server tomonda ishlatiladigan Supabase klienti (service key). */
export function db() {
  if (!client) {
    assertConfig(['supabaseUrl', 'supabaseServiceKey']);
    client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Faqat testlar uchun: soxta klient o'rnatish */
export function _setClient(c) {
  client = c;
}

export const USER_COLS =
  'telegram_id, full_name, role, group_code, face_descriptor, face_enrolled_at, active, edupage_teacher_id, subjects, is_starosta';

export const isOwnerId = (id) => String(id) === config.ownerId;

/**
 * Foydalanuvchini oladi. Ega (OWNER_ID) har doim 'owner' — bazada yo'q bo'lsa ham
 * (tizimdan qulflanib qolmasligi uchun) va birinchi murojaatda bazaga yoziladi.
 */
export async function getUser(telegramId, tgUser = null) {
  let { data, error } = await db().from('bot_users').select(USER_COLS).eq('telegram_id', telegramId).maybeSingle();
  if (error && error.code === '42703') {
    // migration_v3.sql hali ishga tushirilmagan (is_starosta yo'q) — bot ishlashda davom etadi
    ({ data, error } = await db()
      .from('bot_users')
      .select(USER_COLS.replace(', is_starosta', ''))
      .eq('telegram_id', telegramId)
      .maybeSingle());
  }
  if (error) throw error;

  if (isOwnerId(telegramId)) {
    const hasRealName = data?.full_name && data.full_name !== 'Ega';
    const fullName = hasRealName ? data.full_name : tgName(tgUser) || 'Ega';
    if (!data || data.role !== 'owner' || fullName !== data.full_name) {
      await db()
        .from('bot_users')
        .upsert({ telegram_id: Number(telegramId), full_name: fullName, role: 'owner', group_code: null, active: true }, { onConflict: 'telegram_id' });
    }
    return { ...(data || {}), telegram_id: Number(telegramId), full_name: fullName, role: 'owner', active: true };
  }

  if (!data || data.active === false) return null;
  return data;
}

function tgName(u) {
  if (!u) return '';
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
}

// ---- Sozlamalar (30 soniya kesh) ----
const settingsCache = { at: 0, data: null };
const DEFAULT_SETTINGS = { geofence_enabled: true };

export async function getSettings(force = false) {
  if (!force && settingsCache.data && Date.now() - settingsCache.at < 30000) return settingsCache.data;
  const { data, error } = await db().from('app_settings').select('key, value');
  if (error) {
    console.error('settings', error);
    return settingsCache.data || DEFAULT_SETTINGS;
  }
  const out = { ...DEFAULT_SETTINGS };
  for (const r of data || []) out[r.key] = r.value;
  settingsCache.data = out;
  settingsCache.at = Date.now();
  return out;
}

export async function setSetting(key, value, by) {
  const { error } = await db()
    .from('app_settings')
    .upsert({ key, value, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  settingsCache.data = null;
}

export async function groupExists(code) {
  const { data, error } = await db().from('groups').select('code').eq('code', code).maybeSingle();
  if (error) throw error;
  return !!data;
}
