/**
 * FR-02 Business identity card and GST mode. Six optional fields, each on its own line, and
 * the GST mode as three rows. Continue asks the engine to check the format of what was typed
 * (`todayx.identity.check`); each problem code becomes its own sentence. Nothing is looked
 * up online. The card is held in memory by the journey and written after the vault exists.
 */

import { useId, useRef, useState } from 'react';
import { useT } from '../../app/text';
import { Field } from '../../parts/Field';
import { IDENTITY_FIELDS, isIdentityCheckReply } from '../../bridge/todayx-contract.ts';
import type { IdentityCheckReply, IdentityField } from '../../bridge/todayx-contract.ts';
import { ReplyValidationError } from '../../bridge/validate.ts';
import type { GstMode, HeldIdentity } from './journey.ts';
import { failureOf, type JourneyFailure, type JourneyPort } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Note, Status, StepHeader } from './JourneyParts';
import s from './Journey.module.css';

const GST_MODES: readonly GstMode[] = ['regular', 'composition', 'not-registered'];
type Problems = IdentityCheckReply['fields'];

export interface IdentityProps {
  readonly rpc: JourneyPort;
  readonly held: HeldIdentity;
  readonly onHold: (identity: HeldIdentity) => void;
  readonly onBack: () => void;
}

export function Identity({ rpc, held, onHold, onBack }: IdentityProps) {
  const t = useT();
  const gstName = useId();
  const [fields, setFields] = useState<Partial<Record<IdentityField, string>>>(() => ({ ...held.fields }));
  const [gstMode, setGstMode] = useState<GstMode | null>(held.gstMode);
  const [problems, setProblems] = useState<Problems>({});
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<JourneyFailure | null>(null);
  const live = useRef(0);

  const typed = (): Partial<Record<IdentityField, string>> => {
    const out: Partial<Record<IdentityField, string>> = {};
    for (const field of IDENTITY_FIELDS) { const value = fields[field]?.trim(); if (value) out[field] = value; }
    return out;
  };
  const hold = () => onHold({ fields: typed(), gstMode });

  const submit = async () => {
    const values = typed();
    if (Object.keys(values).length === 0) { hold(); return; }
    const token = ++live.current;
    setChecking(true); setFailure(null);
    try {
      const reply = await rpc.request('todayx.identity.check', { fields: values });
      if (token !== live.current) return;
      if (!isIdentityCheckReply(reply)) throw new ReplyValidationError('todayx.identity.check');
      setChecking(false);
      setProblems(reply.fields);
      if (Object.values(reply.fields).every(result => result?.ok !== false)) hold();
    } catch (error) {
      if (token !== live.current) return;
      setChecking(false);
      const seen = failureOf(error);
      // Without the engine's format check the card is still held as typed; the words say so.
      if (seen.kind === 'not-built' || seen.code === 'VAULT_LOCKED') { setFailure({ kind: 'not-built' }); return; }
      setFailure(seen);
    }
  };

  const problemOf = (field: IdentityField): string | undefined => {
    const result = problems[field];
    if (result === undefined || result.ok) return undefined;
    const name = t(`FR-02.field.${field}`);
    if (result.problem === 'length') return result.expectedLength === null ? t('FR-02.problem.length.plain', { field: name }) : t('FR-02.problem.length', { field: name, length: String(result.expectedLength) });
    return t(`FR-02.problem.${result.problem}`, { field: name });
  };

  return (
    <section data-first-run-screen="identity">
      <StepHeader step={1} title="FR-02.title" lede="FR-02.lede" />
      <form onSubmit={event => { event.preventDefault(); if (failure?.kind === 'not-built') { hold(); return; } void submit(); }}>
        <div className={s.fields}>
          {IDENTITY_FIELDS.map(field => (
            <Field key={field} label={t(`FR-02.field.${field}`)} name={field} autoComplete="off" spellCheck={false}
              value={fields[field] ?? ''} problem={problemOf(field)}
              onChange={event => { const value = event.currentTarget.value; setFields(current => ({ ...current, [field]: value })); setProblems(current => { const next = { ...current }; delete next[field]; return next; }); }} />
          ))}
        </div>
        <fieldset className={s.section} style={{ border: 0, padding: 0 }}>
          <legend className={s.sectionTitle}>{t('FR-02.gst')}</legend>
          <ul className={s.rows}>
            {GST_MODES.map(mode => (
              <li key={mode} className={s.row}>
                <label className={s.radioRow}>
                  <input type="radio" name={gstName} value={mode} checked={gstMode === mode} onChange={() => setGstMode(mode)} />
                  <span className={s.rowName}>{t(`FR-02.gst.${mode}`)}</span>
                  <span className={s.rowState}>{t(`FR-02.gst.${mode}.note`)}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {checking && <Status k="FR-02.checking" />}
        {failure !== null && <FailureLine failure={failure} notBuilt="FR-02.checkNotBuilt" refused="FR-02.checkRefused" />}
        <Note k="FR-02.held" />
        <Actions>
          <Act variant="filled" submit label="FR.journey.continue.btn" disabled={checking} />
          <Act variant="link" label="FR.journey.back.btn" onClick={onBack} />
        </Actions>
      </form>
    </section>
  );
}
