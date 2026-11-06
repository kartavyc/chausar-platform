/**
 * The notes sheet after a call (`?sheet=call-notes:<event id>`; the engine's 4E3 venture.meeting.digest): the owner
 * pastes or types their notes, and the engine reads them for the people named, intros promised by either side and next
 * steps. Each comes back as a drafted proposal with its line (a day only when the notes write it; else the owner picks
 * the day when they approve it on Today); "Raise to Today" puts one on Today for approval. Nothing changes until then.
 * The notes go to the owner's own AI only after the chat consent, shown here in the engine's words when it is needed.
 * The notes stay in this sheet only; Chausar keeps what it drafted, not the notes' text.
 */

import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import type { ChatConsentView, ProposalView } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { codeOf, messageOf } from '../clients/network';
import s from './OutreachRows.module.css';

type Digest = Awaited<ReturnType<typeof digestOf>>;
const digestOf = async (engine: ReturnType<typeof useEngine>, eventId: string, notes: string) =>
  engine.request('venture.meeting.digest', { ...(eventId === 'none' ? {} : { eventId }), notes });

export function MeetingNotes({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [digest, setDigest] = useState<Digest | null>(null);
  // The chat consent view while it is needed: its own words shown before Agree, and its digest sent with Agree.
  const [consent, setConsent] = useState<ChatConsentView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function read(event?: FormEvent) {
    event?.preventDefault();
    if (!notes.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      setDigest(await digestOf(engine, id, notes.trim()));
      setConsent(null);
    } catch (error) {
      const code = codeOf(error);
      if (code === 'CHAT_CONSENT_REQUIRED' || code === 'CHAT_CONSENT_STALE') {
        const needed = await engine.request('venture.network.people', { limit: 0 }).then((view) => view.consent, () => null);
        if (needed?.digest) setConsent(needed); else setProblem(messageOf(error));
      } else setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  /** The consent is one per business, shared by agent chat, Chats and the network; its view carries it while needed. */
  async function agree(shown: ChatConsentView) {
    try {
      await engine.request('venture.chats.consent', { digest: shown.digest! });
      await read();
    } catch (error) {
      setProblem(messageOf(error));
    }
  }

  return (
    <Sheet label={t('today.reply.notes.sheet')} title={t('today.reply.notes.title')} line={t('today.reply.notes.line')} onClose={onClose} returnFocus={returnFocus}>
      {!digest ? (
        <form className={s.form} onSubmit={(event) => void read(event)}>
          <Field multiline label={t('today.reply.notes.field')} hint={t('today.reply.notes.hint')} value={notes} rows={8} maxLength={20000} onChange={(event) => setNotes(event.currentTarget.value)} />
          <div className={s.actions}><Button type="submit" disabled={busy || !notes.trim()}>{busy ? t('today.reply.notes.reading') : t('today.reply.notes.read')}</Button></div>
          {consent && (
            <div className={s.section}>
              <p className={s.said} data-consent="">{consent.text}</p>
              <div className={s.actions}><Button size="sm" onClick={() => void agree(consent)}>{t('today.reply.notes.agree')}</Button></div>
            </div>
          )}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
        </form>
      ) : <Drafted digest={digest} />}
    </Sheet>
  );
}

function Drafted({ digest }: { digest: Digest }) {
  const t = useT();
  return (
    <>
      <p className={s.said} role="status">{digest.line}</p>
      {digest.people.length > 0 && (
        <section className={s.section} aria-label={t('today.reply.notes.people')}>
          <h3 className={s.heading}>{t('today.reply.notes.people')}</h3>
          <ul className={s.people}>{digest.people.map((person, index) => <li key={`${person.name}-${index}`}><Chip tone="line">{person.name}</Chip></li>)}</ul>
        </section>
      )}
      {digest.steps.length > 0 && (
        <section className={s.section} aria-label={t('today.reply.notes.steps')}>
          <h3 className={s.heading}>{t('today.reply.notes.steps')}</h3>
          <ul className={s.steps}>
            {digest.steps.map((step, index) => (
              <Step key={step.proposalId ?? index} step={step} proposal={digest.proposals.find((one) => one.id === step.proposalId) ?? null} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Step({ step, proposal }: { step: Digest['steps'][number]; proposal: ProposalView | null }) {
  const t = useT();
  const engine = useEngine();
  const [said, setSaid] = useState<{ line: string; problem: boolean } | null>(null);

  async function raise() {
    if (!proposal) return;
    try {
      const result = await engine.request('venture.proposals.raise', { id: proposal.id });
      setSaid({ line: result.line, problem: false });
    } catch (error) {
      setSaid({ line: messageOf(error), problem: true });
    }
  }

  return (
    <li className={s.step} data-step={step.proposalId ?? ''}>
      <p className={s.stepText}>{step.text}</p>
      {step.person && <p className={s.quiet}>{step.person}</p>}
      <p className={s.quiet}>{step.line}</p>
      {proposal && proposal.status === 'drafted' && !said && <div className={s.actions}><Button size="sm" onClick={() => void raise()}>{t('today.reply.notes.raise')}</Button></div>}
      {said && <p className={said.problem ? s.problem : s.said} role="status">{said.line}</p>}
    </li>
  );
}
