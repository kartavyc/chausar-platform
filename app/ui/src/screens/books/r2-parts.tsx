/** Small pieces the round-2 Books screens share: a refusal in plain words, two totals side by side, one read's envelope. */
import type { Language } from '../../app/presentation.ts';
import { Refusal } from '../work/kit/Page';
import { dayTime, paise } from '../work/kit/format.ts';
import { missingWord } from '../work/kit/words.ts';
import type { EnvelopeView } from './contract-r2.ts';
import { fill } from './shared.tsx';
import { sayCode, useR2, type R2 } from './words-r2.ts';
import s from './R2.module.css';
import b from './Books.module.css';

/** A refusal: the plain sentence when the code has one, otherwise the code itself. */
export function Say({ code, language }: { code: string | null; language: Language }) {
  const w = useR2(language);
  const sentence = sayCode(w, code);
  if (sentence !== null) return <p className={b.amber} role="alert">{sentence}</p>;
  return <Refusal code={code} language={language} />;
}

/** A total recorded by a source or counted from its rows: exact text, never computed here. */
export function TotalText({ value, measure, unit }: { value: string | null; measure: 'money' | 'count'; unit: string }) {
  if (value === null) return null;
  return <span className="fig">{measure === 'money' && unit === 'INR' ? paise(value) : `${value}${unit ? ` ${unit}` : ''}`}</span>;
}

export function TwoTotals({ ours, theirs, measure, unit, match, w, language }: { ours: string | null; theirs: string | null; measure: 'money' | 'count'; unit: string; match: 'yes' | 'no' | 'unavailable'; w: R2; language: Language }) {
  return (
    <div className={b.stack}>
      <div className={s.pair}>
        <div className={s.box}><span className={s.boxName}>{w.ours}</span>{ours === null ? <span className={b.missing}>{missingWord('not-counted', language)}</span> : <TotalText value={ours} measure={measure} unit={unit} />}</div>
        <div className={s.box}><span className={s.boxName}>{w.theirs}</span>{theirs === null ? <span className={b.missing}>{w['match.unavailable']}</span> : <TotalText value={theirs} measure={measure} unit={unit} />}</div>
      </div>
      <p className={match === 'no' ? b.amber : b.note}>{w[`match.${match}`]}</p>
    </div>
  );
}

export function EnvelopeCard({ envelope: e, language }: { envelope: EnvelopeView; language: Language }) {
  const w = useR2(language);
  return (
    <div className={b.stack} aria-label={w.readNow}>
      {e.status === 'accepted' && <p>{w['env.accepted']}</p>}
      {e.status === 'refused' && <p className={b.amber}>{fill(w['env.refused'], { reason: e.refusal?.reason || w.noCode })} {e.refusal && <span className="fig">{fill(w.envCode, { code: e.refusal.code })}</span>}</p>}
      {e.status === 'failed' && <p className={b.amber}>{w['env.failed']} {e.refusal && <span className="fig">{fill(w.envCode, { code: e.refusal.code })}</span>}</p>}
      {e.status === 'abstained' && e.abstention && (
        <div className={b.stack}>
          <p>{w['env.abstained']} {e.abstention.question}</p>
          {e.abstention.options.length > 0 && <ul className={b.list} aria-label={w.choices}>{e.abstention.options.map(o => <li key={o}>{o}</li>)}</ul>}
        </div>
      )}
      <p className={b.note}>{dayTime(e.at, language)} · {e.operation} · {fill(w.rowsRead, { n: e.rows, x: e.excludedRows })}</p>
      <TwoTotals {...e.total} w={w} language={language} />
      {e.unmappedFields.length > 0 && <p className={b.note}>{e.unmappedFields.join(', ')}</p>}
      {e.committed && <p role="status">{e.committed.duplicate ? w.importedDuplicate : fill(w.imported, { n: e.committed.rows })}</p>}
      {e.waiting && <p className={b.note}>{w.waitingImport}</p>}
    </div>
  );
}
export { s as r2Styles };
