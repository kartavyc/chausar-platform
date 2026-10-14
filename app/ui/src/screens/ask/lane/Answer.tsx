/**
 * AS-04 an answer: the calculation as the title, the line from AS-02, one big figure, ranked
 * bars when there is more than one measure, and the check line that opens the number guard's
 * list. Every figure and bar opens the receipt. Missing months and gaps are words. A viewer
 * seat sees no Save, Save as a check or Record a decision.
 */
import { useState } from 'react';
import type { Catalogue } from '../../../places/types.ts';
import type { ChartValue, FigureOrMissing } from '../../../app/presentation.ts';
import { Figure } from '../../../parts/Figure';
import { Button } from '../../../parts/Button';
import { KeyValue } from '../../../parts/KeyValue';
import { Label } from '../../../parts/Label';
import { State } from '../../../patterns/States';
import { AskPage, countWords, dayText, figureOf, fill, missingFigure, periodText, useAsk, useRead, useWords, type AskView } from './kit';
import { call } from './client.ts';
import { answerReply, runReply, savedId, type AnswerReply, type GuardMatch, type RuleKind } from './core-replies.ts';
import { Refusal, monthText, understoodText, useExplain, useShared } from './core-words';
import { RankedBars } from './parts/RankedBars';
import s from './core.module.css';

type Key =
  | 'check' | 'guardTitle' | 'guardReplaced' | 'matchFigure' | 'matchRows' | 'matchExcluded' | 'matchDate' | 'matchOrdinal' | 'matchNone' | 'guardEmpty'
  | 'fromTemplate' | 'fromModel' | 'monthsNotLoaded' | 'compared' | 'asOf' | 'bars' | 'save' | 'saveCheck' | 'saved' | 'savedCheck'
  | 'why' | 'decide' | 'receipt' | 'sentNothing' | 'measures' | 'working' | 'monthsNotLoadedMany' | 'rebuild' | 'measuresNote' | 'measureKey'
  | 'no-model' | 'guard-replaced';
const WORDS = {
  en: {
    check: 'Checked against the receipt. {rows} rows, {left} left out.', guardTitle: 'Numbers in the written explanation',
    guardReplaced: 'A number in the written explanation was not on the receipt, so the explanation was replaced with the plain one. The figures stay, because they come from the receipt.',
    matchFigure: 'matches {label}', matchRows: 'matches the rows read', matchExcluded: 'matches the rows left out', matchDate: 'a date, not an amount', matchOrdinal: 'an ordinal, not an amount', matchNone: 'not on the receipt',
    guardEmpty: 'The written explanation has no numbers of its own.',
    fromTemplate: 'This explanation is written from a template.', fromModel: 'This explanation was written by the model and checked against the receipt.',
    monthsNotLoaded: 'Not loaded yet: {months}.', compared: 'Compared with {period}', asOf: 'As of {date}', bars: 'The measures of this answer, largest first.',
    save: 'Save', saveCheck: 'Save as a check', saved: 'Saved.', savedCheck: 'Saved as a check.',
    why: 'Why did it change', decide: 'Record a decision', receipt: 'See the receipt', sentNothing: 'Nothing was sent to an AI model for this answer.',
    measures: 'Every measure', working: 'Working it out again from the books.',
    monthsNotLoadedMany: '{count} months not loaded yet: {months}.', rebuild: 'Rebuild', measureKey: '{label} ({key})',
    measuresNote: 'These are different measures of the same question. Each one is a figure on the receipt.',
    'no-model': 'Written from a template: no AI model was asked.',
    'guard-replaced': 'The written explanation had a number not on the receipt, so the template is shown. The figures come from the receipt.',
  },
  hi: {
    check: 'रसीद से जाँचा गया। {rows} पंक्तियाँ, {left} छोड़ी गईं।', guardTitle: 'लिखी व्याख्या में आई संख्याएँ',
    guardReplaced: 'लिखी व्याख्या की एक संख्या रसीद में नहीं थी, इसलिए व्याख्या की जगह सादी व्याख्या रखी गई। आँकड़े वही रहे, क्योंकि वे रसीद से आते हैं।',
    matchFigure: '{label} से मेल खाती है', matchRows: 'पढ़ी गई पंक्तियों से मेल खाती है', matchExcluded: 'छोड़ी गई पंक्तियों से मेल खाती है', matchDate: 'तारीख़, राशि नहीं', matchOrdinal: 'क्रम संख्या, राशि नहीं', matchNone: 'रसीद में नहीं',
    guardEmpty: 'लिखी व्याख्या में अपनी कोई संख्या नहीं है।',
    fromTemplate: 'यह व्याख्या एक साँचे से लिखी गई है।', fromModel: 'यह व्याख्या मॉडल ने लिखी और रसीद से जाँची गई।',
    monthsNotLoaded: 'अभी लोड नहीं हुआ: {months}।', compared: '{period} से तुलना', asOf: '{date} तक', bars: 'इस जवाब के माप, सबसे बड़ा पहले।',
    save: 'सहेजें', saveCheck: 'जाँच के रूप में सहेजें', saved: 'सहेजा गया।', savedCheck: 'जाँच के रूप में सहेजा गया।',
    why: 'यह क्यों बदला', decide: 'फ़ैसला दर्ज करें', receipt: 'रसीद देखें', sentNothing: 'इस जवाब के लिए किसी AI मॉडल को कुछ नहीं भेजा गया।',
    measures: 'हर माप', working: 'बही से फिर से हिसाब निकाला जा रहा है।',
    monthsNotLoadedMany: '{count} महीने अभी लोड नहीं हुए: {months}।', rebuild: 'फिर से बनाएँ', measureKey: '{label} ({key})',
    measuresNote: 'ये एक ही सवाल के अलग-अलग माप हैं। हर एक रसीद का एक आँकड़ा है।',
    'no-model': 'एक साँचे से लिखा गया: किसी AI मॉडल से नहीं पूछा गया।',
    'guard-replaced': 'लिखी व्याख्या में एक संख्या रसीद में नहीं थी, इसलिए साँचा दिखाया गया है। आँकड़े रसीद से आते हैं।',
  },
} as const satisfies Catalogue<Key>;

type Act = { readonly kind: 'idle' } | { readonly kind: 'busy' } | { readonly kind: 'done'; readonly what: 'saved' | 'savedCheck' } | { readonly kind: 'refused'; readonly code: string; readonly rule?: RuleKind } | { readonly kind: 'not-built' };

export function AnswerScreen({ view }: { view: Extract<AskView, { kind: 'answer' }> }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useExplain();
  const [load, retry] = useRead(`answer|${view.receiptId}`, () => call(ask.rpc, 'askx.answer', { receiptId: view.receiptId }, answerReply));
  const title = load.kind === 'ok' ? load.value.label : w.receipt;
  return (
    <AskPage title={title} load={load} retry={retry} explain={explain}>
      {(a: AnswerReply) => <AnswerBody answer={a} />}
    </AskPage>
  );
}

function AnswerBody({ answer: a }: { answer: AnswerReply }) {
  const ask = useAsk(), w = useWords(WORDS), shared = useShared();
  const [guardOpen, setGuardOpen] = useState(ask.view === 'books');
  const [act, setAct] = useState<Act>({ kind: 'idle' });
  const toReceipt = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });
  const figs = a.figures.map(f => ({ f, figure: figureOf(f.unit, f.minor, a.receiptId, a.labels) }));
  const head: FigureOrMissing = figs[0]?.figure ?? missingFigure(a.completeness === 'empty' ? 'not-loaded-yet' : 'absent');
  const bars: ChartValue[] = figs.map(({ f, figure }) => ({ id: f.key, label: f.label, value: figure }));
  const matched = (m: GuardMatch) => m === null ? w.matchNone : 'figureKey' in m
    ? fill(w.matchFigure, { label: a.figures.find(f => f.key === m.figureKey)?.label ?? m.figureKey })
    : m.field === 'rows' ? w.matchRows : m.field === 'excluded' ? w.matchExcluded : m.field === 'ordinal' ? w.matchOrdinal : w.matchDate;

  async function mutate(method: 'askx.save' | 'askx.checks.save', what: 'saved' | 'savedCheck') {
    setAct({ kind: 'busy' });
    const payload = method === 'askx.save' ? { receiptId: a.receiptId } : { receiptId: a.receiptId, figureKey: a.figures[0]?.key };
    const reply = await call(ask.rpc, method, payload, savedId);
    if (!ask.live()) return;
    setAct(reply.kind === 'ok' ? { kind: 'done', what } : reply.kind === 'not-built' ? { kind: 'not-built' } : { kind: 'refused', code: reply.code });
  }
  async function rebuild() {
    setAct({ kind: 'busy' });
    const reply = await call(ask.rpc, 'askx.run', {
      operationId: a.operationId, ...(a.period === null ? {} : { period: a.period }), ...(a.comparePeriod === null ? {} : { comparePeriod: a.comparePeriod }), branch: a.branch,
    }, runReply);
    if (!ask.live()) return;
    if (reply.kind === 'ok' && reply.value.kind === 'answer') { setAct({ kind: 'idle' }); return ask.go({ kind: 'answer', receiptId: reply.value.receiptId }); }
    if (reply.kind === 'ok' && reply.value.kind === 'refused' && reply.value.rule !== undefined) return setAct({ kind: 'refused', code: reply.value.code, rule: reply.value.rule });
    setAct(reply.kind === 'not-built' ? { kind: 'not-built' } : { kind: 'refused', code: reply.kind === 'refused' ? reply.code : reply.value.kind === 'refused' ? reply.value.code : 'ASK_REFUSED' });
  }

  return (
    <div className={s.page} data-answer={a.receiptId}>
      <div className={s.block}>
        {a.labels.length > 0 && <p className={s.labels}>{a.labels.map(l => <Label key={l} kind={l} />)}</p>}
        <p className={s.line}>
          <span data-understood="">{understoodText(a.label, a.period, a.branch, ask.language)}</span>
          {a.comparePeriod !== null && <span>{fill(w.compared, { period: periodText(a.comparePeriod, ask.language) })}</span>}
        </p>
        {a.labels.includes('stale') && (
          <div data-answer-stale="">
            <State state={{ kind: 'stale', workedOutOn: dayText(a.asOf, ask.language) }} action={ask.viewer ? undefined : { label: w.rebuild, onPress: () => void rebuild() }} />
          </div>
        )}
      </div>

      <div className={s.big}>
        <Figure value={head} size="big" onReceipt={toReceipt} />
        {a.headline.length > 0 && <span className={s.note}>{a.headline}</span>}
      </div>

      {bars.length > 1 && <RankedBars sentence={w.bars} values={bars} onReceipt={toReceipt} />}
      {(ask.view === 'books' ? bars.length > 0 : bars.length > 1) && (
        <section className={s.section} aria-label={w.measures} data-measures="">
          <h2 className={s.heading}>{w.measures}</h2>
          {bars.length > 1 && <p className={s.note}>{w.measuresNote}</p>}
          <KeyValue align="right" onReceipt={toReceipt} pairs={figs.map(({ f, figure }) => ({ name: ask.view === 'books' ? fill(w.measureKey, { label: f.label, key: f.key }) : f.label, figure }))} />
        </section>
      )}

      <div className={s.block}>
        <Button variant="link" aria-expanded={guardOpen} onClick={() => setGuardOpen(o => !o)} data-check-line="">
          {fill(w.check, { rows: countWords(String(a.rows.read)), left: countWords(String(a.rows.excluded)) })}
        </Button>
        {guardOpen && (
          <section className={s.section} aria-label={w.guardTitle} data-guard="">
            <h2 className={s.heading}>{w.guardTitle}</h2>
            {a.guard.lines.length === 0 ? <p className={s.note}>{w.guardEmpty}</p>
              : <KeyValue onReceipt={toReceipt} pairs={a.guard.lines.map(l => ({ name: l.number, value: matched(l.matched), mono: false }))} />}
          </section>
        )}
        {a.explanation.reason !== null
          ? <p className={s.note} data-explanation-reason={a.explanation.reason}>{w[a.explanation.reason]}</p>
          : (a.guard.status === 'replaced' || a.explanation.replaced) && <p className={s.note} data-guard-replaced="">{w.guardReplaced}</p>}
      </div>

      {ask.view !== 'simple' && a.explanation.text.length > 0 && (
        <div className={s.block}>
          <p className={s.text}>{a.explanation.text}</p>
          {a.explanation.reason === null && <p className={s.small}>{a.explanation.source === 'template' ? w.fromTemplate : w.fromModel}</p>}
        </div>
      )}

      {(a.monthsNotLoaded.length > 0 || a.gaps.length > 0 || a.completeness !== 'reconciled-imports') && (
        <div className={s.block} data-coverage="">
          {a.completeness === 'empty' && a.monthsNotLoaded.length > 0 && (
            <State state={{ kind: 'not-enough', monthsNotLoaded: { exact: String(a.monthsNotLoaded.length), display: countWords(String(a.monthsNotLoaded.length)) } }} />
          )}
          {a.monthsNotLoaded.length > 0 && <p className={s.note}>{fill(a.monthsNotLoaded.length === 1 ? w.monthsNotLoaded : w.monthsNotLoadedMany, {
            count: countWords(String(a.monthsNotLoaded.length)), months: new Intl.ListFormat(ask.language, { type: 'conjunction' }).format(a.monthsNotLoaded.map(m => monthText(m, ask.language))),
          })}</p>}
          {a.completeness !== 'reconciled-imports' && a.completeness !== 'empty' && <p className={s.note}>{shared[a.completeness]}</p>}
          {a.gaps.map(g => <p key={g} className={s.note}>{shared[g]}</p>)}
        </div>
      )}

      {ask.view === 'books' && <p className={s.small}>{fill(w.asOf, { date: dayText(a.asOf, ask.language) })} · {w.sentNothing}</p>}

      <div className={s.actions}>
        {!ask.viewer && <Button variant="filled" disabled={act.kind === 'busy'} onClick={() => void mutate('askx.save', 'saved')}>{w.save}</Button>}
        {!ask.viewer && a.figures.length > 0 && <Button disabled={act.kind === 'busy'} onClick={() => void mutate('askx.checks.save', 'savedCheck')}>{w.saveCheck}</Button>}
        <Button variant="link" onClick={() => ask.go({ kind: 'receipt', receiptId: a.receiptId })}>{w.receipt}</Button>
        <Button variant="link" onClick={() => ask.go({ kind: 'why', operationId: a.operationId })}>{w.why}</Button>
        {!ask.viewer && <Button variant="link" onClick={() => ask.go({ kind: 'decisions', receiptIds: [a.receiptId] })}>{w.decide}</Button>}
      </div>
      {act.kind === 'done' && <p className={s.note} role="status">{w[act.what]}</p>}
      {act.kind === 'not-built' && <State state={{ kind: 'not-built' }} />}
      {act.kind === 'refused' && <Refusal code={act.code} rule={act.rule} />}
    </div>
  );
}
