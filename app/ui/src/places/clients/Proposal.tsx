/**
 * The sales proposal sheet (Ink v2 wave 5, package 5A2; catalogue P2, P3, P4), opened from a client's or a pipeline
 * person's sheet (`?sheet=proposal:client:<id>` or `proposal:person:<id>`): their newest proposal
 * (venture.salesProposal.get), or the form that drafts one (venture.salesProposal.draft) for one offer, as a paid pilot
 * when the owner asks. The proposal reads as the client will: What we heard, Roadmap, Investment, Next step, Open
 * questions; its words are quoted (`data-content`), and every amount under Investment is a Figure with its price
 * receipt. A proposal waits on Today, where the owner reads and approves it; only then does this sheet offer the
 * owner's own mail, WhatsApp or LinkedIn copy. Chausar never sends it. An ask wholly outside what the business does
 * drafts nothing and shows the engine's fixed reply to copy. Engine codes are worded here in both languages.
 */

import { useId, useState, type FormEvent } from 'react';
import { useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import { Figure } from '../../parts/Figure';
import { Segmented } from '../../parts/Segmented';
import { Sheet } from '../../parts/Sheet';
import { EngineError, type OutreachHandoff, type SalesProposalView, type VentureRunEvent } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { copyText, handoffText, performHandoff } from './handoff';
import s from './Proposal.module.css';

const refreshOn = (event: VentureRunEvent) => event.type === 'queue.changed';

/** The engine codes this sheet words itself (kit-sales.error.*); any other refusal shows the engine's own words. */
const WORDED: ReadonlySet<string> = new Set(['OFFER_UNPRICED', 'PILOT_UNPRICED', 'PILOT_NOT_OFFERED', 'PILOT_WINDOW', 'BLUEPRINT_NOT_ACCEPTED', 'APP_APPROVAL_REQUIRED', 'INVALID_AMOUNT', 'INVALID_SHARE']);

export function salesWords(error: unknown, t: T): string {
  if (error instanceof EngineError && WORDED.has(error.code)) return t(`kit-sales.error.${error.code}`);
  return error instanceof Error ? error.message : String(error);
}

/** Who a proposal sheet is for, from its id: `client:<id>` or `person:<id>`. */
function whoOf(id: string): { clientId: string } | { personId: string } | null {
  const at = id.indexOf(':');
  const kind = id.slice(0, at);
  const rest = id.slice(at + 1);
  if (!rest) return null;
  return kind === 'client' ? { clientId: rest } : kind === 'person' ? { personId: rest } : null;
}

export function ProposalSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const who = whoOf(id);
  const newest = useResource('venture.salesProposal.get', who ?? { id: 'none' }, { refreshOn, skip: !who });
  const [drafted, setDrafted] = useState<SalesProposalView | null>(null);
  const [drafting, setDrafting] = useState(false);
  const missing = newest.error?.code === 'PROPOSAL_NOT_FOUND';
  // A fresh draft shows at once; once Today changes it (approved), the engine's newest copy is read again.
  const shown = drafted && (!newest.data || newest.data.id !== drafted.id || drafted.id === null) ? drafted : newest.data ?? null;
  const title = shown?.to ? t('kit-sales.proposal.title', { name: shown.to }) : t('kit-sales.proposal.titlePlain');

  return (
    <Sheet label={t('kit-sales.proposal.sheet')} title={title} onClose={onClose} returnFocus={returnFocus}>
      <div className={s.body}>
        {newest.error && !missing && <p className={s.problem} role="alert">{t('kit-sales.proposal.failed', { message: salesWords(newest.error, t) })}</p>}
        {!shown && newest.loading && !drafted && <p className={s.note}>{t('sheet.loading')}</p>}
        {who && (drafting || (!shown && missing)) && (
          <DraftForm
            who={who} intro={!shown ? t('kit-sales.proposal.none') : null}
            onDrafted={(view) => { setDrafted(view); setDrafting(false); newest.reload(); }}
            onCancel={shown ? () => setDrafting(false) : undefined}
          />
        )}
        {shown && !drafting && <ProposalView view={shown} onAgain={() => setDrafting(true)} />}
      </div>
    </Sheet>
  );
}

function DraftForm({ who, intro, onDrafted, onCancel }: {
  who: { clientId: string } | { personId: string }; intro: string | null; onDrafted: (view: SalesProposalView) => void; onCancel?: (() => void) | undefined;
}) {
  const t = useT();
  const engine = useEngine();
  const pilotId = useId();
  const plan = useResource('venture.blueprint.get', {});
  const offers = plan.data?.blueprint.offers ?? [];
  const [offerId, setOfferId] = useState<string | null>(null);
  const [pilot, setPilot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = offerId ?? offers[0]?.id ?? null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      onDrafted(await engine.request('venture.salesProposal.draft', { ...who, offerId: chosen, ...(pilot ? { pilot: true } : {}) }));
    } catch (error) {
      setProblem(salesWords(error, t));
    } finally {
      setBusy(false);
    }
  }

  if (plan.data && offers.length === 0) return <p className={s.note}>{t('kit-sales.proposal.noOffers')}</p>;
  return (
    <form className={s.form} onSubmit={(event) => void submit(event)} noValidate>
      {intro && <p className={s.note}>{intro}</p>}
      {offers.length > 0 && chosen && (
        <Segmented
          mode="buttons" label={t('kit-sales.proposal.offer')} value={chosen}
          options={offers.map((offer) => ({ id: offer.id, label: offer.name.value }))} onChange={setOfferId}
        />
      )}
      <label className={s.check} htmlFor={pilotId}>
        <input id={pilotId} type="checkbox" checked={pilot} onChange={(event) => setPilot(event.currentTarget.checked)} aria-describedby={`${pilotId}-hint`} />
        <span>{t('kit-sales.proposal.pilot')}</span>
      </label>
      <p id={`${pilotId}-hint`} className={s.note}>{t('kit-sales.proposal.pilotHint')}</p>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.actions}>
        {onCancel && <Button onClick={onCancel}>{t('kit-sales.proposal.cancel')}</Button>}
        <Button variant="primary" type="submit" disabled={busy || !chosen}>{busy ? t('kit-sales.proposal.drafting') : t('kit-sales.proposal.draft')}</Button>
      </div>
    </form>
  );
}

function ProposalView({ view, onAgain }: { view: SalesProposalView; onAgain: () => void }) {
  const t = useT();
  const failed = view.checks.filter((check) => !check.passed);
  return (
    <>
      <div className={s.chips}>
        <Chip tone={view.status === 'approved' ? 'done' : view.status === 'waiting' ? 'wait' : 'neutral'}>{t(`kit-sales.proposal.status.${view.status}`)}</Chip>
        {view.pilot && <Chip tone="line">{t('kit-sales.proposal.pilotChip')}</Chip>}
        {view.id && <Chip tone="line">{t(view.author === 'model' ? 'kit-sales.proposal.byModel' : 'kit-sales.proposal.byChausar')}</Chip>}
      </div>
      <p className={s.note}>{view.line}</p>
      {view.exit && <Exit exit={view.exit} />}
      {view.sections.map((section) => (
        <section key={section.id} className={s.section} aria-label={t(`kit-sales.proposal.section.${section.id}`)}>
          <h3 className={s.heading}>{t(`kit-sales.proposal.section.${section.id}`)}</h3>
          {section.id === 'investment' ? (
            <ul className={s.money}>
              {view.investment.map((item) => (
                <li key={item.offerId} className={s.moneyRow}>
                  <span data-content="">{item.offerName}</span>
                  {item.kind === 'price'
                    ? <><Figure value={item.display} receiptId={item.receiptId} /><span>{item.per}</span></>
                    : <span data-content="">{item.words}</span>}
                </li>
              ))}
            </ul>
          ) : section.lines.length ? (
            <ul className={s.lines} data-content="">{section.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
          ) : (
            <p className={s.note}>{t('kit-sales.proposal.noQuestions')}</p>
          )}
        </section>
      ))}
      {failed.length > 0 && (
        <div className={s.section}>
          <p className={s.problem}>{t('kit-sales.proposal.checksFailed')}</p>
          <ul className={s.lines}>{failed.map((check) => <li key={check.id}>{check.detail}</li>)}</ul>
        </div>
      )}
      {view.status === 'waiting' && failed.length === 0 && <p className={s.note}>{t('kit-sales.proposal.waiting')} <a href="#/today">{t('kit-sales.proposal.openToday')}</a></p>}
      {view.handoffs && <Handoffs handoffs={view.handoffs} />}
      <div className={s.actions}><Button onClick={onAgain}>{t('kit-sales.proposal.again')}</Button></div>
    </>
  );
}

function Exit({ exit }: { exit: NonNullable<SalesProposalView['exit']> }) {
  const t = useT();
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className={s.section}>
      <h3 className={s.heading}>{t(exit.verdict === 'outside' ? 'kit-sales.proposal.exit.outside' : 'kit-sales.proposal.exit.partly')}</h3>
      <blockquote className={s.reply} data-content="">{exit.reply}</blockquote>
      <div className={s.actions}>
        <Button onClick={() => void copyText(exit.reply).then((done) => setSaid(done ? t('kit-sales.proposal.copied') : null))}>{t('kit-sales.proposal.exit.copy')}</Button>
      </div>
      {said && <p className={s.note} role="status">{said}</p>}
    </div>
  );
}

/** The owner's own apps, once approved: the first is the one primary; each says what it does in the engine's words. */
function Handoffs({ handoffs }: { handoffs: OutreachHandoff[] }) {
  const t = useT();
  const [said, setSaid] = useState<{ line: string; copy: string | null } | null>(null);
  async function go(handoff: OutreachHandoff) {
    const done = await performHandoff(handoff, null);
    setSaid({ line: done === 'copied' ? t('kit-sales.proposal.copied') : handoff.line, copy: done === 'copy-failed' ? handoffText(handoff) : null });
  }
  return (
    <div className={s.section}>
      <h3 className={s.heading}>{t('kit-sales.proposal.send')}</h3>
      <p className={s.note}>{t('kit-sales.proposal.sendLine')}</p>
      <div className={s.actions}>
        {handoffs.map((handoff, i) => (
          <Button key={handoff.action} variant={i === 0 ? 'primary' : 'secondary'} onClick={() => void go(handoff)}>{t(`kit-sales.proposal.handoff.${handoff.action}`)}</Button>
        ))}
      </div>
      {said && <p className={s.note} role="status">{said.line}</p>}
      {said?.copy && (
        <>
          <p className={s.note}>{t('kit-sales.proposal.copyHand')}</p>
          <pre className={s.copy} data-content="">{said.copy}</pre>
        </>
      )}
    </div>
  );
}
