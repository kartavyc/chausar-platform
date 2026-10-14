/**
 * AS-11 What if. The label "what if" sits beside the title. The assumption changed is shown
 * as before and after, then two figures side by side: your books, and with the change. A
 * what-if has no way to write to facts; its receipt says "what if". The percent typed is
 * turned into whole basis points by string arithmetic; every amount is the engine's.
 */
import { useState } from 'react';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import { Field } from '../../../parts/Field';
import { Figure } from '../../../parts/Figure';
import { KeyValue } from '../../../parts/KeyValue';
import { Label } from '../../../parts/Label';
import { call, id, minor, obj, oneOf, optStr, period, type Period } from './client.ts';
import { AskPage, bpsFigure, fill, moneyFigure, periodText, useAsk, useRead, useWords, type AskView } from './kit';
import { catalogue, hundredths, Part, PERIOD_IDS, PERIOD_WORDS, Problem, useRefusal, useSend, type PeriodId } from './analysis';
import s from './analysis.module.css';

interface Ref { readonly minor: string; readonly receiptId: string }
export interface WhatIfValue {
  readonly afterBps: string; readonly books: Ref; readonly withChange: Ref; readonly change: Ref; readonly period: Period; readonly branch: string | null;
}
const ref = (value: unknown): Ref => { const v = obj(value); return { minor: minor(v.minor), receiptId: id(v.receiptId) }; };
export function whatIfReply(value: unknown): WhatIfValue {
  const v = obj(value), a = obj(v.assumption);
  oneOf(v.label, ['what-if'] as const); oneOf(a.name, ['price'] as const); oneOf(a.beforeBps, ['0'] as const);
  return { afterBps: minor(a.afterBps), books: ref(v.books), withChange: ref(v.withChange), change: ref(v.change), period: period(v.period), branch: optStr(v.branch, 200) };
}

const WORDS = catalogue({
  en: {
    title: 'What if', period: 'Period', price: 'Change in prices, in percent', priceHint: 'For example 5 for a rise of 5%, or -2.5 for a fall.',
    badPrice: 'Write a percent with at most two decimals, such as 5 or -2.5.', show: 'Show what if', working: 'Working it out…',
    assumption: 'The assumption changed: prices', before: 'Before', after: 'After', books: 'Your books', withChange: 'With the change',
    change: 'Difference', periodLine: 'For {period}. Nothing in your books is changed.', branch: 'Branch', save: 'Save', saved: 'Saved.', again: 'Try another change',
    readOnly: 'A what if needs a seat that can work things out.', question: 'What if prices changed by {percent} in {period}?',
    savedNote: 'Saved. These are the figures as they were worked out then.',
  },
  hi: {
    title: 'अगर ऐसा हो', period: 'अवधि', price: 'कीमतों में बदलाव, प्रतिशत में', priceHint: 'जैसे 5% बढ़ाने के लिए 5, या घटाने के लिए -2.5।',
    badPrice: 'अधिकतम दो दशमलव वाला प्रतिशत लिखें, जैसे 5 या -2.5।', show: 'असर देखें', working: 'निकाला जा रहा है…',
    assumption: 'बदली गई मान्यता: कीमतें', before: 'पहले', after: 'बाद में', books: 'आपके खाते', withChange: 'बदलाव के साथ',
    change: 'अंतर', periodLine: '{period} के लिए। आपके खातों में कुछ नहीं बदला जाता।', branch: 'शाखा', save: 'सहेजें', saved: 'सहेजा गया।', again: 'कोई और बदलाव आज़माएँ',
    readOnly: 'अगर ऐसा हो देखने के लिए ऐसी सीट चाहिए जो गणना चला सके।', question: 'अगर {period} में कीमतें {percent} बदलें तो?',
    savedNote: 'सहेजा गया। ये आँकड़े वैसे ही हैं जैसे तब निकाले गए थे।',
  },
});

export function WhatIfScreen({ view }: { view: Extract<AskView, { kind: 'whatif' }> }) {
  return view.receiptId === undefined ? <WhatIfAsk /> : <WhatIfSaved receiptId={view.receiptId} />;
}

/** A saved what-if read back from its with-change receipt. Nothing is worked out again. */
function WhatIfSaved({ receiptId }: { receiptId: string }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useRefusal();
  const [load, retry] = useRead(`whatif|${receiptId}`, () => call(ask.rpc, 'askx.whatIf.get', { receiptId }, whatIfReply));
  return (
    <AskPage title={w.title} aside={<Label kind="what-if" />} load={load} retry={retry} explain={explain}>
      {(value: WhatIfValue) => <WhatIfResult value={value} saved />}
    </AskPage>
  );
}

function WhatIfAsk() {
  const ask = useAsk(), w = useWords(WORDS), periods = useWords(PERIOD_WORDS);
  const [periodId, setPeriodId] = useState<PeriodId>('last-month');
  const [price, setPrice] = useState('');
  const [result, setResult] = useState<WhatIfValue | null>(null);
  const run = useSend();
  const bps = hundredths(price, true);
  const aside = <Label kind="what-if" />;
  if (result !== null) return <AskPage title={w.title} aside={aside}>{() => <WhatIfResult value={result} onAgain={() => setResult(null)} />}</AskPage>;
  return (
    <AskPage title={w.title} aside={aside}>
      {() => ask.viewer ? <p className={s.note}>{w.readOnly}</p> : (
        <form className={s.form} onSubmit={e => {
          e.preventDefault();
          if (bps !== null) void run.send('askx.whatIf', { periodId, priceChangeBps: bps }, whatIfReply, setResult);
        }}>
          <Choice<PeriodId> label={w.period} options={PERIOD_IDS.map(p => ({ value: p, label: periods[p] }))} value={periodId} onChange={setPeriodId} />
          <div>
            <Field label={w.price} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} problem={price !== '' && bps === null ? w.badPrice : undefined} />
            <p className={s.note}>{w.priceHint}</p>
          </div>
          <div><Button variant="filled" submit disabled={run.busy || bps === null}>{run.busy ? w.working : w.show}</Button></div>
          <Problem code={run.problem} />
        </form>
      )}
    </AskPage>
  );
}

function WhatIfResult({ value, onAgain, saved = false }: { value: WhatIfValue; onAgain?: () => void; saved?: boolean }) {
  const ask = useAsk(), w = useWords(WORDS);
  const open = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });
  const save = useSend();
  const [done, setDone] = useState(false);
  const period = periodText(value.period, ask.language), after = bpsFigure(value.afterBps, value.withChange.receiptId).display;
  return (
    <>
      <p className={s.lead}>{fill(w.periodLine, { period })}</p>
      <Part title={w.assumption}>
        <KeyValue onReceipt={open} pairs={[
          { name: w.before, value: bpsFigure('0', value.books.receiptId).display, mono: true },
          { name: w.after, value: after, mono: true, after: <Label kind="assumption" /> },
          ...(value.branch !== null ? [{ name: w.branch, value: value.branch }] : []),
        ]} />
      </Part>
      <div className={[s.pair, s.part].join(' ')} data-whatif-figures="">
        <div className={s.tile}><span className={s.tileLabel}>{w.books}</span><Figure size="tile" value={moneyFigure(value.books.minor, value.books.receiptId)} onReceipt={open} /></div>
        <div className={s.tile}><span className={s.tileLabel}>{w.withChange}</span><Figure size="tile" value={moneyFigure(value.withChange.minor, value.withChange.receiptId, ['what-if'])} onReceipt={open} /></div>
      </div>
      <KeyValue onReceipt={open} pairs={[{ name: w.change, figure: moneyFigure(value.change.minor, value.change.receiptId, ['what-if']) }]} />
      <div className={[s.actions, s.part].join(' ')}>
        {onAgain !== undefined ? <Button onClick={onAgain}>{w.again}</Button> : !ask.viewer && <Button onClick={() => ask.go({ kind: 'whatif' })}>{w.again}</Button>}
        {!ask.viewer && !saved && <Button disabled={save.busy || done} onClick={() => void save.send('askx.saveRef', { kind: 'what-if', refId: value.withChange.receiptId, question: fill(w.question, { percent: after, period }) }, v => id(obj(v).id), () => setDone(true))}>{w.save}</Button>}
        {done && <span role="status" className={s.note}>{w.saved}</span>}
        {saved && <span className={s.note} data-whatif-saved="">{w.savedNote}</span>}
      </div>
      <Problem code={save.problem} />
    </>
  );
}
