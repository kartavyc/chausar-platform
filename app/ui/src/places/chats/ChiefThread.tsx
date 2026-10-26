/**
 * One chat with Chausar as chief of staff (D-Chats `.cv-head`, `.cv-body`, `.cv-comp`; spec 5.4): the head with the
 * mark, the chat's title (the owner's first question) and Pin; the thread; the composer with suggestions that fill it
 * and never send, and the footer line. The chief's answer is the engine's typed parts: words as it wrote them, each
 * figure through Figure with the receipt its tool returned, and any number the AI wrote with the "model estimate"
 * label; then the calculator's worked table when the answer carries one, the engine's lines for what it left out
 * (counts by code are plain words here too), where a message to an agent went, and the plan card.
 *
 * Sending asks the engine (venture.chief.thread.send). The first message waits for the chat consent: when the engine
 * refuses it, the consent is read once from the thread list (venture.chief.threads carries the one consent per
 * business, needed or stale, with its text and digest) and shown with the message that waits; Agree and send agrees by
 * exactly that digest, never one read later, and sends. No agent is needed for it. If the engine says the words changed
 * meanwhile (APPROVAL_STALE), it says so and shows the consent as it stands now, to agree again. A key or an id
 * number is refused in the engine's words and the box is emptied, so it is never sent again by accident; any other
 * refusal leaves the words in the box with the engine's reason.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLanguage, useT, type Language } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError, type ChatPart, type ChiefCounted, type ChiefMessageView, type ChiefThreadSummary, type VentureRunEvent } from '../../engine/types';
import { navigate } from '../../shell/navigation';
import { ChausarAvatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { ChatThread, type ThreadEntry } from '../../parts/ChatThread';
import { Composer } from '../../parts/Composer';
import { cx } from '../../parts/cx';
import { Figure } from '../../parts/Figure';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { DEPT_OF } from '../team/departments';
import { PlanCard, type AgentLookup } from './PlanCard';
import s from './Chats.module.css';

/** The thread reads again when Chausar answers anywhere, and when a proposal's card moves on Today. */
const THREAD_EVENTS = (event: VentureRunEvent) => event.type === 'chief.message' || event.type === 'queue.changed' || event.type === 'proposal.created';
const SUGGESTIONS = ['chats.suggest.invoiced', 'chats.suggest.waiting', 'chats.suggest.spend'] as const;
const LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN' };

const codeOf = (error: unknown) => (error instanceof EngineError ? error.code : null);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface ChiefThreadProps {
  /** The chat to show; left out, a new chat. */
  threadId: string | undefined;
  /** Words handed over from the header box, Ctrl K, Today or Start, each with its own count: they go in the box, unsent. */
  ask: { words: string; n: number } | null;
  /** The list reads again (a chat was read, or a new one was made). */
  onListChanged: () => void;
  /** A phone shows the way back to the list. */
  phone: boolean;
}

export function ChiefThread({ threadId, ask, onListChanged, phone }: ChiefThreadProps) {
  const t = useT();
  const engine = useEngine();
  const titleId = useId();
  const area = useRef<HTMLDivElement>(null);
  const view = useResource('venture.chief.thread.list', { threadId: threadId ?? '' }, { skip: !threadId, refreshOn: THREAD_EVENTS });
  const team = useResource('venture.team.list', {}, { refreshOn: () => false });
  /** What this pane sent before the engine's thread read lands (a new chat's first exchange). */
  const [sent, setSent] = useState<{ thread: ChiefThreadSummary; messages: ChiefMessageView[] } | null>(null);
  const [box, setBox] = useState<{ words: string; n: number }>({ words: '', n: 0 });
  /** The consent as it was read at the refusal: its words and the digest Agree sends, and the message that waits. */
  const [consent, setConsent] = useState<{ stale: boolean; text: string; digest: string | null; words: string; problem: string | null; busy: boolean } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);

  // Words handed over arrive in the box, unsent, with the cursor in it.
  useEffect(() => {
    if (ask) setBox((was) => ({ words: ask.words, n: was.n + 1 }));
  }, [ask]);
  useEffect(() => {
    if (box.n > 0) area.current?.querySelector<HTMLTextAreaElement>('form textarea')?.focus();
  }, [box.n]);

  // Reading a chat marks its answers read: the list's unread dots follow.
  const loadedId = view.data?.thread.id;
  const listChanged = useRef(onListChanged);
  listChanged.current = onListChanged;
  useEffect(() => {
    if (!loadedId) return;
    listChanged.current();
    // A chat opens at its newest message, once its answers (tables, plans) and the fonts have their height.
    let live = true;
    const toEnd = () => {
      const log = live ? area.current?.querySelector<HTMLElement>('[role="log"]') : null;
      if (log) log.scrollTop = log.scrollHeight;
    };
    const frame = requestAnimationFrame(toEnd);
    void document.fonts?.ready.then(toEnd);
    return () => { live = false; cancelAnimationFrame(frame); };
  }, [loadedId]);

  const shown = view.data && view.data.thread.id === threadId ? view.data : null;
  const fallback = sent && sent.thread.id === threadId ? sent : null;
  const thread = shown?.thread ?? fallback?.thread ?? null;
  const messages = shown?.messages ?? fallback?.messages ?? [];

  const agentOf: AgentLookup = (id) => {
    const agent = team.data?.agents.find((item) => item.id === id);
    return agent ? { name: agent.name, dept: agent.department ? DEPT_OF[agent.department] : undefined } : undefined;
  };

  async function send(words: string): Promise<void> {
    setRefusal(null);
    try {
      const result = await engine.request('venture.chief.thread.send', threadId ? { threadId, text: words } : { text: words });
      setSent({ thread: result.thread, messages: [...(threadId ? messages : []), ...result.added] });
      if (result.thread.id !== threadId) navigate({ place: 'chats', query: { thread: result.thread.id } });
      onListChanged();
    } catch (error) {
      const code = codeOf(error);
      if (code === 'CHAT_CONSENT_REQUIRED' || code === 'CHAT_CONSENT_STALE') { await askConsent(words, code === 'CHAT_CONSENT_STALE', messageOf(error), null); return; }
      if (code === 'CHAT_KEY_REFUSED') { setRefusal(messageOf(error)); return; }
      throw new Error(messageOf(error));
    }
  }

  /**
   * Reads the consent once, as the thread list carries it, and shows it: its words and the digest Agree will send.
   * Where the list cannot be read, the refusal's own words show and Agree says why it cannot agree yet.
   */
  async function askConsent(words: string, stale: boolean, refusedWith: string, problem: string | null) {
    let text = refusedWith;
    let digest: string | null = null;
    try {
      const { consent: now } = await engine.request('venture.chief.threads', {});
      if (now.text) text = now.text;
      digest = now.digest;
      stale = now.state === 'stale' || (now.state !== 'needed' && stale);
    } catch {
      // The refusal's words stay; without the digest there is nothing to agree to yet.
    }
    setConsent({ stale, text, digest, words, problem, busy: false });
  }

  /** Agrees by the digest of the words on screen, then sends the words that waited. */
  async function agree() {
    if (!consent) return;
    const words = consent.words;
    if (!consent.digest) { setConsent({ ...consent, problem: t('chats.consent.unread') }); return; }
    setConsent({ ...consent, busy: true, problem: null });
    try {
      await engine.request('venture.chats.consent', { digest: consent.digest });
    } catch (error) {
      // The words changed since they were read: say so, and show the consent as it stands now.
      if (codeOf(error) === 'APPROVAL_STALE') { await askConsent(words, consent.stale, consent.text, messageOf(error)); return; }
      setConsent({ ...consent, busy: false, problem: t('chats.consent.failed', { message: messageOf(error) }) });
      return;
    }
    setConsent(null);
    try {
      await send(words);
    } catch (error) {
      setBox((was) => ({ words, n: was.n + 1 }));
      setRefusal(messageOf(error));
    }
  }

  function notNow() {
    if (!consent) return;
    setBox((was) => ({ words: consent.words, n: was.n + 1 }));
    setConsent(null);
  }

  async function pin() {
    if (!thread) return;
    setPinning(true);
    try {
      await engine.request('venture.chief.thread.pin', { threadId: thread.id, pinned: !thread.pinned });
      view.reload();
      onListChanged();
    } catch (error) {
      setRefusal(messageOf(error));
    } finally {
      setPinning(false);
    }
  }

  const entries: ThreadEntry[] = messages.map((message): ThreadEntry => (message.from === 'owner'
    ? { kind: 'owner', id: message.id, at: message.at, text: plainOf(message.parts) }
    : { kind: 'card', id: message.id, at: message.at, node: <ChiefAnswer message={message} agentOf={agentOf} onChanged={view.reload} /> }));

  return (
    <section ref={area} className={s.pane} aria-labelledby={titleId}>
      <header className={s.paneHead}>
        {phone && <a className={s.back} href="#/chats">{t('chats.thread.back')}</a>}
        <ChausarAvatar size={40} />
        <div className={s.paneText}>
          <h2 id={titleId} className={s.paneTitle}>{thread ? <span data-content="">{thread.title}</span> : t('chats.thread.new')}</h2>
          <p className={s.paneRole}>{t('chats.thread.role')}</p>
        </div>
        {thread && (
          <Button variant="quiet" size="sm" aria-pressed={thread.pinned} disabled={pinning} onClick={() => void pin()}>
            {t('chats.thread.pin')}
          </Button>
        )}
      </header>
      {threadId && view.error && !shown && !fallback ? (
        <p className={cx(s.problem, s.paneNote)} role="alert">{t('chats.thread.failed', { message: view.error.message })}</p>
      ) : entries.length > 0 ? (
        <ChatThread agent={{ name: t('chats.chief.name'), chausar: true }} entries={entries} className={s.log} />
      ) : (
        <p className={cx(s.quiet, s.paneNote)}>{threadId ? '' : t('chats.thread.start')}</p>
      )}
      {refusal && <p className={cx(s.problem, s.paneNote)} role="alert">{refusal}</p>}
      {consent && <Consent stale={consent.stale} text={consent.text} words={consent.words} problem={consent.problem} busy={consent.busy} onAgree={() => void agree()} onNotNow={notNow} />}
      <div className={s.compose}>
        <Composer
          key={box.n}
          initial={box.words}
          label={t('chats.composer.label')}
          placeholder={t('chats.composer.placeholder')}
          onSend={send}
          suggestions={SUGGESTIONS.map((key) => t(key))}
          hint={t('chats.composer.hint')}
        />
      </div>
    </section>
  );
}

const plainOf = (parts: readonly ChatPart[]) => parts.map((part) => (part.kind === 'figure' ? part.display : part.text)).join(' ');

/** The consent before the first message (D's consent card): the engine's words, the message that waits, and the choice. */
function Consent({ stale, text, words, problem, busy, onAgree, onNotNow }: { stale: boolean; text: string; words: string; problem: string | null; busy: boolean; onAgree: () => void; onNotNow: () => void }) {
  const t = useT();
  const titleId = useId();
  return (
    <section className={s.consent} aria-labelledby={titleId}>
      <h3 id={titleId} className={s.consentTitle}>{t(stale ? 'chats.consent.titleStale' : 'chats.consent.title')}</h3>
      <p className={s.consentText}>{text}</p>
      <p className={s.consentWaits}>{t('chats.consent.waits')} <span data-content="">{words}</span></p>
      <div className={s.actions}>
        <Button disabled={busy} onClick={onNotNow}>{t('chats.consent.notNow')}</Button>
        <Button variant="primary" disabled={busy} onClick={onAgree}>{t('chats.consent.agree')}</Button>
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}

/** One answer from the chief: who and when, its parts, the worked table, what was left out, where it went, the plan. */
function ChiefAnswer({ message, agentOf, onChanged }: { message: ChiefMessageView; agentOf: AgentLookup; onChanged: () => void }) {
  const t = useT();
  const language = useLanguage();
  const at = new Date(message.at);
  const time = Number.isNaN(at.getTime()) ? null : new Intl.DateTimeFormat(LOCALE[language], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return (
    <div className={s.answer} data-chief-message="">
      <p className={s.who}>
        <span className={s.whoName}>{t('chats.chief.name')}</span>
        <span>{t('chats.chief.role')}</span>
        {time && <time className="mono" dateTime={message.at}>{time}</time>}
      </p>
      {message.parts.length > 0 && <p className={s.words} dir="auto">{partsOf(message.parts)}</p>}
      {message.worked.length > 0 && (
        <table className={s.worked}>
          <caption className={s.workedTitle}>{t('chats.worked.title')}</caption>
          <tbody>
            {message.worked.map((line) => (
              <tr key={`${line.receiptId}:${line.label}`}>
                <th scope="row" className={s.workedLabel}>{line.label}</th>
                <td className={s.workedValue}><Figure value={line.value} receiptId={line.receiptId} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {message.counted && <Counted counted={message.counted} />}
      {message.dropped.map((line) => <p key={line} className={s.dropped}>{line}</p>)}
      {message.routedTo && (
        <a className={s.routed} href={`#/team?sheet=agent:${message.routedTo.agent}`}>
          {t('chats.routed', { name: message.routedTo.name })}
        </a>
      )}
      {message.proposals.length > 0 && <PlanCard proposals={message.proposals} agentOf={agentOf} onChanged={onChanged} />}
    </div>
  );
}

/** The kinds the engine counts by code (delivery/fallbacks.ts), each with its words here; another kind is not shown. */
const COUNTED_KINDS = new Set(['clients', 'orders', 'invoices', 'runs', 'people', 'leads']);

/**
 * The counts by code (4J14, Q21) when the AI's answer failed or there is no AI: the label, then each kind with its
 * count and each month's new records, worded here in either language. Code counted them, so no "model estimate".
 */
function Counted({ counted }: { counted: ChiefCounted }) {
  const t = useT();
  const language = useLanguage();
  const titleId = useId();
  const monthOf = (month: string) => {
    const date = new Date(`${month}-01T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat(LOCALE[language], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  };
  return (
    <div className={s.counted} role="group" aria-labelledby={titleId} data-counted="">
      <p id={titleId} className={s.countedTitle}>{t('chats.counted.title')}</p>
      <ul className={s.countedList}>
        {counted.entities.filter((entity) => COUNTED_KINDS.has(entity.kind)).map((entity) => (
          <li key={entity.kind}>{t(`chats.counted.kind.${entity.kind}`, { count: entity.count })}</li>
        ))}
        {counted.months.map((month) => <li key={month.month}>{t('chats.counted.month', { month: monthOf(month.month), count: month.count })}</li>)}
      </ul>
    </div>
  );
}

/** The parts in order, a space between them: words, receipted figures, and model-written numbers with their label. */
function partsOf(parts: readonly ChatPart[]): ReactNode[] {
  return parts.flatMap((part, index) => {
    const gap = index > 0 ? [' '] : [];
    if (part.kind === 'figure') return [...gap, <Figure key={index} value={part.display} receiptId={part.receiptId} />];
    if (part.kind === 'estimate') {
      return [...gap, <span key={index} className={s.estimate}><span data-estimate="">{part.text}</span> <ModelEstimate /></span>];
    }
    return [...gap, <span key={index}>{part.text}</span>];
  });
}
