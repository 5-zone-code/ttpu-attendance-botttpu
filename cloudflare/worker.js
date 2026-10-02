// Cloudflare Workers kirish nuqtasi.
// /api/* so'rovlari shu yerga keladi (wrangler.jsonc: run_worker_first), sahifalar esa public/ dan
// Cloudflare'ning o'zi beradi. Vercel uslubidagi (req, res) funksiyalar o'zgarishsiz ishlatiladi —
// bu fayl faqat Request/Response <-> req/res o'rtasidagi ko'prik.

const API = {
  admin: () => import('../api/admin.js'),
  attend: () => import('../api/attend.js'),
  bot: () => import('../api/bot.js'),
  face: () => import('../api/face.js'),
  me: () => import('../api/me.js'),
  setup: () => import('../api/setup.js'),
  stats: () => import('../api/stats.js'),
  tasks: () => import('../api/tasks.js'),
  teacher: () => import('../api/teacher.js'),
  timetable: () => import('../api/timetable.js'),
};

const MAX_BODY = 2 * 1024 * 1024;
const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = /^\/api\/([^/]+)\/?$/.exec(url.pathname);
    const load = m && Object.hasOwn(API, m[1]) ? API[m[1]] : null;
    // "/" -> index.html (html_handling "none" bo'lgani uchun yo'naltirishsiz, o'zimiz xaritalaymiz)
    if (url.pathname === '/') return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    if (!load) {
      // /api/* dan tashqari narsa bu yerga kelmasligi kerak; kelsa — sahifalarga uzatamiz
      return m ? json(404, { ok: false, error: 'not_found' }) : env.ASSETS.fetch(request);
    }

    // Mini App manzili: o'zi turgan joy (workers.dev yoki o'z domeningiz). Eski Vercel WEBAPP_URL e'tiborga olinmaydi.
    // Boshqa manzil kerak bo'lsa (masalan o'z domeningiz), PUBLIC_URL o'zgaruvchisini bering.
    process.env.WEBAPP_URL = (env.PUBLIC_URL || url.origin).replace(/\/$/, '');

    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_BODY) return json(413, { ok: false, error: 'too_large' });

    const req = {
      method: request.method,
      url: url.pathname + url.search,
      headers: Object.fromEntries(request.headers),
      query: Object.fromEntries(url.searchParams),
      body: undefined,
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json(413, { ok: false, error: 'too_large' });
      if (/json/i.test(req.headers['content-type'] || '')) {
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
      } else req.body = raw || undefined;
    }

    const out = { statusCode: 200, headers: new Headers(), body: undefined };
    const res = {
      get statusCode() { return out.statusCode; },
      set statusCode(v) { out.statusCode = v; },
      setHeader(k, v) { out.headers.set(k, Array.isArray(v) ? v.join(', ') : String(v)); },
      end(s) { out.body = s === undefined || s === null ? '' : s; },
      get headersSent() { return out.body !== undefined; },
    };
    try {
      const fn = (await load()).default;
      await fn(req, res);
    } catch (e) {
      console.error('server xatosi:', e);
      return json(500, { ok: false, error: 'server_error' });
    }
    if (out.body === undefined) return json(500, { ok: false, error: 'no_response' });
    out.headers.set('X-Content-Type-Options', 'nosniff');
    out.headers.set('Referrer-Policy', 'no-referrer');
    return new Response(out.statusCode === 204 || out.statusCode === 304 ? null : out.body, { status: out.statusCode, headers: out.headers });
  },
};
