import { useMemo, useState } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import type { DeliveryLite, ShareLink } from '../../engine/types';
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

/**
 * Preview links for the client, one line per real draft of the order (practice drafts are never shared). "Share with
 * client" asks the engine for a link (venture.share.create). The engine answers with the address, or with no address
 * and its reason (on this computer there is no public address), which is shown in its words. Links the engine keeps
 * are listed with when they stop working, Copy and Revoke. Nothing here makes up an address.
 */
export function ShareLinks({ drafts }: { drafts: DeliveryLite[] }) {
  return (
    <ul className={s.list}>
      {drafts.map((draft) => <ShareLine key={draft.id} draft={draft} />)}
    </ul>
  );
}

function ShareLine({ draft }: { draft: DeliveryLite }) {
  const t = useT();
  const client = useEngine();
  const until = useUntil();
  const links = useResource('venture.share.list', { deliveryId: draft.id }, { refreshOn: never });
  const [made, setMade] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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

  function copy(link: ShareLink) {
    if (!link.url) return;
    const done = () => setCopied(link.id);
    const failed = () => setCopied(null);
    try { void navigator.clipboard?.writeText(link.url).then(done, failed); } catch { failed(); }
  }

  const listed = links.data?.links ?? links.data?.shares ?? [];
  const shown = made?.url && !listed.some((link) => link.id === made.id) ? [made, ...listed] : listed;
  const live = shown.filter((link): link is ShareLink & { url: string } => link.url !== null);
  const title = draft.deliverable?.title ?? t('work.focus.draft');

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
              <span className={`${s.url} mono`}>{link.url}</span>
              <span className={s.until}>{t('work.share.until', { day: until(link.expiresAt) })}</span>
              <span className={s.act}>
                <Button variant="quiet" onClick={() => copy(link)}>{copied === link.id ? t('work.share.copied') : t('work.share.copy')}</Button>
                <Button variant="quiet" disabled={busy !== null} onClick={() => void revoke(link.id)}>{t('work.share.revoke')}</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {links.error && <p className={s.problem} role="status">{t('work.loadFailed', { message: links.error.message })}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </li>
  );
}
