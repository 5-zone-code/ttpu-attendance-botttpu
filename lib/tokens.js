import crypto from 'node:crypto';
import { config } from './config.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 32);
}

/** Kichik imzolangan token: base64url(JSON).imzo */
export function makeToken(obj, secret = config.appSecret) {
  const body = b64u(JSON.stringify(obj));
  return `${body}.${sign(body, secret)}`;
}

export function readToken(token, secret = config.appSecret) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// ---- Face token: yuz tekshiruvidan o'tgani haqida qisqa muddatli ruxsat ----
export function makeFaceToken(uid, now = Date.now()) {
  return makeToken({ t: 'face', u: String(uid), e: Math.floor(now / 1000) + config.faceTokenTtlSec });
}
export function checkFaceToken(token, uid, now = Date.now()) {
  const p = readToken(token);
  return !!(p && p.t === 'face' && p.u === String(uid) && p.e > now / 1000);
}

// ---- QR token: o'qituvchi ekranidagi aylanib turuvchi kod ----
// Format: "TTPU1:<token>" — boshqa QR kodlarni tez ajratish uchun prefiks.
export const QR_PREFIX = 'TTPU1:';
export function makeQrToken(sessionId, now = Date.now()) {
  return QR_PREFIX + makeToken({ t: 'qr', s: sessionId, i: Math.floor(now / 1000) });
}
/** { ok, sessionId, reason } */
export function checkQrToken(raw, now = Date.now()) {
  if (typeof raw !== 'string' || !raw.startsWith(QR_PREFIX)) return { ok: false, reason: 'qr_invalid' };
  const p = readToken(raw.slice(QR_PREFIX.length));
  if (!p || p.t !== 'qr' || !p.s) return { ok: false, reason: 'qr_invalid' };
  const age = now / 1000 - p.i;
  if (age > config.qrTtlSec || age < -5) return { ok: false, reason: 'qr_expired' };
  return { ok: true, sessionId: p.s };
}
