/**
 * FR-07, after the file: the thin list "Proposed meanings (draft)", what the file seems to
 * mean, from learning-ext's builder (`proposals.ts`). Drafts only: nothing is accepted here,
 * FR-08 settles them. Column headers are the file's own text, shown as written.
 */

import { useEffect, useState } from 'react';
import { useT } from '../../app/text';
import type { PickedFile } from './BringFile';
import type { ProposalsOutcome } from './proposals.ts';
import { FailureLine, Note, Status } from './JourneyParts';
import s from './Journey.module.css';

const PACKS: ReadonlySet<string> = new Set(['ecommerce', 'services', 'saas', 'manufacturing', 'retail', 'distributor']);

/** `settle`: where the meanings are settled; the journey's next step by default, Books · Meanings from a place. */
export function ProposedMeanings({ file, propose, settle = 'FR-07.proposals.settle' }: { file: PickedFile; propose: (file: PickedFile) => Promise<ProposalsOutcome>; settle?: string }) {
  const t = useT();
  const [outcome, setOutcome] = useState<ProposalsOutcome | null>(null);
  useEffect(() => {
    let live = true;
    setOutcome(null);
    void propose(file).then(result => { if (live) setOutcome(result); });
    return () => { live = false; };
  }, [file, propose]);

  return (
    <section className={s.section} data-proposed-meanings={outcome === null ? 'reading' : outcome.kind}>
      <h2 className={s.sectionTitle}>{t('FR-07.proposals.title')}</h2>
      {outcome === null && <Status k="FR-07.proposals.reading" />}
      {outcome?.kind === 'sheets-only' && <Note k="FR-07.proposals.sheetsOnly" />}
      {outcome?.kind === 'failed' && <FailureLine failure={outcome.failure} notBuilt="FR-07.proposals.notBuilt" refused="FR-07.proposals.refused" />}
      {outcome?.kind === 'ready' && (() => {
        const { proposal } = outcome;
        const pack = PACKS.has(proposal.pack) ? t(`FR-07.proposals.pack.${proposal.pack}`) : proposal.pack;
        return (
          <>
            <p className={s.note}>{t('FR-07.proposals.lede')}</p>
            <p className={s.status}>{t('FR-07.proposals.looksLike', { pack, sure: t(`FR-07.proposals.sure.${proposal.packConfidence}`) })}</p>
            {proposal.columns.length === 0
              ? <Note k="FR-07.proposals.none" />
              : (
                <ul className={s.rows} data-proposal-rows="">
                  {proposal.columns.map((column, index) => (
                    <li key={`${column.header}-${index}`} className={s.row} data-proposal-column="">
                      <div className={s.rowLine}>
                        <span className={s.rowName}>{column.header}</span>
                        <span className={s.rowState}>{t('FR-07.proposals.draft')}</span>
                      </div>
                      <p className={s.note}>{t(column.existing ? 'FR-07.proposals.meansKnown' : 'FR-07.proposals.means', {
                        meaning: t(`FR-07.proposals.type.${column.type}`), sure: t(`FR-07.proposals.sure.${column.confidence}`),
                      })}</p>
                    </li>
                  ))}
                </ul>
              )}
            {proposal.skipped.length > 0 && (
              <p className={s.note}>{t('FR-07.proposals.skipped', { columns: proposal.skipped.map(item => item.header).join(', ') })}</p>
            )}
            <Note k={settle} />
          </>
        );
      })()}
    </section>
  );
}
