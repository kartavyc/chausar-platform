import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { AgentView, RetiredAgentView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { openSheet } from '../../shell/navigation';
import { AgentChat } from './AgentChat';
import { AgentNotes } from './AgentNotes';
import s from './Team.module.css';
import c from './AgentChat.module.css';
import r from './AgentRetire.module.css';

const never = () => false;
const OWNER = 'owner';


/**
 * The check before an agent retires (W6 6G2, D43), in the agent panel: what it holds (its steps, standing orders, notes
 * and messages), what is in flight, the routines that switch off, and who takes over (another agent or the owner),
 * with the engine's promise of what is kept. "Retire" sends the digest of exactly what the owner read
 * (venture.agents.retire); a check that changed since is refused in the engine's words and read again. The last AI agent
 * cannot retire: the engine says why, and there is no Retire button. Modelled on Clear quarantine (HealthLine).
 */
export function AgentRetire({ agent, onCancel, onRetired }: { agent: AgentView; onCancel: () => void; onRetired: (line: string) => void }) {
  const t = useT();
  const client = useEngine();
  const base = useId();
  const check = useResource('venture.agents.retire.check', { agent: agent.id }, { refreshOn: never });
  const [to, setTo] = useState<string>(OWNER);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const data = check.data;

  async function retire() {
    if (!data || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const done = await client.request('venture.agents.retire', { agent: agent.id, to, digest: data.digest });
      onRetired(done.line);
    } catch (error) {
      setProblem(t('team.retire.failed', { message: messageOf(error) }));
      check.reload();
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <p className={s.quiet}>{check.error ? t('team.retire.failed', { message: check.error.message }) : t('team.retire.loading')}</p>;
  }
  const choices = [...data.to, { id: OWNER, name: t('team.retire.toOwner') }];
  return (
    <section className={r.check} aria-labelledby={`${base}-title`} data-retire-check="">
      <h3 id={`${base}-title`} className={s.small}>{t('team.retire.title', { name: data.agent.name })}</h3>
      <section className={s.section} aria-labelledby={`${base}-holds`}>
        <h4 id={`${base}-holds`} className={s.small}>{t('team.retire.holds')}</h4>
        <ul className={r.list}>
          {data.holds.steps.length > 0 && <li>{t('team.retire.steps', { steps: data.holds.steps.join(', ') })}</li>}
          <li>{t('team.retire.counts', { instructions: data.holds.instructions, notes: data.holds.notes, messages: data.holds.messages })}</li>
        </ul>
      </section>
      <section className={s.section} aria-labelledby={`${base}-flight`}>
        <h4 id={`${base}-flight`} className={s.small}>{t('team.retire.flight')}</h4>
        {data.inFlight.length === 0
          ? <p className={s.quiet}>{t('team.retire.flightNone')}</p>
          : <ul className={r.list}>{data.inFlight.map((item) => <li key={item.id} data-content="">{item.line}</li>)}</ul>}
      </section>
      <section className={s.section} aria-labelledby={`${base}-routines`}>
        <h4 id={`${base}-routines`} className={s.small}>{t('team.retire.routines')}</h4>
        {data.routines.length === 0
          ? <p className={s.quiet}>{t('team.retire.routinesNone')}</p>
          : <ul className={r.list}>{data.routines.map((item) => <li key={item.id}><span data-content="">{item.name}</span>{' · '}{item.when}</li>)}</ul>}
      </section>
      {data.blocked ? <p className={c.problem} role="status">{data.blocked}</p> : (
        <fieldset className={r.choices}>
          <legend className={s.small}>{t('team.retire.to')}</legend>
          {choices.map((choice) => (
            <label key={choice.id} className={r.choice}>
              <input type="radio" name={`${base}-to`} value={choice.id} checked={to === choice.id} onChange={() => setTo(choice.id)} />
              <span>{choice.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className={r.kept}>{data.kept}</p>
      {problem && <p className={c.problem} role="alert">{problem}</p>}
      <div className={c.actions}>
        <Button size="sm" onClick={onCancel} disabled={busy}>{t('team.retire.cancel')}</Button>
        {!data.blocked && <Button size="sm" variant="primary" onClick={() => void retire()} disabled={busy}>{t('team.retire.confirm', { name: data.agent.name })}</Button>}
      </div>
    </section>
  );
}

/**
 * A retired agent in the agent panel (W6 6G2): the engine's shelf line, Bring back, then its chat history read only
 * (no box to write in) and its notes, where Forget and Undo still work but nothing new is added.
 */
export function RetiredPanel({ item, said, onChanged }: { item: RetiredAgentView; said: string | null; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(said);
  // The panel's views need an agent; a retired one has no state, posture, spend or steps of its own on the team now.
  const agent: AgentView = { id: item.id, name: item.name, role: item.role, now: '', posture: 'approve-each', spend: '', steps: [], ...(item.department ? { department: item.department } : {}) };

  async function bringBack() {
    if (busy) return;
    setBusy(true);
    try {
      setLine((await client.request('venture.agents.restore', { agent: item.id })).line);
    } catch (error) {
      setLine(t('team.shelf.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <div className={s.tabPanel} data-retired-panel="">
      <div className={r.retired}>
        <span className={r.grow}>{item.line}</span>
        <Button size="sm" variant="primary" onClick={() => void bringBack()} disabled={busy}>{t('team.shelf.back')}</Button>
      </div>
      {line && <p className={s.quiet} role="status">{line}</p>}
      <AgentChat agent={agent} peers={[]} playbook={undefined} onPlaybookChanged={() => undefined} />
      <AgentNotes agent={agent} readOnly />
    </div>
  );
}

/**
 * The Retired shelf under the departments (W6 6G2): each retired agent with the engine's line (who does its steps now),
 * its read-only chat, and Bring back (venture.agents.restore), which restores it as it was. Shown only when someone is
 * on it, so Team at rest reads as before.
 */
export function RetiredShelf({ retired, onChanged }: { retired: readonly RetiredAgentView[]; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const headId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);

  async function bringBack(item: RetiredAgentView) {
    if (busy) return;
    setBusy(item.id);
    setLine(null);
    try {
      setLine((await client.request('venture.agents.restore', { agent: item.id })).line);
    } catch (error) {
      setLine(t('team.shelf.failed', { message: messageOf(error) }));
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  return (
    <section className={s.section} aria-labelledby={headId} data-retired-shelf="">
      <h2 id={headId} className={s.small}>{t('team.shelf.title')}</h2>
      <ul className={r.shelf} aria-labelledby={headId}>
        {retired.map((item) => (
          <li key={item.id} className={r.retired} data-retired={item.id}>
            <span className={r.grow}><span className={r.name}>{item.name}</span>{' · '}{item.line}</span>
            <Button size="sm" variant="quiet" onClick={(event) => openSheet('agent', item.id, event.currentTarget, 'chat')}>{t('team.shelf.open')}</Button>
            <Button size="sm" onClick={() => void bringBack(item)} disabled={busy !== null} aria-label={t('team.shelf.backNamed', { name: item.name })}>{t('team.shelf.back')}</Button>
          </li>
        ))}
      </ul>
      {line && <p className={s.quiet} role="status">{line}</p>}
    </section>
  );
}
