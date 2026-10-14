/**
 * AS-15 Decisions. The inbox first: drafts to confirm, decisions due for review, and what
 * Chausar is waiting on. Then one sentence and a review date make a draft, with the
 * receipts it came from. Then the journal as a time line down the page, with its labels:
 * recorded later, replaced, closed. A decision's words are the person's own and are drawn
 * as text nodes.
 */
import { useState } from 'react';
import type { RowItem, TimeEvent } from '../../../app/presentation.ts';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import { Label } from '../../../parts/Label';
import { RowList } from '../../../parts/RowList';
import { TimeLine } from '../../../parts/TimeLine';
import { bool, call, date, id, int, list, obj, oneOf, str } from './client.ts';
import { AskPage, countWords, dayText, fill, useAsk, useRead, useWords, type AskView } from './kit';
import { catalogue, Part, Problem, removed, useRefusal, useSend } from './analysis';
import s from './analysis.module.css';

export interface Inbox {
  readonly drafts: readonly { id: string; sentence: string; reviewDate: string; origin: 'typed' | 'forwarded'; createdAt: string; receiptIds: readonly string[] }[];
  readonly due: readonly { id: string; text: string; reviewDate: string }[];
  readonly waiting: readonly { id: string; text: string; at: string }[];
}
export function inboxReply(value: unknown): Inbox {
  const v = obj(value);
  return {
    drafts: list(v.drafts, d => { const x = obj(d); return { id: id(x.id), sentence: str(x.sentence, 2000), reviewDate: date(x.reviewDate), origin: oneOf(x.origin, ['typed', 'forwarded'] as const), createdAt: date(x.createdAt), receiptIds: list(x.receiptIds, id, 50) }; }, 500),
    due: list(v.due, d => { const x = obj(d); return { id: id(x.id), text: str(x.text, 2000), reviewDate: date(x.reviewDate) }; }, 500),
    waiting: list(v.waiting, d => { const x = obj(d); return { id: id(x.id), text: str(x.text, 2000), at: date(x.at) }; }, 500),
  };
}
export interface Journal { readonly items: readonly { id: string; text: string; createdAt: string; reviewDate: string; status: 'open' | 'closed'; recordedLater: boolean; replaced: boolean; cancelled: boolean; reviews: number; receiptIds: readonly string[] }[] }
export function journalReply(value: unknown): Journal {
  return {
    items: list(obj(value).items, d => {
      const x = obj(d);
      return { id: id(x.id), text: str(x.text, 2000), createdAt: date(x.createdAt), reviewDate: date(x.reviewDate), status: oneOf(x.status, ['open', 'closed'] as const), recordedLater: bool(x.recordedLater), replaced: bool(x.replaced), cancelled: x.cancelled === undefined ? false : bool(x.cancelled), reviews: int(x.reviews), receiptIds: list(x.receiptIds, id, 50) };
    }, 5000),
  };
}

const WORDS = catalogue({
  en: {
    title: 'Decisions', inbox: 'Inbox', inboxEmpty: 'Nothing awaits your review.', drafts: 'Drafts to confirm', due: 'Due for review', waiting: 'Chausar is waiting on',
    reviewOn: 'Review on {date}', dueOn: 'Review was due on {date}', askedOn: 'Asked on {date}', forwarded: 'Forwarded from the phone.',
    confirm: 'Confirm', discard: 'Discard', write: 'Write a decision', sentence: 'The decision, in one sentence', reviewDate: 'Review date',
    attached: '{count} receipts are attached, as known today.', draft: 'Make the draft', needBoth: 'Write the sentence and pick a review date.',
    journal: 'Journal', journalEmpty: 'No decisions recorded yet.', open: 'review on {date}', closed: 'closed', replaced: 'replaced', cancelled: 'cancelled', decidedOn: 'Decided on (if earlier)',
    line: '{text} — {status}', lineLater: '{text} — {status}, recorded later', reviews: '{count} reviews',
  },
  hi: {
    title: 'निर्णय', inbox: 'इनबॉक्स', inboxEmpty: 'आपकी समीक्षा के लिए कुछ नहीं है।', drafts: 'पुष्टि के लिए मसौदे', due: 'समीक्षा का समय', waiting: 'Chausar इनकी प्रतीक्षा में है',
    reviewOn: '{date} को समीक्षा', dueOn: 'समीक्षा {date} को होनी थी', askedOn: '{date} को पूछा', forwarded: 'फ़ोन से भेजा गया।',
    confirm: 'पुष्टि करें', discard: 'हटाएँ', write: 'निर्णय लिखें', sentence: 'निर्णय, एक वाक्य में', reviewDate: 'समीक्षा की तारीख़',
    attached: '{count} रसीदें जुड़ी हैं, जैसी आज हैं।', draft: 'मसौदा बनाएँ', needBoth: 'वाक्य लिखें और समीक्षा की तारीख़ चुनें।',
    journal: 'रोज़नामचा', journalEmpty: 'अभी कोई निर्णय दर्ज नहीं है।', open: '{date} को समीक्षा', closed: 'बंद', replaced: 'बदल दिया गया', cancelled: 'रद्द', decidedOn: 'निर्णय की तारीख़ (यदि पहले)',
    line: '{text} — {status}', lineLater: '{text} — {status}, बाद में दर्ज', reviews: '{count} समीक्षाएँ',
  },
});

type Both = { inbox: Inbox; journal: Journal };

export function DecisionsScreen({ view }: { view: Extract<AskView, { kind: 'decisions' }> }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useRefusal();
  const [load, retry] = useRead('decisions', async () => {
    const inbox = await call(ask.rpc, 'askx.decisions.inbox', {}, inboxReply);
    if (inbox.kind !== 'ok') return inbox;
    const journal = await call(ask.rpc, 'askx.decisions.list', {}, journalReply);
    return journal.kind !== 'ok' ? journal : { kind: 'ok' as const, value: { inbox: inbox.value, journal: journal.value } };
  });
  return (
    <AskPage title={w.title} load={load} retry={retry} explain={explain}>
      {(both: Both) => <Body both={both} receiptIds={view.receiptIds ?? []} reload={retry} />}
    </AskPage>
  );
}

function Body({ both, receiptIds, reload }: { both: Both; receiptIds: readonly string[]; reload: () => void }) {
  const ask = useAsk(), w = useWords(WORDS), lang = ask.language;
  const act = useSend(), draft = useSend();
  const [sentence, setSentence] = useState('');
  const [review, setReview] = useState('');
  const [decided, setDecided] = useState('');
  const { drafts, due, waiting } = both.inbox;
  const open = (decisionId: string) => ask.go({ kind: 'decision', decisionId });
  const empty = drafts.length === 0 && due.length === 0 && waiting.length === 0;
  const dueRows: RowItem[] = due.map(d => ({ id: d.id, mark: 'wait', what: d.text, note: fill(w.dueOn, { date: dayText(d.reviewDate, lang) }) }));
  const waitRows: RowItem[] = waiting.map(d => ({ id: d.id, mark: 'busy', what: d.text, note: fill(w.askedOn, { date: dayText(d.at, lang) }) }));
  const events: TimeEvent[] = both.journal.items.map(d => {
    const status = d.replaced ? w.replaced : d.cancelled ? w.cancelled : d.status === 'closed' ? w.closed : fill(w.open, { date: dayText(d.reviewDate, lang) });
    return { id: d.id, mark: d.status === 'open' && !d.replaced ? 'you' : 'off', date: dayText(d.createdAt, lang), sentence: fill(d.recordedLater ? w.lineLater : w.line, { text: d.text, status }) };
  });
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(review);
  return (
    <>
      <Part title={w.inbox}>
        {empty && <p className={s.note}>{w.inboxEmpty}</p>}
        {drafts.length > 0 && (
          <div data-decisions="drafts">
            <h3 className={s.tileLabel}>{w.drafts}</h3>
            <ul className={s.list}>
              {drafts.map(d => (
                <li key={d.id} className={s.item} data-draft={d.id}>
                  <span className={s.grow}>
                    {d.sentence}
                    <span className={s.note}> {fill(w.reviewOn, { date: dayText(d.reviewDate, lang) })}</span>
                    {d.origin === 'forwarded' && <span className={s.note}> <Label kind="experimental" /> {w.forwarded}</span>}
                  </span>
                  {!ask.viewer && (
                    <span className={s.actions}>
                      <Button disabled={act.busy} onClick={() => void act.send('askx.decisions.confirm', { draftId: d.id }, v => id(obj(v).decisionId), reload)}>{w.confirm}</Button>
                      <Button variant="link" danger disabled={act.busy} onClick={() => void act.send('askx.decisions.discard', { draftId: d.id }, removed, reload)}>{w.discard}</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <Problem code={act.problem} />
          </div>
        )}
        {dueRows.length > 0 && <div data-decisions="due"><h3 className={s.tileLabel}>{w.due}</h3><RowList rows={dueRows} onOpen={open} onReceipt={rid => ask.go({ kind: 'receipt', receiptId: rid })} /></div>}
        {waitRows.length > 0 && <div data-decisions="waiting"><h3 className={s.tileLabel}>{w.waiting}</h3><RowList rows={waitRows} onReceipt={rid => ask.go({ kind: 'receipt', receiptId: rid })} /></div>}
      </Part>
      {!ask.viewer && (
        <Part title={w.write}>
          <form className={s.form} onSubmit={e => {
            e.preventDefault();
            if (sentence.trim() === '' || !validDate) return;
            void draft.send('askx.decisions.draft', { sentence: sentence.trim(), reviewDate: review, receiptIds: [...receiptIds], ...(decided === '' ? {} : { decidedOn: decided }) }, v => id(obj(v).id), () => { setSentence(''); setReview(''); setDecided(''); reload(); });
          }}>
            <Field label={w.sentence} value={sentence} maxLength={500} onChange={e => setSentence(e.target.value)} />
            <Field label={w.reviewDate} type="date" value={review} onChange={e => setReview(e.target.value)} />
            <Field label={w.decidedOn} type="date" value={decided} onChange={e => setDecided(e.target.value)} />
            {receiptIds.length > 0 && <p className={s.note}>{fill(w.attached, { count: countWords(String(receiptIds.length)) })}</p>}
            <div><Button variant="filled" submit disabled={draft.busy || sentence.trim() === '' || !validDate}>{w.draft}</Button></div>
            <Problem code={draft.problem} />
          </form>
        </Part>
      )}
      <Part title={w.journal}>
        {events.length === 0 ? <p className={s.note}>{w.journalEmpty}</p> : <div data-decisions="journal"><TimeLine events={events} onOpen={open} onReceipt={rid => ask.go({ kind: 'receipt', receiptId: rid })} /></div>}
      </Part>
    </>
  );
}
