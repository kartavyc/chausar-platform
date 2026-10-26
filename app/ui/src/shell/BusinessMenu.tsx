import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import { SERVICE_TYPES, type BusinessOnComputer } from '../engine/types';
import { refusalWords } from '../parts/custody';
import { initialsOf } from '../parts/Avatar';
import { Icon } from '../parts/Icon';
import { LeftContext, StartedContext } from '../places/onboarding/started';
import s from './BusinessMenu.module.css';

/**
 * The top of the rail (D's `.biz`): the open business as its initials square, its name and its kind, with a
 * chevron that says it switches. It opens a small menu beside it, not a dialog:
 * the businesses on this computer, then plan and playbook, prices, website build, your CA (only for a business on the
 * CA firm playbook), keep this business and new business. The menu is a popover over the page (a portal on the body,
 * placed under the button and no taller than the window left below it), so the rail and the phone top bar never
 * clip it, and nor does the bottom of the window.
 * The engine keeps one business open, so switching closes this one first (workspace.lock), then opens the other and
 * reads the app again. This menu never asks for a passphrase or a code itself: a business that needs one says so, and
 * Continue closes this business and asks for it on Welcome back, under that business's own row.
 */
/** The kind under the business name, unless it only repeats the name (a business named after its playbook). */
export const kindLine = (kind: string | null | undefined, name: string | null | undefined) => (kind && kind !== name ? kind : null);

/** Pixels between the button and the popover, and the least space it keeps from the window's edge. */
const GAP = 4;
const EDGE = 8;
/** What in the popover takes the focus, in page order (the open business's own row is disabled). */
const FOCUSABLE = 'button:not(:disabled), a[href]';

/**
 * `rail`: the rail's button (D's `.biz`), with the kind line and the up-down chevrons. `bar`: the phone's top bar
 * (D's `.bizb`), the initials and the name with a chevron down, a 44 px target.
 */
export type BusinessMenuVariant = 'rail' | 'bar';

export function BusinessMenu({ onNavigate, variant = 'rail' }: { onNavigate?: () => void; variant?: BusinessMenuVariant }) {
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
  const menu = useRef<HTMLDivElement>(null);
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const list = useResource('workspace.list', {}, { skip: !open });

  const name = venture.data?.venture.workingName ?? t('business.none');
  const type = venture.data?.venture.serviceType;
  // The playbook's own label ("YouTube channel") when the idea picked one; else the service type's label.
  const kind = venture.data?.playbook?.label ?? (type && SERVICE_TYPES.includes(type) ? t(`business.kind.${type}`) : null);
  const links: (readonly [string, string])[] = [
    ['business.plan', '#/business/plan'], ['business.prices', '#/business/prices'], ['business.build', '#/business/build'],
    ['business.practice', '#/business/practice'],
    ...(venture.data?.playbook?.id === 'ca-firm' ? [['business.ca', '#/business/ca'] as const] : []),
    ['business.keep', '#/business/keep'], ['business.new', '#/onboarding'],
  ];

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!holder.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // Place the popover under its button before it paints, and again when the window moves under it. Layout only, no
  // figure. It goes through the element's style object (CSSOM), which the strict CSP allows; there is no style
  // attribute or style prop, and position: fixed comes from the CSS module.
  useLayoutEffect(() => {
    if (!open) return;
    const at = () => {
      const rect = button.current?.getBoundingClientRect();
      const popover = menu.current;
      if (!rect || !popover) return;
      const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - popover.offsetWidth - EDGE));
      const top = rect.bottom + GAP;
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      // No taller than the window left under it; it scrolls inside instead of running off the bottom.
      popover.style.maxHeight = `${Math.max(0, window.innerHeight - top - EDGE)}px`;
    };
    at();
    window.addEventListener('resize', at);
    window.addEventListener('scroll', at, true);
    return () => { window.removeEventListener('resize', at); window.removeEventListener('scroll', at, true); };
  }, [open]);

  // The popover is not next to the button in the page, so it takes the focus when it opens; Tab then walks its items.
  useEffect(() => { if (open) menu.current?.focus(); }, [open]);

  function close() { setOpen(false); setProblem(null); setNotice(null); button.current?.focus(); }

  /**
   * Focus left the popover. Inside it or back on the button it stays open. Tab past its last item leaves the page (the
   * popover is the last thing on it), so it closes and the focus goes back to the button; focus that moved to
   * something else on the page closes it and stays there. Never while a switch is on its way.
   */
  function focusLeft(next: EventTarget | null) {
    if (busy) return;
    if (next instanceof Node && (menu.current?.contains(next) || holder.current?.contains(next))) return;
    if (next instanceof Node) { setOpen(false); setProblem(null); setNotice(null); return; }
    close();
  }

  /**
   * Tab between the button and the open popover. The popover sits at the end of the body, so on its own the browser
   * would send Shift+Tab from its first item to the last thing on the page, and Tab from the button past it. Shift+Tab
   * from the first item (or from the popover itself) goes back to the button, which keeps it open; Tab from the
   * button goes to its first item. Every other Tab is the browser's own.
   */
  function tabAcross(event: KeyboardEvent<HTMLDivElement>) {
    const first = menu.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
    const from = event.target;
    if (event.shiftKey && (from === menu.current || from === first)) {
      event.preventDefault();
      button.current?.focus();
    } else if (!event.shiftKey && from === button.current && first) {
      event.preventDefault();
      first.focus();
    }
  }

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
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) { event.stopPropagation(); close(); }
        if (event.key === 'Tab' && open) tabAcross(event);
      }}
    >
      <button ref={button} type="button" className={s.business} data-variant={variant} aria-haspopup="dialog" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        {venture.data && <span className={s.square} data-initials="" aria-hidden="true">{initialsOf(name)}</span>}
        <span className={s.words}>
          <span className={s.name}>{name}</span>
          {variant === 'rail' && kindLine(kind, name) && <span className={s.kind}>{kindLine(kind, name)}</span>}
        </span>
        <Icon name={variant === 'bar' ? 'chevron-down' : 'chevrons-up-down'} size={16} className={s.chevrons} />
        <span className="sr-only">{t('business.switchTo')}</span>
      </button>
      {open && createPortal(
        <div
          ref={menu} id={menuId} className={s.menu} role="dialog" aria-label={t('business.menu', { name })} tabIndex={-1}
          onBlur={(event) => focusLeft(event.relatedTarget)}
        >
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
        </div>,
        document.body,
      )}
    </div>
  );
}
