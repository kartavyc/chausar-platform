import { useId, useState } from 'react';
import { useT } from '../../text';
import { useClock } from '../../shell/clock';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { QrCode } from '../../parts/QrCode';
import { Tile, TileHead } from '../../parts/Tile';
import type { PhoneAccessView } from '../../engine/types';
import s from './Connections.module.css';

/**
 * C5 task 3: pair the phone by QR code, in Connections. The same engine call as Business > Notifications
 * (venture.phone.access): the engine makes the one-time link and draws its code; how long it works comes from the
 * engine's expiresAt, never a typed number.
 */
export function PhoneRow() {
  const t = useT();
  const clock = useClock();
  const client = useEngine();
  const headId = useId();
  const read = useResource('venture.phone.access', {});
  const [view, setView] = useState<PhoneAccessView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = view ?? read.data ?? null;

  async function pair() {
    setBusy(true);
    setProblem(null);
    try { setView(await client.request('venture.phone.access', { action: 'link', via: 'wifi' })); }
    catch (error) { setProblem(t('connections.phone.failed', { message: error instanceof Error ? error.message : String(error) })); }
    finally { setBusy(false); }
  }

  const minutes = shown?.link && shown.expiresAt ? Math.max(1, Math.round((Date.parse(shown.expiresAt) - clock().getTime()) / 60_000)) : null;
  return (
    <Tile as="section" labelledBy={headId}>
      <TileHead id={headId} title={t('connections.phone.title')} />
      {shown?.link ? (
        <>
          {shown.qr && <QrCode rows={shown.qr.rows} label={t('connections.phone.qr')} />}
          {minutes !== null && <p className={s.line}>{t('connections.phone.works', { count: String(minutes) })}</p>}
        </>
      ) : <p className={s.line}>{t('connections.phone.line')}</p>}
      <div>
        <Button variant={shown?.link ? 'quiet' : 'secondary'} disabled={busy} onClick={() => void pair()}>{t(shown?.link ? 'connections.phone.again' : 'connections.phone.pair')}</Button>
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Tile>
  );
}
