/**
 * AS-18: search saved answers, decisions, investigations, checks and why-changed pages by a word.
 * The search runs on this computer over what this seat can already open; nothing leaves it.
 */
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { SearchReply } from './contracts.ts';
import { codeOf, input, peekAsk, text, translate, words } from './shared.ts';

const LIMIT = 50;

export function marks(value: string, terms: readonly string[]): [number, number][] {
  const lower = value.toLowerCase(), out: [number, number][] = [];
  if (lower.length !== value.length) return out;
  for (const term of terms) {
    let at = lower.indexOf(term);
    while (at >= 0 && out.length < 50) { out.push([at, at + term.length]); at = lower.indexOf(term, at + term.length); }
  }
  return out.sort((a, b) => a[0] - b[0]).filter((m, i, all) => i === 0 || m[0] >= all[i - 1]![1]);
}

export async function search(ctx: Context, payload: unknown, host: ModuleHost): Promise<SearchReply> {
  const request = input(payload, ['query'], ['query']);
  const query = text(request.query, 200).trim(), terms = [...new Set(words(query))].slice(0, 8);
  const own = peekAsk(host.store.read());
  const hit = (id: string, value: string) => {
    const found = marks(value, terms);
    return terms.length && terms.every(term => value.toLowerCase().includes(term)) ? [{ id, text: value.slice(0, 500), marks: found.filter(m => m[1] <= 500) }] : [];
  };
  const groups: SearchReply['groups'] = [];
  const add = (kind: SearchReply['groups'][number]['kind'], hits: SearchReply['groups'][number]['hits']) => { if (hits.length) groups.push({ kind, hits: hits.slice(0, LIMIT) }); };
  add('saved', own.saved.filter(s => s.memberId === ctx.memberId).flatMap(s => hit(s.id, s.question ?? s.operationId ?? '')));
  add('check', own.checks.filter(c => c.memberId === ctx.memberId).flatMap(c => hit(c.id, c.question)));
  add('why', own.why.filter(w => w.memberId === ctx.memberId).flatMap(w => [...hit(w.id, w.label), ...w.guesses.flatMap(g => hit(w.id, g.text))]));
  const optional = async (method: string) => { try { return await host.call(method, {}) as any[]; } catch (error) { if (['UNKNOWN_METHOD', 'FORBIDDEN'].includes(codeOf(error))) return []; throw translate(error); } };
  add('decision', (await optional('decisions.list')).flatMap(d => hit(d.id, String(d.text ?? ''))));
  add('investigation', (await optional('investigations.list')).flatMap(i => hit(i.id, String(i.objective ?? ''))));
  return { query, groups };
}
