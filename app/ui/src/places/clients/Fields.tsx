/**
 * A client's fields with their evidence (spec section 7.6, after trycompai/crm). A stored value that evidence backs
 * carries a dotted underline; its source and claim (observed, inferred) show on hover and focus. A value that was
 * inferred says so in words beside it. Weaker evidence never replaces a value on its own: it waits as one quiet
 * suggestion row, placed where the value would land, with a one-line reason and two actions. Data Chausar cannot
 * see is asked for in the same place. The engine decides what may be applied; the UI only shows its answer.
 * Dismiss goes to the engine (venture.evidence.dismiss): a dismissed item stays in the ledger and off the screen.
 */

import { useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import { Provenance } from '../../parts/Provenance';
import { EngineError, type ClientLite, type EvidenceItem } from '../../engine/types';
import { clientsChanged } from './signals';
import s from './Clients.module.css';

/** Always shown, in this order. Other fields appear only while they ask for something. */
const SHOWN = ['email', 'taxId', 'note'] as const;
/** Fields kept on the client record, each with a label in the text catalogue. Other fields show their own name. */
type RecordField = 'name' | 'email' | 'countryCode' | 'taxId' | 'stateCode' | 'note';
const RECORD_FIELDS: ReadonlySet<string> = new Set<RecordField>(['name', 'email', 'countryCode', 'taxId', 'stateCode', 'note']);

interface FieldModel {
  field: string;
  stored: string | null;
  applied?: EvidenceItem | undefined;
  suggestion?: EvidenceItem | undefined;
  ask?: EvidenceItem | undefined;
}

/**
 * What each field shows: its stored value, the evidence applied to it, one waiting suggestion and one ask. Items the
 * engine marks dismissed never show; `hidden` holds the ones being dismissed right now, before the engine answers.
 */
export function fieldModels(client: ClientLite, items: readonly EvidenceItem[], hidden: ReadonlySet<string>): FieldModel[] {
  const open = (item: EvidenceItem) => !item.dismissed && !hidden.has(item.id);
  const stored = (field: string): string | null => {
    if (RECORD_FIELDS.has(field)) return client[field as RecordField];
    return items.find((item) => item.field === field && item.applied)?.value ?? null;
  };
  const model = (field: string): FieldModel => {
    const value = stored(field);
    const mine = items.filter((item) => item.field === field);
    return {
      field,
      stored: value,
      applied: mine.find((item) => item.applied && item.claim !== 'needs-your-data' && item.value === value),
      // One suggestion per field: the newest that is not applied, has a value, and differs from the stored one.
      suggestion: mine.find((item) => !item.applied && item.claim !== 'needs-your-data' && item.value !== value && open(item)),
      ask: mine.find((item) => !item.applied && item.claim === 'needs-your-data' && open(item)),
    };
  };
  const shown = SHOWN.map(model);
  const others = [...new Set(items.map((item) => item.field))]
    .filter((field) => !(SHOWN as readonly string[]).includes(field))
    .map(model)
    .filter((m) => m.suggestion || m.ask);
  return [...shown, ...others];
}

/** The tax fields: a business not registered for GST keeps them one step away (founder decision "simple first"). */
const TAX_FIELDS: ReadonlySet<string> = new Set(['taxId', 'stateCode']);

interface FieldsProps {
  client: ClientLite;
  items: readonly EvidenceItem[];
  /** Items being dismissed now, kept off the screen until the engine answers. */
  hidden: ReadonlySet<string>;
  /** The engine's refusal of a dismiss, by item id. */
  problems: ReadonlyMap<string, string>;
  onDismiss: (id: string) => void;
  /** Put the tax number and state code behind "More details" (a business not registered for GST). Left out, every
   *  field shows in line, as before. */
  foldTax?: boolean | undefined;
}

export function Fields({ client, items, hidden, problems, onDismiss, foldTax = false }: FieldsProps) {
  const t = useT();
  const view = (m: FieldModel) => (
    <FieldView key={m.field} model={m} label={RECORD_FIELDS.has(m.field) ? t(`clients.field.${m.field}`) : m.field} problems={problems} onDismiss={onDismiss} />
  );
  const models = fieldModels(client, items, hidden);
  const folded = foldTax ? models.filter((m) => TAX_FIELDS.has(m.field)) : [];
  return (
    <div className={s.fields}>
      {models.filter((m) => !folded.includes(m)).map(view)}
      {folded.length > 0 && <MoreDetails>{folded.map(view)}</MoreDetails>}
    </div>
  );
}

/** "More details": what a simple business need not see at first, one step away. Closed until the owner opens it,
 *  or until the place opens it to show something the owner must see (an engine refusal of a field inside). */
export function MoreDetails({ open, onOpenChange, children }: { open?: boolean | undefined; onOpenChange?: ((open: boolean) => void) | undefined; children: ReactNode }) {
  const t = useT();
  return (
    <details className={s.more} open={open} onToggle={(event) => onOpenChange?.(event.currentTarget.open)}>
      <summary className={s.moreSummary}>
        <Icon name="chevron-right" size={16} />
        {t('clients.more')}
      </summary>
      <div className={s.moreBody}>{children}</div>
    </details>
  );
}

function FieldView({ model, label, problems, onDismiss }: { model: FieldModel; label: string; problems: ReadonlyMap<string, string>; onDismiss: (id: string) => void }) {
  const t = useT();
  const labelId = useId();
  const group = useRef<HTMLDivElement>(null);
  const { stored, applied, suggestion, ask } = model;
  // The dismissed row leaves; focus stays on its field instead of falling to the page.
  const dismiss = (id: string) => { group.current?.focus(); onDismiss(id); };
  return (
    <div ref={group} role="group" aria-labelledby={labelId} className={s.field} tabIndex={-1}>
      <span id={labelId} className={s.label}>{label}</span>
      <div className={s.value}>
        {stored !== null && (applied ? (
          <>
            <Provenance source={t('clients.provenance', { source: applied.source, claim: t(`clients.claim.${applied.claim}`) })}>{stored}</Provenance>{' '}
            {applied.claim !== 'observed' && <span className={s.claim}>{t(`clients.claim.${applied.claim}`)}</span>}
          </>
        ) : <span>{stored}</span>)}
        {stored === null && !suggestion && !ask && <span className={s.empty}>{t('clients.field.empty')}</span>}
        {ask && <Ask item={ask} label={label} problem={problems.get(ask.id)} onDismiss={dismiss} />}
        {suggestion && <Suggestion key={suggestion.id} item={suggestion} label={label} problem={problems.get(suggestion.id)} onDismiss={dismiss} onApplied={() => group.current?.focus()} />}
      </div>
    </div>
  );
}

type UseState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'weak' } | { kind: 'failed'; message: string };

/** One quiet row where the value would land. Use this asks the engine; EVIDENCE_WEAK is said in plain words. */
function Suggestion({ item, label, problem, onDismiss, onApplied }: { item: EvidenceItem; label: string; problem: string | undefined; onDismiss: (id: string) => void; onApplied: () => void }) {
  const t = useT();
  const engine = useEngine();
  const [state, setState] = useState<UseState>({ kind: 'idle' });

  async function use() {
    setState({ kind: 'busy' });
    try {
      await engine.request('venture.evidence.apply', { id: item.id });
      onApplied();
      clientsChanged(engine);
    } catch (error) {
      if (error instanceof EngineError && error.code === 'EVIDENCE_WEAK') setState({ kind: 'weak' });
      else setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div role="group" aria-label={t('clients.suggest.label', { field: label.toLocaleLowerCase() })} className={s.suggestion} data-row="" data-row-id={`evidence-${item.id}`} tabIndex={-1}>
      <span className={s.suggestValue}>{item.value}</span>
      <span className={s.suggestActions}>
        <Button variant="quiet" className={s.dismiss} data-key="secondary" onClick={() => onDismiss(item.id)}>{t('clients.suggest.dismiss')}</Button>
        <Button variant="quiet" data-key="primary" disabled={state.kind === 'busy' || state.kind === 'weak'} onClick={() => void use()}>{t('clients.suggest.use')}</Button>
      </span>
      <span className={s.reason}>{t('clients.suggest.reason', { claim: t(`clients.claim.${item.claim}`), strength: t(`clients.strength.${item.strength}`), source: item.source })}</span>
      {/* The live region stays in place so the refusal is read out when it arrives. */}
      <span className={s.kept} role="status">{state.kind === 'weak' ? t('clients.suggest.weak') : ''}</span>
      {state.kind === 'failed' && <span className={s.failed} role="alert">{t('clients.suggest.failed', { message: state.message })}</span>}
      {problem && <span className={s.failed} role="alert">{t('clients.suggest.dismissFailed', { message: problem })}</span>}
    </div>
  );
}

/** Data Chausar cannot see: no value to use, only the ask and where it came from. */
function Ask({ item, label, problem, onDismiss }: { item: EvidenceItem; label: string; problem: string | undefined; onDismiss: (id: string) => void }) {
  const t = useT();
  return (
    <div role="group" aria-label={t('clients.ask.label', { field: label })} className={s.suggestion}>
      <span className={s.ask}>{t('clients.claim.needs-your-data')}</span>
      <span className={s.suggestActions}>
        <Button variant="quiet" className={s.dismiss} onClick={() => onDismiss(item.id)}>{t('clients.suggest.dismiss')}</Button>
      </span>
      <span className={s.reason}>{item.source}</span>
      {problem && <span className={s.failed} role="alert">{t('clients.suggest.dismissFailed', { message: problem })}</span>}
    </div>
  );
}
