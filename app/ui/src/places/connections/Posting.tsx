/**
 * Posting from the owner's own browser, on a connector tile (Ink v2 wave 2, K1): "Sign in" opens the platform's own
 * sign-in page in the Chausar browser window (venture.posting.signIn). It shows only while the engine says browser
 * posting is available for the card, and only for the platforms whose text posts Chausar makes (LinkedIn, X). The
 * engine opens the window and does not wait for it; the line after says so. A refusal is shown in the engine's words.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import type { ConnectorCardLite } from '../../engine/types';
import { PostingLimits } from './PostingLimits';
import { StepsCheck } from './StepsCheck';
import s from './Connections.module.css';

const TEXT_POSTING = new Set(['linkedin', 'x']);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Whether this card's browser posting is available now, as the engine lists it. */
export function signInOffered(card: ConnectorCardLite): boolean {
  return TEXT_POSTING.has(card.id) && card.postingOptions.some((option) => option.mode === 'owner-browser-session' && option.status === 'available');
}

export function Posting({ card }: { card: ConnectorCardLite }) {
  const t = useT();
  const client = useEngine();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);
  if (!signInOffered(card)) return null;

  async function signIn() {
    setBusy(true);
    setSaid(null);
    try {
      await client.request('venture.posting.signIn', { connectorId: card.id });
      setSaid({ text: t('connections.posting.opened'), problem: false });
    } catch (error) {
      setSaid({ text: t('connections.posting.failed', { message: messageOf(error) }), problem: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.tools} data-posting-sign-in="">
      <span className={s.toolRow}>
        <Button size="sm" disabled={busy} onClick={() => void signIn()}>
          <span aria-hidden="true">{busy ? t('connections.posting.opening') : t('connections.posting.signIn')}</span>
          <span className="sr-only">{t('connections.posting.signInName', { name: card.name })}</span>
        </Button>
        {said && <span className={said.problem ? s.problem : s.said} role={said.problem ? 'alert' : 'status'}>{said.text}</span>}
      </span>
      <StepsCheck card={card} />
      <PostingLimits card={card} />
    </div>
  );
}
