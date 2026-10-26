/**
 * Connections, "Your calendar" (Ink v2 wave 4, 4E4; the engine's 4E3 venture.network.calendar): the private address of
 * the owner's calendar, read through the network guard each morning (no redirect is followed), so calls with people
 * in the network add to how well the owner knows them and ask for notes after the call. The address is private, like
 * a key: its field is outside any form, autocomplete off, and cleared in a finally; the engine keeps it in memory only,
 * so after a restart the owner pastes it again. Remove forgets it. Desktop only: the hosted app says so.
 *
 * Its state is read on load from the network's sources (venture.network.sources carries it, never the address),
 * with the next morning read; what setting or removing it answers since stands until the sources are read again.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { useMoment } from '../money/words';
import { Button } from '../../parts/Button';
import { ConnectorLabel } from '../../parts/ConnectorLabel';
import { Field } from '../../parts/Field';
import { Tile, TileHead } from '../../parts/Tile';
import type { CalendarFeedView } from '../../engine/types';
import s from './Mailbox.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function CalendarFeed() {
  const t = useT();
  const engine = useEngine();
  const titleId = useId();
  const moment = useMoment();
  const sources = useResource('venture.network.sources', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const [answered, setAnswered] = useState<CalendarFeedView | null>(null);
  const view = answered ?? sources.data?.calendar ?? undefined;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Simple first: the address field is one step away.
  const [opened, setOpened] = useState(false);
  const hosted = engine.transport === 'hosted';

  async function save(address: string) {
    if (busy) return;
    setUrl('');
    setBusy(true);
    setProblem(null);
    try {
      const next = await engine.request('venture.network.calendar', { url: address });
      setAnswered(next);
      setOpened(false);
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setUrl('');
      setBusy(false);
    }
  }

  return (
    <Tile as="section" labelledBy={titleId} className={s.card} data-calendar-feed="">
      <TileHead id={titleId} title={t('connections.mailbox.calendar.title')} end={<ConnectorLabel label="read" />} />
      <p className={s.quiet}>{t('connections.mailbox.calendar.line')}</p>
      {hosted ? (
        <p className={s.quiet} data-desktop-only="">{t('connections.mailbox.calendar.desktopOnly')}</p>
      ) : (
        <>
          {view && <p className={s.said} data-calendar-line="">{view.line}</p>}
          {view?.nextRead && <p className={s.quiet} data-next-read="">{t('connections.mailbox.calendar.next', { when: moment(view.nextRead) })}</p>}
          {!opened && (
            <div className={s.actions}>
              <Button size="sm" onClick={() => setOpened(true)}>{view?.set ? t('connections.mailbox.calendar.replace') : t('connections.mailbox.calendar.add')}</Button>
              {view?.set && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void save('')}>{t('connections.mailbox.calendar.remove')}</Button>}
            </div>
          )}
          {opened && <div className={s.form}>
            <Field
              label={t('connections.mailbox.calendar.url')}
              hint={t('connections.mailbox.calendar.urlHint')}
              type="password" autoComplete="off" spellCheck={false} value={url} disabled={busy}
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
            <div className={s.actions}>
              <Button disabled={busy || !url.trim()} onClick={() => void save(url.trim())}>{t('connections.mailbox.calendar.save')}</Button>
            </div>
          </div>}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
        </>
      )}
    </Tile>
  );
}
