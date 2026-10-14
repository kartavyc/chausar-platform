/**
 * AS-12 Forecast: a look ahead that says how much to trust it. The past in ink, the
 * forecast lighter with a pale band for its range, the simple baseline thin and grey. Under
 * the chart, the error of each on the months held back. When the forecast lost to the
 * baseline, the baseline is the answer and the page says so. Under 24 months of history the
 * page says there is not enough to test one. The label "projection" follows every figure.
 */
import { useId, useState } from 'react';
import { Button } from '../../../parts/Button';
import { Figure } from '../../../parts/Figure';
import { KeyValue } from '../../../parts/KeyValue';
import { Label } from '../../../parts/Label';
import type { Figure as FigureValue } from '../../../app/presentation.ts';
import { call, fail, id, int, list, minor, obj, oneOf, optMinor, period, str, type Period } from './client.ts';
import { AskPage, countWords, fill, missingFigure, moneyFigure, periodText, useAsk, useRead, useWords, type AskView } from './kit';
import { catalogue, menuChoices, month, monthText, Part, Problem, useRefusal, useSend, type MenuChoices } from './analysis';
import { ForecastLine } from './parts/ForecastLine';
import s from './analysis.module.css';

interface Ready {
  readonly state: 'ready'; readonly answer: 'forecast' | 'baseline'; readonly operationId: string; readonly label: string;
  readonly history: readonly { month: string; minor: string; receiptId: string }[];
  readonly heldBack: readonly { month: string; actualMinor: string; forecastMinor: string; baselineMinor: string }[];
  readonly error: { forecastMinor: string; baselineMinor: string };
  readonly next: { month: string; forecastMinor: string | null; baselineMinor: string; rangeMinor: string | null };
  readonly method: { forecast: string; baseline: string; learnedFrom: Period; testedOn: Period };
  readonly evaluationId: string;
}
export type ForecastValue = { readonly state: 'not-enough-history'; readonly months: number; readonly needed: number } | { readonly state: 'cannot-test'; readonly code: string } | Ready;
export function forecastReply(value: unknown): ForecastValue {
  const v = obj(value), state = oneOf(v.state, ['not-enough-history', 'cannot-test', 'ready'] as const);
  if (state === 'not-enough-history') return { state, months: int(v.months), needed: int(v.needed) };
  if (state === 'cannot-test') return { state, code: oneOf(v.code, ['ASK_FORECAST_GAPS'] as const) };
  oneOf(v.label2, ['projection'] as const);
  const e = obj(v.error), n = obj(v.next), m = obj(v.method);
  const ready: Ready = {
    state, answer: oneOf(v.answer, ['forecast', 'baseline'] as const), operationId: id(v.operationId), label: str(v.label, 300),
    history: list(v.history, h => { const x = obj(h); return { month: month(x.month), minor: minor(x.minor), receiptId: id(x.receiptId) }; }, 600),
    heldBack: list(v.heldBack, h => { const x = obj(h); return { month: month(x.month), actualMinor: minor(x.actualMinor), forecastMinor: minor(x.forecastMinor), baselineMinor: minor(x.baselineMinor) }; }, 120),
    error: { forecastMinor: minor(e.forecastMinor), baselineMinor: minor(e.baselineMinor) },
    next: { month: month(n.month), forecastMinor: optMinor(n.forecastMinor), baselineMinor: minor(n.baselineMinor), rangeMinor: optMinor(n.rangeMinor) },
    method: { forecast: str(m.forecast, 200), baseline: str(m.baseline, 200), learnedFrom: period(m.learnedFrom), testedOn: period(m.testedOn) },
    evaluationId: id(v.evaluationId),
  };
  if (ready.history.length === 0) fail();
  return ready;
}

const WORDS = catalogue({
  en: {
    title: 'Forecast', calculation: 'Calculation', run: 'Forecast it', noSums: 'No money total in the menu can be forecast yet.',
    notEnough: 'Not enough history to test a forecast.', notEnoughDetail: '{months} months of history are loaded; {needed} are needed.',
    cannotTest: 'There is enough history, but a month in it has rows that are not reconciled, so the forecast cannot be tested.',
    next: 'Next: {month}', baselineWon: 'The forecast did worse than the simple baseline on the months held back, so the baseline is the answer.',
    forecastWon: 'The forecast did better than the simple baseline on the months held back.', range: 'Range, either way', noForecast: 'The forecast gave no value for this month.',
    byMonth: 'By month', chart: '{label} by month, with the forecast and the baseline for {month}.', past: 'Past', forecast: 'Forecast', baseline: 'Baseline (last year’s pattern)', band: 'Range of the forecast',
    point: '{month}, {series}', heldBack: 'The months held back', month: 'Month', actual: 'Actual', error: 'Error on the months held back',
    errorForecast: 'Forecast', errorBaseline: 'Baseline', method: 'How it was worked out', methodForecast: 'Forecast method', methodBaseline: 'Baseline method',
    learnedFrom: 'Learned from', testedOn: 'Tested on', save: 'Save', saved: 'Saved.', question: 'Forecast of {label} for {month}',
  },
  hi: {
    title: 'अनुमान', calculation: 'गणना', run: 'अनुमान लगाएँ', noSums: 'मेनू में अभी कोई ऐसा पैसे का कुल नहीं है जिसका अनुमान लगाया जा सके।',
    notEnough: 'अनुमान को परखने के लिए पर्याप्त इतिहास नहीं है।', notEnoughDetail: '{months} महीनों का इतिहास लोड है; {needed} चाहिए।',
    cannotTest: 'इतिहास पर्याप्त है, पर उसके एक महीने की पंक्तियाँ मिलाई नहीं गई हैं, इसलिए अनुमान को परखा नहीं जा सकता।',
    next: 'अगला: {month}', baselineWon: 'रोके गए महीनों पर अनुमान साधारण आधार-रेखा से खराब रहा, इसलिए आधार-रेखा ही उत्तर है।',
    forecastWon: 'रोके गए महीनों पर अनुमान साधारण आधार-रेखा से बेहतर रहा।', range: 'दोनों ओर का दायरा', noForecast: 'इस महीने के लिए अनुमान ने कोई मान नहीं दिया।',
    byMonth: 'महीने के अनुसार', chart: 'महीने के अनुसार {label}, {month} के अनुमान और आधार-रेखा के साथ।', past: 'बीता समय', forecast: 'अनुमान', baseline: 'आधार-रेखा (पिछले वर्ष का ढर्रा)', band: 'अनुमान का दायरा',
    point: '{month}, {series}', heldBack: 'रोके गए महीने', month: 'महीना', actual: 'वास्तविक', error: 'रोके गए महीनों पर चूक',
    errorForecast: 'अनुमान', errorBaseline: 'आधार-रेखा', method: 'यह कैसे निकाला गया', methodForecast: 'अनुमान का तरीका', methodBaseline: 'आधार-रेखा का तरीका',
    learnedFrom: 'किससे सीखा', testedOn: 'किस पर परखा', save: 'सहेजें', saved: 'सहेजा गया।', question: '{month} के लिए {label} का अनुमान',
  },
});

export function ForecastScreen({ view }: { view: Extract<AskView, { kind: 'forecast' }> }) {
  const [operationId, setOperationId] = useState<string | null>(view.operationId ?? null);
  return operationId === null ? <ForecastPick onPick={setOperationId} /> : <ForecastRun operationId={operationId} />;
}

function ForecastPick({ onPick }: { onPick: (operationId: string) => void }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useRefusal();
  const [menu, retry] = useRead('forecast-menu', () => call(ask.rpc, 'askx.menu', {}, menuChoices));
  return (
    <AskPage title={w.title} aside={<Label kind="projection" />} load={menu} retry={retry} explain={explain} empty={m => (m.sums.length === 0 ? <p>{w.noSums}</p> : null)}>
      {m => <PickForm menu={m} onPick={onPick} />}
    </AskPage>
  );
}
function PickForm({ menu, onPick }: { menu: MenuChoices; onPick: (operationId: string) => void }) {
  const w = useWords(WORDS), selectId = useId();
  const [op, setOp] = useState(menu.sums[0]!.operationId);
  return (
    <form className={s.formLine} onSubmit={e => { e.preventDefault(); onPick(op); }}>
      <div>
        <label htmlFor={selectId} className={s.tileLabel}>{w.calculation}</label><br />
        <select id={selectId} className={s.input} value={op} onChange={e => setOp(e.target.value)}>
          {menu.sums.map(m => <option key={m.operationId} value={m.operationId}>{m.label}</option>)}
        </select>
      </div>
      <Button variant="filled" submit>{w.run}</Button>
    </form>
  );
}

function ForecastRun({ operationId }: { operationId: string }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useRefusal();
  const [load, retry] = useRead(`forecast|${operationId}`, () => call(ask.rpc, 'askx.forecast', { operationId }, forecastReply));
  const title = load.kind === 'ok' && load.value.state === 'ready' ? load.value.label : w.title;
  return (
    <AskPage title={title} aside={<Label kind="projection" />} load={load} retry={retry} explain={explain}>
      {f => f.state === 'not-enough-history' ? (
        <div data-forecast-state="not-enough-history">
          <p>{w.notEnough}</p>
          <p className={s.note}>{fill(w.notEnoughDetail, { months: countWords(String(f.months)), needed: countWords(String(f.needed)) })}</p>
        </div>
      ) : f.state === 'cannot-test' ? <p data-forecast-state="cannot-test">{w.cannotTest} <span className={s.code}>{f.code}</span></p> : <ForecastReady f={f} />}
    </AskPage>
  );
}

function ForecastReady({ f }: { f: Ready }) {
  const ask = useAsk(), w = useWords(WORDS), lang = ask.language;
  const open = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });
  const save = useSend();
  const [done, setDone] = useState(false);
  /* Everything worked out by the forecast run opens the run's own receipt. */
  const run = (minorValue: string): FigureValue => moneyFigure(minorValue, f.evaluationId, ['projection']);
  const months = [...new Set([...f.history.map(h => h.month.slice(0, 7)), ...f.heldBack.map(h => h.month.slice(0, 7)), f.next.month.slice(0, 7)])].sort();
  const at = (m: string) => months.indexOf(m.slice(0, 7));
  const series = (fill_: (put: (m: string, fig: FigureValue) => void) => void) => {
    const out: (FigureValue | null)[] = months.map(() => null);
    fill_((m, fig) => { out[at(m)] = fig; });
    return out;
  };
  const past = series(put => f.history.forEach(h => put(h.month, moneyFigure(h.minor, h.receiptId))));
  const forecast = series(put => { f.heldBack.forEach(h => put(h.month, run(h.forecastMinor))); if (f.next.forecastMinor !== null) put(f.next.month, run(f.next.forecastMinor)); });
  const baseline = series(put => { f.heldBack.forEach(h => put(h.month, run(h.baselineMinor))); put(f.next.month, run(f.next.baselineMinor)); });
  const nextMonth = monthText(f.next.month, lang);
  const answer = f.answer === 'baseline' ? run(f.next.baselineMinor) : f.next.forecastMinor === null ? missingFigure('null') : run(f.next.forecastMinor);
  const actualOf = (m: string, minorValue: string) => { const h = f.history.find(x => x.month.slice(0, 7) === m.slice(0, 7)); return h ? moneyFigure(h.minor, h.receiptId) : run(minorValue); };
  return (
    <>
      <p className={s.lead} data-forecast-answer={f.answer}>{f.answer === 'baseline' ? w.baselineWon : w.forecastWon}</p>
      <div className={s.tile}>
        <span className={s.tileLabel}>{fill(w.next, { month: nextMonth })}</span>
        <Figure size="big" value={answer} onReceipt={open} />
        {f.answer === 'forecast' && f.next.rangeMinor !== null && <KeyValue onReceipt={open} pairs={[{ name: w.range, figure: run(f.next.rangeMinor) }]} />}
        {f.answer === 'forecast' && f.next.forecastMinor === null && <p className={s.note}>{w.noForecast}</p>}
      </div>
      <Part title={w.byMonth}>
        <ForecastLine
          sentence={fill(w.chart, { label: f.label, month: nextMonth })}
          labels={months.map(m => monthText(m, lang))}
          past={past} forecast={forecast} baseline={baseline}
          band={f.next.forecastMinor !== null && f.next.rangeMinor !== null ? { index: at(f.next.month), centre: f.next.forecastMinor, spread: f.next.rangeMinor } : null}
          words={{ past: w.past, forecast: w.forecast, baseline: w.baseline, range: w.band, point: w.point }}
          onReceipt={open}
        />
      </Part>
      <Part title={w.heldBack}>
        <div className={s.scroll}>
          <table className={s.table}>
            <thead><tr><th scope="col">{w.month}</th><th scope="col">{w.actual}</th><th scope="col">{w.errorForecast}</th><th scope="col">{w.errorBaseline}</th></tr></thead>
            <tbody>
              {f.heldBack.map(h => (
                <tr key={h.month}>
                  <th scope="row">{monthText(h.month, lang)}</th>
                  <td><Figure value={actualOf(h.month, h.actualMinor)} onReceipt={open} /></td>
                  <td><Figure value={run(h.forecastMinor)} onReceipt={open} /></td>
                  <td><Figure value={run(h.baselineMinor)} onReceipt={open} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className={s.tileLabel}>{w.error}</h3>
        <div data-forecast-error="">
          <KeyValue onReceipt={open} pairs={[{ name: w.errorForecast, figure: run(f.error.forecastMinor) }, { name: w.errorBaseline, figure: run(f.error.baselineMinor) }]} />
        </div>
      </Part>
      <Part title={w.method}>
        <KeyValue onReceipt={open} pairs={[
          { name: w.methodForecast, value: f.method.forecast, mono: true }, { name: w.methodBaseline, value: f.method.baseline, mono: true },
          { name: w.learnedFrom, value: periodText(f.method.learnedFrom, lang) }, { name: w.testedOn, value: periodText(f.method.testedOn, lang) },
        ]} />
      </Part>
      {!ask.viewer && (
        <div className={[s.actions, s.part].join(' ')}>
          <Button disabled={save.busy || done} onClick={() => void save.send('askx.saveRef', { kind: 'forecast', refId: f.evaluationId, question: fill(w.question, { label: f.label, month: nextMonth }) }, v => id(obj(v).id), () => setDone(true))}>{w.save}</Button>
          {done && <span role="status" className={s.note}>{w.saved}</span>}
        </div>
      )}
      <Problem code={save.problem} />
    </>
  );
}
