/**
 * One check: the question, the expected value with its receipt, the last value with its own
 * receipt (for a moved check, old and new side by side), and the history of runs. Remove
 * asks once more before it removes.
 */
import { useState } from 'react';
import type { TimeEvent } from '../../../app/presentation.ts';
import { Button } from '../../../parts/Button';
import { Figure } from '../../../parts/Figure';
import { TimeLine } from '../../../parts/TimeLine';
import { call, date, id, list, minor, obj, str } from './client.ts';
import { AskPage, dayText, fill, missingFigure, moneyFigure, useAsk, useRead, useWords, type AskView } from './kit';
import { catalogue, Part, Problem, removed, useRefusal, useSend } from './analysis';
import { CHANGE_WORDS, changeWord, checkResult, type CheckResult } from './Checks';
import s from './analysis.module.css';

export interface CheckValue { readonly id: string; readonly question: string; readonly createdAt: string; readonly expected: { minor: string; receiptId: string }; readonly results: readonly CheckResult[] }
export function checkReply(value: unknown): CheckValue {
  const v = obj(value), e = obj(v.expected);
  id(v.operationId); str(v.figureKey, 100);
  return { id: id(v.id), question: str(v.question, 2000), createdAt: date(v.createdAt), expected: { minor: minor(e.minor), receiptId: id(e.receiptId) }, results: list(v.results, checkResult, 1000) };
}

const WORDS = catalogue({
  en: {
    title: 'A check', expected: 'Expected', expectedOn: 'Saved on {date}', now: 'Last value', nowOn: 'On {date}', notRun: 'This check has not run yet.',
    moved: 'The value moved.', same: 'The value is the same.', cannot: 'This check cannot run.', because: 'After a change of {what}.',
    history: 'History', same2: 'Same.', moved2: 'Moved.', cannot2: 'Could not run.', same3: 'Same, after a change of {what}.', moved3: 'Moved, after a change of {what}.', cannot3: 'Could not run, after a change of {what}.',
    remove: 'Remove', confirmRemove: 'Remove this check?', yesRemove: 'Yes, remove the check', keep: 'Keep it',
  },
  hi: {
    title: 'एक परख', expected: 'अपेक्षित', expectedOn: '{date} को सहेजा', now: 'पिछला मान', nowOn: '{date} को', notRun: 'यह परख अभी नहीं चली।',
    moved: 'मान बदल गया।', same: 'मान वही है।', cannot: 'यह परख चल नहीं सकती।', because: '{what} बदलने के बाद।',
    history: 'इतिहास', same2: 'वही।', moved2: 'बदला।', cannot2: 'चल नहीं सकी।', same3: '{what} बदलने के बाद वही।', moved3: '{what} बदलने के बाद बदला।', cannot3: '{what} बदलने के बाद चल नहीं सकी।',
    remove: 'हटाएँ', confirmRemove: 'यह परख हटाएँ?', yesRemove: 'हाँ, परख हटाएँ', keep: 'रहने दें',
  },
});

export function CheckScreen({ view }: { view: Extract<AskView, { kind: 'check' }> }) {
  const ask = useAsk(), w = useWords(WORDS), changes = useWords(CHANGE_WORDS), explain = useRefusal();
  const [load, retry] = useRead(`check|${view.checkId}`, () => call(ask.rpc, 'askx.checks.get', { checkId: view.checkId }, checkReply));
  const [asking, setAsking] = useState(false);
  const remove = useSend();
  const open = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });
  const lang = ask.language;
  const list_ = (codes: readonly string[]) => new Intl.ListFormat(lang, { type: 'conjunction' }).format([...new Set(codes.map(c => changeWord(changes, c)))]);
  return (
    <AskPage title={load.kind === 'ok' ? load.value.question : w.title} load={load} retry={retry} explain={explain}>
      {c => {
        const last = c.results[c.results.length - 1] ?? null;
        const valueOf = (r: CheckResult) => (r.minor !== null && r.receiptId !== null ? moneyFigure(r.minor, r.receiptId) : missingFigure(r.result === 'cannot-run' ? 'not-counted' : 'null'));
        const events: TimeEvent[] = c.results.map((r, i): TimeEvent => {
          const plain = r.result === 'same' ? w.same2 : r.result === 'moved' ? w.moved2 : w.cannot2;
          const withWhy = r.result === 'same' ? w.same3 : r.result === 'moved' ? w.moved3 : w.cannot3;
          return { id: `run-${i}`, mark: r.result === 'same' ? 'cha' : r.result === 'moved' ? 'wait' : 'unsure', date: dayText(r.at, lang), sentence: r.because.length === 0 ? plain : fill(withWhy, { what: list_(r.because) }), cost: valueOf(r) };
        }).reverse();
        return (
          <>
            {last === null ? <p className={s.lead}>{w.notRun}</p> : (
              <p className={s.lead} data-check-result={last.result}>
                {last.result === 'moved' ? w.moved : last.result === 'same' ? w.same : w.cannot}
                {last.because.length > 0 && <span className={s.note}> {fill(w.because, { what: list_(last.because) })}</span>}
                {last.code !== null && <span className={s.code}>{last.code}</span>}
              </p>
            )}
            <div className={s.pair}>
              <div className={s.tile}><span className={s.tileLabel}>{w.expected}</span><Figure size="tile" value={moneyFigure(c.expected.minor, c.expected.receiptId)} onReceipt={open} /><span className={s.note}>{fill(w.expectedOn, { date: dayText(c.createdAt, lang) })}</span></div>
              {last !== null && <div className={s.tile} data-check-now=""><span className={s.tileLabel}>{w.now}</span><Figure size="tile" value={valueOf(last)} onReceipt={open} /><span className={s.note}>{fill(w.nowOn, { date: dayText(last.at, lang) })}</span></div>}
            </div>
            {events.length > 0 && <Part title={w.history}><TimeLine events={events} onReceipt={open} /></Part>}
            {!ask.viewer && (
              <div className={[s.actions, s.part].join(' ')}>
                {!asking ? <Button danger onClick={() => setAsking(true)}>{w.remove}</Button> : (
                  <>
                    <span>{w.confirmRemove}</span>
                    <Button danger disabled={remove.busy} onClick={() => void remove.send('askx.checks.remove', { checkId: c.id }, removed, () => ask.back())}>{w.yesRemove}</Button>
                    <Button variant="link" onClick={() => setAsking(false)}>{w.keep}</Button>
                  </>
                )}
              </div>
            )}
            <Problem code={remove.problem} />
          </>
        );
      }}
    </AskPage>
  );
}
