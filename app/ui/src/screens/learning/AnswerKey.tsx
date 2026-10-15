/**
 * The answer key: the hand-worked cases every dictionary change must pass. Each expected value
 * was worked out by hand and is shown as that, formatted from its exact paise string; nothing
 * here computes a figure. "Run the key" asks the engine to run it now. The owner can reset the
 * key to the default or replace it with a key file (JSON), each through a sheet naming it.
 * Other seats get the rows withheld, and that is drawn as words.
 */
import { useState } from 'react';
import { useAct, useReply } from '../work/kit/reply.ts';
import { answerKeyReply, type AnswerCase, type AnswerKeyReply, type KeyRun } from './contract.ts';
import {
  Button, CaseMarks, ConfirmSheet, FilePick, Part, Refused, admins, day, isOwner, operationName, rupees, styles as s, useLx, valueOf, type LearningProps,
} from './shared.tsx';

type Replace = { readonly kind: 'reset' } | { readonly kind: 'file'; readonly name: string; readonly key: unknown; readonly label: string; readonly cases: string };

/** What the sheet names before a key file replaces the key. The file itself is checked by the engine. */
function describeKeyFile(name: string, content: string): Replace | null {
  let key: unknown;
  try { key = JSON.parse(content); } catch { return null; }
  if (key === null || typeof key !== 'object' || Array.isArray(key)) return null;
  const { label, cases } = key as { label?: unknown; cases?: unknown };
  if (typeof label !== 'string' || !Array.isArray(cases)) return null;
  return { kind: 'file', name, key, label, cases: String(cases.length) };
}

export function AnswerKey(props: LearningProps) {
  const lx = useLx();
  const { loaded, reload } = useReply(props, 'learningx.answerKey', {}, answerKeyReply);
  const act = useAct(props.rpc);
  const [run, setRun] = useState<KeyRun | null>(null);
  const [replace, setReplace] = useState<Replace | null>(null);
  const [badFile, setBadFile] = useState<string | null>(null);
  const value = valueOf(loaded);
  const owner = isOwner(props);

  const runKey = async () => {
    const done = await act.run('learningx.answerKey', { run: true }, answerKeyReply);
    if (done.ok) setRun(done.value.run ?? null);
  };
  const set = async () => {
    if (replace === null) return;
    const payload = replace.kind === 'reset' ? { reset: true } : { key: replace.key };
    const done = await act.run('learningx.answerKeySet', payload, answerKeyReply);
    setReplace(null);
    if (done.ok) { setRun(done.value.run ?? null); reload(); }
  };

  return (
    <Part title={lx('section.key')} loaded={loaded} reload={reload}>
      {value && <KeyBody props={props} value={value} />}
      {value && (
        <div className={s.inline}>
          {admins(props) && <Button onClick={() => { void runKey(); }} disabled={act.busy}>{lx('key.run')}</Button>}
          {owner && !value.default && <Button variant="link" onClick={() => setReplace({ kind: 'reset' })} disabled={act.busy}>{lx('key.reset')}</Button>}
          {owner && <FilePick label={lx('key.pick')} accept=".json,application/json" onText={(name, content) => {
            const described = describeKeyFile(name, content);
            setBadFile(described === null ? name : null); setReplace(described);
          }} />}
        </div>
      )}
      {badFile !== null && <p className={s.amber}>{lx('key.badFile', { name: badFile })}</p>}
      <Refused code={act.refusal} />
      {run !== null && <RunResult run={run} />}
      {replace !== null && (
        <ConfirmSheet kind={lx('key.sheetKind')} busy={act.busy}
          title={lx(replace.kind === 'reset' ? 'key.resetTitle' : 'key.replaceTitle')}
          confirm={lx(replace.kind === 'reset' ? 'key.resetConfirm' : 'key.replaceConfirm')}
          onConfirm={() => { void set(); }} onClose={() => setReplace(null)}>
          <p className={s.change}>{replace.kind === 'reset'
            ? lx('key.resetChange')
            : lx('key.replaceChange', { name: replace.name, label: replace.label, cases: replace.cases })}</p>
          <p className={s.note}>{lx('key.setNote')}</p>
        </ConfirmSheet>
      )}
    </Part>
  );
}

function KeyBody({ props, value }: { props: LearningProps; value: AnswerKeyReply }) {
  const lx = useLx();
  const key = value.key;
  const by = lx(value.default ? 'key.byDefault' : 'key.byOwner');
  return (
    <div className={s.stack}>
      <p className={s.change}>{lx(value.default ? 'key.defaultName' : 'key.ownName', { label: key.label })}</p>
      {key.expectedTotals && (
        <p>{lx('key.totals', { rows: String(key.expectedTotals.rowCount), amount: rupees(key.expectedTotals.amountMinor) })} <span className={s.word}>{by}</span></p>
      )}
      <table className={s.table}>
        <caption className="sr">{lx('key.cases')}</caption>
        <thead><tr>
          <th scope="col">{lx('key.col.case')}</th><th scope="col">{lx('key.col.period')}</th>
          <th scope="col" className={s.num}>{lx('key.col.expected')}</th>
        </tr></thead>
        <tbody>{key.cases.map(c => (
          <tr key={c.id} data-case={c.id}>
            <td>{operationName(c.operation, lx)}{props.view === 'books' && <span className={s.note}> ({c.id})</span>}</td>
            <td>{period(c, props, lx)}</td>
            <td className={s.num}><span className="fig">{rupees(c.expectedMinor)}</span> <span className={s.word}>{by}</span></td>
          </tr>
        ))}</tbody>
      </table>
      {typeof key.rows === 'string'
        ? (
          <details>
            <summary>{lx('key.showRows')}</summary>
            <pre className={s.bytes}>{key.rows}</pre>
          </details>
        )
        : <p className={s.note} data-rows="withheld">{lx('key.rowsWithheld')}</p>}
      {props.view === 'books' && <p className={[s.note, s.code].join(' ')}>{lx('digest', { digest: value.keyDigest })}</p>}
    </div>
  );
}

function period(c: AnswerCase, props: LearningProps, lx: ReturnType<typeof useLx>): string {
  const range = lx('key.period', { from: day(c.period.from, props.language), to: day(c.period.to, props.language) });
  return c.onDate ? lx('key.periodOn', { range, on: day(c.onDate, props.language) }) : range;
}

function RunResult({ run }: { run: KeyRun }) {
  const lx = useLx();
  if ('state' in run) return <p className={s.amber} role="status">{lx('key.noDictionary')}</p>;
  return (
    <div className={s.stack} role="status">
      <p className={run.passed ? undefined : s.amber}>{run.passed ? lx('key.allPassed') : lx('key.someFailed', { cases: run.failing.join(', ') })}</p>
      <CaseMarks cases={run.cases} />
    </div>
  );
}
