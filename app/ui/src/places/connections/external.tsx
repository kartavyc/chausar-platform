/**
 * Opening a partner site from an engine-provided link. On the desktop the preload's safe external open does it
 * (main.cjs checks the link against the listed partner origins and hands it to the system browser; the window itself
 * refuses new windows). On the web it is a normal link that opens apart from Chausar (rel noopener noreferrer). A
 * click that must ask the engine first opens its tab inside the click (reserveTab), because a browser drops a tab
 * opened after a wait without saying so.
 */

import { useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { EngineError } from '../../engine/types';
import s from './Connections.module.css';

interface Bridge { request?: unknown; openExternal?: (url: string) => Promise<void> }
const bridge = (): Bridge | undefined => (window as Window & { chausar?: Bridge }).chausar;

/** True in the desktop app: the preload is there. */
export function onDesktop(): boolean {
  const b = bridge();
  return Boolean(b && (typeof b.request === 'function' || typeof b.openExternal === 'function'));
}

/** An https link with no credentials in it, or null. The desktop checks the partner origin again. */
export function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Call before any await in a click. The desktop opens links itself and gets null. */
export function reserveTab(): Window | null {
  if (onDesktop()) return null;
  const tab = typeof window.open === 'function' ? window.open('', '_blank') : null;
  if (!tab) throw new EngineError('POPUP_BLOCKED', 'Your browser blocked the new tab.');
  try { tab.opener = null; } catch { /* the tab still opens; it only keeps a handle back */ }
  return tab;
}

/** Opens an engine-provided link, in the reserved tab when there is one. A refused link closes that tab. */
export async function openExternal(url: string, tab: Window | null = null): Promise<void> {
  const href = safeUrl(url);
  if (!href) {
    tab?.close();
    throw new EngineError('INVALID_EXTERNAL_URL', 'Use one partner link.');
  }
  if (onDesktop()) {
    const open = bridge()?.openExternal;
    if (typeof open !== 'function') throw new EngineError('NO_EXTERNAL_OPEN', "This window can't open links yet.");
    await open(href);
    return;
  }
  if (tab) { tab.location.replace(href); return; }
  window.open(href, '_blank', 'noopener,noreferrer');
}

/** Plain words for a failed open: the browser's block and the desktop's refusals in this app's language. */
export function openProblem(error: unknown, t: (key: string) => string): string {
  const code = error instanceof EngineError ? error.code : '';
  if (code === 'POPUP_BLOCKED') return t('connections.blocked');
  if (code === 'NO_EXTERNAL_OPEN') return t('connections.noOpen');
  if (code === 'INVALID_EXTERNAL_URL') return t('connections.badLink');
  return error instanceof Error ? error.message : String(error);
}

/** A link to a partner site: a quiet button through the preload on the desktop, a plain new-tab link on the web. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const t = useT();
  const [problem, setProblem] = useState<string | null>(null);
  const url = safeUrl(href);
  if (!url) return null;
  if (onDesktop()) {
    return (
      <>
        <Button variant="quiet" onClick={() => { setProblem(null); openExternal(url).catch((error: unknown) => setProblem(openProblem(error, t))); }}>{children}</Button>
        {problem && <span className={s.problem} role="status">{problem}</span>}
      </>
    );
  }
  return <a className={s.link} href={url} target="_blank" rel="noopener noreferrer">{children}</a>;
}
