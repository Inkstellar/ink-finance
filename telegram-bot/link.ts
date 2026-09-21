/**
 * Matching a Telegram sender to an app user, so the stored id can be repaired.
 *
 * Why this exists: `sendMessage` cannot deliver a private message to an
 * `@username` — it answers `400 chat not found`. A username typed into the
 * Users page therefore looks perfectly fine and silently breaks transaction
 * alerts. The numeric id is only knowable while the person is talking to the
 * bot, so the bot repairs the stored value the first time it hears from them.
 *
 * Pure, so the matching rules can be tested without a bot or a database.
 */

export interface LinkableUser {
  id: string;
  name: string;
  telegramId?: string | null;
}

export interface TelegramSender {
  /** `ctx.from.id` — numeric. */
  id: number | string;
  /** `ctx.from.username` — no leading `@`, and absent for many accounts. */
  username?: string | null;
}

export interface LinkPlan {
  userId: string;
  name: string;
  /** What was stored. */
  from: string;
  /** What it should become. */
  to: string;
}

/** `"@The_Ink"` → `"the_ink"`. */
export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

/**
 * The stored id as a trimmed string.
 *
 * Coerced rather than trusted: the column is a string, but a JSON body or a
 * hand-edited row can put a number there, and `"12345".trim` on a number is a
 * crash in the middle of an unrelated message handler.
 */
function storedId(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * The user a numeric Telegram id belongs to, if any.
 *
 * The single definition of "this chat id is linked", used both to decide
 * whether a repair is needed and to tell someone whether their alerts are on.
 */
export function findUserByNumericId(
  users: LinkableUser[],
  telegramUserId: number | string,
): LinkableUser | undefined {
  const numeric = storedId(telegramUserId);
  if (!numeric) return undefined;
  return users.find((u) => storedId(u.telegramId) === numeric);
}

/**
 * What to change, or `null` when there is nothing to do.
 *
 * The numeric match is checked first, and deliberately so: if one user already
 * holds the sender's numeric id, a second user storing that sender's
 * `@username` is a mistake, and rewriting them would leave two rows pointing at
 * the same chat — every alert would then be sent twice.
 */
export function planTelegramLink(
  users: LinkableUser[],
  sender: TelegramSender,
): LinkPlan | null {
  const numeric = storedId(sender.id);
  if (!numeric) return null;

  if (findUserByNumericId(users, numeric)) return null;

  const handle = sender.username ? normalizeUsername(sender.username) : '';
  if (!handle) return null;

  const byUsername = users.find(
    (u) => storedId(u.telegramId) && normalizeUsername(storedId(u.telegramId)) === handle,
  );
  if (!byUsername) return null;

  return {
    userId: byUsername.id,
    name: byUsername.name,
    from: storedId(byUsername.telegramId),
    to: numeric,
  };
}
