import { memo, useId } from 'react';
import { useLanguage, useT } from '../../text';
import { useResource } from '../../engine/context';
import type { JournalEntry, VentureRunEvent } from '../../engine/types';
import { EmptyState } from '../../parts/EmptyState';
import { Receipt } from '../../parts/Receipt';
import { StatusMark, type StatusTone } from '../../parts/Row';
import { Tile, TileHead } from '../../parts/Tile';
import { cx } from '../../parts/cx';
import { EngineWords } from '../money/parts';
import s from './Today.module.css';

/** How many of the latest journal lines Earlier shows; the journal in Money holds them all. */
const LATEST = 6;

/** A decision changes the journal, and says so with a queue change. */
const JOURNAL_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed';

/** The status circle for a journal line: done, said no, or waiting on the owner (described, or its outcome unknown). */
const TONE: Readonly<Record<JournalEntry['state'], StatusTone>> = {
  applied: 'ok',
  approved: 'ok',
  rejected: 'no',
  described: 'question',
  outcome_unknown: 'question',
};

/** "21 Oct", the day a line was written, in the reader's language. */
function dayOf(at: string, language: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' }).format(date);
}

/**
 * Earlier (D-Today's Earlier tile, catalogue O15): the latest lines of this business's journal, each with what was
 * done, the engine's own line and its receipt (an amount in the line is proved by it); a line without a receipt is the
 * engine's own words, as Money's Journal shows it (EngineWords). A send whose outcome is not
 * known says "Check it", which goes to Money > Journal, where W1's Resolve settles it. The engine's system-line
 * grammar for these lines is placeholder until W4 4J.
 */
export const Earlier = memo(function Earlier() {
  const t = useT();
  const language = useLanguage();
  const headingId = useId();
  const journal = useResource('venture.journal.list', { limit: LATEST }, { refreshOn: JOURNAL_EVENTS });
  const entries = journal.data?.entries ?? [];
  return (
    <Tile as="section" labelledBy={headingId} className={s.listTile}>
      <TileHead id={headingId} title={t('today.earlier.title')} more={{ href: '#/money/journal', label: t('today.earlier.open') }} />
      {journal.data && entries.length === 0 && <EmptyState title={t('today.earlier.none')} />}
      {entries.length > 0 && (
        <ul className={s.list}>
          {entries.map((entry) => {
            const unknown = entry.state === 'outcome_unknown';
            return (
              <li key={entry.id} className={s.event} data-figure-group={entry.receiptId ? '' : undefined}>
                <StatusMark tone={TONE[entry.state] ?? 'question'} />
                <div className={s.eventBody}>
                  <p className={s.eventTitle}>{t('today.earlier.what', { action: entry.action, target: entry.target })}</p>
                  <p className={cx(s.eventLine, unknown && s.waitLine)}>
                    {entry.receiptId ? entry.line : <EngineWords>{entry.line}</EngineWords>}
                  </p>
                </div>
                {entry.receiptId ? (
                  <Receipt id={entry.receiptId} />
                ) : unknown ? (
                  <a className={s.check} href="#/money/journal">{t('today.earlier.check')}</a>
                ) : (
                  <span className={cx(s.eventEnd, 'mono')}>{dayOf(entry.at, language)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Tile>
  );
});
