import { verifyInitData } from './telegram.js';
import { getUser } from './db.js';
import { config } from './config.js';
import crypto from 'node:crypto';

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export function fail(res, status, code, extra = {}) {
  return send(res, status, { ok: false, error: code, ...extra });
}

export const ADMIN_ROLES = ['admin', 'owner'];

/**
 * Mini App so'rovini tekshiradi: initData imzosi + oq ro'yxat + rol.
 * roles = null bo'lsa har qanday ro'yxatdagi foydalanuvchi o'tadi.
 */
export function authTelegram(req) {
  const initData = req.headers['x-telegram-init-data'];
  return verifyInitData(Array.isArray(initData) ? initData[0] : initData);
}

export async function requireRole(req, res, roles = null) {
  const auth = authTelegram(req);
  if (!auth) {
    fail(res, 401, 'unauthorized');
    return null;
  }
  const user = await getUser(auth.user.id, auth.user);
  if (!user) {
    fail(res, 403, 'not_allowed');
    return null;
  }
  if (roles && !roles.includes(user.role)) {
    fail(res, 403, 'wrong_role', { role: user.role });
    return null;
  }
  return { tgUser: auth.user, user };
}

export const requireStudent = (req, res) => requireRole(req, res, ['student']);

/** Faqat /api/setup uchun (brauzerdan bir martalik sozlash) */
export function checkAdminKey(key) {
  const a = Buffer.from(String(key || ''));
  const b = Buffer.from(config.adminKey || '');
  return !!config.adminKey && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body || '{}');
  } catch {
    return {};
  }
}

/** try/catch o'rami — xatolarni JSON ko'rinishida qaytaradi */
export const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) fail(res, e.status || 500, e.code && e.status ? e.code : 'server_error', { message: e.message });
  }
};

/** Kutilgan xato (4xx) */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const cleanText = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const cleanMultiline = (s, max) => String(s ?? '').replace(/\r/g, '').trim().slice(0, max);
export const isTgId = (v) => /^\d{5,15}$/.test(String(v ?? '').trim());
