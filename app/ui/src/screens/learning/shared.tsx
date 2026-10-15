/**
 * Shared pieces for the learning place: its words (the lane's own catalogue, read through
 * `useT()`), who may do what, refusals and "not yet" codes as words, the answer-key case
 * lines, a confirm sheet that names the exact change, and a file picker that reads text in
 * the browser. Display only: amounts arrive as exact paise strings and are formatted here,
 * never calculated.
 */
import { useId, useState, type ReactNode } from 'react';
import type { Language, ScreenState } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Sheet } from '../../parts/Sheet';
import { Button } from '../../parts/Button';
import { State } from '../../patterns/States';
import { money } from '../../format/money.ts';
import { date } from '../../format/dates.ts';
import type { Loaded } from '../work/kit/reply.ts';
import { NOT_BUILT_CODES } from '../work/kit/reply.ts';
import type { CaseResult, NotYet, TypedEdit } from './contract.ts';
import s from './Learning.module.css';

export type LearningProps = PlaceRenderProps;
export type Lx = (key: string, values?: Readonly<Record<string, string>>) => string;

/** Every word this place draws is under `LX.` in app/ui/src/text/lanes/learning-ext.ts. */
export function useLx(): Lx {
  const t = useT();
  return (key, values) => t(`LX.${key}`, values);
}

/** The owner decides every dictionary change, the answer key, the model route and each outside send. */
export const isOwner = (p: LearningProps) => !p.viewer && p.member.role === 'owner';
/** Anyone but a viewer may prepare: look for edits, profile a file, build a model request. */
export const prepares = (p: LearningProps) => !p.viewer && p.member.role !== 'viewer';
/** Running the key is an admin read: the owner or a co-founder. */
export const admins = (p: LearningProps) => !p.viewer && (p.member.role === 'owner' || p.member.role === 'cofounder');

export function valueOf<T>(loaded: Loaded<T>): T | undefined {
  return loaded.phase === 'ready' ? loaded.value : loaded.phase === 'loading' ? loaded.last : undefined;
}
export function stateOf<T>(loaded: Loaded<T>): ScreenState | undefined {
  if (loaded.phase === 'refused') return loaded.state;
  if (loaded.phase === 'loading' && loaded.last === undefined) return { kind: 'loading' };
  return undefined;
}

/** A section of the page: its title, then its state while it has nothing else to show. */
export function Part({ title, loaded, reload, children }: { title: string; loaded?: Loaded<unknown>; reload?: () => void; children?: ReactNode }) {
  const lx = useLx();
  const state = loaded ? stateOf(loaded) : undefined;
  return (
    <section className={s.part}>
      <h2 className={s.partTitle}>{title}</h2>
      {state && state.kind !== 'ready'
        ? <State state={state} action={state.kind === 'failed' && reload ? { label: lx('retry'), onPress: reload } : undefined} />
        : children}
    </section>
  );
}

const REFUSALS: ReadonlySet<string> = new Set([
  'EDIT_STALE', 'EDIT_CHANGED', 'EDIT_NOT_REVIEWABLE', 'PROPOSAL_STALE', 'PROPOSAL_CHANGED', 'PROPOSAL_DECIDED', 'ANSWER_KEY_FAILED', 'OWNER_REQUIRED',
  'APP_APPROVAL_REQUIRED', 'DICTIONARY_REQUIRED', 'EDITS_PENDING', 'NOT_FOUND', 'INVALID_ANSWER_KEY', 'INVALID_ANSWER_CASE', 'FORBIDDEN', 'ROUTE_NOT_FOUND',
  'TAINTED_APPROVAL', 'PREVIEW_NOT_FOUND', 'INVALID_REPLY', 'ACCESS_REVOKED', 'ALREADY_DECIDED', 'REQUEST_FAILED', 'NETWORK_WAIT', 'FILE_LIMIT', 'EMPTY_FILE',
  'FILE_TOO_LARGE', 'PROPOSAL_STALE',
]);
export const REFUSAL_CODES: readonly string[] = [...REFUSALS];
/** A refused change, in words. A code with no words of its own is named as it came. */
export function refusalText(code: string, lx: Lx): string {
  if (NOT_BUILT_CODES.has(code)) return lx('refusal.notBuilt');
  return REFUSALS.has(code) ? lx(`refusal.${code}`) : lx('refusal.other', { code });
}
export function Refused({ code }: { code: string | null }) {
  const lx = useLx();
  return code === null ? null : <p className={s.refusal} role="alert">{refusalText(code, lx)}</p>;
}

const NOT_YET: ReadonlySet<string> = new Set([
  'MODEL_ROUTE_UNAVAILABLE', 'SEND_LEVEL_WITHHELD', 'APPROVAL_REQUIRED', 'PREVIEW_STALE', 'ALREADY_ATTEMPTED', 'MODEL_FAILED', 'MODEL_OUTPUT_INVALID', 'DICTIONARY_REQUIRED',
]);
export const NOT_YET_CODES: readonly string[] = [...NOT_YET];
/** A typed "not yet" from the model routes, drawn as plain words per code. The engine's English reason is not shown. */
export function NotYetLine({ value }: { value: NotYet }) {
  const lx = useLx();
  return (
    <p className={s.amber} role="status" data-not-yet={value.code}>
      {NOT_YET.has(value.code) ? lx(`notYet.${value.code}`) : lx('notYet.other', { code: value.code })}
    </p>
  );
}

export const day = (iso: string, language: Language) => date(iso.slice(0, 10), 'short', language);
export const rupees = (minor: string) => money(minor);
export const OPERATIONS = ['billed', 'received', 'earned', 'refunds', 'costs', 'net_sales', 'margin', 'aging'] as const;
export function operationName(operation: string, lx: Lx): string {
  return (OPERATIONS as readonly string[]).includes(operation) ? lx(`op.${operation}`) : operation;
}

/** A dictionary edit in words: its kind and the definition or field it touches. */
export function editText(edit: TypedEdit, lx: Lx): string {
  switch (edit.edit) {
    case 'add-field': return lx('edit.add-field', { name: edit.name, type: lx(`type.${edit.type}`) });
    case 'add-definition': return lx('edit.add-definition', { label: edit.definition.label, name: edit.definition.name, kind: edit.definition.kind, field: edit.definition.field });
    case 'remove-definition': return lx('edit.remove-definition', { name: edit.name });
    case 'change-meaning': return lx('edit.change-meaning', { name: edit.name, meaning: edit.meaning });
    case 'change-nulls': return lx('edit.change-nulls', { name: edit.name, nulls: lx(`nulls.${edit.nulls}`) });
    case 'change-label': return lx('edit.change-label', { name: edit.name, label: edit.label });
    case 'change-sign': return lx(edit.sign === 1 ? 'edit.change-sign.plus' : 'edit.change-sign.minus', { name: edit.name });
    case 'change-kind': return lx('edit.change-kind', { name: edit.name, kind: edit.kind });
  }
}

/** Passed and failed cases of one run, by case id. Counts are of the rows the engine sent. */
export function passedOf(cases: readonly CaseResult[]): string { return String(cases.filter(c => c.passed).length); }

export function CaseMarks({ cases }: { cases: readonly CaseResult[] }) {
  const lx = useLx();
  return (
    <ul className={s.marks}>
      {cases.map(c => (
        <li key={c.id} className={c.passed ? s.pass : s.fail} data-case={c.id} data-passed={c.passed ? 'yes' : 'no'}>
          {c.passed ? lx('case.passed', { id: c.id }) : c.code ? lx('case.failedCode', { id: c.id, code: c.code }) : lx('case.failed', { id: c.id })}
        </li>
      ))}
    </ul>
  );
}

/** The approval sheet for one exact change: it names the change, and only its button sends it. */
export function ConfirmSheet({ kind, title, confirm, busy, onConfirm, onClose, children }: {
  kind: string; title: string; confirm: string; busy: boolean; onConfirm: () => void; onClose: () => void; children: ReactNode;
}) {
  const lx = useLx();
  return (
    <Sheet kind={kind} title={title} origin={null} onClose={onClose}
      primary={{ label: confirm, onPress: onConfirm, money: true, disabled: busy }}
      actions={<Button variant="quiet" onClick={onClose}>{lx('notNow')}</Button>}>
      {children}
    </Sheet>
  );
}

/** Reads one chosen file as text, in the browser. Nothing is sent until a later press. */
export function FilePick({ label, accept, maxBytes, onText, onTooLarge }: { label: string; accept: string; maxBytes: number; onText: (name: string, content: string) => void; onTooLarge: () => void }) {
  const id = useId();
  const [reading, setReading] = useState(false);
  const read = (file: File) => {
    // A file over the limit is never read or sent.
    if (file.size > maxBytes) { onTooLarge(); return; }
    setReading(true);
    const done = (content: string) => { setReading(false); onText(file.name, content); };
    if (typeof file.text === 'function') void file.text().then(done, () => done(''));
    else { const reader = new FileReader(); reader.onload = () => done(typeof reader.result === 'string' ? reader.result : ''); reader.onerror = () => done(''); reader.readAsText(file); }
  };
  return (
    <label className={s.pick} htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="file" accept={accept} disabled={reading}
        onChange={event => { const file = event.currentTarget.files?.[0]; if (file) read(file); event.currentTarget.value = ''; }} />
    </label>
  );
}

export { Button };
export const styles = s;
