import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import { EngineError, SERVICE_TYPES, type BusinessOnComputer } from '../engine/types';
import s from './BusinessMenu.module.css';

/**
 * The top of the rail: the open business (name, kind, "switch"). It opens a small menu beside it, not a dialog:
 * the businesses on this computer, then plan and playbook, prices, website build, your CA (only for a business on the
 * CA firm playbook), keep this business and new business.
 * Opening a business that needs its passphrase belongs to a trusted host control, which neither the engine nor the
 * desktop preload offers yet, so this menu never asks for a passphrase: it says the business opens with one and that
 * asking for it here isn't built. A business whose key is missing says its recovery code opens it.
 */
export function BusinessMenu({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const client = useEngine();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
    const called = business.name ?? t('business.noName');
    if (business.opens === 'needs-passphrase') { setNotice(t('business.menuPassphrase', { name: called })); return; }
    if (business.opens === 'key-missing') { setNotice(t('business.menuKeyMissing', { name: called })); return; }
    try {
      await client.request('workspace.open', { folder: business.folder });
      venture.reload();
      setOpen(false);
      onNavigate?.();
    } catch (error) {
      setProblem(error instanceof EngineError || error instanceof Error ? error.message : String(error));
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
        <span className={s.kind}>{kind ? `${kind} · ` : ''}{t('business.switch')}</span>
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
                  <button type="button" className={s.item} aria-current={current ? 'true' : undefined} disabled={current} onClick={() => void switchTo(business)}>
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
          {notice && <p className={s.notice} role="status">{notice}</p>}
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
