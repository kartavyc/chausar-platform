import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import {
  EngineError, type AgentMessageView, type AgentProposalView, type AgentRunItem, type AgentThreadItem, type AgentView, type ChatConsentView,
  type StandingPlaybookView,
} from '../../engine/types';
import { openSheet } from '../../shell/navigation';
import { useClock } from '../../shell/clock';
import type { DeptId } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { ChatThread, type ThreadEntry } from '../../parts/ChatThread';
import { Composer } from '../../parts/Composer';
import { DiffCard } from '../../parts/DiffCard';
import { Figure } from '../../parts/Figure';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { Steps } from '../../parts/Steps';
import { prefillOrder } from '../work/prefill';
import { ChatConsent } from './ChatConsent';
import { cardLines, chatRefresh, itemId, partsText } from './chat';
import c from './AgentChat.module.css';

const CONSENT_CODES = new Set(['CHAT_CONSENT_REQUIRED', 'CHAT_CONSENT_STALE']);
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface AgentChatProps {
  agent: AgentView;
  dept?: DeptId | undefined;
  /** The agents with a chat, in the engine's order, for the previous and next buttons. */
  peers: readonly AgentView[];
  /** The version in use (venture.agents.orders.list, read): an accepted change that made it can be undone from its card. */
  playbook: StandingPlaybookView | undefined;
  /** The version in use changed (a change accepted or undone). */
  onPlaybookChanged: () => void;
  /** W4 4J22b: words a skill's "Try this" put in the box, unsent until the owner presses Send; a new key opens it afresh. */
  initial?: string | undefined;
  initialKey?: number | undefined;
  /** The words are in the box: the panel lets them go, so the box never fills by itself again. */
  onInitialUsed?: (() => void) | undefined;
}

type Asking = { view: ChatConsentView; resolve: () => void; reject: (error: Error) => void };

/**
 * The Chat tab (W4 4B3; spec 5.2; D-TeamChat `.cp-body`, `.cp-comp`): the owner reads every run of this agent as a
 * conversation and talks to it. The thread is the engine's, in time order: the owner's and the agent's messages, each
 * run folded to one row that opens its steps (with a "Recalled" chip for the notes it read), and the changes the agent
 * drafted from the owner's words: a "from now on" change as a DiffCard (Accept is its one primary; a stale one says
 * why in the engine's words) and a note to keep as a small card that quotes the words. The question the agent's run
 * waits on stays pinned above the thread, never only in the scroll. A first message waits for the chat consent when
 * the owner's own AI would read it. A suggestion to start work opens New order filled in; nothing is created here.
 */
export function AgentChat({ agent, dept, peers, playbook, onPlaybookChanged, initial, initialKey, onInitialUsed }: AgentChatProps) {
  const t = useT();
  const client = useEngine();
  const clock = useClock();
  const waitingId = useId();
  const box = useRef<HTMLDivElement>(null);
  const thread = useResource('venture.agents.thread.list', { agent: agent.id }, { refreshOn: chatRefresh });
  // W4 4J22b: a skill's question is in the box once it is drawn; the panel then lets it go.
  useEffect(() => { if (initial) onInitialUsed?.(); }, [initial, initialKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [older, setOlder] = useState<AgentThreadItem[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [answering, setAnswering] = useState(false);
  /**
   * Decisions the engine has taken, with the version in use when they were taken, until the thread and the version are
   * read again; and the changes the owner undid from their card here.
   */
  const [decided, setDecided] = useState<Record<string, { status: 'accepted' | 'rejected'; seen: number | undefined }>>({});
  const [undone, setUndone] = useState<Record<string, true>>({});

  const data = thread.data;
  const items = [...older, ...(data?.items ?? [])].filter((item, at, all) => all.findIndex((other) => itemId(other) === itemId(item)) === at);
  const more = olderMore ?? data?.more ?? false;

  function askConsent(view: ChatConsentView): Promise<void> {
    return new Promise((resolve, reject) => setAsking({ view, resolve, reject }));
  }

  async function send(text: string) {
    setLine(null);
    const consent = data?.consent;
    if (consent && (consent.state === 'needed' || consent.state === 'stale')) await askConsent(consent);
    let result;
    try {
      result = await client.request('venture.agents.thread.send', { agent: agent.id, text });
    } catch (error) {
      if (!(error instanceof EngineError) || !CONSENT_CODES.has(error.code)) throw error;
      // The AI connection changed after the thread was read: read what chats send now, then ask once more.
      const fresh = await client.request('venture.agents.thread.list', { agent: agent.id });
      await askConsent(fresh.consent);
      result = await client.request('venture.agents.thread.send', { agent: agent.id, text });
    }
    setAnswering(false);
    setLine(result.line);
    thread.reload();
  }

  async function agree() {
    if (!asking) return;
    try {
      await client.request('venture.chats.consent', { digest: asking.view.digest ?? '' });
    } catch (error) {
      // What chats send changed since the owner read it: read it again, show the new words, and say why.
      if (error instanceof EngineError && error.code === 'APPROVAL_STALE') {
        const fresh = await client.request('venture.agents.thread.list', { agent: agent.id });
        setAsking((was) => (was ? { ...was, view: fresh.consent } : was));
      }
      throw error;
    }
    asking.resolve();
    setAsking(null);
    thread.reload();
  }

  function decline() {
    asking?.reject(new Error(t('team.chat.consent.declined')));
    setAsking(null);
  }

  async function loadOlder() {
    const first = items[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await client.request('venture.agents.thread.list', { agent: agent.id, before: itemId(first) });
      setOlder((was) => [...page.items, ...was]);
      setOlderMore(page.more);
    } catch (error) {
      setLine(t('team.chat.failed', { message: messageOf(error) }));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function decide(proposal: AgentProposalView, decision: 'accept' | 'reject') {
    try {
      await client.request('venture.agents.proposal.decide', { id: proposal.id, digest: proposal.digest, decision });
      setDecided((was) => ({ ...was, [proposal.id]: { status: decision === 'accept' ? 'accepted' : 'rejected', seen: playbook?.version } }));
      if (proposal.kind !== 'note' && decision === 'accept') onPlaybookChanged();
    } finally {
      thread.reload();
    }
  }

  /** Undo from an accepted change's card: the card says it was undone and offers Undo no more. */
  async function undo(proposalId: string) {
    if (!playbook) return;
    const result = await client.request('venture.agents.version.undo', { agent: agent.id, digest: playbook.hash });
    setDecided(({ [proposalId]: _gone, ...rest }) => rest);
    setUndone((was) => ({ ...was, [proposalId]: true }));
    setLine(result.line);
    onPlaybookChanged();
    thread.reload();
  }

  function answer() {
    setAnswering(true);
    requestAnimationFrame(() => box.current?.querySelector('textarea')?.focus());
  }

  const entriesOf = (list: readonly AgentThreadItem[]) => list.flatMap((item): ThreadEntry[] => {
    if (item.type === 'message') return messageEntries(item.message);
    if (item.type === 'run') return runEntries(item.run);
    return [{ kind: 'card', id: item.proposal.id, at: item.proposal.at, node: renderProposal(proposal(item.proposal)) }];
  });
  // Earlier pages sit in the part of the log that is not read out; the page the thread read now is announced as it grows.
  const recentIds = new Set((data?.items ?? []).map(itemId));
  const olderEntries = entriesOf(items.filter((item) => !recentIds.has(itemId(item))));
  const entries = entriesOf(items.filter((item) => recentIds.has(itemId(item))));

  /** A proposal as decided here, until the thread is read again. */
  function proposal(view: AgentProposalView): AgentProposalView {
    const local = decided[view.id];
    return local && view.status === 'drafted' ? { ...view, status: local.status } : view;
  }

  function messageEntries(message: AgentMessageView): ThreadEntry[] {
    if (message.from === 'owner') return [{ kind: 'owner', id: message.id, at: message.at, text: partsText(message.parts) }];
    const plain = message.parts.every((part) => part.kind === 'text');
    const said: ThreadEntry = plain
      ? { kind: 'agent', id: message.id, at: message.at, text: partsText(message.parts) }
      : { kind: 'agent', id: message.id, at: message.at, text: partsText(message.parts), body: <Parts message={message} /> };
    // A request on the floor waits on Today: the reply opens its card there (W4 4B3).
    if (message.proposalId) {
      return [said, {
        kind: 'card', id: `${message.id}-today`, at: message.at,
        node: <a className={c.onToday} href={`#/today?row=${encodeURIComponent(`proposal:${message.proposalId}`)}`}>{t('team.chat.today')}</a>,
      }];
    }
    const suggestion = message.suggestion;
    if (!suggestion) return [said];
    return [said, {
      kind: 'card', id: `${message.id}-order`, at: message.at,
      node: (
        <Button onClick={(event) => { prefillOrder({ offerId: suggestion.offerId, request: suggestion.request }); openSheet('new-order', 'new', event.currentTarget); }}>
          {t('team.chat.order')}
        </Button>
      ),
    }];
  }

  function runEntries(run: AgentRunItem): ThreadEntry[] {
    const fold: ThreadEntry = { kind: 'run', id: `run-${run.runId}`, at: run.at, title: run.purpose, state: run.state, done: run.done, total: run.total, steps: <Steps steps={run.steps} /> };
    if (run.recalled.length === 0) return [fold];
    return [fold, { kind: 'card', id: `run-${run.runId}-recalled`, at: run.at, node: <Recalled run={run} /> }];
  }

  /**
   * A change the agent drafted. A "from now on" change is a DiffCard while it waits, is stale or was turned down, and
   * once accepted only while its version is the one in use (its Undo goes back from it), or until the version is read
   * again just after the owner accepted it here; undone from its card, it says so. An older accepted change, a note and
   * an import are a small card.
   */
  function renderProposal(view: AgentProposalView): ReactNode {
    const local = decided[view.id];
    const inUse = view.kind === 'instruction' && playbook !== undefined && playbook.origin === 'owner' && view.toVersion === playbook.version;
    const justAccepted = local?.status === 'accepted' && local.seen === playbook?.version;
    if (view.kind === 'instruction' && undone[view.id]) {
      return (
        <DiffCard
          agent={agent.name} dept={dept} appliesTo={view.appliesTo ?? ''} lines={cardLines(view.diff)} fromVersion={view.fromVersion ?? ''}
          toVersion={view.toVersion ?? ''} decided="undone" onAccept={() => decide(view, 'accept')} onReject={() => decide(view, 'reject')} onUndo={() => undo(view.id)}
        />
      );
    }
    if (view.kind === 'instruction' && (view.status !== 'accepted' || inUse || justAccepted)) {
      return (
        <DiffCard
          agent={agent.name}
          dept={dept}
          appliesTo={view.appliesTo ?? ''}
          lines={cardLines(view.diff)}
          fromVersion={view.fromVersion ?? ''}
          toVersion={view.toVersion ?? ''}
          stale={view.status === 'stale'}
          staleLine={view.line ?? undefined}
          decided={view.status === 'accepted' ? 'accepted' : view.status === 'rejected' ? 'rejected' : undefined}
          onAccept={() => decide(view, 'accept')}
          onReject={() => decide(view, 'reject')}
          onUndo={() => undo(view.id)}
        />
      );
    }
    return <ProposalCard proposal={view} agentName={agent.name} onDecide={(decision) => decide(view, decision)} />;
  }

  const index = peers.findIndex((peer) => peer.id === agent.id);
  const previous = index > 0 ? peers[index - 1] : undefined;
  const next = index >= 0 && index < peers.length - 1 ? peers[index + 1] : undefined;
  const waiting = data?.waiting ?? null;

  return (
    <div className={c.chat}>
      {peers.length > 1 && index >= 0 && (
        <nav className={c.peers} aria-label={t('team.chat.peers')}>
          <button
            type="button" className={c.peer} aria-label={previous ? t('team.chat.previous', { name: previous.name }) : t('team.chat.first')} disabled={!previous}
            onClick={(event) => previous && openSheet('agent', previous.id, event.currentTarget, 'chat')}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span className={c.position}>{t('team.chat.position', { at: index + 1, count: peers.length })}</span>
          <button
            type="button" className={c.peer} aria-label={next ? t('team.chat.next', { name: next.name }) : t('team.chat.last')} disabled={!next}
            onClick={(event) => next && openSheet('agent', next.id, event.currentTarget, 'chat')}
          >
            <span aria-hidden="true">›</span>
          </button>
        </nav>
      )}
      {waiting && (
        <section className={c.waiting} aria-labelledby={waitingId} data-waiting="">
          <h3 id={waitingId} className={c.waitingHead}>{t('team.chat.waiting')}</h3>
          <p className={c.question} data-content="">{waiting.question}</p>
          <Button size="sm" onClick={answer}>{t('team.chat.answer')}</Button>
        </section>
      )}
      {thread.error && !data && <p className={c.problem}>{t('team.chat.failed', { message: thread.error.message })}</p>}
      {!data && !thread.error && <p className={c.quiet}>{t('team.chat.loading')}</p>}
      {data && (
        <>
          {more && (
            <button type="button" className={c.earlier} onClick={() => void loadOlder()} disabled={loadingOlder}>{t('team.chat.earlier')}</button>
          )}
          <ChatThread agent={{ name: agent.name, dept }} older={olderEntries} entries={entries} now={clock()} className={c.thread} />
        </>
      )}
      {line && <p className={c.line} role="status">{line}</p>}
      <div ref={box} className={c.compose}>
        {asking && <ChatConsent view={asking.view} onAgree={agree} onCancel={decline} />}
        <Composer
          key={initialKey ?? 0}
          initial={initial || undefined}
          label={answering ? t('team.chat.answerLabel', { name: agent.name }) : t('team.chat.label', { name: agent.name })}
          onSend={send}
          suggestions={[t('team.chat.suggest.ask'), t('team.chat.suggest.standing'), t('team.chat.suggest.note')]}
          hint={t('team.chat.hint', { name: agent.name })}
        />
      </div>
    </div>
  );
}

/** A message from its typed parts: the agent's words, a figure with its receipt, and a model's number labelled as one. */
function Parts({ message }: { message: AgentMessageView }) {
  const out: ReactNode[] = [];
  message.parts.forEach((part, at) => {
    if (at > 0) out.push(' ');
    if (part.kind === 'text') out.push(<span key={at} data-content="">{part.text}</span>);
    else if (part.kind === 'figure') out.push(<Figure key={at} value={part.display} receiptId={part.receiptId} />);
    else out.push(<ModelEstimate key={at} value={part.text} />);
  });
  return <>{out}</>;
}

/** The notes a run read (4B2), behind a quiet chip: "Recalled 2 notes" opens the list; a note forgotten since says so. */
function Recalled({ run }: { run: AgentRunItem }) {
  const t = useT();
  const listId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={c.recalled}>
      <button type="button" className={c.chip} aria-expanded={open} aria-controls={listId} onClick={() => setOpen((was) => !was)}>
        {t('team.chat.recalled', { count: run.recalled.length })}
      </button>
      {open && (
        <ul id={listId} className={c.recalledList} aria-label={t('team.chat.recalledList', { title: run.purpose })}>
          {run.recalled.map((note) => (
            <li key={note.id} className={note.forgotten ? c.forgotten : undefined} data-content={note.forgotten ? undefined : ''}>{note.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A note to keep, quoting the owner's words (4B2), an agent file to import (4J17), or a change accepted earlier: the
 * engine's title (a note's in the screen's words: "Save this note?" while it waits, "Note for Editor" once decided), the
 * quoted words, the note as it would be saved and where it reaches, then Accept (the one primary) and Reject while it waits. A decision is sent once; a failure says why.
 */
function ProposalCard({ proposal, agentName, onDecide }: { proposal: AgentProposalView; agentName: string; onDecide: (decision: 'accept' | 'reject') => Promise<void> }) {
  const t = useT();
  const titleId = useId();
  const outcome = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const note = proposal.kind === 'note';

  async function decide(decision: 'accept' | 'reject') {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onDecide(decision);
      requestAnimationFrame(() => outcome.current?.focus());
    } catch (error) {
      setProblem(t('team.chat.decideFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  const outcomeLine = proposal.status === 'accepted'
    ? note ? t('team.chat.note.saved', { name: agentName }) : proposal.kind === 'instruction' ? t('team.chat.acceptedEarlier', { version: proposal.toVersion ?? '' }) : t('team.chat.accepted')
    : proposal.status === 'rejected' ? t(note ? 'team.chat.note.rejected' : 'team.chat.rejected') : null;
  // 4Z2: a note's heading is worded from its status, so a kept note no longer asks "Save this note?" (in Hindi too).
  const title = !note ? proposal.title : proposal.status === 'drafted' || proposal.status === 'stale' ? t('team.chat.note.ask') : t('team.chat.note.title', { name: agentName });
  return (
    <article className={c.prop} aria-labelledby={titleId} data-card="" data-proposal={proposal.kind} data-status={proposal.status}>
      <h3 id={titleId} className={c.propTitle}>{title}</h3>
      {proposal.line && <p className={c.quote} data-content="">{proposal.line}</p>}
      {proposal.note && proposal.note.text && <p className={c.noteText} data-content="">{proposal.note.text}</p>}
      {proposal.diff.length > 0 && (
        <ul className={c.lines} aria-label={t('diff.lines')}>
          {proposal.diff.map((line, at) => (
            <li key={at} data-line={line.op} data-content="">
              {line.op !== 'same' && <span className={c.lineWord}>{t(line.op === 'add' ? 'diff.added' : 'diff.removed')} </span>}
              {line.text}
            </li>
          ))}
        </ul>
      )}
      {proposal.appliesTo && <p className={c.applies}>{proposal.appliesTo}</p>}
      {proposal.status === 'drafted' && (
        <div className={c.actions}>
          {/* The engine's reply says nothing is saved until the owner accepts: the note's buttons use those words. */}
          <Button size="sm" onClick={() => void decide('reject')} disabled={busy}>{t('diff.reject')}</Button>
          <Button size="sm" variant="primary" onClick={() => void decide('accept')} disabled={busy}>{t('diff.accept')}</Button>
        </div>
      )}
      {outcomeLine && <p ref={outcome} className={c.outcome} role="status" tabIndex={-1}>{outcomeLine}</p>}
      {problem && <p className={c.problem} role="alert">{problem}</p>}
    </article>
  );
}
