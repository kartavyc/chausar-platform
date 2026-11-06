/**
 * "Due today and late" (D-Clients `.due`; the engine's 4E1 venture.pipeline.followups): each follow-up due now, oldest
 * first, with the engine's line ("Follow up 21 Oct, 2 days late. Nudge drafted for Mail."). With a nudge drafted, its
 * handoff opens the owner's own app with the text filled in (Open in Mail, Open in LinkedIn, Open WhatsApp), and "I
 * sent it" records the owner's own send on the draft's channel (venture.outreach.sent). Without one, Open the card
 * leads to the card, where the owner drafts it. Chausar never sends. With nothing due the tile is left out.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { useClock } from '../../shell/clock';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Tile, TileHead } from '../../parts/Tile';
import type { FollowupView, OutreachChannel } from '../../engine/types';
import { reserveTab } from '../connections/external';
import { NeverContactLost } from './NeverContactLost';
import { codeOf, messageOf } from './network';
import { clientsChanged } from './signals';
import { handoffText, opensPage, performHandoff, SENT_OF } from './handoff';
import { pipelineRefresh } from './pipeline';
import s from './Pipeline.module.css';

export function DueList({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const titleId = useId();
  const followups = useResource('venture.pipeline.followups', {}, { refreshOn: pipelineRefresh });
  const due = followups.data?.due ?? [];
  // Simple first: with nothing due (and nothing refused), the tile is not drawn at all.
  if (!followups.error && due.length === 0) return null;
  return (
    <Tile as="section" labelledBy={titleId} className={s.due}>
      <TileHead id={titleId} title={t('clients.pipeline.dueTitle')} meta={due.length ? t('clients.pipeline.dueCount', { count: due.length }) : undefined} />
      {followups.error && <p className={s.problem} role="alert">{t('sheet.failed', { message: followups.error.message })}</p>}
      {due.length > 0 && (
        <ul className={s.dueList}>
          {due.map((item) => <DueItem key={`${item.cardId}:${item.due}`} item={item} onChanged={() => { followups.reload(); onChanged(); }} />)}
        </ul>
      )}
      {due.length > 0 && <p className={s.quiet}>{t('clients.pipeline.dueHow')}</p>}
    </Tile>
  );
}

/** One follow-up: who, the engine's line, its handoff and I sent it. */
function DueItem({ item, onChanged }: { item: FollowupView; onChanged: () => void }) {
  const t = useT();
  const engine = useEngine();
  const clock = useClock();
  const [said, setSaid] = useState<{ text: string; problem: boolean; code?: string } | null>(null);
  const [copy, setCopy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const channel: OutreachChannel | null = item.draftId ? item.channel : null;

  async function open() {
    if (!item.draftId || !channel) return;
    setSaid(null);
    setCopy(null);
    let tab: Window | null = null;
    try {
      // A page that opens on the web needs its tab inside the click, before the engine answers.
      tab = opensPage(channel) ? reserveTab() : null;
      const handoff = await engine.request('venture.outreach.open', { draftId: item.draftId });
      const done = await performHandoff(handoff, tab);
      if (done === 'copy-failed') setCopy(handoffText(handoff));
      setSaid({ text: handoff.line, problem: false });
    } catch (error) {
      tab?.close();
      setSaid({ text: messageOf(error), problem: true, code: codeOf(error) });
    }
  }

  async function sent() {
    if (!item.draftId || !channel) return;
    setBusy(true);
    setSaid(null);
    try {
      const result = await engine.request('venture.outreach.sent', { draftId: item.draftId, at: clock().toISOString(), channel: SENT_OF[channel] });
      setSaid({ text: result.line, problem: false });
      clientsChanged(engine);
      onChanged();
    } catch (error) {
      setSaid({ text: messageOf(error), problem: true, code: codeOf(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={s.dueItem} data-due-card={item.cardId}>
      <Avatar name={item.name} size={32} />
      <div className={s.dueBody}>
        <p className={s.dueWho}>{item.company ? t('clients.pipeline.who', { name: item.name, company: item.company }) : item.name}</p>
        <p className={s.dueLine} data-late={item.late ? '' : undefined}>{item.line}</p>
        <div className={s.dueActions}>
          {channel ? (
            <>
              <Button size="sm" onClick={() => void open()}>{t(`clients.outreach.open.${channel}`)}</Button>
              <Button size="sm" disabled={busy} onClick={() => void sent()}>{t('clients.outreach.sent')}</Button>
            </>
          ) : (
            <Button size="sm" onClick={(event) => openSheet('card', item.cardId, event.currentTarget)}>{t('clients.pipeline.openCard')}</Button>
          )}
        </div>
        {copy && <p className={s.copy} data-content="">{copy}</p>}
        {said && (said.code === 'NEVER_CONTACT_LOST' ? <NeverContactLost /> : <p className={said.problem ? s.problem : s.said} role="status">{said.text}</p>)}
      </div>
    </li>
  );
}
