/**
 * The journal: every outside effect (a send, a post, a payment written to the books) with where it stands, in words.
 * An irreversible send that timed out is "outcome unknown": Chausar never resends it on its own, so the row says to
 * check before retrying, and Resolve lets the owner record what they found on the other side
 * (venture.journal.resolve). Recording it sends nothing; the row then shows what the engine recorded.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { JournalEntry } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Chip, type ChipTone } from '../../parts/Chip';
import { EmptyState } from '../../parts/EmptyState';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import { EngineWords, Failed, Section } from './parts';
import { useMoment } from './words';
import s from './Money.module.css';

const LIMIT = 50;

/** Each state's tone: an unknown outcome waits on the owner (amber), an applied one is done, a rejected one is grey. */
const TONES: Readonly<Record<JournalEntry['state'], ChipTone>> = {
  described: 'neutral', approved: 'neutral', applied: 'done', rejected: 'idle', outcome_unknown: 'wait',
};

export function Journal() {
  const t = useT();
  const journal = useResource('venture.journal.list', { limit: LIMIT });
  // What the engine answered to Resolve, by entry, until the next read brings the same thing.
  const [settled, setSettled] = useState<Readonly<Record<string, JournalEntry>>>({});
  useEffect(() => { setSettled({}); }, [journal.data]);
  const entries = (journal.data?.entries ?? []).map((entry) => settled[entry.id] ?? entry);

  function onSettled(entry: JournalEntry) {
    setSettled((all) => ({ ...all, [entry.id]: entry }));
    journal.reload();
  }

  return (
    <>
      {journal.error && <Failed error={journal.error} />}
      <Section title={t('money.journal.heading')}>
        {journal.data && entries.length === 0 && <EmptyState title={t('money.journal.none')} />}
        {entries.length > 0 && (
          <ul className={s.list}>
            {entries.map((entry) => <JournalRow key={entry.id} entry={entry} onSettled={onSettled} />)}
          </ul>
        )}
      </Section>
    </>
  );
}

/** One journalled effect. An unknown outcome asks the owner what they found, in the row, before anything is recorded. */
function JournalRow({ entry, onSettled }: { entry: JournalEntry; onSettled: (entry: JournalEntry) => void }) {
  const t = useT();
  const moment = useMoment();
  const engine = useEngine();
  const [phase, setPhase] = useState<'idle' | 'ask' | 'sending'>('idle');
  const [failed, setFailed] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const unknown = entry.state === 'outcome_unknown';

  useEffect(() => { if (phase === 'ask') cancelRef.current?.focus(); }, [phase]);

  async function resolve(outcome: 'sent' | 'not-sent') {
    setPhase('sending');
    setFailed(null);
    try {
      const answer = await engine.request('venture.journal.resolve', { entryId: entry.id, outcome });
      setPhase('idle');
      onSettled(answer.entry);
    } catch (error) {
      setFailed(t('money.journal.resolveFailed', { message: error instanceof Error ? error.message : String(error) }));
      setPhase('idle');
    }
  }

  const sending = phase === 'sending';
  return (
    <Row
      id={entry.id}
      eyebrow={moment(entry.at)}
      title={t('money.journal.title', { action: entry.action, target: entry.target })}
      line={entry.receiptId
        // An amount the journal recorded sits with its receipt; any other line is the engine's words as written.
        ? <span className={s.value} data-figure-group=""><span>{entry.line}</span><Receipt id={entry.receiptId} /></span>
        : <EngineWords>{entry.line}</EngineWords>}
      aside={<Chip tone={TONES[entry.state] ?? 'neutral'}>{t(`money.journal.state.${entry.state}`)}</Chip>}
      actions={unknown && phase === 'idle' ? <Button size="sm" onClick={() => setPhase('ask')}>{t('money.journal.resolve')}</Button> : undefined}
    >
      {unknown && <p className={s.check}>{t('money.journal.check')}</p>}
      {unknown && phase !== 'idle' && (
        <div className={s.ask}>
          <p>{t('money.journal.resolveAsk')}</p>
          <div className={s.buttons}>
            <Button ref={cancelRef} disabled={sending} onClick={() => setPhase('idle')}>{t('approval.cancel')}</Button>
            <Button disabled={sending} onClick={() => void resolve('not-sent')}>{t('money.journal.notSent')}</Button>
            <Button disabled={sending} onClick={() => void resolve('sent')}>{t('money.journal.sent')}</Button>
          </div>
        </div>
      )}
      {failed && <p className={s.failed} role="status" data-engine-line="">{failed}</p>}
    </Row>
  );
}
