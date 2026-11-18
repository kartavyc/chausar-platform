import { useId, useState } from 'react';
import { useT } from '../../text';
import { useClock } from '../../shell/clock';
import { usePhoneAccess } from '../../engine/usePhoneAccess';
import { Button } from '../../parts/Button';
import { QrCode } from '../../parts/QrCode';
import { Tile, TileHead } from '../../parts/Tile';
import s from './Connections.module.css';

/**
 * C5 task 3: pair the phone by QR code, in Connections. The same engine call as Business > Notifications
 * (venture.phone.access): the engine makes the one-time link and draws its code; how long it works comes from the
 * engine's expiresAt, never a typed number. Whenever the engine says phone access is on, the row says so in the
 * engine's words and offers Stop, whoever made the link and whether or not its code still shows (usePhoneAccess).
 */
export function PhoneRow() {
  const t = useT();
  const clock = useClock();
  const headId = useId();
  const phone = usePhoneAccess();
  const [problem, setProblem] = useState<string | null>(null);
  const { status, made, busy } = phone;

  async function act(run: () => Promise<void>) {
    setProblem(null);
    try { await run(); }
    catch (error) { setProblem(t('connections.phone.failed', { message: error instanceof Error ? error.message : String(error) })); }
  }

  const minutes = made?.link && made.expiresAt ? Math.max(1, Math.round((Date.parse(made.expiresAt) - clock().getTime()) / 60_000)) : null;
  return (
    <Tile as="section" labelledBy={headId}>
      <TileHead id={headId} title={t('connections.phone.title')} />
      {made?.link ? (
        <>
          {made.qr && <QrCode rows={made.qr.rows} label={t('connections.phone.qr')} />}
          {minutes !== null && <p className={s.line}>{t('connections.phone.works', { count: String(minutes) })}</p>}
        </>
      ) : <p className={s.line} role={status?.on ? 'status' : undefined}>{status?.on ? status.line : t('connections.phone.line')}</p>}
      <div className={s.phoneButtons}>
        <Button variant={made?.link ? 'quiet' : 'secondary'} disabled={busy} onClick={() => void act(() => phone.link('wifi'))}>{t(made?.link ? 'connections.phone.again' : 'connections.phone.pair')}</Button>
        {status?.on && <Button variant="secondary" disabled={busy} onClick={() => void act(phone.stop)}>{t('connections.phone.stop')}</Button>}
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Tile>
  );
}
