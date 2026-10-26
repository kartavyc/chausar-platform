/**
 * NEVER_CONTACT_LOST (4J6; NOTES item 44): the never-contact list of the businesses on this computer can no longer be
 * checked (its key lost or changed, the file changed), so the network drafts nothing. Wherever the network refuses for
 * that reason this says so plainly, and "Start a new list" asks once more, with the open business's name typed in, then
 * calls workspace.custody.neverContactReset { confirmation }. What the reset means is said before it: each business
 * adds its own blocklist again when next opened, and people forgotten in other businesses can't be put back. The
 * engine's own line says what it did.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Icon } from '../../parts/Icon';
import { messageOf } from './network';
import s from './Network.module.css';

export function NeverContactLost() {
  const t = useT();
  const engine = useEngine();
  const status = useResource('workspace.status', {});
  const name = status.data?.workspace?.name ?? '';
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setProblem(null);
    try {
      const { line } = await engine.request('workspace.custody.neverContactReset', { confirmation: typed });
      setDone(line);
      setAsking(false);
    } catch (error) {
      setProblem(t('clients.network.neverContact.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className={s.said} role="status">{done}</p>;
  return (
    <div className={s.lost} data-never-contact-lost="">
      <p className={s.lostLine} role="alert"><Icon name="triangle-alert" size={16} />{t('clients.network.neverContact.line')}</p>
      {!asking ? (
        <Button size="sm" onClick={() => setAsking(true)}>{t('clients.network.neverContact.reset')}</Button>
      ) : (
        <div className={s.ask}>
          <p className={s.quiet}>{t('clients.network.neverContact.ask')}</p>
          {name && <Field label={t('clients.network.neverContact.type', { name })} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />}
          <div className={s.actions}>
            <Button variant="quiet" size="sm" onClick={() => { setAsking(false); setTyped(''); }}>{t('clients.network.neverContact.keep')}</Button>
            <Button size="sm" disabled={busy || !name || typed !== name} onClick={() => void reset()}>{t('clients.network.neverContact.confirm')}</Button>
          </div>
          {problem && <p className={s.problem} role="alert">{problem}</p>}
        </div>
      )}
    </div>
  );
}
