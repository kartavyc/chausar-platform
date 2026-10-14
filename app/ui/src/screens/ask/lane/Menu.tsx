/**
 * AS-01 the ask page, with AS-02 (what Chausar understood), AS-03 (which did you mean), AS-08
 * (not yet) and AS-09 (stopped by a rule) drawn in place under the typed question.
 *
 * The menu is the way to ask when no model is connected: a calculation and a period chosen
 * from short lists run as they are. A typed question is only understood first; nothing runs
 * until the person presses Run, and a corrected proposal is sent with what it corrected, as
 * structure only. An answer opens on its own page.
 */
import { useState, type FormEvent } from 'react';
import type { Catalogue } from '../../../places/types.ts';
import type { RowItem } from '../../../app/presentation.ts';
import { RowList } from '../../../parts/RowList';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import { Choice } from '../../../parts/Choice';
import { Label } from '../../../parts/Label';
import { State } from '../../../patterns/States';
import { AskPage, fill, periodText, useAsk, useRead, useWords, type AskView } from './kit';
import { call, type Period } from './client.ts';
import {
  menuReply, runReply, suggestReply, understandReply,
  type MenuItem, type MenuReply, type PeriodChoice, type PeriodId, type Topic, type UnderstandReply,
} from './core-replies.ts';
import { Refusal, understoodText, useExplain } from './core-words';
import s from './core.module.css';

type Key =
  | 'title' | 'seed' | 'seedNote' | 'noModel' | 'empty' | 'period' | 'compareWith' | 'onDate' | 'run' | 'cancel'
  | 'suggestions' | 'suggestion' | 'ownDates' | 'dateFrom' | 'dateTo' | 'ownDatesNote' | 'badDates' | 'clearDates' | 'typeLabel' | 'typeAsk' | 'understood' | 'change' | 'changeCalc' | 'changePeriod' | 'changeGroup' | 'everyone'
  | 'choose' | 'notYet' | 'no-calculation' | 'action' | 'unknownWord' | 'onList' | 'nearby' | 'seeWanted'
  | 'composition' | 'unregistered' | 'notApplicable' | 'working' | 'dictionary' | 'more'
  | 'why' | 'whatif' | 'forecast' | 'plan' | 'gst2b' | 'search' | 'saved' | 'notyetList' | 'needs'
  | 'comparePeriod' | 'priceChange' | Topic | PeriodId;
const WORDS = {
  en: {
    title: 'Ask', seed: 'This is a small starting menu.', seedNote: 'Every answer from it carries the label seed.',
    noModel: 'No model connected? The menu is the way to ask. Pick a calculation and a period.',
    empty: 'No calculations are on the menu yet. Agree what your words mean in Books to fill it.',
    period: 'Period', compareWith: 'Compare with', onDate: 'On the date', run: 'Run', cancel: 'Cancel',
    suggestions: 'You often ask', suggestion: '{calc} · {period}',
    ownDates: 'Or choose the dates', dateFrom: 'From', dateTo: 'To', ownDatesNote: 'The menu will use {period}.', badDates: 'The first date must not be after the second.', clearDates: 'Use the period above',
    typeLabel: 'Type a question', typeAsk: 'Ask',
    understood: 'What Chausar understood', change: 'Change', changeCalc: 'Calculation', changePeriod: 'Period', changeGroup: 'Who is counted', everyone: 'All branches',
    choose: 'Which did you mean?', notYet: 'Not yet. No calculation covers this.',
    'no-calculation': 'No calculation in the menu works this out yet.', action: 'This asks Chausar to do something, and it cannot do that yet.',
    unknownWord: 'Not sure what “{word}” means. It is on the list.', onList: 'It is on the wanted list.', nearby: 'Close to what you asked', seeWanted: 'See the not-yet list',
    composition: 'This business is in the composition scheme, so this does not apply.', unregistered: 'This business is not registered for GST, so this does not apply.',
    notApplicable: 'Not applicable.', working: 'Working it out from the books.', dictionary: 'Meanings: {label}, version {version}', more: 'More ways to ask',
    why: 'Why did it change', whatif: 'What if', forecast: 'Forecast', plan: 'The best plan under limits', gst2b: 'Purchases against GSTR-2B', search: 'Search',
    saved: 'Saved', notyetList: 'Not yet asked for', needs: 'needs: {list}',
    sales: 'Sales', collections: 'Collections', cash: 'Cash', stock: 'Stock', tax: 'Tax', other: 'Other',
    'this-month': 'This month', 'last-month': 'Last month', 'this-quarter': 'This quarter', 'last-quarter': 'Last quarter', 'this-year': 'This year', 'last-year': 'Last year',
    comparePeriod: 'a period to compare with', priceChange: 'a price change',
  },
  hi: {
    title: 'पूछें', seed: 'यह शुरुआती छोटा मेन्यू है।', seedNote: 'इससे मिले हर जवाब पर शुरुआती का लेबल रहता है।',
    noModel: 'कोई मॉडल जुड़ा नहीं? मेन्यू ही पूछने का तरीका है। एक गणना और एक अवधि चुनें।',
    empty: 'मेन्यू में अभी कोई गणना नहीं है। इसे भरने के लिए Books में अपने शब्दों के अर्थ तय करें।',
    period: 'अवधि', compareWith: 'इससे तुलना करें', onDate: 'इस तारीख़ को', run: 'चलाएँ', cancel: 'रद्द करें',
    suggestions: 'आप अक्सर पूछते हैं', suggestion: '{calc} · {period}',
    ownDates: 'या तारीख़ें चुनें', dateFrom: 'से', dateTo: 'तक', ownDatesNote: 'मेन्यू {period} का उपयोग करेगा।', badDates: 'पहली तारीख़ दूसरी के बाद नहीं हो सकती।', clearDates: 'ऊपर की अवधि का उपयोग करें',
    typeLabel: 'सवाल लिखें', typeAsk: 'पूछें',
    understood: 'Chausar ने क्या समझा', change: 'बदलें', changeCalc: 'गणना', changePeriod: 'अवधि', changeGroup: 'किसे गिना गया', everyone: 'सभी शाखाएँ',
    choose: 'आपका मतलब कौन सा था?', notYet: 'अभी नहीं। कोई गणना इसे नहीं करती।',
    'no-calculation': 'मेन्यू की कोई गणना अभी यह नहीं निकालती।', action: 'यह Chausar से कुछ करने को कहता है, और वह अभी यह नहीं कर सकता।',
    unknownWord: 'पक्का नहीं कि “{word}” का क्या अर्थ है। यह सूची में है।', onList: 'यह चाही गई चीज़ों की सूची में है।', nearby: 'आपके सवाल के क़रीब', seeWanted: '“अभी नहीं” सूची देखें',
    composition: 'यह व्यवसाय कंपोज़िशन योजना में है, इसलिए यह लागू नहीं होता।', unregistered: 'यह व्यवसाय GST में पंजीकृत नहीं है, इसलिए यह लागू नहीं होता।',
    notApplicable: 'लागू नहीं।', working: 'बही से हिसाब निकाला जा रहा है।', dictionary: 'अर्थ: {label}, संस्करण {version}', more: 'पूछने के और तरीके',
    why: 'यह क्यों बदला', whatif: 'अगर ऐसा हो', forecast: 'अनुमान', plan: 'सीमाओं में सबसे अच्छी योजना', gst2b: 'GSTR-2B से ख़रीद का मिलान', search: 'खोजें',
    saved: 'सहेजे गए', notyetList: 'अभी नहीं हो सका', needs: 'चाहिए: {list}',
    sales: 'बिक्री', collections: 'वसूली', cash: 'नकद', stock: 'स्टॉक', tax: 'कर', other: 'अन्य',
    'this-month': 'इस महीने', 'last-month': 'पिछले महीने', 'this-quarter': 'इस तिमाही', 'last-quarter': 'पिछली तिमाही', 'this-year': 'इस साल', 'last-year': 'पिछले साल',
    comparePeriod: 'तुलना के लिए एक अवधि', priceChange: 'क़ीमत में बदलाव',
  },
} as const satisfies Catalogue<Key>;

type Proposed = Extract<UnderstandReply, { kind: 'proposal' }>;
type Flow =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'not-built' }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'not-applicable'; readonly reason: 'composition' | 'unregistered' }
  | { readonly kind: 'needs'; readonly item: MenuItem }
  | { readonly kind: 'proposal'; readonly reply: Proposed; readonly changing: boolean; readonly op: string; readonly periodId: PeriodId | null; readonly branch: string | null }
  | { readonly kind: 'choose'; readonly reply: Extract<UnderstandReply, { kind: 'choose' }> }
  | { readonly kind: 'no-match'; readonly reply: Extract<UnderstandReply, { kind: 'no-match' }> };

export function MenuScreen(_props: { view: Extract<AskView, { kind: 'menu' }> }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useExplain();
  const [menu, reload] = useRead('menu', () => call(ask.rpc, 'askx.menu', {}, menuReply));
  const [suggest] = useRead('suggest', () => call(ask.rpc, 'askx.suggest', {}, suggestReply));
  const [chosen, setChosen] = useState<PeriodId | null>(null);
  const [question, setQuestion] = useState('');
  const [flow, setFlow] = useState<Flow>({ kind: 'idle' });
  const [own, setOwn] = useState({ from: '', to: '' });
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const ownBoth = ISO.test(own.from) && ISO.test(own.to);
  /* Calendar order only: ISO dates compare as text. */
  const ownPeriod: Period | null = ownBoth && own.from <= own.to ? { from: own.from, to: own.to } : null;

  async function run(payload: Record<string, unknown>) {
    setFlow({ kind: 'busy' });
    const reply = await call(ask.rpc, 'askx.run', payload, runReply);
    if (!ask.live()) return;
    if (reply.kind === 'not-built') return setFlow({ kind: 'not-built' });
    if (reply.kind === 'refused') return setFlow({ kind: 'refused', code: reply.code });
    const value = reply.value;
    if (value.kind === 'refused') return setFlow({ kind: 'refused', code: value.code });
    if (value.kind === 'not-applicable') return setFlow({ kind: 'not-applicable', reason: value.reason });
    setFlow({ kind: 'idle' });
    ask.go({ kind: 'answer', receiptId: value.receiptId });
  }

  async function understand(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length === 0) return;
    setFlow({ kind: 'busy' });
    const reply = await call(ask.rpc, 'askx.understand', { question: text }, understandReply);
    if (!ask.live()) return;
    if (reply.kind === 'not-built') return setFlow({ kind: 'not-built' });
    if (reply.kind === 'refused') return setFlow({ kind: 'refused', code: reply.code });
    const v = reply.value;
    if (v.kind === 'refused') return setFlow({ kind: 'refused', code: v.code });
    if (v.kind === 'proposal') return setFlow({ kind: 'proposal', reply: v, changing: false, op: v.proposal.operationId, periodId: v.proposal.periodId, branch: v.proposal.branch });
    setFlow(v.kind === 'choose' ? { kind: 'choose', reply: v } : { kind: 'no-match', reply: v });
  }

  return (
    <AskPage title={w.title} load={menu} retry={reload} explain={explain}>
      {(m: MenuReply) => {
        const periodId = chosen ?? m.periods[0]?.id ?? null;
        const when: Record<string, unknown> = ownPeriod !== null ? { period: ownPeriod } : periodId === null ? {} : { periodId };
        const periodName = (p: PeriodChoice) => w[p.id];
        const pick = (item: MenuItem) => {
          if (item.needs.includes('priceChange')) return ask.go({ kind: 'whatif' });
          if (item.needs.includes('comparePeriod') || item.needs.includes('onDate')) return setFlow({ kind: 'needs', item });
          void run({ operationId: item.operationId, ...when });
        };
        const items = m.topics.flatMap(t => t.items);
        const byId = new Map(items.map(i => [i.operationId, i]));
        const needsNote = (item: MenuItem) => {
          const extra = item.needs.filter((n): n is 'comparePeriod' | 'priceChange' => n === 'comparePeriod' || n === 'priceChange').map(n => w[n]);
          const parts = [ask.view === 'books' ? item.type : null, extra.length > 0 ? fill(w.needs, { list: extra.join(', ') }) : null].filter((x): x is string => x !== null);
          return ask.view === 'simple' || parts.length === 0 ? undefined : parts.join(' · ');
        };
        const rowOf = (item: MenuItem): RowItem => {
          const note = needsNote(item);
          return note === undefined ? { id: item.operationId, mark: 'cha', what: item.label } : { id: item.operationId, mark: 'cha', what: item.label, note };
        };
        const suggestions = suggest.kind === 'ok' ? suggest.value : [];
        return (
          <div className={s.page}>
            {m.seed && (
              <p className={s.line} data-seed=""><Label kind="seed" /> <span>{w.seed}</span> <span>{w.seedNote}</span></p>
            )}
            {m.state === 'no-dictionary' && <Refusal code="ASK_NO_DICTIONARY" />}
            {ask.view !== 'books' ? <p className={s.note}>{w.noModel}</p> : m.dictionary !== null && (
              <p className={s.small}>{fill(w.dictionary, { label: m.dictionary.label, version: m.dictionary.version })}</p>
            )}

            <form className={s.form} onSubmit={e => void understand(e)}>
              <Field label={w.typeLabel} value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} />
              <Button submit disabled={question.trim().length === 0 || flow.kind === 'busy'}>{w.typeAsk}</Button>
            </form>

            <FlowPanel flow={flow} setFlow={setFlow} run={payload => void run(payload)} periodId={periodId} when={when} periods={m.periods} byId={byId} />

            {suggestions.length > 0 && (
              <section className={s.section} aria-label={w.suggestions}>
                <h2 className={s.heading}>{w.suggestions}</h2>
                <div className={s.actions}>
                  {suggestions.map(sg => (
                    <Button key={`${sg.operationId}|${sg.periodId}`} onClick={() => void run({ operationId: sg.operationId, periodId: sg.periodId })}>
                      {fill(w.suggestion, { calc: sg.label, period: w[sg.periodId] })}
                    </Button>
                  ))}
                </div>
              </section>
            )}

            {m.periods.length > 0 && periodId !== null && (
              <div className={s.block}>
                <Choice<PeriodId> label={w.period} options={m.periods.map(p => ({ value: p.id, label: periodName(p) }))} value={periodId} onChange={setChosen} />
                {ownPeriod === null && m.periods.filter(p => p.id === periodId).map(p => <p key={p.id} className={s.small}>{periodText(p.period, ask.language)}</p>)}
              </div>
            )}
            <fieldset className={[s.block, s.dates].join(' ')} data-own-dates="">
              <legend className={s.small}>{w.ownDates}</legend>
              <div className={s.actions}>
                <Field label={w.dateFrom} type="date" value={own.from} onChange={e => setOwn(o => ({ ...o, from: e.target.value }))} />
                <Field label={w.dateTo} type="date" value={own.to} onChange={e => setOwn(o => ({ ...o, to: e.target.value }))} problem={ownBoth && ownPeriod === null ? w.badDates : undefined} />
              </div>
              {ownPeriod !== null && (
                <p className={s.note}>{fill(w.ownDatesNote, { period: periodText(ownPeriod, ask.language) })} <Button variant="link" onClick={() => setOwn({ from: '', to: '' })}>{w.clearDates}</Button></p>
              )}
            </fieldset>

            {items.length === 0 ? <p className={s.note} data-empty="">{w.empty}</p> : m.topics.filter(t => t.items.length > 0).map(t => (
              <section key={t.topic} className={s.section} aria-labelledby={`ask-topic-${t.topic}`} data-topic={t.topic}>
                <h2 id={`ask-topic-${t.topic}`} className={s.heading}>{w[t.topic]}</h2>
                <RowList labelledBy={`ask-topic-${t.topic}`} rows={t.items.map(rowOf)} onOpen={opId => { const item = byId.get(opId); if (item) pick(item); }}
                  onReceipt={receiptId => ask.go({ kind: 'receipt', receiptId })} />
              </section>
            ))}

            <nav className={s.section} aria-label={w.more}>
              <h2 className={s.heading}>{w.more}</h2>
              <div className={s.actions}>
                <Button variant="link" onClick={() => ask.go({ kind: 'why' })}>{w.why}</Button>
                <Button variant="link" onClick={() => ask.go({ kind: 'whatif' })}>{w.whatif}</Button>
                {ask.view !== 'simple' && <Button variant="link" onClick={() => ask.go({ kind: 'forecast' })}>{w.forecast}</Button>}
                {ask.view !== 'simple' && <Button variant="link" onClick={() => ask.go({ kind: 'plan' })}>{w.plan}</Button>}
                {m.gst2b === 'offered' && <Button variant="link" onClick={() => ask.go({ kind: 'gst2b' })}>{w.gst2b}</Button>}
                <Button variant="link" onClick={() => ask.go({ kind: 'search' })}>{w.search}</Button>
                <Button variant="link" onClick={() => ask.go({ kind: 'saved' })}>{w.saved}</Button>
                <Button variant="link" onClick={() => ask.go({ kind: 'notyet' })}>{w.notyetList}</Button>
              </div>
            </nav>
          </div>
        );
      }}
    </AskPage>
  );
}

function FlowPanel({ flow, setFlow, run, periodId, when, periods, byId }: {
  flow: Flow; setFlow: (f: Flow) => void; run: (payload: Record<string, unknown>) => void;
  periodId: PeriodId | null; when: Record<string, unknown>; periods: readonly PeriodChoice[]; byId: ReadonlyMap<string, MenuItem>;
}) {
  const ask = useAsk(), w = useWords(WORDS);
  const [compare, setCompare] = useState<PeriodId | null>(null);
  const [onDate, setOnDate] = useState('');
  const toReceipt = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });
  const runOp = (operationId: string, pid: PeriodId | null) => run({ operationId, ...(pid === null ? {} : { periodId: pid }) });
  switch (flow.kind) {
    case 'idle': return null;
    case 'busy': return <State state={{ kind: 'loading', reading: w.working }} />;
    case 'not-built': return <State state={{ kind: 'not-built' }} />;
    case 'refused': return <Refusal code={flow.code} />;
    case 'not-applicable': return <p className={s.note} data-not-applicable="">{w.notApplicable} {w[flow.reason]}</p>;
    case 'needs': {
      const item = flow.item, needsCompare = item.needs.includes('comparePeriod'), needsDate = item.needs.includes('onDate');
      const others = periods.filter(p => p.id !== periodId);
      const comparePeriod: Period | undefined = others.find(p => p.id === compare)?.period;
      const ready = (!needsCompare || comparePeriod !== undefined) && (!needsDate || /^\d{4}-\d{2}-\d{2}$/.test(onDate));
      return (
        <section className={s.section} aria-label={item.label}>
          <h2 className={s.heading}>{item.label}</h2>
          {needsCompare && <Choice<PeriodId> label={w.compareWith} options={others.map(p => ({ value: p.id, label: w[p.id] }))} value={compare} onChange={setCompare} />}
          {needsDate && <Field label={w.onDate} type="date" value={onDate} onChange={e => setOnDate(e.target.value)} />}
          <div className={s.actions}>
            <Button variant="filled" disabled={!ready} onClick={() => run({
              operationId: item.operationId, ...when,
              ...(needsCompare && comparePeriod !== undefined ? { comparePeriod } : {}), ...(needsDate ? { onDate } : {}),
            })}>{w.run}</Button>
            <Button variant="link" onClick={() => setFlow({ kind: 'idle' })}>{w.cancel}</Button>
          </div>
        </section>
      );
    }
    case 'proposal': {
      const { reply, op, branch } = flow, p = reply.proposal, o = reply.options;
      const opLabel = o.operations.find(x => x.operationId === op)?.label ?? byId.get(op)?.label ?? p.label;
      const chosenPeriod = flow.periodId === null ? p.period : o.periods.find(x => x.id === flow.periodId)?.period ?? p.period;
      const periodChanged = flow.periodId !== p.periodId, groupChanged = branch !== p.branch, changed = op !== p.operationId || periodChanged || groupChanged;
      const go = () => run({
        operationId: op, ...(flow.periodId === null ? { period: p.period } : { periodId: flow.periodId }), branch,
        ...(changed ? { correctedFrom: { operationId: p.operationId, periodChanged, groupChanged } } : {}),
      });
      const operations = o.operations.some(x => x.operationId === p.operationId) ? o.operations : [{ operationId: p.operationId, label: p.label }, ...o.operations];
      return (
        <section className={s.section} aria-label={w.understood} data-proposal="">
          <h2 className={s.heading}>{w.understood}</h2>
          <p className={s.line}>
            <span data-understood="">{understoodText(opLabel, chosenPeriod, branch, ask.language)}</span>
            {!flow.changing && <Button variant="link" onClick={() => setFlow({ ...flow, changing: true })}>{w.change}</Button>}
          </p>
          {flow.changing && (
            <div className={s.section}>
              {operations.length > 1 && <Choice label={w.changeCalc} options={operations.map(x => ({ value: x.operationId, label: x.label }))} value={op} onChange={v => setFlow({ ...flow, op: v })} />}
              {o.periods.length > 0 && <Choice<PeriodId> label={w.changePeriod} options={o.periods.map(x => ({ value: x.id, label: w[x.id] }))} value={flow.periodId} onChange={v => setFlow({ ...flow, periodId: v })} />}
              {o.branches.length > 0 && (
                <Choice label={w.changeGroup} options={[{ value: '', label: w.everyone }, ...o.branches.map(b => ({ value: `b:${b}`, label: b }))]}
                  value={branch === null ? '' : `b:${branch}`} onChange={v => setFlow({ ...flow, branch: v === '' ? null : v.slice(2) })} />
              )}
            </div>
          )}
          <div className={s.actions}>
            <Button variant="filled" onClick={go}>{w.run}</Button>
            <Button variant="link" onClick={() => setFlow({ kind: 'idle' })}>{w.cancel}</Button>
          </div>
        </section>
      );
    }
    case 'choose': {
      const pid = flow.reply.periodId ?? periodId;
      const rows: RowItem[] = flow.reply.choices.map(c => c.meaning === null ? { id: c.operationId, mark: 'unsure', what: c.label } : { id: c.operationId, mark: 'unsure', what: c.label, note: c.meaning });
      return (
        <section className={s.section} aria-labelledby="ask-choose" data-choose="">
          <h2 id="ask-choose" className={s.heading}>{w.choose}</h2>
          <RowList labelledBy="ask-choose" rows={rows} onOpen={opId => runOp(opId, pid)} onReceipt={toReceipt} />
        </section>
      );
    }
    case 'no-match': {
      const r = flow.reply;
      return (
        <section className={s.section} aria-label={w.notYet} data-not-yet="">
          <p className={s.text}>{w.notYet}</p>
          <p className={s.note}>{r.reason === 'unknown-word' && r.word !== null ? fill(w.unknownWord, { word: r.word }) : w[r.reason === 'unknown-word' ? 'no-calculation' : r.reason]}</p>
          {!(r.reason === 'unknown-word' && r.word !== null) && <p className={s.note}>{w.onList}</p>}
          {r.nearby.length > 0 && (
            <>
              <h2 id="ask-nearby" className={s.heading}>{w.nearby}</h2>
              <RowList labelledBy="ask-nearby" rows={r.nearby.map(n => ({ id: n.operationId, mark: 'cha', what: n.label }))} onOpen={opId => run({ operationId: opId, ...when })} onReceipt={toReceipt} />
            </>
          )}
          <div className={s.actions}><Button variant="link" onClick={() => ask.go({ kind: 'notyet' })}>{w.seeWanted}</Button></div>
        </section>
      );
    }
  }
}
