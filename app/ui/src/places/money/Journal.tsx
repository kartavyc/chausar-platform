/**
 * The journal: every outside effect (a send, a post, a payment written to the books) with where it stands, in words.
 * An irreversible send that timed out is "outcome unknown": Chausar never resends it on its own, so the row says to
 * check before retrying.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { EmptyState } from '../../parts/EmptyState';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import { Failed } from './parts';
import { useMoment } from './words';
import s from './Money.module.css';

const LIMIT = 50;

export function Journal() {
  const t = useT();
  const moment = useMoment();
  const journal = useResource('venture.journal.list', { limit: LIMIT });
  const entries = journal.data?.entries ?? [];

  return (
    <>
      {journal.error && <Failed error={journal.error} />}
      {journal.data && entries.length === 0 && <EmptyState title={t('money.journal.none')} />}
      {entries.length > 0 && (
        <ul className={s.list}>
          {entries.map((entry) => {
            const unknown = entry.state === 'outcome_unknown';
            return (
              <Row
                key={entry.id}
                id={entry.id}
                eyebrow={moment(entry.at)}
                title={t('money.journal.title', { action: entry.action, target: entry.target })}
                line={entry.receiptId ? <span className={s.value}><span>{entry.line}</span><Receipt id={entry.receiptId} /></span> : entry.line}
                actions={<span className={unknown ? `${s.state} ${s.wait}` : s.state}>{t(`money.journal.state.${entry.state}`)}</span>}
              >
                {unknown && <p className={s.check}>{t('money.journal.check')}</p>}
              </Row>
            );
          })}
        </ul>
      )}
    </>
  );
}
