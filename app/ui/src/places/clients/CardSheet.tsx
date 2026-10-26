/**
 * The card sheet beside the board (`?sheet=card:<id>`; the engine's 4E1 card view): where the card stands and its next
 * step (set your own, with its day), why it is here (its trigger, and its score with the rules that matched), the warm
 * path, what happened (each send and reply with its day, what is scheduled, and what is projected, "estimated"; Chausar
 * tracks no opens), "Write to them" (4E2's drafts) and "Move it", forward only, with what each stage rests on: the day
 * you sent it, the day they wrote back, what you offered, a reason for Lost. Every line is the engine's; the move's
 * refusal is the engine's words, and the card stays where it was. Simple first: the three forms (next step, draft,
 * move) each open from their own button. A board move that closes the card, or needs its evidence, opens the sheet at
 * Move it with that stage picked (`&tab=move-<stage>`).
 */

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet, useRoute } from '../../shell/navigation';
import { useDay, useLocalToday } from '../money/words';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Inner } from '../../parts/Card';
import { Sheet } from '../../parts/Sheet';
import { StrengthDots } from '../../parts/StrengthDots';
import type { LostReason, PipelineCardView, PipelineQuoteView, PipelineStage } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { clientsChanged } from './signals';
import { codeOf, dotsOf, messageOf, WarmPath } from './network';
import { CLOSED_STAGES, pipelineRefresh, STAGE_ORDER, useCardWords } from './pipeline';
import { DraftForm } from './DraftForm';
import { draftSheetId, parseWriteTab } from './handoff';
import s from './Pipeline.module.css';

/** The move refusals worded here, by the engine's code (its words stay the English source). */
const MOVE_REFUSALS: Readonly<Record<string, string>> = { PIPELINE_NOT_A_QUOTE: 'clients.pipeline.card.refused.PIPELINE_NOT_A_QUOTE' };

const LOST_REASONS: readonly LostReason[] = ['no-budget', 'no-reply', 'chose-someone-else', 'not-a-fit', 'timing', 'other'];

export function CardSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const board = useResource('venture.pipeline.list', {}, { refreshOn: pipelineRefresh });
  const card = board.data?.columns.flatMap((column) => column.cards).find((one) => one.id === id);
  const title = card ? card.name : board.error ? t('sheet.failed', { message: board.error.message }) : board.data ? t('clients.pipeline.card.gone') : t('sheet.loading');
  return (
    <Sheet
      label={t('clients.pipeline.card.sheet')}
      title={title}
      name={card?.name}
      line={card?.company ?? undefined}
      avatar={card ? <Avatar name={card.name} size={40} /> : undefined}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {card && <Body card={card} quotes={board.data?.quotes ?? []} reload={board.reload} />}
    </Sheet>
  );
}

function Body({ card, quotes, reload }: { card: PipelineCardView; quotes: readonly PipelineQuoteView[]; reload: () => void }) {
  const t = useT();
  const ids = useId();
  const route = useRoute();
  const closed = CLOSED_STAGES.has(card.stage);
  const words = useCardWords();
  // What the last move here said: kept beside the sheet, since a move that closes the card also closes Move it.
  const [moved, setMoved] = useState<{ line: string; problem: boolean } | null>(null);
  // The board asked to move this card to a stage that needs the owner's say: Move it opens with that stage picked.
  const asked = route.query.tab?.startsWith('move-') ? (route.query.tab.slice('move-'.length) as PipelineStage) : null;
  const pickedStage = asked && STAGE_ORDER.includes(asked) ? asked : null;
  // A draft again on a cold channel comes back here: Write a draft opens with that kind and channel picked.
  const write = parseWriteTab(route.query.tab);
  return (
    <>
      <div className={s.sheetTop}>
        <Chip tone="line">{t(`clients.pipeline.stage.${card.stage}`)}</Chip>
        {card.band && <StrengthDots level={dotsOf(card)} />}
      </div>
      {card.blocked && <p className={s.blocked} data-blocked="">{words.blocked(card.blocked)}</p>}
      {card.thread && <p className={s.quiet} data-thread={card.thread.age}>{words.thread(card.thread)}</p>}

      <section className={s.section} aria-labelledby={`${ids}-next`}>
        <h3 id={`${ids}-next`} className={s.heading}>{t('clients.pipeline.card.next')}</h3>
        {card.next ? <p className={s.next} data-late={card.next.late ? '' : undefined}>{words.next(card.next)}</p> : <p className={s.quiet}>{t('clients.pipeline.card.noNext')}</p>}
        {!closed && !card.blocked && <Opens label={t('clients.pipeline.card.nextOpen')}><NextForm card={card} reload={reload} /></Opens>}
      </section>

      <section className={s.section} aria-labelledby={`${ids}-why`}>
        <h3 id={`${ids}-why`} className={s.heading}>{t('clients.pipeline.card.why')}</h3>
        <p className={s.said} data-trigger="">{card.trigger}</p>
        {card.score && (
          <>
            <p className={s.cardLine}>
              <span>{t('clients.pipeline.card.score')}</span>
              <Chip tone="line">{t(`clients.pipeline.card.score.${card.score.bucket}`)}</Chip>
            </p>
            <ul className={s.lines} aria-label={t('clients.pipeline.card.reasons')}>{card.score.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          </>
        )}
      </section>

      {card.path && (
        <section className={s.section} aria-labelledby={`${ids}-path`}>
          <h3 id={`${ids}-path`} className={s.heading}>{t('clients.pipeline.card.path')}</h3>
          <Inner card={false} className={s.pathBox}><WarmPath path={card.path} name={card.name} /></Inner>
        </section>
      )}

      <section className={s.section} aria-labelledby={`${ids}-timeline`}>
        <h3 id={`${ids}-timeline`} className={s.heading}>{t('clients.pipeline.card.timeline')}</h3>
        {card.timeline.length === 0 ? <p className={s.quiet}>{t('clients.pipeline.card.timeline.none')}</p> : (
          <ol className={s.timeline}>
            {card.timeline.map((item, index) => (
              <li key={index} className={s.timelineItem} data-what={item.what} data-estimated={item.estimated ? '' : undefined}>
                <span className={s.timelineWhat}>{t(`clients.pipeline.card.what.${item.what}`)}</span>
                <span>{item.line}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {!closed && !card.blocked && (
        <section className={s.section} aria-labelledby={`${ids}-write`}>
          <h3 id={`${ids}-write`} className={s.heading}>{t('clients.pipeline.card.write')}</h3>
          {card.draft && (
            <div className={s.actions}>
              <p className={s.said} data-draft="">{card.draft}</p>
              {card.draftId && <Button size="sm" onClick={(event) => openSheet('outreach', draftSheetId(card.personId, card.draftId!), event.currentTarget)}>{t('clients.pipeline.card.openDraft')}</Button>}
            </div>
          )}
          <Opens key={route.query.tab ?? 'board'} label={t('clients.pipeline.card.writeOpen')} open={write !== null}><DraftForm card={card} picked={write} /></Opens>
        </section>
      )}

      {!closed && (
        <section className={s.section} aria-labelledby={`${ids}-move`}>
          <h3 id={`${ids}-move`} className={s.heading}>{t('clients.pipeline.card.move')}</h3>
          <Opens key={pickedStage ?? 'board'} label={t('clients.pipeline.card.moveOpen')} open={pickedStage !== null}><MoveForm card={card} quotes={quotes} reload={reload} picked={pickedStage} onSaid={setMoved} /></Opens>
        </section>
      )}
      {moved && <p className={moved.problem ? s.problem : s.said} role="status" data-moved="">{moved.line}</p>}
    </>
  );
}

/** A form one step away: its button, then the form (simple first). Open from the start when the board asked for it. */
function Opens({ label, open = false, children }: { label: string; open?: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(open);
  if (shown) return <>{children}</>;
  return <div className={s.actions}><Button size="sm" onClick={() => setShown(true)}>{label}</Button></div>;
}

/** The owner's own next step and its day (venture.pipeline.setNext). */
function NextForm({ card, reload }: { card: PipelineCardView; reload: () => void }) {
  const t = useT();
  const engine = useEngine();
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [said, setSaid] = useState<{ line: string; problem: boolean } | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaid(null);
    try {
      const { line } = await engine.request('venture.pipeline.setNext', { id: card.id, text: text.trim(), due });
      setSaid({ line, problem: false });
      setText('');
      clientsChanged(engine);
      reload();
    } catch (error) {
      setSaid({ line: messageOf(error), problem: true });
    }
  }

  return (
    <form className={s.form} onSubmit={(event) => void save(event)}>
      <Field label={t('clients.pipeline.card.nextText')} value={text} maxLength={200} onChange={(event) => setText(event.currentTarget.value)} autoComplete="off" />
      <Field label={t('clients.pipeline.card.nextDay')} type="date" value={due} onChange={(event) => setDue(event.currentTarget.value)} />
      <div className={s.actions}><Button type="submit" size="sm" disabled={!text.trim() || !due}>{t('clients.pipeline.card.nextSave')}</Button></div>
      {said && <p className={said.problem ? s.problem : s.said} role="status">{said.line}</p>}
    </form>
  );
}

/** A moment as its day on this computer's calendar ('2026-10-22'), for the day words. */
const dayOf = (at: string) => {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? at : new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
};

/**
 * Move forward, with what the stage rests on (venture.pipeline.move). Proposal rests on one of the business's quotes
 * (newest first) or a note of what was offered; Lost starts with no reason, so the owner says why. Move stays locked
 * until what the stage needs is there.
 */
function MoveForm({ card, quotes, reload, picked, onSaid }: {
  card: PipelineCardView; quotes: readonly PipelineQuoteView[]; reload: () => void; picked: PipelineStage | null; onSaid: (said: { line: string; problem: boolean }) => void;
}) {
  const t = useT();
  const engine = useEngine();
  const localToday = useLocalToday();
  const ids = useId();
  const later = STAGE_ORDER.filter((stage) => stage === 'lost' || stage === 'not-now' || STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(card.stage));
  const [stage, setStage] = useState<PipelineStage>(picked && later.includes(picked) ? picked : later[0] ?? 'not-now');
  // The owner's day, from the app's one clock (the dates the engine takes are days, never times).
  const today = localToday();
  const [on, setOn] = useState(today);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<LostReason | ''>('');
  const day = useDay('short');
  // What a Proposal rests on: a quote's receipt id, or 'note'; nothing is picked for the owner, as with Lost's reason.
  const [rests, setRests] = useState('');
  const chosen = quotes.find((quote) => quote.receiptId === rests);
  const byNote = stage === 'proposal' && (quotes.length === 0 || rests === 'note');
  const waiting = stage === 'lost' && !reason ? t('clients.pipeline.card.reasonFirst')
    : stage === 'proposal' && !chosen && !byNote ? t('clients.pipeline.card.quoteFirst')
      : byNote && !note.trim() ? t('clients.pipeline.card.offeredFirst') : null;

  async function move(event: FormEvent) {
    event.preventDefault();
    if (waiting) return;
    const evidence = stage === 'asked' || stage === 'talking' ? { kind: 'note' as const, on }
      : stage === 'proposal' ? (byNote ? { kind: 'note' as const, text: note.trim() } : { kind: 'quote' as const, id: rests })
        : undefined;
    try {
      const { line } = await engine.request('venture.pipeline.move', { id: card.id, stage, ...(evidence ? { evidence } : {}), ...(stage === 'lost' && reason ? { reason } : {}) });
      onSaid({ line, problem: false });
      clientsChanged(engine);
      reload();
    } catch (error) {
      // A refusal the screen words itself, in the owner's language; any other is the engine's own words.
      onSaid({ line: Object.hasOwn(MOVE_REFUSALS, codeOf(error)) ? t(MOVE_REFUSALS[codeOf(error)]!) : messageOf(error), problem: true });
    }
  }

  return (
    <form className={s.form} onSubmit={(event) => void move(event)}>
      <div className={s.choice}>
        <label className={s.label} htmlFor={`${ids}-stage`}>{t('clients.pipeline.card.moveTo')}</label>
        <select id={`${ids}-stage`} className={s.select} value={stage} onChange={(event) => setStage(event.currentTarget.value as PipelineStage)}>
          {later.map((one) => <option key={one} value={one}>{t(`clients.pipeline.stage.${one}`)}</option>)}
        </select>
      </div>
      {(stage === 'asked' || stage === 'talking') && (
        <Field label={t(stage === 'asked' ? 'clients.pipeline.card.sentOn' : 'clients.pipeline.card.repliedOn')} type="date" value={on} max={today} onChange={(event) => setOn(event.currentTarget.value)} />
      )}
      {stage === 'proposal' && quotes.length > 0 && (
        <div className={s.choice}>
          <label className={s.label} htmlFor={`${ids}-rests`}>{t('clients.pipeline.card.evidence')}</label>
          <select id={`${ids}-rests`} className={s.select} value={rests} onChange={(event) => setRests(event.currentTarget.value)}>
            <option value="" disabled>{t('clients.pipeline.card.quotePick')}</option>
            {quotes.map((quote) => (
              <option key={quote.receiptId} value={quote.receiptId}>
                {t(quote.quantity === '1' ? 'clients.pipeline.card.quoteOption' : 'clients.pipeline.card.quoteOptionMany', { offer: quote.offer, quantity: quote.quantity, value: quote.value, day: day(dayOf(quote.at)) })}
              </option>
            ))}
            <option value="note">{t('clients.pipeline.card.noteOption')}</option>
          </select>
          {chosen && <p className={s.quote} data-picked-quote="" data-figure-group=""><Figure value={chosen.value} receiptId={chosen.receiptId} /></p>}
        </div>
      )}
      {byNote && <Field label={t('clients.pipeline.card.offered')} value={note} maxLength={300} onChange={(event) => setNote(event.currentTarget.value)} autoComplete="off" />}
      {stage === 'won' && <p className={s.quiet}>{t('clients.pipeline.card.wonLine')}</p>}
      {stage === 'lost' && (
        <div className={s.choice}>
          <label className={s.label} htmlFor={`${ids}-reason`}>{t('clients.pipeline.card.reason')}</label>
          <select id={`${ids}-reason`} className={s.select} value={reason} onChange={(event) => setReason(event.currentTarget.value as LostReason | '')}>
            <option value="" disabled>{t('clients.pipeline.card.reasonPick')}</option>
            {LOST_REASONS.map((one) => <option key={one} value={one}>{t(`clients.pipeline.card.reason.${one}`)}</option>)}
          </select>
        </div>
      )}
      <div className={s.actions}><Button type="submit" size="sm" locked={waiting !== null} lockedReason={waiting ?? undefined}>{t('clients.pipeline.card.moveGo')}</Button></div>
    </form>
  );
}
