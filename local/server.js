// Botni o'z kompyuteringizda ishga tushirish:  npm run local
//
// Vercel'dagi bilan bir xil kod: /api/*.js funksiyalari + public/ sahifalari.
// Telegram Mini App, kamera (Face ID) va joylashuv faqat HTTPS da ishlaydi, shuning uchun
// kompyuter internetga Cloudflare "quick tunnel" orqali HTTPS manzil bilan chiqariladi
// (hisob ochish shart emas). Har ishga tushirishda manzil yangi bo'ladi — webhook va
// menyu tugmasi avtomatik yangilanadi.
//
// .env (loyiha papkasida) dagi qo'shimcha sozlamalar:
//   PORT=3000                 — mahalliy port
//   LOCAL_URL=https://...     — o'zingiz ishga tushirgan doimiy tunnel manzili (ngrok/cloudflared nomli tunnel);
//                               berilsa, Cloudflare quick tunnel ishga tushirilmaydi
//   NO_TUNNEL=1               — tunnelsiz, faqat http://localhost:PORT (Telegram ulanmaydi, faqat ko'rish uchun)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv, findTunnelUrl } from './util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error(`Node.js 20 yoki yangisi kerak (sizda ${process.versions.node}). https://nodejs.org dan LTS ni o'rnating.`);
  process.exit(1);
}

// ---------- .env ----------
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) {
    console.error(
      "❌ .env fayli topilmadi.\n" +
        '   1) .env.example ni nusxalab, nomini .env qiling (Windows: copy .env.example .env)\n' +
        '   2) Ichiga BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_SECRET, ADMIN_KEY qiymatlarini yozing.'
    );
    process.exit(1);
  }
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv();

const PORT = Number(process.env.PORT) || 3000;
const missing = ['BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_SECRET', 'ADMIN_KEY'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error('❌ .env da yetishmayapti: ' + missing.join(', '));
  process.exit(1);
}
if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(process.env.SUPABASE_URL)) {
  console.error(
    '❌ SUPABASE_URL noto\'g\'ri: "' + process.env.SUPABASE_URL + '"\n' +
      '   Kerakli ko\'rinish: https://xxxxxxxx.supabase.co  (dashboard havolasi emas)'
  );
  process.exit(1);
}

// ---------- API funksiyalari (Vercel uslubida) ----------
const modules = new Map();
async function loadApi(name) {
  if (!/^[a-z0-9-]+$/i.test(name)) return null;
  const file = path.join(API, name + '.js');
  if (!fs.existsSync(file)) return null;
  if (!modules.has(name)) modules.set(name, import(pathToFileURL(file).href));
  return (await modules.get(name)).default;
}

async function runInternal(name, { query = {}, headers = {} } = {}) {
  const fn = await loadApi(name);
  const res = {
    statusCode: 200, body: undefined,
    setHeader() {}, end(s) { this.body = s; },
    get headersSent() { return this.body !== undefined; },
  };
  await fn({ method: 'GET', query, headers, body: undefined }, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* matn */ }
  return { status: res.statusCode, json, text: res.body };
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c); // ortiqchasini o'qib tashlaymiz, saqlamaymiz (javob yozilishi uchun ulanish uzilmaydi)
    });
    req.on('end', () => (size > limit ? reject(Object.assign(new Error('too_large'), { status: 413 })) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = ''; }
  if (rel.includes('\0')) rel = '/\0';
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Not found');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

let ready; // WEBAPP_URL aniq bo'lguncha so'rovlar kutadi (config import paytida o'qiladi)
const readyPromise = new Promise((r) => { ready = r; });

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.on('finish', () => {
    if (req.headers['x-local-probe']) return;
    if (res.statusCode >= 400) console.log(`${req.method} ${req.url.slice(0, 80)} -> ${res.statusCode} (${Date.now() - t0} ms)`);
  });
  try {
    await readyPromise;
    const url = new URL(req.url, 'http://localhost');
    const m = /^\/api\/([^/]+)\/?$/.exec(url.pathname);
    if (!m) return serveStatic(req, res, url.pathname);

    const fn = await loadApi(m[1]);
    if (!fn) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    }
    req.query = Object.fromEntries(url.searchParams);
    const raw = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
    if (/json/i.test(req.headers['content-type'] || '')) {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
    } else {
      req.body = raw || undefined;
    }
    await fn(req, res);
  } catch (e) {
    if (e.status !== 413) console.error('server xatosi:', e);
    if (!res.headersSent) {
      res.statusCode = e.status || 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify({ ok: false, error: e.status === 413 ? 'too_large' : 'server_error' }));
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`❌ ${PORT}-port band. Boshqa dastur ishlatyapti yoki bot allaqachon ochiq. .env ga PORT=3001 yozib ko'ring.`);
  else console.error(e);
  process.exit(1);
});

// ---------- HTTPS tunnel ----------
let tunnelProc = null;

function startTunnel() {
  return new Promise((resolve, reject) => {
    let done = false;
    const p = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
    tunnelProc = p;
    const onData = (buf) => {
      const url = findTunnelUrl(buf);
      if (url && !done) { done = true; resolve(url); }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => { if (!done) { done = true; reject(e); } });
    p.on('exit', (code) => {
      if (!done) { done = true; reject(new Error('cloudflared to\'xtadi (kod ' + code + ')')); }
      else { console.error('\n⚠️  Tunnel to\'xtadi — bot internetdan uzildi. Dasturni qayta ishga tushiring.'); process.exit(1); }
    });
    setTimeout(() => { if (!done) { done = true; reject(new Error('tunnel 40 soniyada ochilmadi')); } }, 40000);
  });
}

async function waitPublic(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url + '/api/me', { headers: { 'x-local-probe': '1' }, signal: AbortSignal.timeout(4000) });
      if (r.status === 401) return true; // bizning server javob berdi
    } catch { /* hali tayyor emas */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  await new Promise((r) => server.listen(PORT, r));
  console.log(`Server ${PORT}-portda ishga tushdi (http://localhost:${PORT})`);

  let publicUrl = null;
  if (process.env.NO_TUNNEL === '1') {
    process.env.WEBAPP_URL = `http://localhost:${PORT}`;
    console.log('NO_TUNNEL=1: tunnel yo\'q. Telegram bu manzilga ulana olmaydi.');
  } else if (process.env.LOCAL_URL) {
    publicUrl = process.env.LOCAL_URL.replace(/\/$/, '');
    if (!/^https:\/\//.test(publicUrl)) { console.error('❌ LOCAL_URL https:// bilan boshlanishi kerak'); process.exit(1); }
    console.log('Doimiy manzil (LOCAL_URL): ' + publicUrl + ` — tunnelni o'zingiz shu manzildan ${PORT}-portga ulang.`);
  } else {
    console.log('HTTPS tunnel ochilmoqda (Cloudflare)...');
    try {
      publicUrl = await startTunnel();
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.error(
          '\n❌ cloudflared o\'rnatilmagan. Windows PowerShell da:\n' +
            '     winget install --id Cloudflare.cloudflared\n' +
            '   keyin yangi PowerShell oynasi ochib, dasturni qayta ishga tushiring.'
        );
      } else console.error('❌ Tunnel ochilmadi: ' + e.message);
      process.exit(1);
    }
  }
  if (publicUrl) process.env.WEBAPP_URL = publicUrl;
  ready(); // endi handlerlar to'g'ri WEBAPP_URL bilan import qilinadi

  if (!publicUrl) return;
  process.stdout.write('Tunnel tayyor bo\'lishi kutilmoqda');
  const ok = await waitPublic(publicUrl, Number(process.env.LOCAL_PROBE_TRIES) || 30);
  console.log(ok ? ' ✓' : ' (javob yo\'q, baribir davom etamiz)');

  // Webhook + menyu — /api/setup bilan bir xil (Telegram DNS ni ko'rmasa, bir necha marta urinamiz)
  let setup = null;
  for (let i = 0; i < 8; i++) {
    setup = await runInternal('setup', { query: { key: process.env.ADMIN_KEY } });
    if (setup.json?.webhook?.ok) break;
    if (setup.status === 401 || setup.status === 500) break;
    if ([401, 404].includes(setup.json?.webhook?.error_code)) break; // BOT_TOKEN noto'g'ri — qayta urinish befoyda
    await new Promise((r) => setTimeout(r, 3000));
  }
  const j = setup?.json || {};
  if (!j.webhook?.ok) {
    console.error('❌ Webhook o\'rnatilmadi:', JSON.stringify(j.webhook || j.error || setup?.text));
    console.error('   BOT_TOKEN to\'g\'riligini tekshiring.');
    process.exit(1);
  }
  const mig = (k) => (String(j[k]).startsWith('ok') ? 'ok' : "YO'Q ← Supabase SQL Editor'da " + k + '.sql ni ishga tushiring');
  console.log(
    '\n✅ Bot mahalliy ishga tushdi\n' +
      `   Manzil:      ${publicUrl}\n` +
      `   Webhook:     ${j.info?.url || 'ok'}${j.info?.last_error_message ? '  (oxirgi xato: ' + j.info.last_error_message + ')' : ''}\n` +
      `   Baza:        v2 ${mig('migration_v2')}, v3 ${mig('migration_v3')}, v4 ${mig('migration_v4')}\n` +
      `   Storage:     ${j.storage}\n\n` +
      "Telegramda botga /start yozing. To'xtatish: Ctrl+C\n" +
      "Eslatma: kompyuter o'chsa yoki uxlab qolsa, bot ham ishlamaydi.\n" +
      "Tunnel manzili har ishga tushirishda o'zgaradi — undan keyin o'quvchilar botga /start ni qayta yozishi kerak."
  );
}

function shutdown() {
  try { tunnelProc?.kill(); } catch { /* */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => { try { tunnelProc?.kill(); } catch { /* */ } });

main().catch((e) => { console.error(e); process.exit(1); });
