/**
 * AS-14 saved: answers, investigations, what-ifs and forecasts, each with its question, its
 * kind, its figure and when it was worked out. A stale one says so with its date and offers
 * Rebuild; one whose source was deleted says when and cannot be rebuilt. A viewer seat sees
 * no Rebuild.
 */
import { useState } from 'react';
import type { Catalogue } from '../../../places/types.ts';
import type { FigureOrMissing } from '../../../app/presentation.ts';
import { Figure } from '../../../parts/Figure';
import { Button } from '../../../parts/Button';
import { Label } from '../../../parts/Label';
import { State } from '../../../patterns/States';
import { AskPage, bpsFigure, dayText, fill, missingFigure, rowMoneyFigure, useAsk, useRead, useWords, type AskView } from './kit';
import { call } from './client.ts';
import { rebuilt, savedReply, type SavedEntry, type SavedKind, type StaleReason } from './core-replies.ts';
import { Refusal, useExplain } from './core-words';
import s from './core.module.css';

type Key =
  | 'title' | 'empty' | 'toMenu' | 'workedOut' | 'stale' | 'staleUndated' | 'deleted' | 'rebuild' | 'rebuilt' | 'noQuestion' | 'savedOn' | 'cannotRebuild' | 'kindWhen'
  | SavedKind | StaleReason;
const WORDS = {
  en: {
    title: 'Saved', empty: 'Nothing saved yet. Save an answer from its page to find it here again.', toMenu: 'Ask a question',
    workedOut: 'worked out on {date}', stale: 'worked out on {date}, may be out of date', staleUndated: 'may be out of date',
    deleted: 'Something it used was deleted on {date}.', rebuild: 'Rebuild', rebuilt: 'Rebuilt from the books as they are now.',
    noQuestion: 'Chosen from the menu', savedOn: 'saved on {date}', kindWhen: '{kind} · {when}',
    cannotRebuild: 'This cannot be rebuilt here. Open it again from where it was made to work it out with the books as they are now.',
    answer: 'Answer', why: 'Why it changed', 'what-if': 'What if', forecast: 'Forecast',
    'meaning-changed': 'A meaning it used has changed.', 'books-changed': 'The books changed since.', 'access-changed': 'Who can see what has changed.', 'new-rows': 'New rows came in since.',
  },
  hi: {
    title: 'सहेजे गए', empty: 'अभी कुछ सहेजा नहीं गया। किसी जवाब को उसके पेज से सहेजें, वह यहाँ मिलेगा।', toMenu: 'सवाल पूछें',
    workedOut: '{date} को निकाला गया', stale: '{date} को निकाला गया, शायद पुराना हो', staleUndated: 'शायद पुराना हो',
    deleted: 'इसमें इस्तेमाल हुई एक चीज़ {date} को हटा दी गई।', rebuild: 'फिर से बनाएँ', rebuilt: 'बही में अभी जो है उससे फिर से बनाया गया।',
    noQuestion: 'मेन्यू से चुना गया', savedOn: '{date} को सहेजा गया', kindWhen: '{kind} · {when}',
    cannotRebuild: 'इसे यहाँ फिर से नहीं बनाया जा सकता। बही में अभी जो है उससे निकालने के लिए इसे वहीं से फिर खोलें जहाँ यह बना था।',
    answer: 'जवाब', why: 'यह क्यों बदला', 'what-if': 'अगर ऐसा हो', forecast: 'अनुमान',
    'meaning-changed': 'इसमें इस्तेमाल हुआ एक अर्थ बदल गया है।', 'books-changed': 'तब से बही बदल गई है।', 'access-changed': 'कौन क्या देख सकता है, यह बदल गया है।', 'new-rows': 'तब से नई पंक्तियाँ आई हैं।',
  },
} as const satisfies Catalogue<Key>;

type Act = { readonly id: string; readonly state: 'busy' | 'done' } | { readonly id: string; readonly state: 'refused'; readonly code: string } | null;

export function SavedScreen(_props: { view: Extract<AskView, { kind: 'saved' }> }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useExplain();
  const [load, retry] = useRead('saved', () => call(ask.rpc, 'askx.saved', {}, savedReply));
  const [act, setAct] = useState<Act>(null);
  const toReceipt = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });

  async function rebuild(item: SavedEntry) {
    setAct({ id: item.id, state: 'busy' });
    const reply = await call(ask.rpc, 'askx.rebuild', { savedId: item.id }, rebuilt);
    if (!ask.live()) return;
    if (reply.kind === 'ok') { setAct({ id: item.id, state: 'done' }); retry(); }
    else setAct({ id: item.id, state: 'refused', code: reply.kind === 'not-built' ? 'METHOD_UNAVAILABLE' : reply.code });
  }
  const open = (item: SavedEntry) => {
    if (item.kind === 'answer' && item.receiptId !== null) return ask.go({ kind: 'answer', receiptId: item.receiptId });
    if (item.kind === 'why' && item.refId !== null) return ask.go({ kind: 'why', whyId: item.refId });
    if (item.kind === 'what-if') return ask.go({ kind: 'whatif' });
    if (item.kind === 'forecast') return ask.go(item.operationId === null ? { kind: 'forecast' } : { kind: 'forecast', operationId: item.operationId });
  };
  const opens = (item: SavedEntry) => item.deletedOn === null && (item.kind !== 'answer' || item.receiptId !== null) && (item.kind !== 'why' || item.refId !== null);

  return (
    <AskPage title={w.title} load={load} retry={retry} explain={explain}
      empty={items => items.length === 0 ? <p className={s.note}>{w.empty} <Button variant="link" onClick={() => ask.go({ kind: 'menu' })}>{w.toMenu}</Button></p> : null}>
      {(items: readonly SavedEntry[]) => (
        <ul className={s.ledger} data-saved="">
          {items.map(item => {
            const figure: FigureOrMissing = item.deletedOn !== null ? missingFigure('absent')
              : item.headline !== null && item.receiptId !== null
                ? (item.headline.kind === 'money' ? rowMoneyFigure(item.headline.minor, item.receiptId, ask.view, ask.language, item.stale !== null ? ['stale'] : []) : bpsFigure(item.headline.minor, item.receiptId, item.stale !== null ? ['stale'] : []))
              : missingFigure(item.headline === null ? 'not-applicable' : 'unknown');
            const when = item.workedOutAt === null ? null : dayText(item.workedOutAt, ask.language);
            const what = item.question ?? w.noQuestion;
            const mine = act !== null && act.id === item.id ? act : null;
            return (
              <li key={item.id} data-saved-id={item.id}>
                <div className={s.ledgerLine}>
                  {opens(item) ? <button type="button" className={s.open} onClick={() => open(item)}>{what}</button> : <span className={s.text}>{what}</span>}
                  <Figure value={figure} onReceipt={toReceipt} />
                </div>
                <p className={s.small}>
                  {fill(w.kindWhen, { kind: w[item.kind], when: item.stale !== null ? (when === null ? w.staleUndated : fill(w.stale, { date: when })) : when === null ? fill(w.savedOn, { date: dayText(item.savedAt, ask.language) }) : fill(w.workedOut, { date: when }) })}
                </p>
                {item.deletedOn !== null && <p className={s.note} data-deleted="">{fill(w.deleted, { date: dayText(item.deletedOn, ask.language) })}</p>}
                {item.deletedOn === null && item.stale !== null && (
                  <div className={s.actions} data-stale="">
                    <Label kind="stale" />
                    {ask.view !== 'simple' && <span className={s.note}>{w[item.stale.reason]}</span>}
                    {!ask.viewer && item.rebuildable && <Button variant="link" disabled={mine?.state === 'busy'} onClick={() => void rebuild(item)}>{w.rebuild}</Button>}
                  </div>
                )}
                {item.deletedOn === null && item.stale !== null && !item.rebuildable && <p className={s.note} data-cannot-rebuild="">{w.cannotRebuild}</p>}
                {mine?.state === 'busy' && <State state={{ kind: 'loading' }} />}
                {mine?.state === 'done' && <p className={s.note} role="status">{w.rebuilt}</p>}
                {mine?.state === 'refused' && (mine.code === 'METHOD_UNAVAILABLE' ? <State state={{ kind: 'not-built' }} /> : <Refusal code={mine.code} />)}
              </li>
            );
          })}
        </ul>
      )}
    </AskPage>
  );
}
