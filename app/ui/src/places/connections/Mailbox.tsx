/**
 * Connections, "Your mailbox" (Ink v2 wave 4, 4E4; the engine's 4E3 venture.mailbox.*): the owner's own inbox, read
 * only, over IMAP with an app password, so Chausar sees replies from people in the network or the pipeline. It never
 * sends mail and never marks a message read. Desktop only: the hosted app says so and offers nothing.
 *
 * The app password never outlives the click (W1's U15 rule): its field sits outside any form (so no browser offers to
 * save it), autocomplete off, sent from a button and cleared in a finally, whether Connect worked or not. The engine
 * keeps it in memory only, so after a restart the owner types it again (the engine's line says so). An account that
 * allows only Google or Microsoft sign-in cannot connect this way (MAILBOX_OAUTH_ONLY), said before and when it happens.
 *
 * The mailbox's state is read on load from the network's sources (venture.network.sources carries it, never the
 * password); what connect, read or disconnect answers since stands until the sources are read again.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { ConnectorLabel } from '../../parts/ConnectorLabel';
import { Field } from '../../parts/Field';
import { Inner } from '../../parts/Card';
import { Tile, TileHead } from '../../parts/Tile';
import type { MailboxView } from '../../engine/types';
import { EngineError } from '../../engine/types';
import s from './Mailbox.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function Mailbox() {
  const t = useT();
  const engine = useEngine();
  const titleId = useId();
  const sources = useResource('venture.network.sources', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const [answered, setAnswered] = useState<MailboxView | null>(null);
  const view = answered ?? sources.data?.mailbox ?? undefined;
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  // Simple first: the form is one step away, behind Connect.
  const [opened, setOpened] = useState(false);
  const hosted = engine.transport === 'hosted';
  const keep = (next: MailboxView) => setAnswered(next);
  // Connected, but the engine says the password left its shelf with a restart: the password field shows at once,
  // in place of Read new mail. Not connected: Connect opens the form, one step away.
  const retype = Boolean(view?.connected && view.needsPassword);
  const needsPassword = retype || !view || !view.connected || said?.problem === true;

  async function sync() {
    setSaid(null);
    try {
      const result = await engine.request('venture.mailbox.sync', {});
      keep(result.mailbox);
      setSaid({ text: result.line, problem: false });
    } catch (error) {
      setSaid({ text: messageOf(error), problem: true });
    }
  }

  async function disconnect() {
    setSaid(null);
    try {
      keep(await engine.request('venture.mailbox.disconnect', {}));
      setAsking(false);
    } catch (error) {
      setSaid({ text: messageOf(error), problem: true });
    }
  }

  return (
    <Tile as="section" labelledBy={titleId} className={s.card} data-mailbox="">
      <TileHead id={titleId} title={t('connections.mailbox.title')} end={<ConnectorLabel label="read" />} />
      <p className={s.quiet}>{t('connections.mailbox.line')}</p>
      {hosted ? (
        <p className={s.quiet} data-desktop-only="">{t('connections.mailbox.desktopOnly')}</p>
      ) : (
        <>
          {view && <p className={s.said} data-mailbox-line="">{view.line}</p>}
          {view?.connected && !retype && (
            <div className={s.actions}>
              <Button size="sm" onClick={() => void sync()}>{t('connections.mailbox.read')}</Button>
              {!asking && <Button size="sm" variant="quiet" onClick={() => setAsking(true)}>{t('connections.mailbox.disconnect')}</Button>}
            </div>
          )}
          {asking && (
            <Inner card={false} className={s.ask}>
              <p>{t('connections.mailbox.disconnect.ask')}</p>
              <div className={s.actions}>
                <Button size="sm" variant="quiet" onClick={() => setAsking(false)}>{t('connections.mailbox.disconnect.keep')}</Button>
                <Button size="sm" onClick={() => void disconnect()}>{t('connections.mailbox.disconnect.yes')}</Button>
              </div>
            </Inner>
          )}
          {said && <p className={said.problem ? s.problem : s.said} role="status">{said.text}</p>}
          {needsPassword && !retype && !opened && <div className={s.actions}><Button size="sm" onClick={() => setOpened(true)}>{t('connections.mailbox.open')}</Button></div>}
          {needsPassword && (opened || retype) && <ConnectForm view={view} onConnected={(next) => { keep(next); setSaid(null); setOpened(false); }} />}
        </>
      )}
    </Tile>
  );
}

/** Server, port, address and the app password; Connect signs in read-only first, then keeps the mailbox. */
function ConnectForm({ view, onConnected }: { view: MailboxView | undefined; onConnected: (view: MailboxView) => void }) {
  const t = useT();
  const engine = useEngine();
  const [host, setHost] = useState(view?.host ?? '');
  const [port, setPort] = useState('993');
  const [user, setUser] = useState(view?.user ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; oauth: boolean } | null>(null);

  async function connect() {
    if (busy) return;
    const typed = password;
    setPassword('');
    setBusy(true);
    setProblem(null);
    try {
      onConnected(await engine.request('venture.mailbox.connect', { host: host.trim(), port: Number(port), user: user.trim(), appPassword: typed }));
    } catch (error) {
      setProblem({ text: messageOf(error), oauth: error instanceof EngineError && error.code === 'MAILBOX_OAUTH_ONLY' });
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <div className={s.form} data-mailbox-form="">
      <div className={s.row}>
        <Field label={t('connections.mailbox.host')} hint={t('connections.mailbox.hostHint')} value={host} autoComplete="off" spellCheck={false} onChange={(event) => setHost(event.currentTarget.value)} />
        <Field label={t('connections.mailbox.port')} inputMode="numeric" value={port} autoComplete="off" onChange={(event) => setPort(event.currentTarget.value)} />
      </div>
      <Field label={t('connections.mailbox.user')} type="email" value={user} autoComplete="off" spellCheck={false} onChange={(event) => setUser(event.currentTarget.value)} />
      <Field
        label={t('connections.mailbox.password')}
        hint={t('connections.mailbox.passwordHint')}
        type="password" autoComplete="off" spellCheck={false} value={password} disabled={busy}
        onChange={(event) => setPassword(event.currentTarget.value)}
      />
      <p className={s.quiet} data-oauth-line="">{t('connections.mailbox.oauth')}</p>
      <div className={s.actions}>
        <Button disabled={busy || !host.trim() || !user.trim() || !password} onClick={() => void connect()}>{t('connections.mailbox.connect')}</Button>
      </div>
      {problem && <p className={s.problem} role="alert" data-oauth={problem.oauth ? '' : undefined}>{problem.text}</p>}
    </div>
  );
}
