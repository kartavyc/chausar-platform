import { useContext, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import { SERVICE_TYPES, type BusinessOnComputer } from '../engine/types';
import { refusalWords } from '../parts/custody';
import { LeftContext, StartedContext } from '../places/onboarding/started';
import s from './BusinessMenu.module.css';

/**
 * The top of the rail: the open business (name, kind, "switch"). It opens a small menu beside it, not a dialog:
 * the businesses on this computer, then plan and playbook, prices, website build, your CA (only for a business on the
 * CA firm playbook), keep this business and new business.
 * The engine keeps one business open, so switching closes this one first (workspace.lock), then opens the other and
 * reads the app again. This menu never asks for a passphrase or a code itself: a business that needs one says so, and
 * Continue closes this business and asks for it on Welcome back, under that business's own row.
 */
/** The kind under the business name, unless it only repeats the name (a business named after its playbook). */
export const kindPrefix = (kind: string | null | undefined, name: string | null | undefined) => (kind && kind !== name ? `${kind} · ` : '');

export function BusinessMenu({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const client = useEngine();
  const restarted = useContext(StartedContext);
  const left = useContext(LeftContext);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** A business that needs its passphrase or its recovery code, waiting for Continue. */
  const [notice, setNotice] = useState<{ business: BusinessOnComputer; with: 'passphrase' | 'recovery-code' } | null>(null);
  const [busy, setBusy] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const list = useResource('workspace.list', {}, { skip: !open });

  const name = venture.data?.venture.workingName ?? t('business.none');
  const type = venture.data?.venture.serviceType;
  // The playbook's own label ("YouTube channel") when the idea picked one; else the service type's label.
  const kind = venture.data?.playbook?.label ?? (type && SERVICE_TYPES.includes(type) ? t(`business.kind.${type}`) : null);
  const links: (readonly [string, string])[] = [
    ['business.plan', '#/business/plan'], ['business.prices', '#/business/prices'], ['business.build', '#/business/build'],
    ...(venture.data?.playbook?.id === 'ca-firm' ? [['business.ca', '#/business/ca'] as const] : []),
    ['business.keep', '#/business/keep'], ['business.new', '#/onboarding'],
  ];

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!holder.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function close() { setOpen(false); setProblem(null); setNotice(null); button.current?.focus(); }

  async function switchTo(business: BusinessOnComputer) {
    setProblem(null);
    setNotice(null);
    if (business.opens === 'needs-passphrase') { setNotice({ business, with: 'passphrase' }); return; }
    if (business.opens === 'key-missing') { setNotice({ business, with: 'recovery-code' }); return; }
    // Hosted switches its session itself; this computer's engine opens one business at a time.
    const hosted = client.transport === 'hosted';
    setBusy(true);
    try {
      if (!hosted) await client.request('workspace.lock', {});
    } catch (error) {
      setProblem(refusalWords(error, t));
      setBusy(false);
      return;
    }
    try {
      await client.request('workspace.open', { folder: business.folder });
      setOpen(false);
      onNavigate?.();
      restarted();
    } catch (error) {
      // This business is closed already: Welcome back says what went wrong and offers every way in.
      if (!hosted) left({ problem: refusalWords(error, t) });
      else { setProblem(refusalWords(error, t)); setBusy(false); }
    }
  }

  /** Close this business, then Welcome back asks for the other one's passphrase or recovery code. */
  async function closeAndAsk() {
    if (!notice) return;
    setBusy(true);
    setProblem(null);
    try {
      await client.request('workspace.lock', {});
      left({ ask: { folder: notice.business.folder, with: notice.with } });
    } catch (error) {
      setProblem(refusalWords(error, t));
      setBusy(false);
    }
  }

  const status = (b: BusinessOnComputer) =>
    b.name !== null && b.name === venture.data?.venture.workingName ? t('business.current')
      : b.opens === 'needs-passphrase' ? t('business.locked')
        : b.opens === 'key-missing' ? t('business.keyMissing') : '';

  return (
    <div
      ref={holder}
      className={s.holder}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}
    >
      <button ref={button} type="button" className={s.business} aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        <span className={s.name}>{name}</span>
        <span className={s.kind}>{kindPrefix(kind, name)}{t('business.switch')}</span>
      </button>
      {open && (
        <div id={menuId} className={s.menu} role="group" aria-label={t('business.menu', { name })}>
          <p className={s.heading}>{t('business.switchTo')}</p>
          <ul className={s.list}>
            {(list.data?.businesses ?? []).map((business) => {
              const word = status(business);
              const current = word === t('business.current');
              return (
                <li key={business.folder}>
                  <button type="button" className={s.item} aria-current={current ? 'true' : undefined} disabled={current || busy} onClick={() => void switchTo(business)}>
                    <span className={s.itemName}>
                      <span>{business.name ?? t('business.noName')}</span>
                      {current && kind && <span className={s.itemKind}>{kind}</span>}
                    </span>
                    {word && <span className={s.status}>{word}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {notice && (
            <div className={s.notice} role="status">
              <p className={s.noticeLine}>{t(notice.with === 'passphrase' ? 'business.menuPassphrase' : 'business.menuKeyMissing', { name: notice.business.name ?? t('business.noName') })}</p>
              <button type="button" className={s.item} disabled={busy} onClick={() => void closeAndAsk()}>{t('business.continue')}</button>
            </div>
          )}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <ul className={s.list}>
            {links.map(([key, href]) => (
              <li key={key}>
                <a className={s.item} href={href} onClick={() => { setOpen(false); onNavigate?.(); }}>{t(key)}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
