import { useMemo, useState } from 'react';
import { useLanguage, useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { DeliveryLite, ShareAnswer, ShareLink } from '../../engine/types';
import s from './Work.module.css';

const LOCALE = { en: 'en-IN', hi: 'hi-IN' } as const;
const never = () => false;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** When a link stops working, as '28 Oct' on this computer's calendar. */
function useUntil(): (iso: string) => string {
  const language = useLanguage();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(LOCALE[language], { day: 'numeric', month: 'short' });
    return (iso) => {
      const at = new Date(iso);
      return Number.isNaN(at.getTime()) ? iso : format.format(at);
    };
  }, [language]);
}

/** When the client first opened a link (4J7, O20), as "21 Oct, 10:42" on this computer's clock. */
function useWhen(): (iso: string) => string {
  const language = useLanguage();
  return useMemo(() => {
    const day = new Intl.DateTimeFormat(LOCALE[language], { day: 'numeric', month: 'short' });
    const time = new Intl.DateTimeFormat(LOCALE[language], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return (iso) => {
      const at = new Date(iso);
      return Number.isNaN(at.getTime()) ? iso : `${day.format(at)}, ${time.format(at)}`;
    };
  }, [language]);
}

/** Which part of the draft a client's comment is on: the whole draft, or one post ('<run>.post-<n>'). */
function itemWords(item: string, t: T): string {
  const post = /\.post-(\d+)$/.exec(item);
  return post ? t('work.request.post', { n: post[1]! }) : t('work.request.whole');
}

/** The client's answer in words: "Your client's answer: Approved", with what they said when there is a comment. */
export function answerWords(answer: ShareAnswer, t: T): string {
  const word = t(answer.decision === 'approved' ? 'work.post.answer.approved' : 'work.post.answer.changes');
  return answer.comment ? t('work.post.answer.recordedComment', { answer: word, comment: answer.comment }) : t('work.post.answer.recorded', { answer: word });
}

/**
 * The client's answer the engine counts for the draft as it is now: the list's answer for one draft. The engine is the
 * source of truth: it is what posting reads and what recording an answer refuses over. From an engine that sends
 * none: the answer on the newest link the owner has not taken back.
 */
export function answerOf(listed: { links?: readonly ShareLink[]; shares?: readonly ShareLink[]; answer?: ShareAnswer | null } | undefined): ShareAnswer | null {
  if (!listed) return null;
  if (listed.answer !== undefined) return listed.answer;
  return (listed.links ?? listed.shares ?? []).find((link) => !link.revoked)?.answer ?? null;
}

/**
 * Preview links for the client, one line per real draft of the order (practice drafts are never shared). "Share with
 * client" asks the engine for a link (venture.share.create). The engine answers with the address, or with no address
 * and its reason (on this computer there is no public address), which is shown in its words. Links the engine keeps
 * are listed with when they stop working, Copy and Revoke. Nothing here makes up an address.
 * Once a draft has a link, the owner records what the client said (venture.share.recordAnswer, Ink v2 wave 2): Approved
 * or Asked for changes, with an optional comment; the line then shows the answer the engine counts. onAnswered tells
 * the order's other parts (Post) to read the engine again.
 */
export function ShareLinks({ drafts, onAnswered }: { drafts: DeliveryLite[]; onAnswered?: () => void }) {
  return (
    <ul className={s.list}>
      {drafts.map((draft) => <ShareLine key={draft.id} draft={draft} onAnswered={onAnswered} />)}
    </ul>
  );
}

function ShareLine({ draft, onAnswered }: { draft: DeliveryLite; onAnswered?: (() => void) | undefined }) {
  const t = useT();
  const client = useEngine();
  const until = useUntil();
  const when = useWhen();
  const links = useResource('venture.share.list', { deliveryId: draft.id }, { refreshOn: never });
  const [made, setMade] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<ShareAnswer | null>(null);
  const [comment, setComment] = useState('');

  async function share() {
    setBusy('new');
    setProblem(null);
    try {
      setMade(await client.request('venture.share.create', { deliveryId: draft.id }));
      links.reload();
    } catch (error) {
      setProblem(t('work.share.failed', { message: messageOf(error) }));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    setProblem(null);
    try {
      await client.request('venture.share.revoke', { id });
      if (made?.id === id) setMade(null);
      links.reload();
    } catch (error) {
      setProblem(t('work.share.revokeFailed', { message: messageOf(error) }));
    } finally {
      setBusy(null);
    }
  }

  async function record(answer: ShareAnswer['decision']) {
    setBusy('answer');
    setProblem(null);
    try {
      const text = comment.trim();
      const result = await client.request('venture.share.recordAnswer', { draftId: draft.id, answer, ...(text ? { comment: text } : {}) });
      setRecorded(result.answer);
      links.reload();
      onAnswered?.();
    } catch (error) {
      setProblem(t('work.post.answer.failed', { message: messageOf(error) }));
    } finally {
      setBusy(null);
    }
  }

  function copy(link: ShareLink) {
    if (!link.url) return;
    const done = () => setCopied(link.id);
    const failed = () => setCopied(null);
    try { void navigator.clipboard?.writeText(link.url).then(done, failed); } catch { failed(); }
  }

  const listed = links.data?.links ?? links.data?.shares ?? [];
  // The engine sends a link's address once, when it is made, and lists it later with no address and its reason (4J7):
  // the address made here stays with its link until the page closes.
  const withMade = listed.map((link) => (made?.url && link.id === made.id ? { ...link, url: made.url } : link));
  const shown = made?.url && !listed.some((link) => link.id === made.id) ? [made, ...withMade] : withMade;
  // A link drawn as a row: one with its address, or one the client opened or commented on (W4 4J21, O20), from every
  // listed link, whatever its address. A link taken back is not drawn.
  const live = shown.filter((link) => !link.revoked && (link.url !== null || Boolean(link.viewedAt) || (link.comments?.length ?? 0) > 0));
  // W4 4J21: what the client wrote on each item, through any of this draft's links, oldest first.
  const comments = shown.flatMap((link) => link.comments ?? []).sort((a, b) => a.at.localeCompare(b.at));
  const title = draft.deliverable?.title ?? t('work.focus.draft');
  const answer = recorded ?? answerOf(links.data);
  // The owner records an answer only on a link not taken back (the engine refuses SHARE_NOT_FOUND otherwise).
  const hasLink = made !== null || listed.some((link) => !link.revoked);

  return (
    <li className={s.item} data-row="" data-row-id={`share-${draft.id}`} tabIndex={-1}>
      <span className={s.who} />
      <span className={s.what}>{title}</span>
      <div className={s.tail}>
        {made && made.url === null && made.reason && <span className={s.quiet} role="status">{made.reason}</span>}
        <span className={s.act}>
          <Button variant="quiet" disabled={busy !== null} onClick={() => void share()}>
            {busy === 'new' ? t('work.share.creating') : t('work.share.create')}
          </Button>
        </span>
      </div>
      {live.length > 0 && (
        <ul className={s.links} aria-label={t('work.share.links', { title })}>
          {live.map((link) => (
            <li key={link.id} className={s.link}>
              {link.url ? <span className={`${s.url} mono`}>{link.url}</span> : <span className={s.quiet}>{link.reason}</span>}
              <span className={s.until}>{t('work.share.until', { day: until(link.expiresAt) })}</span>
              {/* W4 4J21: the first time the client opened it (never the owner's own preview), from the engine. */}
              <span className={s.until} data-viewed="">{link.viewedAt ? t('work.request.viewed', { when: when(link.viewedAt) }) : t('work.request.notViewed')}</span>
              <span className={s.act}>
                {link.url && <Button variant="quiet" onClick={() => copy(link)}>{copied === link.id ? t('work.share.copied') : t('work.share.copy')}</Button>}
                <Button variant="quiet" disabled={busy !== null} onClick={() => void revoke(link.id)}>{t('work.share.revoke')}</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {comments.length > 0 && (
        <ul className={s.links} aria-label={t('work.request.comments')} data-comments="">
          {comments.map((comment, index) => (
            <li key={`${comment.at}-${index}`} className={s.link}>
              <span className={s.until} data-comment-item="">{itemWords(comment.item, t)}</span>
              <span className={s.what} data-content="">{comment.text}</span>
            </li>
          ))}
        </ul>
      )}
      {answer ? <p className={`${s.confirm} ${s.note}`} data-share-answer="">{answerWords(answer, t)}</p> : hasLink && (
        <div className={s.confirm} role="group" aria-label={t('work.post.answer.label')}>
          <Field label={t('work.post.answer.comment')} value={comment} maxLength={1000} onChange={(event) => setComment(event.currentTarget.value)} />
          <span className={s.act}>
            <Button variant="quiet" disabled={busy !== null} onClick={() => void record('changes')}>{t('work.post.answer.changes')}</Button>
            <Button variant="quiet" disabled={busy !== null} onClick={() => void record('approved')}>{busy === 'answer' ? t('work.post.answer.saving') : t('work.post.answer.approved')}</Button>
          </span>
        </div>
      )}
      {links.error && <p className={s.problem} role="status">{t('work.loadFailed', { message: links.error.message })}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </li>
  );
}
