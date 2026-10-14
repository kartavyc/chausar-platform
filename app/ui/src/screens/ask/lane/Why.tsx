/**
 * AS-10 Why did it change. The title is the finding. "Measured" is a bridge from the earlier
 * figure to the later one, each bar a measured cause that opens its receipt. "Possible
 * causes", labelled guess, are rows with an open amber square and the evidence for and
 * against. The two parts are never merged: a guess never becomes a bar, and nothing from
 * outside enters a measured number. The change in percent comes from the engine; this
 * screen only formats it.
 */
import { useId, useState } from 'react';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import { Field } from '../../../parts/Field';
import { Label } from '../../../parts/Label';
import { Square } from '../../../parts/Square';
import { Steps } from '../../../parts/Steps';
import { call, date, id, list, minor, obj, oneOf, optMinor, period, str, type Period } from './client.ts';
import { AskPage, bpsFigure, fill, moneyFigure, moneyText, periodText, dayText, useAsk, useRead, useWords, type AskView } from './kit';
import { catalogue, menuChoices, Part, PERIOD_WORDS, Problem, useRefusal, useSend, WithWords, type MenuChoices, type PeriodId } from './analysis';
import { Bridge } from './parts/Bridge';
import s from './analysis.module.css';

type By = 'customer' | 'branch' | 'source' | 'kind';
const BY = ['customer', 'branch', 'source', 'kind'] as const;
interface Side { readonly period: Period; readonly minor: string; readonly receiptId: string }
export interface WhyValue {
  readonly id: string; readonly createdAt: string; readonly operationId: string; readonly label: string; readonly by: By;
  readonly earlier: Side; readonly later: Side;
  readonly bars: readonly { key: string; changeMinor: string }[]; readonly otherMinor: string;
  readonly guesses: readonly { id: string; text: string; forReceiptIds: readonly string[]; againstReceiptIds: readonly string[]; source: { name: string; fetchedAt: string } | null; at: string }[];
  readonly direction: 'up' | 'down' | 'same'; readonly changeMinor: string; readonly changeBps: string | null;
  readonly steps: readonly { id: 'earlier' | 'later' | 'split'; state: 'done' }[];
}
const side = (value: unknown): Side => { const v = obj(value); return { period: period(v.period), minor: minor(v.minor), receiptId: id(v.receiptId) }; };
export function whyReply(value: unknown): WhyValue {
  const v = obj(value);
  return {
    id: id(v.id), createdAt: date(v.createdAt), operationId: id(v.operationId), label: str(v.label, 300), by: oneOf(v.by, BY),
    earlier: side(v.earlier), later: side(v.later),
    bars: list(v.bars, b => { const x = obj(b); return { key: str(x.key, 300), changeMinor: minor(x.changeMinor) }; }, 200),
    otherMinor: minor(v.otherMinor),
    guesses: list(v.guesses, g => {
      const x = obj(g), src = x.source === null ? null : obj(x.source);
      return {
        id: id(x.id), text: str(x.text, 2000), forReceiptIds: list(x.forReceiptIds, id, 50), againstReceiptIds: list(x.againstReceiptIds, id, 50),
        source: src === null ? null : { name: str(src.name, 300), fetchedAt: date(src.fetchedAt) }, at: date(x.at),
      };
    }, 200),
    direction: oneOf(v.direction, ['up', 'down', 'same'] as const), changeMinor: minor(v.changeMinor), changeBps: optMinor(v.changeBps),
    steps: list(v.steps, st => { const x = obj(st); return { id: oneOf(x.id, ['earlier', 'later', 'split'] as const), state: oneOf(x.state, ['done'] as const) }; }, 10),
  };
}

const WORDS = catalogue({
  en: {
    title: 'Why did it change', calculation: 'Calculation', later: 'Later period', earlier: 'Compared with', before: 'The period before',
    by: 'Split by', customer: 'Customer', branch: 'Branch', source: 'Source', kind: 'Kind', start: 'Find out why', starting: 'Working it out…',
    noSums: 'No money total in the menu can be split yet.',
    fell: '{label} fell {percent} in {period}', rose: '{label} rose {percent} in {period}',
    fellBy: '{label} fell by {amount} in {period}', roseBy: '{label} rose by {amount} in {period}', same: '{label} did not change in {period}',
    basis: 'Compared with {earlier}, split by {by}.',
    measured: 'Measured', bridge: 'From {earlier} to {later}, each bar a measured cause.', other: 'Everything else', up: 'up', down: 'down',
    notExact: 'The causes do not lead exactly from one figure to the other, so the bridge is not drawn.',
    earlierBar: 'Earlier: {period}', laterBar: 'Later: {period}', noBars: 'No single cause stands out; the whole change is under everything else.',
    possible: 'Possible causes', guessNote: 'A guess is not measured. It never enters a figure above.', noGuesses: 'No possible cause written yet.',
    evidenceFor: 'Points to it', evidenceAgainst: 'Points against it', none: 'nothing yet', earlierFig: 'the earlier figure', laterFig: 'the later figure',
    receiptN: 'receipt {n}', from: 'From {name}, fetched {date}', addGuess: 'Write a possible cause', addGuessButton: 'Add the guess',
    decide: 'Record a decision', save: 'Save', saved: 'Saved.', stepEarlier: 'Earlier figure', stepLater: 'Later figure', stepSplit: 'Split',
  },
  hi: {
    title: 'यह क्यों बदला', calculation: 'गणना', later: 'बाद की अवधि', earlier: 'किससे तुलना', before: 'उससे पहले की अवधि',
    by: 'किस आधार पर बाँटें', customer: 'ग्राहक', branch: 'शाखा', source: 'स्रोत', kind: 'प्रकार', start: 'कारण पता करें', starting: 'निकाला जा रहा है…',
    noSums: 'मेनू में अभी कोई ऐसा पैसे का कुल नहीं है जिसे बाँटा जा सके।',
    fell: '{period} में {label} {percent} गिरा', rose: '{period} में {label} {percent} बढ़ा',
    fellBy: '{period} में {label} {amount} गिरा', roseBy: '{period} में {label} {amount} बढ़ा', same: '{period} में {label} नहीं बदला',
    basis: '{earlier} से तुलना, {by} के आधार पर बाँटा गया।',
    measured: 'मापा गया', bridge: '{earlier} से {later} तक, हर पट्टी एक मापा गया कारण।', other: 'बाकी सब', up: 'बढ़ा', down: 'घटा',
    notExact: 'कारण एक आँकड़े से दूसरे तक ठीक-ठीक नहीं पहुँचते, इसलिए पुल नहीं बनाया गया।',
    earlierBar: 'पहले: {period}', laterBar: 'बाद में: {period}', noBars: 'कोई एक कारण अलग नहीं दिखता; पूरा बदलाव बाकी सब में है।',
    possible: 'संभावित कारण', guessNote: 'अनुमान मापा नहीं गया है। यह ऊपर के किसी आँकड़े में कभी नहीं जुड़ता।', noGuesses: 'अभी कोई संभावित कारण नहीं लिखा गया।',
    evidenceFor: 'इसके पक्ष में', evidenceAgainst: 'इसके विरोध में', none: 'अभी कुछ नहीं', earlierFig: 'पहले का आँकड़ा', laterFig: 'बाद का आँकड़ा',
    receiptN: 'रसीद {n}', from: '{name} से, {date} को लिया गया', addGuess: 'एक संभावित कारण लिखें', addGuessButton: 'अनुमान जोड़ें',
    decide: 'निर्णय दर्ज करें', save: 'सहेजें', saved: 'सहेजा गया।', stepEarlier: 'पहले का आँकड़ा', stepLater: 'बाद का आँकड़ा', stepSplit: 'बँटवारा',
  },
});
type W = Readonly<Record<keyof (typeof WORDS)['en'], string>>;

export function WhyScreen({ view }: { view: Extract<AskView, { kind: 'why' }> }) {
  return view.whyId !== undefined ? <WhyOpen whyId={view.whyId} /> : <WhyStart operationId={view.operationId} />;
}

function WhyOpen({ whyId }: { whyId: string }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useRefusal();
  const [load, retry] = useRead(`why|${whyId}`, () => call(ask.rpc, 'askx.why.get', { whyId }, whyReply));
  const [shown, setShown] = useState<WhyValue | null>(null);
  const why = shown ?? (load.kind === 'ok' ? load.value : null);
  return (
    <AskPage title={why ? finding(why, w, ask.language) : w.title} load={load} retry={retry} explain={explain}>
      {() => <WhyBody why={why!} onChange={setShown} />}
    </AskPage>
  );
}

function WhyStart({ operationId }: { operationId?: string | undefined }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useRefusal();
  const [menu, retry] = useRead('why-menu', () => call(ask.rpc, 'askx.menu', {}, menuChoices));
  const [why, setWhy] = useState<WhyValue | null>(null);
  if (why !== null) return <AskPage title={finding(why, w, ask.language)}>{() => <WhyBody why={why} onChange={setWhy} />}</AskPage>;
  return (
    <AskPage title={w.title} load={menu} retry={retry} explain={explain} empty={m => (m.sums.length === 0 ? <p>{w.noSums}</p> : null)}>
      {m => <WhyForm menu={m} operationId={operationId} onDone={setWhy} />}
    </AskPage>
  );
}

function WhyForm({ menu, operationId, onDone }: { menu: MenuChoices; operationId?: string | undefined; onDone: (why: WhyValue) => void }) {
  const ask = useAsk(), w = useWords(WORDS), periods = useWords(PERIOD_WORDS), selectId = useId();
  const [op, setOp] = useState(menu.sums.some(m => m.operationId === operationId) ? operationId! : menu.sums[0]!.operationId);
  const firstLater = menu.periods.find(p => p.id === 'last-month') ?? menu.periods[0];
  const [later, setLater] = useState<PeriodId | null>(firstLater?.id ?? null);
  const [earlier, setEarlier] = useState<PeriodId | 'before'>('before');
  const [by, setBy] = useState<By>('customer');
  const { busy, problem, send } = useSend();
  if (ask.viewer) return null;
  const periodOf = (pid: PeriodId | null) => menu.periods.find(p => p.id === pid)?.period;
  const submit = () => {
    const period = periodOf(later);
    if (period === undefined) return;
    const compare = earlier === 'before' ? undefined : periodOf(earlier);
    void send('askx.why.start', { operationId: op, period, ...(compare ? { comparePeriod: compare } : {}), by }, whyReply, onDone);
  };
  const choices = menu.periods.map(p => ({ value: p.id, label: periods[p.id] }));
  return (
    <form className={s.form} onSubmit={e => { e.preventDefault(); submit(); }}>
      <div>
        <label htmlFor={selectId} className={s.tileLabel}>{w.calculation}</label><br />
        <select id={selectId} className={s.input} value={op} onChange={e => setOp(e.target.value)}>
          {menu.sums.map(m => <option key={m.operationId} value={m.operationId}>{m.label}</option>)}
        </select>
      </div>
      <Choice label={w.later} options={choices} value={later} onChange={setLater} />
      <Choice<PeriodId | 'before'> label={w.earlier} options={[{ value: 'before', label: w.before }, ...choices]} value={earlier} onChange={setEarlier} />
      <Choice<By> label={w.by} options={BY.map(b => ({ value: b, label: w[b] }))} value={by} onChange={setBy} />
      <div><Button variant="filled" submit disabled={busy || later === null}>{busy ? w.starting : w.start}</Button></div>
      <Problem code={problem} />
    </form>
  );
}

/** The finding as one complete sentence. The percent and the amount are the engine's, formatted. */
export function finding(why: WhyValue, w: W, language: 'en' | 'hi'): string {
  const period = periodText(why.later.period, language), label = why.label;
  if (why.direction === 'same') return fill(w.same, { label, period });
  const down = why.direction === 'down';
  if (why.changeBps !== null) return fill(down ? w.fell : w.rose, { label, period, percent: bpsFigure(why.changeBps.replace(/^-/, ''), why.later.receiptId).display });
  return fill(down ? w.fellBy : w.roseBy, { label, period, amount: moneyText(why.changeMinor.replace(/^-/, '')) });
}

function WhyBody({ why, onChange }: { why: WhyValue; onChange: (why: WhyValue) => void }) {
  const ask = useAsk(), w = useWords(WORDS), lang = ask.language;
  const open = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });
  const saved = useSend(), guess = useSend();
  const [done, setDone] = useState(false);
  const [text, setText] = useState('');
  const earlier = periodText(why.earlier.period, lang), later = periodText(why.later.period, lang);
  /* The split was measured on the later receipt; each cause bar opens it. */
  const causes = [
    ...why.bars.map((b, i) => ({ id: `bar-${i}`, label: b.key, value: moneyFigure(b.changeMinor, why.later.receiptId) })),
    ...(why.otherMinor === '0' ? [] : [{ id: 'other', label: w.other, value: moneyFigure(why.otherMinor, why.later.receiptId) }]),
  ];
  const evidence = (ids: readonly string[]) => ids.length === 0 ? <span className={s.hit}>{w.none}</span> : ids.map((rid, i) => (
    <Button key={`${rid}-${i}`} variant="link" onClick={() => open(rid)}>
      {rid === why.earlier.receiptId ? w.earlierFig : rid === why.later.receiptId ? w.laterFig : fill(w.receiptN, { n: i + 1 })}
    </Button>
  ));
  const stepWords: Record<string, string> = { 'ASKWHY.step.earlier': w.stepEarlier, 'ASKWHY.step.later': w.stepLater, 'ASKWHY.step.split': w.stepSplit };
  return (
    <>
      <p className={s.lead}>{fill(w.basis, { earlier, by: w[why.by] })}</p>
      {why.steps.length > 0 && <WithWords words={stepWords}><Steps steps={why.steps.map(st => ({ nameKey: `ASKWHY.step.${st.id}`, state: st.state }))} /></WithWords>}
      <Part title={w.measured} aside={<Label kind="measured" />}>
        <div data-why-part="measured">
          <Bridge
            sentence={fill(w.bridge, { earlier, later })}
            start={{ id: 'earlier', label: fill(w.earlierBar, { period: earlier }), value: moneyFigure(why.earlier.minor, why.earlier.receiptId) }}
            causes={causes}
            end={{ id: 'later', label: fill(w.laterBar, { period: later }), value: moneyFigure(why.later.minor, why.later.receiptId) }}
            words={{ up: w.up, down: w.down, notExact: w.notExact }}
            onReceipt={open}
          />
          {why.bars.length === 0 && <p className={s.note}>{w.noBars}</p>}
        </div>
      </Part>
      <Part title={w.possible} aside={<Label kind="guess" />}>
        <div data-why-part="possible">
          <p className={s.note}>{w.guessNote}</p>
          {why.guesses.length === 0 ? <p className={s.note}>{w.noGuesses}</p> : (
            <ul className={s.list}>
              {why.guesses.map(g => (
                <li key={g.id} className={s.item} data-guess="">
                  <Square mark="guess" />
                  <span className={s.grow}>
                    {g.text}
                    {g.source !== null && <span className={s.note}> {fill(w.from, { name: g.source.name, date: dayText(g.source.fetchedAt, lang) })}</span>}
                  </span>
                  <span className={s.actions}><span className={s.tileLabel}>{w.evidenceFor}</span>{evidence(g.forReceiptIds)}</span>
                  <span className={s.actions}><span className={s.tileLabel}>{w.evidenceAgainst}</span>{evidence(g.againstReceiptIds)}</span>
                </li>
              ))}
            </ul>
          )}
          {!ask.viewer && (
            <form className={s.formLine} onSubmit={e => {
              e.preventDefault();
              if (text.trim() === '') return;
              void guess.send('askx.why.guess', { whyId: why.id, text: text.trim(), forReceiptIds: [], againstReceiptIds: [] }, whyReply, next => { setText(''); onChange(next); });
            }}>
              <Field label={w.addGuess} value={text} maxLength={2000} onChange={e => setText(e.target.value)} className={s.grow} />
              <Button submit disabled={guess.busy || text.trim() === ''}>{w.addGuessButton}</Button>
            </form>
          )}
          <Problem code={guess.problem} />
        </div>
      </Part>
      {!ask.viewer && (
        <div className={[s.actions, s.part].join(' ')}>
          <Button onClick={() => ask.go({ kind: 'decisions', receiptIds: [why.earlier.receiptId, why.later.receiptId] })}>{w.decide}</Button>
          <Button disabled={saved.busy || done} onClick={() => void saved.send('askx.saveRef', { kind: 'why', refId: why.id, question: finding(why, w, lang) }, v => id(obj(v).id), () => setDone(true))}>{w.save}</Button>
          {done && <span role="status" className={s.note}>{w.saved}</span>}
        </div>
      )}
      <Problem code={saved.problem} />
    </>
  );
}
