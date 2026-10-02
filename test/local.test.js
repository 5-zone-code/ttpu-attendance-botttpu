import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, findTunnelUrl } from '../local/util.js';

test('.env o\'qish: izoh, tirnoq, bo\'sh joy, BOM, CRLF, = belgisi qiymat ichida', () => {
  const env = parseEnv('﻿# izoh\r\nBOT_TOKEN=123:ABC\r\n  APP_SECRET = "a b=c" \nADMIN_KEY=\'x\'\nexport PORT=3001 # port\nBAD LINE\nEMPTY=\nSUPABASE_URL=https://a.supabase.co\n');
  assert.deepEqual(env, {
    BOT_TOKEN: '123:ABC', APP_SECRET: 'a b=c', ADMIN_KEY: 'x', PORT: '3001', EMPTY: '', SUPABASE_URL: 'https://a.supabase.co',
  });
});

test('cloudflared chiqishidan tunnel manzilini topish', () => {
  const log = '2026-09-30T10:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...\n' +
    '2026-09-30T10:00:02Z INF +--------------------------------------------------------------------------------------------+\n' +
    '2026-09-30T10:00:02Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |\n' +
    '2026-09-30T10:00:02Z INF |  https://random-words-here-1234.trycloudflare.com                                          |\n';
  assert.equal(findTunnelUrl(log), 'https://random-words-here-1234.trycloudflare.com');
  assert.equal(findTunnelUrl('api.trycloudflare.com bilan bog\'lanmoqda'), null);
  assert.equal(findTunnelUrl(''), null);
});
