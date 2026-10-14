/** TR-03 Send: the three levels drawn from the person's own data, with stand-ins for names, phones, emails and GSTINs. */
import { audit, check } from '../contracts.ts';
import type { Context, Fact, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { visibleFacts } from '../trust.ts';
import { coreState, peekCore } from './core-state.ts';
import { onApplyChange, requestChange } from './core-dual.ts';

const gstin = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g, email = /[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}/g, phone = /(?:\+?\d[\d\s-]{8,}\d)/g;
const nameKey = /name|customer|party|supplier|vendor|contact|person|buyer|payee|payer|owner/i;
/** Values that carry no identity: amounts, numbers, dates, currency codes and short lower-case codes. */
const plain = (text: string) => /^-?\d+(\.\d+)?$/.test(text) || /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(text) || /^[A-Z]{3}$/.test(text) || /^[a-z0-9_-]{1,32}$/.test(text);

/** Swaps identities for stand-ins (CUSTOMER_1, PHONE_1, EMAIL_1, GSTIN_1, TEXT_1); the same value keeps its stand-in. */
export class StandIns {
  #seen = new Map<string, string>(); #counts = new Map<string, number>();
  #name(prefix: string, value: string) {
    const key = `${prefix}:${value}`; if (!this.#seen.has(key)) { const n = (this.#counts.get(prefix) ?? 0) + 1; this.#counts.set(prefix, n); this.#seen.set(key, `${prefix}_${n}`); }
    return this.#seen.get(key)!;
  }
  value(field: string, value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text === '') return '';
    if (/phone|mobile|tel|whatsapp/i.test(field)) return this.#name('PHONE', text.replace(/\D/g, '') || text);
    if (/e-?mail/i.test(field)) return this.#name('EMAIL', text);
    if (/gst/i.test(field)) return this.#name('GSTIN', text);
    if (nameKey.test(field) && !plain(text)) return this.#name('CUSTOMER', text);
    if (/^-?\d+(\.\d+)?$/.test(text) || /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(text)) return text;
    const swapped = text.replace(gstin, m => this.#name('GSTIN', m)).replace(email, m => this.#name('EMAIL', m)).replace(phone, m => m.replace(/\D/g, '').length >= 10 ? this.#name('PHONE', m.replace(/\D/g, '')) : m);
    if (swapped !== text) return /^(GSTIN|EMAIL|PHONE)_\d+$/.test(swapped) ? swapped : this.#name('TEXT', text);
    return plain(text) ? text : this.#name('TEXT', text);
  }
}
function typeOf(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (/minor$/i.test(field)) return 'money';
  if (typeof value === 'boolean') return 'yes/no';
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))) return 'number';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  return 'text';
}
const synthetic: Fact[] = [1, 2].map(n => ({ id: `example_${n}`, entityId: `example-${n}`, sourceId: 'example', sourceRow: n, kind: 'invoice', validFrom: `2026-04-0${n}`, validTo: null,
  learnedAt: '2026-04-01T00:00:00.000Z', supersededAt: null, fields: { customer: `Example customer ${n}`, phone: `+91 90000 0000${n}`, date: `2026-04-0${n}`, amountMinor: `${n}25000` } }));

export function sendLevels(ctx: Context, host: ModuleHost) {
  const state = host.store.read(); const core = peekCore(state);
  const own = visibleFacts(host.store, ctx).sort((a, b) => b.learnedAt.localeCompare(a.learnedAt));
  const facts = own.length ? own.filter(f => f.kind === own[0].kind).slice(0, 3) : synthetic;
  const headings = [...new Set(facts.flatMap(f => Object.keys(f.fields ?? {})))].slice(0, 6);
  const stand = new StandIns();
  const rows = facts.map(f => headings.map(h => stand.value(h, f.fields?.[h])));
  const types = headings.map(h => typeOf(h, facts.find(f => f.fields?.[h] !== undefined)?.fields?.[h]));
  return { current: state.policy.send, localOnly: core.send.localOnly, financialRoutes: [...core.send.financialRoutes], synthetic: own.length === 0,
    levels: [
      { id: 'nothing', headings: headings.map(() => '—'), rows: [], memory: 'No memory lines are sent.', question: 'The text of your question is not sent.' },
      { id: 'shape', headings, rows: [types], memory: 'Memory lines are sent as headings only, without values.', question: 'The text of your question is sent only after you review it.' },
      { id: 'samples', headings, rows, memory: 'Memory lines you kept may be sent, with names, phones, emails and GSTINs swapped for stand-ins.', question: 'The text of your question is sent only after you review it.' },
    ],
    voice: { on: false as const, note: 'Voice is off. Audio leaves this computer when voice is on.' } };
}

export async function setSend(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const op: { type: string } & Record<string, unknown> = { type: 'send' }; const parts: string[] = [];
  if (payload.level !== undefined) { check(['nothing', 'shape', 'samples'].includes(payload.level), 'INVALID_POLICY', 'Choose nothing, shape, or samples.'); op.level = payload.level; parts.push(`send level ${payload.level}`); }
  if (payload.localOnly !== undefined) { check(typeof payload.localOnly === 'boolean', 'INVALID_POLICY', 'Local only is on or off.'); op.localOnly = payload.localOnly; parts.push(`local only ${payload.localOnly ? 'on' : 'off'}`); }
  if (payload.financialRoutes !== undefined) {
    check(Array.isArray(payload.financialRoutes) && payload.financialRoutes.length <= 20 && payload.financialRoutes.every((r: unknown) => typeof r === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(r)), 'INVALID_POLICY', 'Name each approved route.');
    op.financialRoutes = [...new Set(payload.financialRoutes as string[])]; parts.push(`${(op.financialRoutes as string[]).length} routes approved for financial data`);
  }
  check(parts.length > 0, 'INVALID_POLICY', 'Say what to change in Send.');
  return requestChange(ctx, host, 'send', `Change ${parts.join(', ')}.`, op);
}

onApplyChange('send', async (ctx, host, op) => {
  if (op.level !== undefined) await host.services.trust.updatePolicy(ctx, { send: op.level });
  if (op.localOnly !== undefined || op.financialRoutes !== undefined) await host.store.update((state: State) => {
    const send = coreState(state).send;
    if (typeof op.localOnly === 'boolean') send.localOnly = op.localOnly;
    if (Array.isArray(op.financialRoutes)) send.financialRoutes = [...op.financialRoutes as string[]];
    audit(state, 'trustx.send.changed', { memberId: ctx.memberId, fields: Object.keys(op).filter(k => k !== 'type') });
  });
  return {};
});
