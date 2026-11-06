/**
 * The owner's own, stricter posting limits for one channel (Ink v2 wave 2, K5), folded under its connector tile:
 * posts a day, minutes between posts, warm-up days, the near-duplicate percent and the link streak. The numbers in use
 * come from the engine (venture.posting.limits.get), each with Chausar's own as the hint. Save sends them as typed
 * (venture.posting.limits.set); the engine refuses any looser than Chausar's own, and that refusal is shown in its
 * words. An empty box means Chausar's own number. Nothing here works out a limit.
 */

import { useEffect, useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Inner } from '../../parts/Card';
import { Field } from '../../parts/Field';
import type { ConnectorCardLite, OwnerPostingLimits } from '../../engine/types';
import s from './Connections.module.css';
import own from './PostingLimits.module.css';

const KEYS: readonly (keyof OwnerPostingLimits)[] = ['capPer24h', 'minGapMinutes', 'warmUpDays', 'duplicatePercent', 'linkStreak'];
type Typed = Record<keyof OwnerPostingLimits, string>;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const typedFrom = (limits: OwnerPostingLimits): Typed => ({
  capPer24h: String(limits.capPer24h), minGapMinutes: String(limits.minGapMinutes), warmUpDays: String(limits.warmUpDays),
  duplicatePercent: String(limits.duplicatePercent), linkStreak: String(limits.linkStreak),
});

export function PostingLimits({ card }: { card: ConnectorCardLite }) {
  const t = useT();
  const client = useEngine();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const limits = useResource('venture.posting.limits.get', {}, { skip: !open });
  const channel = limits.data?.channels.find((item) => item.connectorId === card.id);
  const [typed, setTyped] = useState<Typed | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);

  useEffect(() => {
    if (channel && typed === null) setTyped(typedFrom(channel.inUse));
  }, [channel, typed]);

  async function save() {
    if (!typed || !channel) return;
    setBusy(true);
    setSaid(null);
    try {
      // Only the boxes that differ from Chausar's own are sent; an empty box, or Chausar's own number, means Chausar's own.
      const chosen: Partial<OwnerPostingLimits> = {};
      for (const key of KEYS) {
        const text = typed[key].trim();
        if (text && text !== String(channel.house[key])) chosen[key] = Number(text);
      }
      const view = await client.request('venture.posting.limits.set', { connectorId: card.id, limits: chosen });
      const now = view.channels.find((item) => item.connectorId === card.id);
      if (now) setTyped(typedFrom(now.inUse));
      setSaid({ text: t('connections.posting.limits.saved'), problem: false });
    } catch (error) {
      setSaid({ text: t('connections.posting.limits.failed', { message: messageOf(error) }), problem: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button className={own.toggle} size="sm" variant="quiet" aria-expanded={open} aria-controls={formId} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">{t('connections.posting.limits.toggle')}</span>
        <span className="sr-only">{t('connections.posting.limits.toggleName', { name: card.name })}</span>
      </Button>
      {open && (
        <Inner card={false}>
          <div id={formId} className={own.form} role="group" aria-label={t('connections.posting.limits.label', { name: card.name })}>
            <p className={s.note}>{t('connections.posting.limits.line')}</p>
            {limits.error && <p className={s.problem} role="alert">{t('connections.posting.limits.failed', { message: limits.error.message })}</p>}
            {!typed && !limits.error && <p className={s.note}>{t('connections.posting.limits.loading')}</p>}
            {typed && channel && (
              <>
                <div className={own.fields}>
                  {KEYS.map((key) => (
                    <Field
                      key={key} label={t(`connections.posting.limits.${key}`)} inputMode="numeric" value={typed[key]}
                      hint={t('connections.posting.limits.house', { value: String(channel.house[key]) })}
                      onChange={(event) => { const value = event.currentTarget.value; setTyped((now) => (now ? { ...now, [key]: value } : now)); }}
                    />
                  ))}
                </div>
                <div className={own.actions}>
                  <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? t('connections.posting.limits.saving') : t('connections.posting.limits.save')}</Button>
                  {said && <span className={said.problem ? s.problem : s.said} role={said.problem ? 'alert' : 'status'}>{said.text}</span>}
                </div>
              </>
            )}
          </div>
        </Inner>
      )}
    </>
  );
}
