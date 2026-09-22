#!/usr/bin/env node
/**
 * Regression test for the wishlist endpoints.
 *
 *   npm run test:wishlist                       # against http://localhost:3456
 *   API_BASE=https://… npm run test:wishlist
 *
 * The wishlist is fed by the Telegram bot: you paste a product link, the bot
 * scrapes it, and you tap "Add to wishlist". Everything it sends is untrusted
 * — a scraped price is free text, and the actor is named in a header rather
 * than a session. These checks pin down the two things that would otherwise
 * fail silently: a price that isn't a number, and attribution.
 *
 * Authenticates with SERVICE_TOKEN (the bot's credential), so it needs no
 * session. Every row it creates is deleted again, and it never touches an
 * existing item.
 */
import 'dotenv/config';

const BASE = process.env.API_BASE || 'http://localhost:3456';
const TOKEN = process.env.SERVICE_TOKEN;
const headers = { 'Content-Type': 'application/json', 'X-Service-Token': TOKEN };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const call = async (path, method = 'GET', body, extraHeaders = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

/** Same request with no credential at all, to prove the route is protected. */
const callAnon = async (path, method = 'GET', body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

async function main() {
  if (!TOKEN) {
    console.error('\n  ✗ SERVICE_TOKEN is not set — cannot authenticate.\n');
    process.exit(1);
  }

  const users = (await call('/api/users')).data || [];
  if (!users.length) {
    console.error('\n  ✗ No users exist — cannot test attribution.\n');
    process.exit(1);
  }
  const owner = users[0];
  const other = users[1] || users[0];

  const baseline = ((await call('/api/wishlist')).data || []).length;
  console.log(`\n  target: ${BASE}`);
  console.log(`  baseline: ${baseline} existing item(s)`);
  console.log(`  actor: ${owner.name} (${owner.id})\n`);

  const created = [];
  const tag = `ZZ Wishlist Probe ${Date.now()}`;

  try {
    // ── Validation ────────────────────────────────────────
    const noName = await call('/api/wishlist_link', 'POST', {
      productUrl: 'https://example.com/p/1',
    });
    check('a link with no product name is rejected', noName.status === 400, `status ${noName.status}`);

    const noUrl = await call('/api/wishlist_link', 'POST', { name: tag });
    check('a link with no URL is rejected', noUrl.status === 400, `status ${noUrl.status}`);

    // ── Auth ──────────────────────────────────────────────
    const anon = await callAnon('/api/wishlist_link', 'POST', {
      name: tag,
      productUrl: 'https://example.com/p/1',
    });
    check('an unauthenticated write is refused', anon.status === 401, `status ${anon.status}`);

    const anonRead = await callAnon('/api/wishlist');
    check('an unauthenticated read is refused', anonRead.status === 401, `status ${anonRead.status}`);

    // ── Price is free text, and must never become NaN ─────
    const messy = await call(
      '/api/wishlist_link',
      'POST',
      {
        name: `${tag} — messy price`,
        productUrl: 'https://example.com/p/2',
        price: '₹1,299.50',
        currency: 'INR',
        description: 'A short description.',
        reviews: '4.5 stars from 1k reviews',
      },
      { 'X-Actor-User-Id': owner.id },
    );
    created.push(messy.data?.id);
    check('a scraped price is created', messy.status === 200, `status ${messy.status}`);
    check(
      'the currency symbol is stripped from the price',
      messy.data?.price === 1299.5,
      `got ${JSON.stringify(messy.data?.price)}`,
    );
    check(
      'description and reviews are both kept',
      typeof messy.data?.notes === 'string'
        && messy.data.notes.includes('A short description.')
        && messy.data.notes.includes('4.5 stars'),
      JSON.stringify(messy.data?.notes),
    );
    check(
      'the header actor is recorded',
      messy.data?.userId === owner.id,
      `expected ${owner.id}, got ${messy.data?.userId}`,
    );

    const unreadable = await call(
      '/api/wishlist_link',
      'POST',
      {
        name: `${tag} — no price`,
        productUrl: 'https://example.com/p/3',
        price: 'N/A',
      },
      { 'X-Actor-User-Id': owner.id },
    );
    created.push(unreadable.data?.id);
    check(
      'an unreadable price becomes null, not NaN',
      unreadable.status === 200 && unreadable.data?.price === null,
      `status ${unreadable.status}, price ${JSON.stringify(unreadable.data?.price)}`,
    );

    // "Rs. 1299" is the case where a naive strip keeps the dot from "Rs."
    // and stores 0.1299 — twelve paise for a two-hundred-rupee item.
    const abbreviated = await call(
      '/api/wishlist_link',
      'POST',
      {
        name: `${tag} — Rs. prefix`,
        productUrl: 'https://example.com/p/6',
        price: 'Rs. 1299',
      },
      { 'X-Actor-User-Id': owner.id },
    );
    created.push(abbreviated.data?.id);
    check(
      'the dot in "Rs." is not read as a decimal point',
      abbreviated.data?.price === 1299,
      `got ${JSON.stringify(abbreviated.data?.price)}`,
    );

    const nanPrice = await call('/api/wishlist_link', 'POST', {
      name: `${tag} — junk price`,
      productUrl: 'https://example.com/p/4',
      price: {},
    });
    created.push(nanPrice.data?.id);
    check(
      'a non-scalar price does not 500',
      nanPrice.status === 200 && nanPrice.data?.price === null,
      `status ${nanPrice.status}, price ${JSON.stringify(nanPrice.data?.price)}`,
    );

    // ── Attribution cannot be forged in the body ──────────
    const forged = await call(
      '/api/wishlist_link',
      'POST',
      {
        name: `${tag} — forged actor`,
        productUrl: 'https://example.com/p/5',
        // The route must read the actor from the header, never the body.
        userId: other.id,
      },
      { 'X-Actor-User-Id': owner.id },
    );
    created.push(forged.data?.id);
    check(
      'a userId in the body is ignored',
      forged.data?.userId === owner.id,
      `expected ${owner.id}, got ${forged.data?.userId}`,
    );

    // ── Read back ─────────────────────────────────────────
    const all = (await call('/api/wishlist')).data || [];
    check('the created items come back', all.length >= created.length, `${all.length} item(s)`);
    check(
      'the newest item is first',
      all[0]?.id === created[created.length - 1],
      `first is ${all[0]?.name}`,
    );

    const mine = all.find((i) => i.id === messy.data.id);
    check('the owner is joined onto the item', mine?.user?.id === owner.id, `user ${JSON.stringify(mine?.user)}`);
    check(
      'the joined owner carries a name',
      typeof mine?.user?.name === 'string' && mine.user.name.length > 0,
      JSON.stringify(mine?.user?.name),
    );

    const filtered = (await call(`/api/wishlist?userId=${encodeURIComponent(other.id)}`)).data || [];
    check(
      'filtering by another user excludes the new item',
      !filtered.some((i) => i.id === messy.data.id),
      `${filtered.length} item(s) for the other user`,
    );

    const mineOnly = (await call(`/api/wishlist?userId=${encodeURIComponent(owner.id)}`)).data || [];
    check(
      'filtering by the owner includes it',
      mineOnly.some((i) => i.id === messy.data.id),
      `${mineOnly.length} item(s) for the owner`,
    );

    // ── Delete ────────────────────────────────────────────
    const first = created.shift();
    const removed = await call(`/api/wishlist/${first}`, 'DELETE');
    check('an item can be deleted', removed.status === 200 && removed.data?.success === true, `status ${removed.status}`);

    const again = await call(`/api/wishlist/${first}`, 'DELETE');
    check('deleting it twice reports not found', again.status === 404, `status ${again.status}`);

    const after = (await call('/api/wishlist')).data || [];
    check(
      'the deleted item is gone',
      !after.some((i) => i.id === first),
      `${after.length} item(s) remain`,
    );
  } finally {
    // ── Cleanup ───────────────────────────────────────────
    for (const id of created) {
      if (!id) continue;
      await call(`/api/wishlist/${id}`, 'DELETE').catch(() => {});
    }
    const leftover = ((await call('/api/wishlist')).data || []).filter((i) =>
      String(i.name || '').startsWith('ZZ Wishlist Probe'),
    );
    for (const item of leftover) {
      await call(`/api/wishlist/${item.id}`, 'DELETE').catch(() => {});
    }
    const final = ((await call('/api/wishlist')).data || []).length;
    console.log(`\n  cleanup: back to ${final} item(s) (baseline ${baseline})`);
    if (final !== baseline) {
      console.log('  ⚠️  the item count did not return to the baseline');
    }
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n  ✗ unexpected failure:', err);
  process.exit(1);
});
