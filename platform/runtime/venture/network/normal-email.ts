// Shared email normalization for engine and browser-safe imported form evidence.
export const HIDDEN = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
export const FORMULA = /^[=+\-@]/;

const EMAIL = /^[^\s@<>()",;:]{1,64}@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/;

/**
 * An email address in one spelling (trimmed, lower case, mailto: taken off), or null when it is not one. One starting
 * with a formula sign (= + -) is refused too: it would run as a formula in a spreadsheet the owner opens later.
 */
export function normalEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(HIDDEN, '').trim().replace(/^mailto:/i, '').toLowerCase();
  return text.length <= 254 && !FORMULA.test(text) && EMAIL.test(text) ? text : null;
}
