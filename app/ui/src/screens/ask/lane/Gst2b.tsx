/**
 * AS-19 Purchases against GSTR-2B. Four groups as rows with their count and amount: matched;
 * amount differs, inside or outside the tolerance (shown beside it); in 2B only; in your
 * books only. A group opens its lines; a line opens both rows' cells as written. Under them
 * the IMS list: what a person should accept, reject or keep pending in the GST portal, each
 * with its reason, and its export. Chausar never acts in the GST portal.
 *
 * The match reply carries no calculator receipt for a group or a line, so their amounts are
 * written as text and a line opens its two source rows, which are what the match read.
 */
import { useEffect, useState } from 'react';
import type { RowItem } from '../../../app/presentation.ts';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import { Field } from '../../../parts/Field';
import { KeyValue } from '../../../parts/KeyValue';
import { RowList } from '../../../parts/RowList';
import { call, fail, id, int, list, minor, obj, oneOf, optMinor, period, str, type Period } from './client.ts';
import { AskPage, countWords, fill, moneyText, periodText, useAsk, useRead, useWords, type AskView } from './kit';
import { catalogue, Part, PERIOD_WORDS, Problem, useRefusal, useSend, hundredths } from './analysis';
import s from './analysis.module.css';

const GROUPS = ['matched', 'differs-inside', 'differs-outside', 'in-2b-only', 'books-only'] as const;
type Group = (typeof GROUPS)[number];
interface Line { id: string; group: Group; supplier: string; invoice: string; booksMinor: string | null; twoBMinor: string | null; differenceMinor: string | null }
interface Ims { lineId: string; action: 'accept' | 'reject' | 'pending'; reason: 'matched' | 'amount-differs' | 'not-in-books' }
export type Gst2bValue =
  | { readonly state: 'not-applicable'; readonly reason: 'composition' | 'unregistered' }
  | { readonly state: 'not-loaded'; readonly period: Period }
  | { readonly state: 'ready'; readonly period: Period; readonly toleranceMinor: string; readonly via: 'connectors' | 'facts'; readonly groups: readonly { group: Group; count: number; taxableMinor: string; taxMinor: string }[]; readonly lines: readonly Line[]; readonly ims: readonly Ims[] };
export function gst2bReply(value: unknown): Gst2bValue {
  const v = obj(value), state = oneOf(v.state, ['not-applicable', 'not-loaded', 'ready'] as const);
  if (state === 'not-applicable') return { state, reason: oneOf(v.reason, ['composition', 'unregistered'] as const) };
  if (state === 'not-loaded') return { state, period: period(v.period) };
  const lines = list(v.lines, l => {
    const x = obj(l);
    return { id: id(x.id), group: oneOf(x.group, GROUPS), supplier: str(x.supplier, 300), invoice: str(x.invoice, 100), booksMinor: optMinor(x.booksMinor), twoBMinor: optMinor(x.twoBMinor), differenceMinor: optMinor(x.differenceMinor) };
  }, 20000);
  const known = new Set(lines.map(l => l.id));
  return {
    state, period: period(v.period), toleranceMinor: minor(v.toleranceMinor), via: oneOf(v.via, ['connectors', 'facts'] as const),
    groups: list(v.groups, g => { const x = obj(g); return { group: oneOf(x.group, GROUPS), count: int(x.count), taxableMinor: minor(x.taxableMinor), taxMinor: minor(x.taxMinor) }; }, 10),
    lines,
    ims: list(v.ims, i => {
      const x = obj(i), lineId = id(x.lineId);
      if (!known.has(lineId)) fail();
      return { lineId, action: oneOf(x.action, ['accept', 'reject', 'pending'] as const), reason: oneOf(x.reason, ['matched', 'amount-differs', 'not-in-books'] as const) };
    }, 20000),
  };
}
interface Side { readonly sourceId: string; readonly sourceRow: number | null; readonly cells: readonly { name: string; value: string }[] }
export interface LineValue { readonly id: string; readonly group: Group; readonly books: Side | null; readonly twoB: Side | null; readonly toleranceMinor: string }
const sideOf = (value: unknown): Side | null => {
  if (value === null) return null;
  const v = obj(value);
  id(v.rowId);
  return { sourceId: id(v.sourceId), sourceRow: v.sourceRow === null ? null : int(v.sourceRow), cells: list(v.cells, c => { const x = obj(c); return { name: str(x.name, 200), value: str(x.value, 2000) }; }, 200) };
};
export function lineReply(value: unknown): LineValue {
  const v = obj(value), rule = obj(v.rule);
  oneOf(rule.key, ['supplier-gstin-and-invoice'] as const);
  return { id: id(v.id), group: oneOf(v.group, GROUPS), books: sideOf(v.books), twoB: sideOf(v.twoB), toleranceMinor: minor(rule.toleranceMinor) };
}
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
    sourceRow: 'From {source}, row {row}', sourceOnly: 'From {source}', lineRule: 'Matched on the supplier’s GSTIN and the invoice number, with a tolerance of {tolerance}.', closeLine: 'Close the line',
    ims: 'The IMS list', imsNone: 'Nothing for the IMS list this month.', accept: 'Accept', reject: 'Reject', pending: 'Keep pending',
    'why-matched': 'it matches your books', 'why-amount-differs': 'the amount differs from your books', 'why-not-in-books': 'it is not in your books',
    imsLine: '{action} in the GST portal, because {reason}.', export: 'Export the IMS list', exportReady: 'The IMS list is ready.', download: 'Save {name}',
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
    sourceRow: '{source} से, पंक्ति {row}', sourceOnly: '{source} से', lineRule: 'आपूर्तिकर्ता के GSTIN और बिल संख्या पर मिलाया गया, {tolerance} की छूट के साथ।', closeLine: 'पंक्ति बंद करें',
    ims: 'IMS सूची', imsNone: 'इस महीने IMS सूची के लिए कुछ नहीं।', accept: 'स्वीकार करें', reject: 'अस्वीकार करें', pending: 'लंबित रखें',
    'why-matched': 'यह आपके खातों से मिलता है', 'why-amount-differs': 'राशि आपके खातों से अलग है', 'why-not-in-books': 'यह आपके खातों में नहीं है',
    imsLine: 'GST पोर्टल में {action}, क्योंकि {reason}।', export: 'IMS सूची निर्यात करें', exportReady: 'IMS सूची तैयार है।', download: '{name} सहेजें',
  },
});
type Month = 'last-month' | 'this-month';

export function Gst2bScreen(_props: { view: Extract<AskView, { kind: 'gst2b' }> }) {
  const ask = useAsk(), w = useWords(WORDS), periods = useWords(PERIOD_WORDS), explain = useRefusal();
  const [periodId, setPeriodId] = useState<Month>('last-month');
  const [load, retry] = useRead(`gst2b|${periodId}`, () => call(ask.rpc, 'askx.gst2b', { periodId }, gst2bReply));
  return (
    <AskPage title={w.title} load={load} retry={retry} explain={explain}>
      {g => (
        <>
          <Choice<Month> label={w.period} options={(['last-month', 'this-month'] as const).map(p => ({ value: p, label: periods[p] }))} value={periodId} onChange={setPeriodId} />
          <p className={s.note} data-gst-rule="">{w.rule}</p>
          {g.state === 'not-applicable' ? <p data-gst-state="not-applicable">{w[g.reason]}</p>
            : g.state === 'not-loaded' ? <p data-gst-state="not-loaded">{fill(w.notLoaded, { period: periodText(g.period, ask.language) })}</p>
            : <Ready g={g} periodId={periodId} onChanged={retry} />}
        </>
      )}
    </AskPage>
  );
}

function Ready({ g, periodId, onChanged }: { g: Extract<Gst2bValue, { state: 'ready' }>; periodId: Month; onChanged: () => void }) {
  const ask = useAsk(), w = useWords(WORDS), lang = ask.language;
  const [group, setGroup] = useState<'matched' | 'differs' | 'in-2b-only' | 'books-only' | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState('');
  const [file, setFile] = useState<{ name: string; url: string } | null>(null);
  const tol = useSend(), exp = useSend();
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);
  const tolText = moneyText(g.toleranceMinor), paise = hundredths(tolerance);
  const of = (k: Group) => g.groups.find(x => x.group === k);
  const note = (k: Group) => { const x = of(k); return x === undefined || x.count === 0 ? w.noInvoices : fill(w.groupNote, { count: countWords(String(x.count)), tax: moneyText(x.taxMinor), taxable: moneyText(x.taxableMinor) }); };
  const countOf = (k: Group) => { const x = of(k); return x === undefined ? w.noInvoices : countWords(String(x.count)); };
  const rows: RowItem[] = [
    { id: 'matched', mark: 'cha', what: w.matched, note: note('matched') },
    { id: 'differs', mark: 'unsure', what: w.differs, note: fill(w.differsNote, { inside: countOf('differs-inside'), outside: countOf('differs-outside'), tolerance: tolText }) },
    { id: 'in-2b-only', mark: 'wait', what: w['in-2b-only'], note: note('in-2b-only') },
    { id: 'books-only', mark: 'wait', what: w['books-only'], note: note('books-only') },
  ];
  const inGroup = (l: Line) => group === 'differs' ? l.group === 'differs-inside' || l.group === 'differs-outside' : l.group === group;
  const amount = (m: string | null) => (m === null ? w.missing : moneyText(m));
  const lineRows: RowItem[] = g.lines.filter(inGroup).map(l => ({ id: l.id, mark: l.group === 'matched' ? 'cha' : 'unsure', what: l.supplier, note: fill(w.lineNote, { invoice: l.invoice, books: amount(l.booksMinor), twoB: amount(l.twoBMinor) }) }));
  const byLine = new Map(g.lines.map(l => [l.id, l]));
  return (
    <>
      <Part title={fill(w.groups, { period: periodText(g.period, lang) })}>
        <div data-gst-groups="">
          <RowList rows={rows} onOpen={k => { setGroup(k as typeof group); setLineId(null); }} onReceipt={() => undefined} selectedId={group ?? undefined} />
        </div>
        <p className={s.note}>{fill(w.toleranceNow, { tolerance: tolText })} {g.via === 'connectors' ? w.via : w.viaFacts}</p>
        {!ask.viewer && (
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
            {lineRows.length === 0 ? <p className={s.note}>{w.noInvoices}</p> : <RowList rows={lineRows} onOpen={setLineId} onReceipt={() => undefined} selectedId={lineId ?? undefined} />}
          </div>
        </Part>
      )}
      {lineId !== null && <LineDetail key={lineId} lineId={lineId} periodId={periodId} onClose={() => setLineId(null)} />}
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
          <Button disabled={exp.busy} onClick={() => void exp.send('askx.gst2b.exportIms', { periodId }, v => { const x = obj(v); return { name: fileName(x.fileName), csv: str(x.csv, 5_000_000) }; }, out => {
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

function LineDetail({ lineId, periodId, onClose }: { lineId: string; periodId: Month; onClose: () => void }) {
  const ask = useAsk(), w = useWords(WORDS);
  const [load] = useRead(`gst2b-line|${periodId}|${lineId}`, () => call(ask.rpc, 'askx.gst2b.line', { periodId, lineId }, lineReply));
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
            <p className={s.note}>{fill(w.lineRule, { tolerance: moneyText(load.value.toleranceMinor) })}</p>
          </>
        ) : <Problem code={load.kind === 'refused' ? load.code : 'NOT_BUILT'} />}
      </div>
    </Part>
  );
}
