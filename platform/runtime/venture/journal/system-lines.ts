// Chausar venture launcher, journal (Ink v2 wave 4, package 4J1; catalogue O15): one grammar for the lines the engine
// writes about what happened (journal lines, Today's Earlier lines, run results, row meta):
//   <subject> <verb>[ <object>][ · <consequence>]
// A subject and its verb first ("Plan accepted", "The judge is reading this draft"), then at most one consequence,
// after " · " or as one more short sentence ("Draft accepted. You send it to the client."). One line, no dashes, no
// shouting. systemLineOk is the check a contract test runs every generator through; systemLine builds a line in it.
// The grammar and its contract test follow Beeline apps/server/src/system-line.ts; a rewrite, not a copy.
import { ChausarError } from '../../contracts.ts';

/** The longest system line, in characters. */
export const SYSTEM_LINE_MAX = 240;
const SEPARATOR = ' · ';
/** The en and long dashes, built from their code points so this file holds neither. */
const DASHES = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]| - |--`);

/** A line's parts: its head (subject and verb, maybe an object) and its consequence, split at " · " or a sentence end. */
export function systemLineParts(line: string): string[] {
  return line.split(SEPARATOR).flatMap(part => part.split(/(?<=[.?])\s+(?=[A-Z0-9'"])/u)).filter(part => part.length > 0);
}

/**
 * Why a line breaks the grammar, or null when it keeps it: one line of at most 240 characters with no dash, no "!",
 * no doubled spaces; a head of two words or more that starts with its subject (a capital letter, a digit or a quote);
 * at most one consequence; no part that trails off in a comma, colon or semicolon.
 */
export function systemLineProblem(line: string): string | null {
  if (typeof line !== 'string' || line.length === 0) return 'empty';
  if (line.length > SYSTEM_LINE_MAX) return 'too long';
  if (/[\r\n]/.test(line)) return 'more than one line';
  if (line !== line.trim() || / {2}/.test(line)) return 'stray spaces';
  if (DASHES.test(line)) return 'a dash';
  if (line.includes('!')) return 'shouting';
  const parts = systemLineParts(line);
  if (parts.length > 2) return 'more than one consequence';
  const [head] = parts;
  if (!/^[A-Z0-9'"₹$]/u.test(head)) return 'no subject first';
  if (head.replace(/[.?]$/, '').trim().split(/\s+/).length < 2) return 'no verb after the subject';
  if (parts.some(part => /[,;:]$/.test(part))) return 'trails off';
  return null;
}

/** True when a line keeps the system-line grammar. */
export function systemLineOk(line: string): boolean {
  return systemLineProblem(line) === null;
}

/** A line in the grammar from its parts: "Plan accepted · you send it to the client". */
export function systemLine(subject: string, verb: string, object?: string | null, consequence?: string | null): string {
  const head = [subject.trim(), verb.trim(), object?.trim()].filter(Boolean).join(' ');
  const line = consequence?.trim() ? `${head}${SEPARATOR}${consequence.trim()}` : head;
  const problem = systemLineProblem(line);
  if (problem) throw new ChausarError('INVALID_VENTURE_REQUEST', `This line does not keep the system-line grammar (${problem}).`);
  return line;
}
