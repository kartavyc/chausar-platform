/**
 * BK-08, round 4: a definition's worked example and the date it came into use, as core-data
 * defines them on `Definition` (docs/lanes/core-data.md "Round 4 contracts", `ontology.ts` on its branch):
 *   example?: { rows: { label: string; amountMinor: string; counted: boolean; reason?: string }[]; resultMinor: string }
 *     (1 to 12 rows; a label of 1 to 80 characters; amounts are whole minor units as strings; a row left out
 *      needs a reason of 1 to 160 characters; resultMinor is exactly the counted rows' sum times the sign)
 *   usedFrom?: 'YYYY-MM-DD' (a real calendar date)
 * They are checked here with core-data's rules, kept on the draft, and passed to the dictionary only when
 * this build's `compileDictionary` accepts them (read once, by compiling a small synthetic dictionary with
 * and without them in a try). Until core-data is merged the base refuses them, so they are left out of what
 * is compiled and published: publishing never breaks because of them, and the draft says they are kept on
 * the draft only.
 */
import { check } from '../contracts.ts';
import { compileDictionary, type Definition, type DictionaryDraft } from '../ontology.ts';

export type DefinitionExample = { rows: { label: string; amountMinor: string; counted: boolean; reason?: string }[]; resultMinor: string };
export type DefinitionExtras = { example?: DefinitionExample; usedFrom?: string };
export const EXTRA_KEYS = ['example', 'usedFrom'] as const;

const MINOR = /^-?(?:0|[1-9]\d{0,17})$/;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const keysWithin = (v: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));

/** The extras in a draft request, checked with core-data's rules; INVALID_DEFINITION otherwise. */
export function extrasInput(d: Record<string, unknown>, sign: 1 | -1 | undefined): DefinitionExtras {
  const out: DefinitionExtras = {};
  if (d.usedFrom !== undefined) {
    const day = d.usedFrom;
    check(typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day, 'INVALID_DEFINITION', 'Give the date used as a calendar date.');
    out.usedFrom = day;
  }
  if (d.example !== undefined) {
    const example = d.example;
    check(plain(example) && keysWithin(example, ['rows', 'resultMinor']) && Array.isArray(example.rows) && example.rows.length >= 1 && example.rows.length <= 12
      && typeof example.resultMinor === 'string' && MINOR.test(example.resultMinor), 'INVALID_DEFINITION', 'A worked example needs one to twelve rows and its exact result.');
    let total = 0n; const rows: DefinitionExample['rows'] = [];
    for (const row of example.rows as unknown[]) {
      check(plain(row) && keysWithin(row, ['label', 'amountMinor', 'counted'], ['reason']) && typeof row.label === 'string' && row.label.trim().length > 0 && row.label.length <= 80
        && typeof row.amountMinor === 'string' && MINOR.test(row.amountMinor) && typeof row.counted === 'boolean'
        && (row.reason === undefined ? row.counted : typeof row.reason === 'string' && row.reason.trim().length > 0 && row.reason.length <= 160),
      'INVALID_DEFINITION', 'Each example row needs a label, an exact amount, whether it counts, and a reason when it is left out.');
      const r = row as { label: string; amountMinor: string; counted: boolean; reason?: string };
      if (r.counted) total += BigInt(r.amountMinor);
      rows.push({ label: r.label, amountMinor: r.amountMinor, counted: r.counted, ...(r.reason !== undefined ? { reason: r.reason } : {}) });
    }
    check(String(total * BigInt(sign ?? 1)) === example.resultMinor, 'INVALID_DEFINITION', 'The example result must be exactly what the counted rows add up to.');
    out.example = { rows, resultMinor: example.resultMinor as string };
  }
  return out;
}

export const hasExtras = (d: Definition | null | undefined): boolean => !!d && EXTRA_KEYS.some(k => Object.hasOwn(d, k));
/** The definition without the extras, for a dictionary that does not take them. */
export function withoutExtras(d: Definition): Definition {
  const { example: _e, usedFrom: _u, ...rest } = d as Definition & DefinitionExtras; return rest as Definition;
}

const PROBE: Definition = { name: 'probe', label: 'Probe', meaning: 'A synthetic probe of the definition fields.', kind: 'probe', field: 'amountMinor', currency: 'INR', nulls: 'exclude' };
const probeDraft = (definition: Definition): DictionaryDraft => ({ pack: 'probe', label: 'Probe', currency: 'INR', gstMode: 'regular', fields: { amountMinor: 'money' }, definitions: [definition] });
/** Whether `compile` accepts the extras: it compiles the probe without them and refuses nothing more with them. */
export function extrasAcceptedBy(compile: (draft: DictionaryDraft) => unknown): boolean {
  try { compile(probeDraft(PROBE)); } catch { return false; }
  try {
    compile(probeDraft({ ...PROBE, example: { rows: [{ label: 'One sale', amountMinor: '100', counted: true }, { label: 'A refund', amountMinor: '40', counted: false, reason: 'Not a sale.' }], resultMinor: '100' }, usedFrom: '2026-04-01' } as Definition));
    return true;
  } catch { return false; }
}
let accepted: boolean | undefined;
/** Read once per process: this build's dictionary compiler either takes the extras or it does not. */
export const extrasAccepted = (): boolean => (accepted ??= extrasAcceptedBy(draft => compileDictionary(draft, 1, 'probe')));
