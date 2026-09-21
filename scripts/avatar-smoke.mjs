#!/usr/bin/env node
/**
 * End-to-end check of profile-picture support against a running API.
 *
 *   npm run test:avatar                        # against http://localhost:3456
 *   API_BASE=https://ink-finance-web.onrender.com npm run test:avatar
 *
 * Creates a throwaway user with a random password, signs in, then exercises the
 * real HTTP flow: /me → upload → serve bytes → revalidate → delete, plus every
 * rejection path. Deletes the user in a `finally`, so a mid-test failure still
 * cleans up. Existing users and their pictures are never touched.
 *
 * Pointing API_BASE at a deployed service writes a user to the production
 * database, so prefer the local API.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = process.env.API_BASE || 'http://localhost:3456';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

/** Very small cookie jar: Auth.js needs the CSRF cookie echoed back. */
class Jar {
  cookies = new Map();
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

const callbackHeaders = (jar) => ({
  'Content-Type': 'application/x-www-form-urlencoded',
  'X-Auth-Return-Redirect': '1',
  cookie: jar.header(),
});

async function csrf(jar) {
  const res = await fetch(`${BASE}/api/auth/csrf`);
  jar.absorb(res);
  return (await res.json()).csrfToken;
}

/** A real, minimal PNG — 1×1, transparent. Byte-exactness is the point. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

async function main() {
  const email = `avatar-${Date.now()}@local.test`;
  const password = randomBytes(18).toString('base64url');

  const user = await prisma.finUser.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      name: 'Avatar Test',
      initials: 'AT',
    },
  });
  const uid = user.id;

  console.log(`\n  target: ${BASE}`);
  console.log(`  temp user: ${email} (deleted at the end)\n`);

  const api = (path, init = {}, jar) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(jar ? { cookie: jar.header() } : {}),
        ...(init.headers ?? {}),
      },
    });

  try {
    // ── /me is gated ────────────────────────────────────────
    check('/api/users/me rejects anonymous', (await api('/api/users/me')).status === 401);

    // ── Sign in ─────────────────────────────────────────────
    const jar = new Jar();
    {
      const csrfToken = await csrf(jar);
      const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: 'POST',
        headers: callbackHeaders(jar),
        body: new URLSearchParams({
          email,
          password,
          csrfToken,
          callbackUrl: BASE,
          redirect: 'false',
        }),
      });
      jar.absorb(res);
      const body = await res.json().catch(() => ({}));
      check('sign-in succeeds', !String(body.url ?? '').includes('error='), body.url ?? '');
    }

    // ── /me identifies the session ──────────────────────────
    {
      const res = await api('/api/users/me', {}, jar);
      const me = await res.json().catch(() => ({}));
      check('/api/users/me returns the signed-in user', res.status === 200 && me.email === email);
      check('/me reports no avatar yet', me.hasAvatar === false);
      check('/me never includes the raw avatar field', !('avatar' in me));
    }

    // ── The list endpoint must not ship image data ──────────
    {
      const users = await (await api('/api/users', {}, jar)).json();
      check(
        'user list carries no base64 avatar',
        Array.isArray(users) && users.every((u) => !('avatar' in u)),
      );
      check(
        'user list reports hasAvatar instead',
        Array.isArray(users) && users.every((u) => typeof u.hasAvatar === 'boolean'),
      );
    }

    // ── Nothing to serve before an upload ───────────────────
    check('avatar 404s before upload', (await api(`/api/users/${uid}/avatar`, {}, jar)).status === 404);

    // ── Rejections ──────────────────────────────────────────
    {
      const bad = await api(
        `/api/users/${uid}/avatar`,
        { method: 'PUT', body: JSON.stringify({ dataUrl: 'not-an-image' }) },
        jar,
      );
      check('a non-image data URL is rejected', bad.status === 400, `got ${bad.status}`);

      const noBody = await api(`/api/users/${uid}/avatar`, { method: 'PUT', body: '{}' }, jar);
      check('a missing dataUrl is rejected', noBody.status === 400, `got ${noBody.status}`);

      const gif = await api(
        `/api/users/${uid}/avatar`,
        {
          method: 'PUT',
          body: JSON.stringify({ dataUrl: `data:image/gif;base64,${PNG_BASE64}` }),
        },
        jar,
      );
      check('an unsupported image type is rejected', gif.status === 400, `got ${gif.status}`);

      // >1.5MB decoded. The mime is valid, so this exercises the size gate only.
      const huge = Buffer.alloc(1_600_000, 7).toString('base64');
      const tooBig = await api(
        `/api/users/${uid}/avatar`,
        {
          method: 'PUT',
          body: JSON.stringify({ dataUrl: `data:image/png;base64,${huge}` }),
        },
        jar,
      );
      check('an oversized image is rejected', tooBig.status === 413, `got ${tooBig.status}`);

      const ghost = await api(
        '/api/users/does-not-exist/avatar',
        { method: 'PUT', body: JSON.stringify({ dataUrl: PNG_DATA_URL }) },
        jar,
      );
      check('an unknown user is rejected', ghost.status === 404, `got ${ghost.status}`);
    }

    // ── Upload ──────────────────────────────────────────────
    {
      const res = await api(
        `/api/users/${uid}/avatar`,
        { method: 'PUT', body: JSON.stringify({ dataUrl: PNG_DATA_URL }) },
        jar,
      );
      const body = await res.json().catch(() => ({}));
      check('a PNG upload is accepted', res.status === 200, `got ${res.status}`);
      check('the upload reports hasAvatar', body.hasAvatar === true);
      check('the upload does not echo the image back', !('avatar' in body));
    }

    // ── Serve the bytes ─────────────────────────────────────
    let etag;
    {
      const res = await api(`/api/users/${uid}/avatar`, {}, jar);
      const bytes = Buffer.from(await res.arrayBuffer());
      etag = res.headers.get('etag');
      check('the avatar is served', res.status === 200, `got ${res.status}`);
      check('the content type is the uploaded type', res.headers.get('content-type') === 'image/png');
      check('the bytes round-trip exactly', bytes.equals(PNG_BYTES), `${bytes.length} vs ${PNG_BYTES.length}`);
      check('it is marked private and cacheable', /private/.test(res.headers.get('cache-control') ?? ''));
      check('an ETag is issued', Boolean(etag));
    }

    // ── Revalidation ────────────────────────────────────────
    {
      const res = await api(`/api/users/${uid}/avatar`, { headers: { 'If-None-Match': etag } }, jar);
      check('a matching ETag returns 304', res.status === 304, `got ${res.status}`);
    }

    // ── Replacing the picture ───────────────────────────────
    {
      // A different, valid image — a 1×1 red PNG.
      const red =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const res = await api(
        `/api/users/${uid}/avatar`,
        { method: 'PUT', body: JSON.stringify({ dataUrl: `data:image/png;base64,${red}` }) },
        jar,
      );
      check('an avatar can be replaced', res.status === 200);
      const served = await api(`/api/users/${uid}/avatar`, {}, jar);
      const bytes = Buffer.from(await served.arrayBuffer());
      check('the replacement is what is served', bytes.equals(Buffer.from(red, 'base64')));
      check(
        'the ETag changes with the image',
        served.headers.get('etag') !== etag,
        `${etag} -> ${served.headers.get('etag')}`,
      );
    }

    // ── Delete ──────────────────────────────────────────────
    {
      const res = await api(`/api/users/${uid}/avatar`, { method: 'DELETE' }, jar);
      const body = await res.json().catch(() => ({}));
      check('the avatar can be deleted', res.status === 200, `got ${res.status}`);
      check('deletion clears hasAvatar', body.hasAvatar === false);
      check('the bytes are gone', (await api(`/api/users/${uid}/avatar`, {}, jar)).status === 404);
    }
  } finally {
    await prisma.finUser.delete({ where: { id: uid } }).catch(() => {});
    console.log(`\n  cleaned up: ${email}\n`);
    await prisma.$disconnect();
  }

  console.log(`  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\n  fatal:', err);
  await prisma.$disconnect();
  process.exit(1);
});
