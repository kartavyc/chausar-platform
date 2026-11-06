/**
 * The posting steps of one text platform, on its connector card (Ink v2 wave 2, K2): the day they last worked on this
 * computer, and a button that checks them now (venture.posting.checkSteps). The engine opens the post box in the
 * owner's own session, finds each step without typing or clicking, and may ask the owner to click an item once in
 * that window. The date and the line after a check are the engine's; a refusal is shown in the engine's words.
 * Rendered by Posting.tsx, so it shows only where browser posting is available.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import type { ConnectorCardLite } from '../../engine/types';
import { useDay } from '../money/words';
import s from './Connections.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The two dates of a check: every step (the first post checks the confirmation), and the post box and button only. */
type Dates = { all: string | null; boxAndButton: string | null };

/** The browser mode's own dates, as venture.connectors.list says them; null when not checked. */
function datesOf(card: ConnectorCardLite): Dates {
  const option = card.postingOptions.find((item) => item.mode === 'owner-browser-session');
  return { all: option?.stepsCheckedOn ?? null, boxAndButton: option?.boxAndButtonCheckedOn ?? null };
}

export function StepsCheck({ card }: { card: ConnectorCardLite }) {
  const t = useT();
  const day = useDay();
  const client = useEngine();
  const [dates, setDates] = useState<Dates>(() => datesOf(card));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);
  const dateLine = dates.all
    ? t('connections.steps.checkedOn', { day: day(dates.all) })
    : dates.boxAndButton ? t('connections.steps.boxChecked', { day: day(dates.boxAndButton) }) : t('connections.steps.notChecked');

  async function check() {
    setBusy(true);
    setSaid(null);
    try {
      const view = await client.request('venture.posting.checkSteps', { connectorId: card.id });
      setDates({ all: view.stepsCheckedOn, boxAndButton: view.boxAndButtonCheckedOn ?? null });
      setSaid({ text: view.line, problem: false });
    } catch (error) {
      setSaid({ text: t('connections.steps.failed', { message: messageOf(error) }), problem: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={s.toolRow} data-posting-steps="">
      <span className={s.quiet}>{dateLine}</span>{' '}
      <Button size="sm" disabled={busy} onClick={() => void check()}>
        <span aria-hidden="true">{busy ? t('connections.steps.checking') : t('connections.steps.check')}</span>
        <span className="sr-only">{t('connections.steps.checkName', { name: card.name })}</span>
      </Button>
      {busy && <span className={s.said}>{t('connections.steps.watch')}</span>}
      {said && said.text && <span className={said.problem ? s.problem : s.said} role={said.problem ? 'alert' : 'status'}>{said.text}</span>}
    </span>
  );
}
