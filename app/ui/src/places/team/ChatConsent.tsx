import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import type { ChatConsentView } from '../../engine/types';
import { Button } from '../../parts/Button';
import c from './AgentChat.module.css';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The one chat consent per business (W4 4B3; engine 4B1 venture.chats.consent): before the first message goes to the
 * owner's own AI, what chats send, in the engine's own words (which name that AI), with Agree and send and Not now.
 * When the AI connection changed since the owner agreed, it says so first. Shown in the chat above the box, never as
 * a page of its own; the message waits in the box until the owner answers. With only templates nothing is sent, so the
 * engine asks nothing and this never shows.
 */
export function ChatConsent({ view, onAgree, onCancel }: { view: ChatConsentView; onAgree: () => Promise<void>; onCancel: () => void }) {
  const t = useT();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { title.current?.focus(); }, []);

  async function agree() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onAgree();
    } catch (error) {
      setProblem(t('team.chat.consent.failed', { message: messageOf(error) }));
      setBusy(false);
    }
  }

  return (
    <section className={c.consent} aria-labelledby={titleId} data-consent={view.state}>
      <h3 id={titleId} ref={title} tabIndex={-1} className={c.consentTitle}>{t('team.chat.consent.title')}</h3>
      {view.state === 'stale' && <p className={c.consentStale}>{t('team.chat.consent.stale')}</p>}
      <p className={c.consentText}>{view.text}</p>
      <div className={c.actions}>
        <Button onClick={onCancel} disabled={busy}>{t('team.chat.consent.cancel')}</Button>
        <Button variant="primary" onClick={() => void agree()} disabled={busy}>{t('team.chat.consent.accept')}</Button>
      </div>
      {problem && <p className={c.problem} role="alert">{problem}</p>}
    </section>
  );
}
