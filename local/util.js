// local/server.js uchun sof yordamchilar (testlanadi)

/** .env matnini {KEY: value} ga aylantiradi (izohlar, tirnoqlar, `export` qo'llab-quvvatlanadi). */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

/** cloudflared chiqishidan trycloudflare.com manzilini topadi. */
export function findTunnelUrl(text) {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(String(text));
  return m ? m[0] : null;
}
