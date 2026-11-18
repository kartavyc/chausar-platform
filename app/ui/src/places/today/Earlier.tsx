import { memo, useId } from 'react';
import { useT } from '../../text';
import { useDay } from '../../parts/when';
import { useResource } from '../../engine/context';
import type { EarlierEntry, VentureRunEvent } from '../../engine/types';
import { EmptyState } from '../../parts/EmptyState';
import { Receipt } from '../../parts/Receipt';
import { StatusMark, type StatusTone } from '../../parts/Row';
import { Tile, TileHead } from '../../parts/Tile';
import { cx } from '../../parts/cx';
import { EngineWords } from '../money/parts';
import { fixedWords } from './plan-words';
import s from './Today.module.css';

/** How many of the latest things Earlier shows; the journal in Money and Business, Decisions hold them all. */
const LATEST = 6;

/** A decision and an outside effect say so with a queue change; a search that ended, with a pipeline change. */
const EARLIER_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type === 'pipeline.changed';

/** The status circle for a line: done, said no, or waiting on the owner (described, or its outcome unknown). */
const TONE: Readonly<Record<EarlierEntry['state'], StatusTone>> = {
  applied: 'ok',
  approved: 'ok',
  rejected: 'no',
  described: 'question',
  outcome_unknown: 'question',
};

/**
 * Earlier (D-Today's Earlier tile, catalogue O15): the latest things that happened in this business, as the engine's
 * venture.earlier.list gives them (journal/earlier-list.ts): its outside effects, its decisions and its searches for
 * customers that ended, newest first. Round 6 (re-check 026): it read the journal alone, so after the plan was accepted,
 * prices set and a search found 10 customers it still said "Nothing has happened yet." Each line is the engine's own
 * words with its receipt (an amount in the line is proved by it); a line without a receipt is shown as the engine's own
 * words, as Money's Journal shows it (EngineWords). One whose outcome is not known says "Check it", which goes to
 * Money > Journal, where W1's Resolve settles it.
 */
/** W6 6H3: `title`, the name the owner (or their AI) gave this block; left out, its own. */
export const Earlier = memo(function Earlier({ title }: { title?: string | undefined } = {}) {
  const t = useT();
  const day = useDay('short');
  const headingId = useId();
  const earlier = useResource('venture.earlier.list', { limit: LATEST }, { refreshOn: EARLIER_EVENTS });
  const entries = earlier.data?.entries ?? [];
  // Round 7 (re-check 6, item 5): Chausar's own words on each line in the owner's language (plan-words.ts); a name, an
  // amount and anything the owner or an AI wrote stay as written. A line with a receipt keeps the engine's words.
  const words = fixedWords(t);
  return (
    <Tile as="section" labelledBy={headingId} className={s.listTile}>
      <TileHead id={headingId} title={title ?? t('today.earlier.title')} more={{ href: '#/money/journal', label: t('today.earlier.open') }} />
      {earlier.data && entries.length === 0 && <EmptyState title={t('today.earlier.none')} />}
      {entries.length > 0 && (
        <ul className={s.list}>
          {entries.map((entry) => {
            const unknown = entry.state === 'outcome_unknown';
            return (
              <li key={entry.id} className={s.event} data-figure-group={entry.receiptId ? '' : undefined}>
                <StatusMark tone={TONE[entry.state] ?? 'question'} />
                <div className={s.eventBody}>
                  <p className={s.eventTitle}>{entry.receiptId ? entry.title : <EngineWords>{words(entry.title)}</EngineWords>}</p>
                  {entry.line !== null && (
                    <p className={cx(s.eventLine, unknown && s.waitLine)}>
                      {entry.receiptId ? entry.line : <EngineWords>{words(entry.line)}</EngineWords>}
                    </p>
                  )}
                </div>
                {entry.receiptId ? (
                  <Receipt id={entry.receiptId} />
                ) : unknown ? (
                  <a className={s.check} href="#/money/journal">{t('today.earlier.check')}</a>
                ) : (
                  <span className={s.eventEnd}>{day(entry.at)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Tile>
  );
});
