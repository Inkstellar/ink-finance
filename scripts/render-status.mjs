#!/usr/bin/env node
/**
 * Ping the deployed Render services and report whether they are awake.
 *
 *   npm run render:status
 *
 * Worth running before `npm run dev:use-render-server`: Render's free tier
 * suspends a web service after ~15 minutes of no inbound traffic, so the first
 * request can take 30–60s while the instance boots (a "cold start"). Hitting
 * the health endpoints first means the browser doesn't eat that delay.
 *
 * URLs come from `.env.render` so there is a single source of truth.
 */
import dotenv from 'dotenv';

dotenv.config({ path: '.env.render', quiet: true });

const API_URL = process.env.VITE_API_URL || 'http://localhost:3456';
const WEB_URL = process.env.WEB_URL || 'http://localhost:5179';
const BOT_URL = process.env.BOT_URL || '';

const TIMEOUT_MS = 90_000; // generous: covers a Render free-tier cold start

const targets = [
  { name: 'api', base: API_URL, path: '/api/health' },
  { name: 'bot', base: BOT_URL, path: '/health' },
  { name: 'web', base: WEB_URL, path: '/transactions' },
].filter((t) => t.base);

if (!BOT_URL) {
  console.warn('⚠️  BOT_URL is not set in .env.render — skipping the bot check.\n');
}

console.log('\n  Render service status (.env.render)\n');

let failures = 0;
const results = await Promise.all(
  targets.map(async (t) => {
    const url = `${t.base.replace(/\/$/, '')}${t.path}`;
    const started = Date.now();

    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ms = Date.now() - started;
      const body = (await res.text()).slice(0, 140).replace(/\s+/g, ' ');

      const ok = res.ok;
      if (!ok) failures++;

      return { ...t, url, ok, status: res.status, ms, body };
    } catch (err) {
      failures++;
      return {
        ...t,
        url,
        ok: false,
        status: 0,
        ms: Date.now() - started,
        body: err?.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS}ms` : String(err?.message ?? err),
      };
    }
  }),
);

for (const r of results) {
  const icon = r.ok ? '✅' : '❌';
  const cold = r.ms > 5_000 ? '  ⏱️  cold start (instance was suspended)' : '';

  console.log(`  ${icon} ${r.name.padEnd(3)} ${r.status || '—'}  ${r.ms}ms${cold}`);
  console.log(`      ${r.url}`);
  if (r.body) console.log(`      ${r.body}`);

  // The bot's health payload reports its own startedAt — if that is only a few
  // seconds old, the request we just made is what woke it up.
  if (r.name === 'bot' && r.ok) {
    const m = r.body.match(/"startedAt":"([^"]+)"/);
    if (m) {
      const age = Date.now() - new Date(m[1]).getTime();
      if (age < 60_000) {
        console.log('      ⚠️  up for only a few seconds — it had been suspended.');
      }
    }
  }
  console.log('');
}

if (failures) {
  console.log(`  ${failures} of ${results.length} service(s) did not respond.`);
  console.log('  Free-tier services wake on demand — retry in ~60s.\n');
  process.exit(1);
}

console.log('  All services are up. Run: npm run dev:use-render-server\n');
