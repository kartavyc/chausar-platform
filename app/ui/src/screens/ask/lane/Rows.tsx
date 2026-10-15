/**
 * AS-06 the rows behind a number: a full-page table of every row counted or left out, with
 * the file, the row number, the cells as written and the amount. Two tabs of words. Rows this
 * seat may not see are not drawn; a line says they are hidden and why.
 */
import { useState } from 'react';
import type { Catalogue } from '../../../places/types.ts';
import { Choice } from '../../../parts/Choice';
import { Button } from '../../../parts/Button';
import { Figure, MissingWords } from '../../../parts/Figure';
import { AskPage, countWords, fill, moneyFigure, useAsk, useRead, useWords, type AskView } from './kit';
import { call } from './client.ts';
import { sourceRowsReply, type RuleKind, type SourceRowsReply } from './core-replies.ts';
import { RuleLine, useExplain } from './core-words';
import s from './core.module.css';

const LIMIT = 50;
type Tab = 'counted' | 'left-out';
const WORDS = {
  en: {
    title: 'The rows behind the number', tabs: 'Rows', counted: 'Counted', 'left-out': 'Left out', file: 'File', row: 'Row', cells: 'As written', amount: 'Amount',
    reason: 'Why left out', rowId: 'Row id', showing: 'Rows {from} to {to} of {total}', earlier: 'Earlier rows', later: 'Later rows',
    hidden: 'Some rows of this receipt are hidden from your seat by a rule in Trust. Nothing about them is shown here.',
    emptyCounted: 'No rows were counted for this receipt.', emptyLeftOut: 'No rows were left out of this receipt.',
    allHidden: 'None of these rows can be shown to your seat, so how many there are is not shown either.',
    hiddenCount: '{count} rows are hidden from this seat because of {rule}.',
    'rule-branch': 'a branch rule', 'rule-source': 'a source rule', 'rule-seat': 'a seat rule', 'rule-access': 'an access rule', 'rule-marking': 'a marking rule', 'rule-unknown': 'a rule in Trust',
  },
  hi: {
    title: 'संख्या के पीछे की पंक्तियाँ', tabs: 'पंक्तियाँ', counted: 'गिनी गईं', 'left-out': 'छोड़ी गईं', file: 'फ़ाइल', row: 'पंक्ति', cells: 'जैसा लिखा है', amount: 'रकम',
    reason: 'क्यों छोड़ी गई', rowId: 'पंक्ति id', showing: '{total} में से पंक्तियाँ {from} से {to}', earlier: 'पहले की पंक्तियाँ', later: 'बाद की पंक्तियाँ',
    hidden: 'इस रसीद की कुछ पंक्तियाँ Trust के एक नियम से आपकी सीट से छिपी हैं। उनके बारे में यहाँ कुछ नहीं दिखाया गया।',
    emptyCounted: 'इस रसीद में कोई पंक्ति नहीं गिनी गई।', emptyLeftOut: 'इस रसीद से कोई पंक्ति नहीं छोड़ी गई।',
    allHidden: 'इनमें से कोई पंक्ति आपकी सीट को नहीं दिखाई जा सकती, इसलिए उनकी गिनती भी नहीं दिखाई गई।',
    hiddenCount: '{rule} के कारण {count} पंक्तियाँ इस सीट से छिपी हैं।',
    'rule-branch': 'शाखा के नियम', 'rule-source': 'स्रोत के नियम', 'rule-seat': 'सीट के नियम', 'rule-access': 'पहुँच के नियम', 'rule-marking': 'चिह्न के नियम', 'rule-unknown': 'Trust के एक नियम',
  },
} as const satisfies Catalogue<'title' | 'tabs' | Tab | 'file' | 'row' | 'cells' | 'amount' | 'reason' | 'rowId' | 'showing' | 'earlier' | 'later' | 'hidden' | 'emptyCounted' | 'emptyLeftOut' | 'allHidden'
  | 'hiddenCount' | `rule-${RuleKind | 'unknown'}`>;

export function RowsScreen({ view }: { view: Extract<AskView, { kind: 'rows' }> }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useExplain();
  const [tab, setTab] = useState<Tab>(view.tab);
  const [offset, setOffset] = useState(0);
  const [load, retry] = useRead(`rows|${view.receiptId}|${tab}|${offset}`,
    () => call(ask.rpc, 'askx.sourceRows', { receiptId: view.receiptId, tab, offset, limit: LIMIT }, sourceRowsReply));
  const toReceipt = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });
  const books = ask.view === 'books', simple = ask.view === 'simple';
  return (
    <AskPage title={w.title} load={load} retry={retry} explain={explain}
      aside={<Choice<Tab> label={w.tabs} labelHidden options={[{ value: 'counted', label: w.counted }, { value: 'left-out', label: w['left-out'] }]} value={tab} onChange={t => { setTab(t); setOffset(0); }} />}>
      {(r: SourceRowsReply) => (
        <div className={s.page} data-rows={r.tab}>
          {r.hidden && (r.hiddenCount === null
            ? <p className={s.note} data-hidden="">{w.hidden}</p>
            : <p className={s.note} data-hidden="" data-hidden-rule={r.rule ?? ''}>{fill(w.hiddenCount, { count: countWords(String(r.hiddenCount)), rule: w[`rule-${r.rule ?? 'unknown'}`] })}</p>)}
          {r.hidden && r.rule !== null && <RuleLine rule={r.rule} receiptId={view.receiptId} />}
          {r.rows.length === 0 ? <p className={s.note} data-rows-empty="">{r.hidden ? w.allHidden : r.tab === 'counted' ? w.emptyCounted : w.emptyLeftOut}</p> : (
            <>
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      {!simple && <th scope="col">{w.file}</th>}
                      <th scope="col">{w.row}</th>
                      <th scope="col">{w.cells}</th>
                      {r.tab === 'left-out' && <th scope="col">{w.reason}</th>}
                      {books && <th scope="col">{w.rowId}</th>}
                      <th scope="col" className={s.num}>{w.amount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map(row => (
                      <tr key={row.rowId}>
                        {!simple && <td className="fig">{row.sourceId}</td>}
                        <td className="fig">{row.sourceRow === null ? <MissingWords missing="unknown" /> : countWords(String(row.sourceRow))}</td>
                        <td>{row.cells.map((c, i) => <span key={i} className={s.cell}><span className={s.cellName}>{c.name}</span>{c.value}</span>)}</td>
                        {r.tab === 'left-out' && <td>{row.reason ?? <MissingWords missing="unknown" />}</td>}
                        {books && <td className="fig">{row.rowId}</td>}
                        <td className={s.num}>
                          {row.amountMinor === null ? <MissingWords missing="absent" /> : <Figure value={moneyFigure(row.amountMinor, view.receiptId)} onReceipt={toReceipt} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={s.small}>{fill(w.showing, { from: countWords(String(r.offset + 1)), to: countWords(String(r.offset + r.rows.length)), total: countWords(String(r.total)) })}</p>
              <div className={s.actions}>
                {r.offset > 0 && <Button variant="link" onClick={() => setOffset(Math.max(0, r.offset - LIMIT))}>{w.earlier}</Button>}
                {r.offset + r.rows.length < r.total && <Button variant="link" onClick={() => setOffset(r.offset + r.rows.length)}>{w.later}</Button>}
              </div>
            </>
          )}
        </div>
      )}
    </AskPage>
  );
}
