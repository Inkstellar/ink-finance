/**
 * Tests for telegram-bot/link.ts — repairing a stored Telegram id.
 *
 *   npm run test:link
 *
 * Pure. The rules matter because getting them wrong is invisible: a user whose
 * id stays as an `@username` never receives a transaction alert, and two rows
 * holding the same chat would each get a copy of every alert.
 */
import { normalizeUsername, planTelegramLink, type LinkableUser } from '../telegram-bot/link.js';

let pass = 0;
let fail = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`);
  ok ? pass++ : fail++;
};

const users = (...rows: [string, string, string | null][]): LinkableUser[] =>
  rows.map(([id, name, telegramId]) => ({ id, name, telegramId }));

console.log('\n  usernames');
eq('a leading @ is stripped', normalizeUsername('@The_Ink'), 'the_ink');
eq('case is folded', normalizeUsername('THE_INK'), 'the_ink');
eq('surrounding space is trimmed', normalizeUsername('  @ink  '), 'ink');
eq('a bare handle is left alone', normalizeUsername('ink'), 'ink');

console.log('\n  the upgrade this exists for');
eq(
  'a stored @username becomes the numeric id',
  planTelegramLink(users(['u1', 'Kousi', '@the_inkstellar']), { id: 12345, username: 'the_inkstellar' }),
  { userId: 'u1', name: 'Kousi', from: '@the_inkstellar', to: '12345' },
);
eq(
  'the match ignores case on both sides',
  planTelegramLink(users(['u1', 'Kousi', 'The_Inkstellar']), { id: 12345, username: 'THE_INKSTELLAR' }),
  { userId: 'u1', name: 'Kousi', from: 'The_Inkstellar', to: '12345' },
);
eq(
  'the match tolerates a stored @ and a bare sender handle',
  planTelegramLink(users(['u1', 'Kousi', '@ink']), { id: 7, username: 'ink' }),
  { userId: 'u1', name: 'Kousi', from: '@ink', to: '7' },
);

console.log('\n  nothing to do');
eq(
  'an id that is already numeric is left alone',
  planTelegramLink(users(['u1', 'Kousi', '12345']), { id: 12345, username: 'the_inkstellar' }),
  null,
);
eq(
  'a numeric id stored as a number still counts as correct',
  planTelegramLink(users(['u1', 'Kousi', 12345 as unknown as string]), { id: 12345 }),
  null,
);
eq(
  'a sender whose handle belongs to nobody changes nothing',
  planTelegramLink(users(['u1', 'Kousi', '@the_inkstellar']), { id: 12345, username: 'stranger' }),
  null,
);
eq(
  'a sender with no username and no numeric match changes nothing',
  planTelegramLink(users(['u1', 'Kousi', '@the_inkstellar']), { id: 12345 }),
  null,
);
eq(
  'an empty user list changes nothing',
  planTelegramLink([], { id: 12345, username: 'the_inkstellar' }),
  null,
);
eq(
  'a user with no telegram id is never matched',
  planTelegramLink(users(['u1', 'Kousi', null]), { id: 12345, username: 'the_inkstellar' }),
  null,
);
eq(
  'a blank stored id is never matched',
  planTelegramLink(users(['u1', 'Kousi', '   ']), { id: 12345, username: 'the_inkstellar' }),
  null,
);

console.log('\n  not creating a duplicate');
// If one row already holds the numeric id, a second row holding that sender's
// @username is a data error. Rewriting it would point two rows at one chat, and
// every alert would then be delivered twice.
eq(
  'an existing numeric holder wins over a username holder',
  planTelegramLink(
    users(['u1', 'Kousi', '12345'], ['u2', 'Preeti', '@the_inkstellar']),
    { id: 12345, username: 'the_inkstellar' },
  ),
  null,
);
eq(
  'the same holds whichever order the rows come in',
  planTelegramLink(
    users(['u2', 'Preeti', '@the_inkstellar'], ['u1', 'Kousi', '12345']),
    { id: 12345, username: 'the_inkstellar' },
  ),
  null,
);

console.log('\n  picking the right person');
eq(
  'only the matching row is planned',
  planTelegramLink(
    users(['u1', 'Kousi', '@the_inkstellar'], ['u2', 'Preeti', '@shedevil05']),
    { id: 999, username: 'shedevil05' },
  ),
  { userId: 'u2', name: 'Preeti', from: '@shedevil05', to: '999' },
);
eq(
  'a negative group id is accepted',
  planTelegramLink(users(['u1', 'Home', '@ink']), { id: -1001234567890, username: 'ink' }),
  { userId: 'u1', name: 'Home', from: '@ink', to: '-1001234567890' },
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
