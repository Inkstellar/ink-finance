/**
 * Tests for telegram-bot/format.ts — escaping text that goes into a Telegram
 * Markdown message.
 *
 *   npm run test:format
 *
 * Pure functions only: no Telegram, no database. Telegram's legacy Markdown
 * parser has no escape *syntax* to validate against, so the contract asserted
 * here is the mechanical one: every character it treats as markup comes back
 * preceded by a backslash, and nothing else is touched.
 */
import { mdEscape } from '../telegram-bot/format.js';

let pass = 0;
let fail = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const good = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`);
  good ? pass++ : fail++;
};

// ── Every markup character is escaped ──────────────────────
eq('underscore', mdEscape('a_b'), 'a\\_b');
eq('asterisk', mdEscape('a*b'), 'a\\*b');
eq('backtick', mdEscape('a`b'), 'a\\`b');
eq('open bracket', mdEscape('a[b'), 'a\\[b');
eq('close bracket', mdEscape('a]b'), 'a\\]b');

// ── Ordinary text is left alone ────────────────────────────
eq('plain text is untouched', mdEscape('Groceries at Reliance'), 'Groceries at Reliance');
eq('digits and currency survive', mdEscape('₹1,299.50'), '₹1,299.50');
eq('a hyphen is not markup', mdEscape('5-in-1 Combo'), '5-in-1 Combo');
eq('a dot is not markup', mdEscape('Rs. 1299'), 'Rs. 1299');
eq('a hash is not markup', mdEscape('Order #12345'), 'Order #12345');
eq('the empty string is safe', mdEscape(''), '');

// ── The realistic product titles ───────────────────────────
eq(
  "a title with markup in it",
  mdEscape("Men's *Pack of 2* [Blue]"),
  "Men's \\*Pack of 2\\* \\[Blue\\]",
);
eq(
  'a title with an underscore',
  mdEscape('boAt_Airdopes 141'),
  'boAt\\_Airdopes 141',
);
eq(
  'a URL with an underscore keeps its shape',
  mdEscape('https://example.com/p/some_item_2'),
  'https://example.com/p/some\\_item\\_2',
);

// ── Escaping is idempotent on already-escaped text? No — and that
//    matters: a double escape would show a literal backslash in chat,
//    so callers must escape exactly once, at the interpolation site.
eq(
  'escaping twice is visibly wrong, so it is not done twice',
  mdEscape(mdEscape('a_b')),
  'a\\\\_b',
);

// ── Every character Telegram would parse is covered ────────
{
  const markup = ['_', '*', '`', '[', ']'];
  const untouched = markup.filter((ch) => !mdEscape(ch).startsWith('\\'));
  eq('no markup character is left unescaped', untouched, []);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
