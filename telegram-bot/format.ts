/**
 * Escape the characters Telegram's Markdown parser treats as markup.
 *
 * Every message the bot sends uses `parse_mode: 'Markdown'`. Telegram rejects
 * the entire message with "can't parse entities" if the text contains an
 * unbalanced `_`, `*`, `` ` `` or `[` — so any string that came from a user or
 * from a scraped page has to be escaped before it is interpolated.
 *
 * A scraped product title is the worst case in this codebase:
 * `Men's *Pack of 2* [Blue]` would otherwise never reach the chat.
 */
export function mdEscape(text: string): string {
  return text.replace(/([_*`\[\]])/g, '\\$1');
}
