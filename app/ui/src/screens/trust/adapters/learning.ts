/**
 * Adapter for the learning-ext lane's sharing methods behind TR-11, as written in
 * `platform/runtime/learning-ext/sharing.ts` and `log.ts` and docs/lanes/learning-ext.md:
 * `learningx.intakeStatus` (closed, test inbox or intake; the switch; the boxes),
 * `learningx.preview` (the exact bytes of a batch, scanned line by line),
 * `learningx.consent` and `learningx.submit` (agree to those bytes, then send once),
 * `learningx.settle` (an uncertain upload, re-sent under the same key),
 * `learningx.batches` and `learningx.batch` (what I shared, the running line, credits),
 * `learningx.deleteBatch`, `learningx.withdraw`, `learningx.creditName`, `learningx.log`,
 * `learningx.cleanSample` and `learningx.outbox`. The switch itself is core `learning.sharing`.
 * Every reply is checked into this screen's types; engine sentences are kept only as data.
 */
import { ShapeError, bool, int, list, oneOf, optStr, rec, str } from '../kit/validate.ts';

export const LEARNING = {
  status: 'learningx.intakeStatus', preview: 'learningx.preview', consent: 'learningx.consent', submit: 'learningx.submit', settle: 'learningx.settle',
  batches: 'learningx.batches', batch: 'learningx.batch', deleteBatch: 'learningx.deleteBatch', withdraw: 'learningx.withdraw',
  creditName: 'learningx.creditName', log: 'learningx.log', clean: 'learningx.cleanSample', outbox: 'learningx.outbox', switch: 'learning.sharing',
} as const;

/** The public name the intake accepts for credits (learning-ext's own rule). */
export const PUBLIC_NAME = /^[A-Za-z][A-Za-z .'-]{0,38}[A-Za-z.]$/;
export const SAMPLE_LIMIT = 5_000_000;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
function instant(value: unknown, path: string): string {
  const s = str(value, path, 40);
  if (!INSTANT.test(s)) throw new ShapeError(path);
  return s;
}
function id(value: unknown, path: string): string {
  const s = str(value, path, 200);
  if (s.length === 0) throw new ShapeError(path);
  return s;
}
function count(value: unknown, path: string): number {
  const n = int(value, path);
  if (n < 0) throw new ShapeError(path);
  return n;
}
function optCount(value: unknown, path: string): number | null {
  return value === null || value === undefined ? null : count(value, path);
}

export interface Box { readonly box: string; readonly open: boolean; readonly shown: boolean }
export interface IntakeStatus { readonly open: boolean; readonly mode: 'closed' | 'test-inbox' | 'intake'; readonly on: boolean; readonly boxes: readonly Box[] }
export function intakeStatus(value: unknown): IntakeStatus {
  const r = rec(value);
  const mode = oneOf(r['mode'], 'reply.mode', ['closed', 'test-inbox', 'intake'] as const);
  str(r['label'], 'reply.label', 500);
  const open = bool(r['open'], 'reply.open');
  if (open !== (mode !== 'closed')) throw new ShapeError('reply.open');
  return {
    open, mode, on: bool(r['sharingSwitch'], 'reply.sharingSwitch'),
    boxes: list(r['boxes'], 'reply.boxes', (v, p) => {
      const b = rec(v, p), isOpen = bool(b['open'], `${p}.open`);
      return { box: id(b['box'], `${p}.box`), open: isOpen, shown: isOpen || b['shown'] === true };
    }, 10),
  };
}

/** A line of the file that looks like a value, by kind (GSTIN, PAN, IFSC, UPI, MAIL, PHONE, DIGITS); never the value. */
export interface Blocked { readonly line: number; readonly code: string }
function blocked(value: unknown, path: string): Blocked {
  const b = rec(value, path);
  return { line: count(b['line'], `${path}.line`), code: id(b['code'], `${path}.code`) };
}
export interface SharePreview {
  readonly id: string; readonly digest: string; readonly size: number; readonly count: number; readonly bytes: string;
  readonly names: number; readonly amounts: number; readonly blocked: readonly Blocked[]; readonly publicName: string | null;
}
export function preview(value: unknown): SharePreview {
  const r = rec(value);
  return {
    id: id(r['id'], 'reply.id'), digest: id(r['digest'], 'reply.digest'), size: count(r['size'], 'reply.size'), count: count(r['count'], 'reply.count'),
    bytes: str(r['bytes'], 'reply.bytes', 5_000_000), names: count(r['names'], 'reply.names'), amounts: count(r['amounts'], 'reply.amounts'),
    blocked: list(r['blocked'], 'reply.blocked', blocked, 5000), publicName: optStr(r['publicName'], 'reply.publicName', 40),
  };
}
export function consent(value: unknown): { readonly id: string; readonly digest: string } {
  const r = rec(value);
  return { id: id(r['id'], 'reply.id'), digest: id(r['digest'], 'reply.digest') };
}

export const BATCH_STATES = ['pending', 'sent', 'unknown', 'refused', 'deleted'] as const;
export interface Batch {
  readonly id: string; readonly at: string; readonly mode: 'intake' | 'test-inbox'; readonly status: (typeof BATCH_STATES)[number];
  readonly size: number; readonly count: number; readonly digest: string; readonly bytes: string | null; readonly refusal: string | null; readonly credits: number | null;
}
export function batch(value: unknown, path = 'reply'): Batch {
  const b = rec(value, path);
  return {
    id: id(b['id'], `${path}.id`), at: instant(b['at'], `${path}.at`), mode: oneOf(b['mode'], `${path}.mode`, ['intake', 'test-inbox'] as const),
    status: oneOf(b['status'], `${path}.status`, BATCH_STATES), size: count(b['size'], `${path}.size`), count: count(b['count'], `${path}.count`),
    digest: id(b['digest'], `${path}.digest`), bytes: optStr(b['bytes'], `${path}.bytes`, 5_000_000),
    refusal: optStr(b['refusal'], `${path}.refusal`, 60), credits: optCount(b['credits'], `${path}.credits`),
  };
}
export interface Batches {
  readonly items: readonly Batch[]; readonly shared: { readonly events: number; readonly names: number; readonly amounts: number };
  readonly credits: { readonly publicName: string | null; readonly latest: number | null };
}
/** One batch as a whole reply (`learningx.batch`, `submit`, `settle`, `deleteBatch`). */
export function oneBatch(value: unknown): Batch { return batch(value); }
export function batches(value: unknown): Batches {
  const r = rec(value), sh = rec(r['shared'], 'reply.shared'), cr = rec(r['credits'], 'reply.credits');
  return {
    items: list(r['items'], 'reply.items', batch, 1000),
    shared: { events: count(sh['events'], 'reply.shared.events'), names: count(sh['names'], 'reply.shared.names'), amounts: count(sh['amounts'], 'reply.shared.amounts') },
    credits: { publicName: optStr(cr['publicName'], 'reply.credits.publicName', 40), latest: optCount(cr['latest'], 'reply.credits.latest') },
  };
}
export function withdrawn(value: unknown): { readonly withdrawnConsents: number } {
  const r = rec(value);
  if (r['sharing'] !== false) throw new ShapeError('reply.sharing');
  return { withdrawnConsents: count(r['withdrawnConsents'], 'reply.withdrawnConsents') };
}
export function credited(value: unknown): { readonly publicName: string | null } {
  return { publicName: optStr(rec(value)['publicName'], 'reply.publicName', 40) };
}
export function switched(value: unknown): { readonly enabled: boolean } {
  return { enabled: bool(rec(value)['enabled'], 'reply.enabled') };
}

/** One decision in the log: its kind, choice and reason are vocabulary words, never a name or a value. */
export interface Decision { readonly id: string; readonly at: string; readonly kind: string; readonly choice: string; readonly reason: string | null }
export interface LogPage { readonly items: readonly Decision[]; readonly total: number }
export function logPage(value: unknown): LogPage {
  const r = rec(value);
  return {
    items: list(r['items'], 'reply.items', (v, p) => {
      const d = rec(v, p), e = rec(d['event'], `${p}.event`);
      return { id: id(d['id'], `${p}.id`), at: instant(d['at'], `${p}.at`), kind: id(e['kind'], `${p}.event.kind`), choice: id(e['choice'], `${p}.event.choice`),
        reason: optStr(e['reason'], `${p}.event.reason`, 60) };
    }, 500),
    total: count(r['total'], 'reply.total'),
  };
}

export interface Sample {
  readonly id: string; readonly at: string; readonly label: string; readonly status: 'clean' | 'blocked'; readonly cleaned: string;
  readonly hits: readonly { readonly line: number; readonly column: string; readonly code: string }[];
}
function sample(value: unknown, path: string): Sample {
  const x = rec(value, path);
  return {
    id: id(x['id'], `${path}.id`), at: instant(x['at'], `${path}.at`), label: str(x['label'], `${path}.label`, 120),
    status: oneOf(x['status'], `${path}.status`, ['clean', 'blocked'] as const), cleaned: str(x['cleaned'], `${path}.cleaned`, 6_000_000),
    hits: list(x['hits'], `${path}.hits`, (v, p) => { const h = rec(v, p); return { line: count(h['line'], `${p}.line`), column: str(h['column'], `${p}.column`, 200), code: id(h['code'], `${p}.code`) }; }, 5000),
  };
}
export function cleaned(value: unknown): Sample { return sample(value, 'reply'); }
export function outbox(value: unknown): readonly Sample[] { return list(rec(value)['items'], 'reply.items', sample, 50); }
