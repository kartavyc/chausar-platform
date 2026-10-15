/**
 * AS-19 Purchases against GSTR-2B. Four groups as rows with their count and amount: matched;
 * amount differs, inside or outside the tolerance (shown beside it); in 2B only; in your
 * books only. A group opens its lines; a line opens both rows' cells as written. Under them
 * the IMS list: what a person should accept, reject or keep pending in the GST portal, each
 * with its reason, and its export. Chausar never acts in the GST portal.
 *
 * When there is more than one purchase register or GSTR-2B read, the person chooses which two
 * to match first. A probable match is the connectors lane's suggestion: never counted as
 * matched. When the core lane serves a receipt for the match, group amounts are figures that
 * open it, and a line with its own receipt opens that receipt; otherwise amounts are written
 * as text and a line opens its two source rows, which are what the match read.
 */
import { useEffect, useState } from 'react';
import type { RowItem } from '../../../app/presentation.ts';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import { Field } from '../../../parts/Field';
import { KeyValue } from '../../../parts/KeyValue';
import { RowList } from '../../../parts/RowList';
import { Figure } from '../../../parts/Figure';
import { call, fail, id, int, list, minor, obj, oneOf, optMinor, period, str, type Period } from './client.ts';
import { AskPage, countWords, fill, moneyFigure, moneyText, periodText, rowMoneyFigure, useAsk, useRead, useWords, type AskView } from './kit';
import { catalogue, Part, PERIOD_WORDS, Problem, useRefusal, useSend, hundredths } from './analysis';
import s from './analysis.module.css';

const GROUPS = ['matched', 'differs-inside', 'differs-outside', 'probable', 'in-2b-only', 'books-only'] as const;
type Group = (typeof GROUPS)[number];
interface Line { id: string; group: Group; supplier: string; invoice: string; booksMinor: string | null; twoBMinor: string | null; differenceMinor: string | null; bookRowId: string | null; twoBRowId: string | null; receiptId: string | null }
interface Ims { lineId: string; action: 'accept' | 'reject' | 'pending'; reason: 'matched' | 'amount-differs' | 'not-in-books' | 'probable-match' }
interface GroupTotal { group: Group; count: number; taxableMinor: string; taxMinor: string; unknownTax: number }
export interface Sources { readonly register: string; readonly gstr2b: string }
export type Gst2bValue =
  | { readonly state: 'not-applicable'; readonly reason: 'composition' | 'unregistered' }
  | { readonly state: 'not-loaded'; readonly period: Period }
  | { readonly state: 'choose-sources'; readonly period: Period; readonly registerSources: readonly string[]; readonly gstr2bSources: readonly string[] }
  | {
    readonly state: 'ready'; readonly period: Period; readonly toleranceMinor: string; readonly via: 'connectors' | 'facts'; readonly sources: Sources | null;
    readonly leftOut: number; readonly matchReceiptId: string | null; readonly groups: readonly GroupTotal[]; readonly lines: readonly Line[]; readonly ims: readonly Ims[];
  };
const optId = (value: unknown) => value === null ? null : id(value);
export function gst2bReply(value: unknown): Gst2bValue {
  const v = obj(value), state = oneOf(v.state, ['not-applicable', 'not-loaded', 'choose-sources', 'ready'] as const);
  if (state === 'not-applicable') return { state, reason: oneOf(v.reason, ['composition', 'unregistered'] as const) };
  if (state === 'not-loaded') return { state, period: period(v.period) };
  if (state === 'choose-sources') {
    const choice = { state, period: period(v.period), registerSources: list(v.registerSources, id, 200), gstr2bSources: list(v.gstr2bSources, id, 200) };
    if (choice.registerSources.length === 0 || choice.gstr2bSources.length === 0) fail();
    return choice;
  }
  const lines = list(v.lines, l => {
    const x = obj(l);
    return { id: id(x.id), group: oneOf(x.group, GROUPS), supplier: str(x.supplier, 300), invoice: str(x.invoice, 100), booksMinor: optMinor(x.booksMinor), twoBMinor: optMinor(x.twoBMinor), differenceMinor: optMinor(x.differenceMinor),
      bookRowId: optId(x.bookRowId), twoBRowId: optId(x.twoBRowId), receiptId: optId(x.receiptId) };
  }, 20000);
  const known = new Set(lines.map(l => l.id)), src = v.sources === null ? null : obj(v.sources);
  return {
    state, period: period(v.period), toleranceMinor: minor(v.toleranceMinor), via: oneOf(v.via, ['connectors', 'facts'] as const), leftOut: count(v.leftOut),
    sources: src === null ? null : { register: id(src.register), gstr2b: id(src.gstr2b) }, matchReceiptId: optId(v.matchReceiptId),
    groups: list(v.groups, g => { const x = obj(g); return { group: oneOf(x.group, GROUPS), count: count(x.count), taxableMinor: minor(x.taxableMinor), taxMinor: minor(x.taxMinor), unknownTax: count(x.unknownTax) }; }, 10),
    lines,
    ims: list(v.ims, i => {
      const x = obj(i), lineId = id(x.lineId);
      if (!known.has(lineId)) fail();
      return { lineId, action: oneOf(x.action, ['accept', 'reject', 'pending'] as const), reason: oneOf(x.reason, ['matched', 'amount-differs', 'not-in-books', 'probable-match'] as const) };
    }, 20000),
  };
}
type MatchKey = 'supplier-gstin-and-invoice' | 'supplier-gstin-invoice-and-financial-year';
interface Side { readonly sourceId: string; readonly sourceRow: number | null; readonly cells: readonly { name: string; value: string }[] }
export interface LineValue { readonly id: string; readonly group: Group; readonly books: Side | null; readonly twoB: Side | null; readonly toleranceMinor: string; readonly key: MatchKey }
const sideOf = (value: unknown): Side | null => {
  if (value === null) return null;
  const v = obj(value);
  id(v.rowId);
  return { sourceId: id(v.sourceId), sourceRow: v.sourceRow === null ? null : int(v.sourceRow), cells: list(v.cells, c => { const x = obj(c); return { name: str(x.name, 200), value: str(x.value, 2000) }; }, 200) };
};
export function lineReply(value: unknown): LineValue {
  const v = obj(value), rule = obj(v.rule);
  const key = oneOf(rule.key, ['supplier-gstin-and-invoice', 'supplier-gstin-invoice-and-financial-year'] as const);
  return { id: id(v.id), group: oneOf(v.group, GROUPS), books: sideOf(v.books), twoB: sideOf(v.twoB), toleranceMinor: minor(rule.toleranceMinor), key };
}
const count = (value: unknown) => { const n = int(value); if (n < 0) fail(); return n; };
const fileName = (value: unknown) => { const v = str(value, 120); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,115}\.csv$/.test(v)) fail(); return v; };

const WORDS = catalogue({
  en: {
    title: 'Purchases against GSTR-2B', period: 'Month', composition: 'Not applicable. This business is in the composition scheme, so there is no GSTR-2B to match.',
    unregistered: 'Not applicable. This business is not registered for GST, so there is no GSTR-2B to match.',
    notLoaded: 'The GSTR-2B file for {period} is not loaded yet. Load it in Books to match your purchases.',
    rule: 'Chausar never acts in the GST portal. The IMS list is for a person to act on there.',
    groups: 'The match for {period}', matched: 'Matched', differs: 'Amount differs', 'in-2b-only': 'In 2B only', 'books-only': 'In your books only',
    groupNote: '{count} invoices · tax {tax} on {taxable}', differsNote: '{inside} inside the tolerance of {tolerance} · {outside} outside',
    noInvoices: 'none', via: 'Read from your connected systems.', viaFacts: 'Read from the files loaded in Books.',
    tolerance: 'Tolerance in rupees', toleranceNow: 'Amounts within {tolerance} of each other count as inside the tolerance.', setTolerance: 'Change the tolerance', badAmount: 'Write rupees with at most two decimals.',
    lines: 'Lines: {group}', lineNote: 'Invoice {invoice} · books {books} · 2B {twoB}', missing: 'not there', closeLines: 'Close the lines',
    line: 'Invoice line', books: 'In your books', twoB: 'In GSTR-2B', notInBooks: 'This invoice is not in your books.', notIn2b: 'This invoice is not in GSTR-2B.',
    sourceRow: 'From {source}, row {row}', sourceOnly: 'From {source}', lineRule: 'Matched on the supplier’s GSTIN and the invoice number, with a tolerance of {tolerance}.',
    lineRuleYear: 'Matched on the supplier’s GSTIN, the invoice number and the financial year, with a tolerance of {tolerance}.', closeLine: 'Close the line',
    probable: 'Probable match — not counted as matched; check it in the portal', unknownTax: '{count} lines with unknown tax, not added as zero', unknownTaxOne: 'One line with unknown tax, not added as zero',
    'why-probable-match': 'it is a probable match: check before accepting',
    choose: 'There is more than one purchase register or GSTR-2B read for {period}. Choose which two to match.', register: 'Purchase register', gstr2b: 'GSTR-2B read', matchThese: 'Match these two',
    sources: 'Matched {register} against {gstr2b}.', otherSources: 'Choose other sources', openMatch: 'Open the match receipt',
    withReceipt: 'Each amount opens the receipt for the match.',
    ims: 'The IMS list', imsNone: 'Nothing for the IMS list this month.', accept: 'Accept', reject: 'Reject', pending: 'Keep pending',
    'why-matched': 'it matches your books', 'why-amount-differs': 'the amount differs from your books', 'why-not-in-books': 'it is not in your books',
    imsLine: '{action} in the GST portal, because {reason}.', export: 'Export the IMS list', exportReady: 'The IMS list is ready.', download: 'Save {name}',
    leftOut: '{count} rows were left out of the match: no supplier GSTIN and invoice number, no amount, or another currency. They are not counted as zero.',
    leftOutOne: 'One row was left out of the match: no supplier GSTIN and invoice number, no amount, or another currency. It is not counted as zero.',
    noLeftOut: 'No row was left out of the match.',
    table: 'The match as a table', group: 'Group', invoices: 'Invoices', taxable: 'Taxable value', tax: 'Tax', 'differs-inside': 'Amount differs, inside the tolerance', 'differs-outside': 'Amount differs, outside the tolerance',
    noReceipt: 'These amounts come from the rows as written. The match has no receipt of its own yet, so a line opens its two rows instead.',
  },
  hi: {
    title: 'GSTR-2B से ख़रीद का मिलान', period: 'महीना', composition: 'लागू नहीं। यह व्यवसाय कंपोज़िशन योजना में है, इसलिए मिलाने के लिए कोई GSTR-2B नहीं है।',
    unregistered: 'लागू नहीं। यह व्यवसाय GST में पंजीकृत नहीं है, इसलिए मिलाने के लिए कोई GSTR-2B नहीं है।',
    notLoaded: '{period} की GSTR-2B फ़ाइल अभी लोड नहीं हुई है। ख़रीद मिलाने के लिए इसे Books में लोड करें।',
    rule: 'Chausar GST पोर्टल में कभी कुछ नहीं करता। IMS सूची वहाँ किसी व्यक्ति के करने के लिए है।',
    groups: '{period} का मिलान', matched: 'मिल गए', differs: 'राशि में अंतर', 'in-2b-only': 'केवल 2B में', 'books-only': 'केवल आपके खातों में',
    groupNote: '{count} बिल · {taxable} पर कर {tax}', differsNote: '{tolerance} की छूट के भीतर {inside} · बाहर {outside}',
    noInvoices: 'कोई नहीं', via: 'आपके जुड़े सिस्टम से पढ़ा गया।', viaFacts: 'Books में लोड की गई फ़ाइलों से पढ़ा गया।',
    tolerance: 'रुपयों में छूट', toleranceNow: 'एक-दूसरे से {tolerance} के भीतर की राशियाँ छूट के भीतर मानी जाती हैं।', setTolerance: 'छूट बदलें', badAmount: 'अधिकतम दो दशमलव वाले रुपये लिखें।',
    lines: 'पंक्तियाँ: {group}', lineNote: 'बिल {invoice} · खाते {books} · 2B {twoB}', missing: 'नहीं है', closeLines: 'पंक्तियाँ बंद करें',
    line: 'बिल की पंक्ति', books: 'आपके खातों में', twoB: 'GSTR-2B में', notInBooks: 'यह बिल आपके खातों में नहीं है।', notIn2b: 'यह बिल GSTR-2B में नहीं है।',
    sourceRow: '{source} से, पंक्ति {row}', sourceOnly: '{source} से', lineRule: 'आपूर्तिकर्ता के GSTIN और बिल संख्या पर मिलाया गया, {tolerance} की छूट के साथ।',
    lineRuleYear: 'आपूर्तिकर्ता के GSTIN, बिल संख्या और वित्त वर्ष पर मिलाया गया, {tolerance} की छूट के साथ।', closeLine: 'पंक्ति बंद करें',
    probable: 'संभावित मिलान — मिला हुआ नहीं गिना गया; पोर्टल में जाँचें', unknownTax: '{count} पंक्तियों का कर पता नहीं, शून्य नहीं जोड़ा गया', unknownTaxOne: 'एक पंक्ति का कर पता नहीं, शून्य नहीं जोड़ा गया',
    'why-probable-match': 'यह संभावित मिलान है: स्वीकार करने से पहले जाँचें',
    choose: '{period} के लिए एक से ज़्यादा ख़रीद रजिस्टर या GSTR-2B हैं। चुनें कि किन दो को मिलाना है।', register: 'ख़रीद रजिस्टर', gstr2b: 'GSTR-2B', matchThese: 'इन दोनों को मिलाएँ',
    sources: '{register} को {gstr2b} से मिलाया गया।', otherSources: 'दूसरे स्रोत चुनें', openMatch: 'मिलान की रसीद खोलें',
    withReceipt: 'हर राशि मिलान की रसीद खोलती है।',
    ims: 'IMS सूची', imsNone: 'इस महीने IMS सूची के लिए कुछ नहीं।', accept: 'स्वीकार करें', reject: 'अस्वीकार करें', pending: 'लंबित रखें',
    'why-matched': 'यह आपके खातों से मिलता है', 'why-amount-differs': 'राशि आपके खातों से अलग है', 'why-not-in-books': 'यह आपके खातों में नहीं है',
    imsLine: 'GST पोर्टल में {action}, क्योंकि {reason}।', export: 'IMS सूची निर्यात करें', exportReady: 'IMS सूची तैयार है।', download: '{name} सहेजें',
    leftOut: 'मिलान से {count} पंक्तियाँ छोड़ी गईं: आपूर्तिकर्ता का GSTIN और बिल संख्या नहीं, राशि नहीं, या कोई दूसरी मुद्रा। इन्हें शून्य नहीं गिना गया।',
    leftOutOne: 'मिलान से एक पंक्ति छोड़ी गई: आपूर्तिकर्ता का GSTIN और बिल संख्या नहीं, राशि नहीं, या कोई दूसरी मुद्रा। इसे शून्य नहीं गिना गया।',
    noLeftOut: 'मिलान से कोई पंक्ति नहीं छोड़ी गई।',
    table: 'तालिका में मिलान', group: 'समूह', invoices: 'बिल', taxable: 'कर योग्य मूल्य', tax: 'कर', 'differs-inside': 'राशि में अंतर, छूट के भीतर', 'differs-outside': 'राशि में अंतर, छूट के बाहर',
    noReceipt: 'ये राशियाँ लिखी गई पंक्तियों से हैं। मिलान की अपनी कोई रसीद अभी नहीं है, इसलिए एक पंक्ति अपनी दोनों पंक्तियाँ खोलती है।',
  },
});
type Month = 'last-month' | 'this-month';

/** The two sources the person chose, sent with every call about the match. */
const sourceFields = (src: Sources | null) => src === null ? {} : { registerSourceId: src.register, gstr2bSourceId: src.gstr2b };

export function Gst2bScreen(_props: { view: Extract<AskView, { kind: 'gst2b' }> }) {
  const ask = useAsk(), w = useWords(WORDS), periods = useWords(PERIOD_WORDS), explain = useRefusal();
  const [periodId, setPeriodId] = useState<Month>('last-month');
  const [chosen, setChosen] = useState<Sources | null>(null);
  const [load, retry] = useRead(`gst2b|${periodId}|${chosen?.register ?? ''}|${chosen?.gstr2b ?? ''}`, () => call(ask.rpc, 'askx.gst2b', { periodId, ...sourceFields(chosen) }, gst2bReply));
  return (
    <AskPage title={w.title} load={load} retry={retry} explain={explain}>
      {g => (
        <>
          <Choice<Month> label={w.period} options={(['last-month', 'this-month'] as const).map(p => ({ value: p, label: periods[p] }))} value={periodId} onChange={p => { setPeriodId(p); setChosen(null); }} />
          <p className={s.note} data-gst-rule="">{w.rule}</p>
          {g.state === 'not-applicable' ? <p data-gst-state="not-applicable">{w[g.reason]}</p>
            : g.state === 'not-loaded' ? <p data-gst-state="not-loaded">{fill(w.notLoaded, { period: periodText(g.period, ask.language) })}</p>
            : g.state === 'choose-sources' ? <ChooseSources key={`${g.registerSources.join('|')}#${g.gstr2bSources.join('|')}`} g={g} onChoose={setChosen} />
            : <Ready g={g} periodId={periodId} onChanged={retry} onOtherSources={chosen === null ? undefined : () => setChosen(null)} />}
        </>
      )}
    </AskPage>
  );
}

/** More than one purchase register or GSTR-2B read: the person picks the two to match. Choosing reads only. */
function ChooseSources({ g, onChoose }: { g: Extract<Gst2bValue, { state: 'choose-sources' }>; onChoose: (sources: Sources) => void }) {
  const ask = useAsk(), w = useWords(WORDS);
  const [register, setRegister] = useState(g.registerSources[0]!);
  const [gstr2b, setGstr2b] = useState(g.gstr2bSources[0]!);
  return (
    <div className={s.part} data-gst-state="choose-sources">
      <p>{fill(w.choose, { period: periodText(g.period, ask.language) })}</p>
      <Choice label={w.register} options={g.registerSources.map(x => ({ value: x, label: x }))} value={register} onChange={setRegister} />
      <Choice label={w.gstr2b} options={g.gstr2bSources.map(x => ({ value: x, label: x }))} value={gstr2b} onChange={setGstr2b} />
      <div className={s.actions}><Button variant="filled" onClick={() => onChoose({ register, gstr2b })}>{w.matchThese}</Button></div>
    </div>
  );
}

function Ready({ g, periodId, onChanged, onOtherSources }: { g: Extract<Gst2bValue, { state: 'ready' }>; periodId: Month; onChanged: () => void; onOtherSources?: (() => void) | undefined }) {
  const ask = useAsk(), w = useWords(WORDS), lang = ask.language;
  const [group, setGroup] = useState<'matched' | 'differs' | 'probable' | 'in-2b-only' | 'books-only' | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState('');
  const [file, setFile] = useState<{ name: string; url: string } | null>(null);
  const tol = useSend(), exp = useSend();
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);
  const tolText = moneyText(g.toleranceMinor), paise = hundredths(tolerance);
  const open = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });
  const matchReceipt = g.matchReceiptId;
  const of = (k: Group) => g.groups.find(x => x.group === k);
  const unknownText = (k: Group) => { const n = of(k)?.unknownTax ?? 0; return n === 0 ? null : n === 1 ? w.unknownTaxOne : fill(w.unknownTax, { count: countWords(String(n)) }); };
  const withUnknown = (text: string, ...ks: Group[]) => [text, ...ks.map(unknownText).filter((x): x is string => x !== null)].join(' · ');
  const note = (k: Group) => {
    const x = of(k);
    if (x === undefined || x.count === 0) return w.noInvoices;
    return withUnknown(fill(w.groupNote, { count: countWords(String(x.count)), tax: moneyText(x.taxMinor), taxable: moneyText(x.taxableMinor) }), k);
  };
  /* With a match receipt, a group's tax is a figure that opens it. */
  const groupRow = (k: Group, row: Omit<RowItem, 'figure'>): RowItem => {
    const x = of(k);
    return matchReceipt !== null && x !== undefined && x.count > 0 ? { ...row, figure: rowMoneyFigure(x.taxMinor, matchReceipt, ask.view, lang) } : row;
  };
  const countOf = (k: Group) => { const x = of(k); return x === undefined ? w.noInvoices : countWords(String(x.count)); };
  const rows: RowItem[] = [
    groupRow('matched', { id: 'matched', mark: 'cha', what: w.matched, note: note('matched') }),
    { id: 'differs', mark: 'unsure', what: w.differs, note: withUnknown(fill(w.differsNote, { inside: countOf('differs-inside'), outside: countOf('differs-outside'), tolerance: tolText }), 'differs-inside', 'differs-outside') },
    ...(of('probable') === undefined ? [] : [groupRow('probable', { id: 'probable', mark: 'unsure', what: w.probable, note: note('probable') })]),
    groupRow('in-2b-only', { id: 'in-2b-only', mark: 'wait', what: w['in-2b-only'], note: note('in-2b-only') }),
    groupRow('books-only', { id: 'books-only', mark: 'wait', what: w['books-only'], note: note('books-only') }),
  ];
  const inGroup = (l: Line) => group === 'differs' ? l.group === 'differs-inside' || l.group === 'differs-outside' : l.group === group;
  const amount = (m: string | null) => (m === null ? w.missing : moneyText(m));
  /* A line with its own receipt: its amount is a figure and the line opens that receipt. Otherwise it opens its two rows. */
  const lineRows: RowItem[] = g.lines.filter(inGroup).map(l => {
    const row: RowItem = { id: l.id, mark: l.group === 'matched' ? 'cha' : 'unsure', what: l.supplier, note: fill(w.lineNote, { invoice: l.invoice, books: amount(l.booksMinor), twoB: amount(l.twoBMinor) }) };
    const shown = l.twoBMinor ?? l.booksMinor;
    return l.receiptId !== null && shown !== null ? { ...row, figure: rowMoneyFigure(shown, l.receiptId, ask.view, lang) } : row;
  });
  const byLine = new Map(g.lines.map(l => [l.id, l]));
  const cell = (m: string) => matchReceipt === null ? moneyText(m) : <Figure value={moneyFigure(m, matchReceipt)} onReceipt={open} />;
  return (
    <>
      <Part title={fill(w.groups, { period: periodText(g.period, lang) })}>
        {g.sources !== null && (
          <p className={s.note} data-gst-sources="">{fill(w.sources, { register: g.sources.register, gstr2b: g.sources.gstr2b })}
            {onOtherSources !== undefined && <> <Button variant="link" onClick={onOtherSources}>{w.otherSources}</Button></>}</p>
        )}
        <div data-gst-groups="">
          <RowList rows={rows} onOpen={k => { setGroup(k as typeof group); setLineId(null); }} onReceipt={open} selectedId={group ?? undefined} />
        </div>
        {matchReceipt !== null && (
          <p className={s.note} data-gst-match-receipt={matchReceipt}>{w.withReceipt} <Button variant="link" onClick={() => open(matchReceipt)}>{w.openMatch}</Button></p>
        )}
        <p className={s.note} data-gst-left-out="">{g.leftOut === 0 ? w.noLeftOut : g.leftOut === 1 ? w.leftOutOne : fill(w.leftOut, { count: countWords(String(g.leftOut)) })}</p>
        {ask.view === 'books' && (
          <div className={s.scroll} data-gst-table="">
            <table className={s.table}>
              <caption className={s.tileLabel}>{w.table}</caption>
              <thead><tr><th scope="col">{w.group}</th><th scope="col">{w.invoices}</th><th scope="col">{w.taxable}</th><th scope="col">{w.tax}</th></tr></thead>
              <tbody>
                {GROUPS.filter(k => of(k) !== undefined).map(k => { const x = of(k)!; return (
                  <tr key={k}>
                    <th scope="row">{w[k]}</th>
                    <td>{countWords(String(x.count))}</td>
                    <td>{cell(x.taxableMinor)}</td>
                    <td>{cell(x.taxMinor)}{x.unknownTax > 0 && <span className={s.note}> · {unknownText(k)}</span>}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        )}
        {ask.view !== 'simple' && matchReceipt === null && <p className={s.note}>{w.noReceipt}</p>}
        <p className={s.note}>{fill(w.toleranceNow, { tolerance: tolText })} {g.via === 'connectors' ? w.via : w.viaFacts}</p>
        {/* Changing the tolerance needs approve permission: owner or cofounder only. */}
        {!ask.viewer && (ask.member.role === 'owner' || ask.member.role === 'cofounder') && (
          <form className={s.formLine} onSubmit={e => {
            e.preventDefault();
            if (paise !== null) void tol.send('askx.gst2b.tolerance', { toleranceMinor: paise }, v => minor(obj(v).toleranceMinor), () => { setTolerance(''); onChanged(); });
          }}>
            <Field label={w.tolerance} prefix={'₹'} inputMode="decimal" value={tolerance} onChange={e => setTolerance(e.target.value)} problem={tolerance !== '' && paise === null ? w.badAmount : undefined} />
            <Button submit disabled={tol.busy || paise === null}>{w.setTolerance}</Button>
          </form>
        )}
        <Problem code={tol.problem} />
      </Part>
      {group !== null && (
        <Part title={fill(w.lines, { group: rows.find(r => r.id === group)!.what })} aside={<Button variant="link" onClick={() => setGroup(null)}>{w.closeLines}</Button>}>
          <div data-gst-lines="">
            {lineRows.length === 0 ? <p className={s.note}>{w.noInvoices}</p> : (
              <RowList rows={lineRows} onOpen={lid => { const l = byLine.get(lid); if (l?.receiptId) open(l.receiptId); else setLineId(lid); }} onReceipt={open} selectedId={lineId ?? undefined} />
            )}
          </div>
        </Part>
      )}
      {lineId !== null && <LineDetail key={lineId} lineId={lineId} periodId={periodId} sources={g.sources} onClose={() => setLineId(null)} />}
      <Part title={w.ims}>
        {g.ims.length === 0 ? <p className={s.note}>{w.imsNone}</p> : (
          <ul className={s.list} data-gst-ims="">
            {g.ims.map(i => {
              const l = byLine.get(i.lineId)!;
              return (
                <li key={i.lineId} className={s.item}>
                  <span className={s.grow}>{l.supplier} <span className={s.note}>{l.invoice}</span></span>
                  <span>{fill(w.imsLine, { action: w[i.action], reason: w[`why-${i.reason}`] })}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className={[s.actions, s.part].join(' ')}>
          <Button disabled={exp.busy} onClick={() => void exp.send('askx.gst2b.exportIms', { periodId, ...sourceFields(g.sources) }, v => { const x = obj(v); return { name: fileName(x.fileName), csv: str(x.csv, 5_000_000) }; }, out => {
            const url = URL.createObjectURL(new Blob([out.csv], { type: 'text/csv;charset=utf-8' }));
            setFile(old => { if (old) URL.revokeObjectURL(old.url); return { name: out.name, url }; });
          })}>{w.export}</Button>
          {file !== null && <span role="status" className={s.note}>{w.exportReady} <a href={file.url} download={file.name} data-gst-download="">{fill(w.download, { name: file.name })}</a></span>}
        </div>
        <Problem code={exp.problem} />
      </Part>
    </>
  );
}

function LineDetail({ lineId, periodId, sources, onClose }: { lineId: string; periodId: Month; sources: Sources | null; onClose: () => void }) {
  const ask = useAsk(), w = useWords(WORDS);
  const [load] = useRead(`gst2b-line|${periodId}|${lineId}`, () => call(ask.rpc, 'askx.gst2b.line', { periodId, lineId, ...sourceFields(sources) }, lineReply));
  const side = (title: string, row: Side | null, absent: string) => (
    <div className={s.tile}>
      <span className={s.tileLabel}>{title}</span>
      {row === null ? <p className={s.note}>{absent}</p> : (
        <>
          <p className={s.note}>{row.sourceRow === null ? fill(w.sourceOnly, { source: row.sourceId }) : fill(w.sourceRow, { source: row.sourceId, row: countWords(String(row.sourceRow)) })}</p>
          <KeyValue onReceipt={() => undefined} pairs={row.cells.map(c => ({ name: c.name, value: c.value, mono: true }))} />
        </>
      )}
    </div>
  );
  return (
    <Part title={w.line} aside={<Button variant="link" onClick={onClose}>{w.closeLine}</Button>}>
      <div data-gst-line="">
        {load.kind === 'loading' ? null : load.kind === 'ok' ? (
          <>
            <div className={s.pair}>{side(w.books, load.value.books, w.notInBooks)}{side(w.twoB, load.value.twoB, w.notIn2b)}</div>
            <p className={s.note} data-gst-line-rule={load.value.key}>{fill(load.value.key === 'supplier-gstin-invoice-and-financial-year' ? w.lineRuleYear : w.lineRule, { tolerance: moneyText(load.value.toleranceMinor) })}</p>
          </>
        ) : <Problem code={load.kind === 'refused' ? load.code : 'NOT_BUILT'} />}
      </div>
    </Part>
  );
}
