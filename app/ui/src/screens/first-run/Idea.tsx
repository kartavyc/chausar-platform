/**
 * FR-11 An idea, not a business yet (the conversation is not built yet), and FR-12 the setup
 * checklist from the engine's dated rule table (`todayx.setupChecklist`). Each row names its
 * rule, its source and the date it was checked. Nothing on this list comes from a model.
 */

import { useEffect, useState } from 'react';
import { useT } from '../../app/text';
import { isChecklistReply, type ChecklistRow } from '../../bridge/todayx-contract.ts';
import { ReplyValidationError } from '../../bridge/validate.ts';
import { failureOf, type JourneyFailure, type JourneyPort } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Note, Status, StepHeader } from './JourneyParts';
import s from './Journey.module.css';

type Checklist = { readonly kind: 'reading' } | { readonly kind: 'ready'; readonly rows: readonly ChecklistRow[] } | { readonly kind: 'failed'; readonly failure: JourneyFailure };

export function SetupChecklist({ rpc }: { rpc: JourneyPort }) {
  const t = useT();
  const [list, setList] = useState<Checklist>({ kind: 'reading' });
  useEffect(() => {
    let live = true;
    void rpc.request('todayx.setupChecklist', {}).then(reply => {
      if (!isChecklistReply(reply)) throw new ReplyValidationError('todayx.setupChecklist');
      if (live) setList({ kind: 'ready', rows: reply.rows });
    }).catch((error: unknown) => { if (live) setList({ kind: 'failed', failure: failureOf(error) }); });
    return () => { live = false; };
  }, [rpc]);
  return (
    <section className={s.section} data-setup-checklist="">
      <h2 className={s.sectionTitle}>{t('FR-12.title')}</h2>
      <p className={s.note}>{t('FR-12.lede')}</p>
      {list.kind === 'reading' && <Status k="FR-12.reading" />}
      {list.kind === 'failed' && <FailureLine failure={list.failure} notBuilt="FR-12.notBuilt" refused="FR.journey.code" />}
      {list.kind === 'ready' && (
        <ul className={s.rows}>
          {list.rows.map(row => (
            <li key={row.id} className={s.row} data-checklist-row={row.id}>
              <div className={s.rowLine}>
                <span className={s.rowName}>{t(`FR-12.row.${row.id}`)}</span>
                <span className={s.rowState}>{t(`FR-12.state.${row.state}`)}</span>
              </div>
              <p className={s.note}>{t('FR-12.rule', { rule: row.ruleId, source: row.source, date: row.checkedOn.slice(0, 10) })}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Idea({ rpc, onDone }: { rpc: JourneyPort; onDone: () => void }) {
  return (
    <section data-first-run-screen="idea">
      <StepHeader step={6} title="FR-11.title" />
      <Note k="FR-11.notBuilt" role="status" />
      <SetupChecklist rpc={rpc} />
      <Actions><Act variant="filled" label="FR-12.finish.btn" onClick={onDone} /></Actions>
    </section>
  );
}
