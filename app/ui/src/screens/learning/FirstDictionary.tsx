/**
 * First dictionary: the builder profiles a CSV the person picks (read as text in the browser)
 * and proposes a starter pack with inferred fields and their evidence. The owner adopts a
 * proposal through a sheet naming it; adoption runs the answer key first and publishes only
 * when every case passes.
 */
import { useState } from 'react';
import { useAct, useReply } from '../work/kit/reply.ts';
import { adoptReply, proposal as proposalCheck, proposalsReply, type AdoptReply, type Proposal } from './contract.ts';
import {
  Button, CaseMarks, ConfirmSheet, FilePick, Part, Refused, day, isOwner, prepares, styles as s, useLx, valueOf, type LearningProps, type Lx,
} from './shared.tsx';

export const PACKS = ['ecommerce', 'services', 'saas', 'manufacturing', 'retail', 'distributor'] as const;
export const FIELD_REASONS = [
  'empty-column', 'true-false-values', 'date-iso', 'date-dmy', 'date-ymd8', 'decimal-amounts', 'amount-header', 'whole-numbers',
  'decimal-without-amount-header', 'text-values', 'type-differs-between-files', 'type-differs-from-pack', 'matches-pack-field',
] as const;
export const SKIP_REASONS = ['no-safe-name', 'record-identity-column'] as const;
const known = (list: readonly string[], value: string) => list.includes(value);
export const packName = (pack: string, lx: Lx) => known(PACKS, pack) ? lx(`pack.${pack}`) : pack;
const reasonText = (reason: string, lx: Lx) => known(FIELD_REASONS, reason) ? lx(`reason.${reason}`) : reason;
const skipText = (reason: string, lx: Lx) => known(SKIP_REASONS, reason) ? lx(`skip.${reason}`) : reason;

export function FirstDictionary(props: LearningProps) {
  const lx = useLx();
  const { loaded, reload } = useReply(props, 'learningx.dictionaryProposals', {}, proposalsReply);
  const act = useAct(props.rpc);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [adopting, setAdopting] = useState<Proposal | null>(null);
  const [outcome, setOutcome] = useState<AdoptReply | null>(null);
  const value = valueOf(loaded);

  const build = async () => {
    if (file === null || file.content.length === 0) return;
    const built = await act.run('learningx.dictionaryBuild', { files: [{ content: file.content }] }, proposalCheck);
    if (built.ok) { setFile(null); reload(); }
  };
  const adopt = async () => {
    if (adopting === null) return;
    const done = await act.run('learningx.dictionaryAdopt', { id: adopting.id, digest: adopting.digest }, adoptReply);
    setAdopting(null);
    if (done.ok) { setOutcome(done.value); reload(); }
  };

  return (
    <Part title={lx('section.first')} loaded={loaded} reload={reload}>
      <p className={s.note}>{lx('first.intro')}</p>
      {prepares(props) && (
        <div className={s.stack}>
          <FilePick label={lx('first.pick')} accept=".csv,text/csv" onText={(name, content) => { setOutcome(null); setFile({ name, content }); }} />
          {file !== null && (file.content.length === 0
            ? <p className={s.amber}>{lx('first.emptyFile', { name: file.name })}</p>
            : (
              <p className={s.inline}>
                <span>{lx('first.picked', { name: file.name })}</span>
                <Button onClick={() => { void build(); }} disabled={act.busy}>{lx('first.propose')}</Button>
              </p>
            ))}
          <p className={s.note}>{lx('first.stays')}</p>
        </div>
      )}
      <Refused code={act.refusal} />
      {outcome !== null && <Outcome outcome={outcome} />}
      {value && (value.items.length === 0
        ? <p className={s.note}>{lx('first.empty')}</p>
        : (
          <ul className={s.rows} aria-label={lx('section.first')}>
            {value.items.map(item => (
              <ProposalRow key={item.id} props={props} item={item} busy={act.busy} onAdopt={() => { setOutcome(null); setAdopting(item); }} />
            ))}
          </ul>
        ))}
      {adopting !== null && (
        <ConfirmSheet kind={lx('first.sheetKind')} title={lx('first.adoptTitle')} confirm={lx('first.adoptConfirm')} busy={act.busy}
          onConfirm={() => { void adopt(); }} onClose={() => setAdopting(null)}>
          <p className={s.change}>{lx('first.adoptChange', { label: adopting.draft.label, pack: packName(adopting.pack.pack, lx), fields: String(adopting.evidence.length) })}</p>
          <p className={s.note}>{lx('first.adoptNote')}</p>
          {props.view === 'books' && <p className={[s.note, s.code].join(' ')}>{lx('digest', { digest: adopting.digest })}</p>}
        </ConfirmSheet>
      )}
    </Part>
  );
}

function Outcome({ outcome }: { outcome: AdoptReply }) {
  const lx = useLx();
  return (
    <div className={s.stack} role="status">
      {outcome.published && outcome.dictionary
        ? <p>{lx('first.published', { version: String(outcome.dictionary.version) })}</p>
        : <p className={s.amber}>{lx('first.notPublished', { failing: outcome.failing.join(', ') || lx('none') })}</p>}
      <CaseMarks cases={outcome.cases} />
    </div>
  );
}

function ProposalRow({ props, item, busy, onAdopt }: { props: LearningProps; item: Proposal; busy: boolean; onAdopt: () => void }) {
  const lx = useLx();
  return (
    <li className={s.row} data-proposal={item.id} data-status={item.status}>
      <p className={s.change}>{lx('first.row', { label: item.draft.label, pack: packName(item.pack.pack, lx) })}</p>
      <p className={s.inline}>
        <span className={item.status === 'failed-answer-key' ? s.amberWord : s.word}>{lx(`proposal.${item.status}`)}</span>
        <span className={s.word}>{lx('first.packConfidence', { confidence: lx(`confidence.${item.pack.confidence}`) })}</span>
        {item.origin === 'model' && <span className={s.word}>{lx('edits.fromModel')}</span>}
        <span className={s.note}>{day(item.at, props.language)}</span>
      </p>
      {item.pack.matched && item.pack.matched.length > 0 && props.view !== 'simple' && <p className={s.note}>{lx('first.matched', { words: item.pack.matched.join(', ') })}</p>}
      {item.failing.length > 0 && <p className={s.amber}>{lx('edits.failing', { cases: item.failing.join(', ') })}</p>}
      {props.view !== 'simple' && item.evidence.length > 0 && (
        <ul className={s.list} aria-label={lx('first.fields')}>
          {item.evidence.map(field => (
            <li key={field.name}>
              {lx('first.field', { name: field.name, type: lx(`type.${field.type}`), header: field.header, filled: String(field.filled), rows: String(field.rows), confidence: lx(`confidence.${field.confidence}`) })}
              {field.reasons.length > 0 && <span className={s.note}> {lx('first.because', { reasons: field.reasons.map(r => reasonText(r, lx)).join(', ') })}</span>}
            </li>
          ))}
        </ul>
      )}
      {props.view === 'books' && item.skipped.length > 0 && (
        <ul className={s.list} aria-label={lx('first.skipped')}>
          {item.skipped.map(skip => <li key={skip.header} className={s.note}>{lx('first.skip', { header: skip.header, reason: skipText(skip.reason, lx) })}</li>)}
        </ul>
      )}
      {isOwner(props) && item.status === 'proposed' && <p><Button onClick={onAdopt} disabled={busy}>{lx('first.adopt')}</Button></p>}
      {!isOwner(props) && !props.viewer && item.status === 'proposed' && <p className={s.note}>{lx('first.ownerAdopts')}</p>}
    </li>
  );
}
