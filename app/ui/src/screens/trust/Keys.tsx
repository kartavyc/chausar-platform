/**
 * Trust · Keys, at `trust/keys`: the key each connection uses, over connectors-ext's `connectorsx.connections`,
 * `connectorsx.credentials.status`, `connectorsx.credentials.set` and `connectorsx.credentials.remove`. A key is
 * typed into a password field, emptied before the request is awaited, and never shown back: the status says only
 * whether one is stored, its kind and since when. Removing one asks once more.
 */
import { useState, type FormEvent } from 'react';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { State } from '../../patterns/States';
import { useEngine, useSend } from './kit/engine.ts';
import { Note, Screen, screenState } from './kit/Screen';
import { AskTwice, Tag, dayText, powers, type P } from './common';
import { rtt } from './rtt.ts';
import { Said } from './rtt-parts';
import { validateConnections, validateCredentialRemoved, validateCredentialSet, validateCredentialStatus, type Connection, type CredentialStatus } from './validate-hosted.ts';
import s from './Trust.module.css';

export function KeysScreen(p: P) {
  const say = rtt(p.language);
  const { state } = useEngine(p.rpc, 'connectorsx.connections', {}, validateConnections);
  return (
    <Screen where={say('RTT.keys.where')} title={say('RTT.keys.title')} loaded={state}>
      {(items) => (
        <>
          <Note>{say('RTT.keys.note')}</Note>
          {!powers(p).admin && <Note>{say('RTT.keys.adminOnly')}</Note>}
          {items.length === 0 ? <p className={s.quiet}>{say('RTT.keys.none')}</p> : (
            <ul className={s.list}>{items.map((c) => <KeyRow key={c.id} p={p} c={c} />)}</ul>
          )}
        </>
      )}
    </Screen>
  );
}

function statusLine(x: CredentialStatus, say: ReturnType<typeof rtt>, p: P): string {
  if (!x.available) return say('RTT.keys.storeOff');
  if (!x.present) return say('RTT.keys.absent');
  if (x.storedAt === null) return say('RTT.keys.presentNoDate');
  return say(x.kind === 'oauth' ? 'RTT.keys.signedIn' : 'RTT.keys.present', { date: dayText(x.storedAt, p.language) });
}

function KeyRow({ p, c }: { p: P; c: Connection }) {
  const say = rtt(p.language);
  const { admin } = powers(p);
  const { state, reload } = useEngine(p.rpc, 'connectorsx.credentials.status', { connectionId: c.id }, validateCredentialStatus);
  return (
    <li className={s.item} data-connection={c.id}>
      <span className={s.itemHead}><span className={s.name}>{c.label}</span><span className={s.quiet}>{c.group}</span>{c.paused && <Tag>{say('RTT.keys.paused')}</Tag>}</span>
      {state.kind !== 'ready' ? <State state={screenState(state)} /> : (
        <>
          <span className={s.quiet} data-key={state.value.present ? state.value.kind ?? '' : 'absent'}>{statusLine(state.value, say, p)}</span>
          {admin && state.value.available && <KeyForm p={p} c={c} x={state.value} reload={reload} />}
        </>
      )}
    </li>
  );
}

function KeyForm({ p, c, x, reload }: { p: P; c: Connection; x: CredentialStatus; reload: () => void }) {
  const say = rtt(p.language);
  const [secret, setSecret] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const save = useSend(p.rpc, validateCredentialSet);
  const remove = useSend(p.rpc, validateCredentialRemoved);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = secret;
    // The field is emptied before the request goes; nothing typed is kept in this screen.
    setSecret('');
    if (typed.length === 0) { setProblem(say('RTT.keys.needKey')); return; }
    if (typed.length < 4 || typed.length > 4096 || /[\u0000-\u001f]/.test(typed)) { setProblem(say('RTT.keys.badKey')); return; }
    setProblem(undefined);
    if (await save.send('connectorsx.credentials.set', { connectionId: c.id, secret: typed }) !== null && p.live(p.address)) reload();
  };
  const drop = async () => { if (await remove.send('connectorsx.credentials.remove', { connectionId: c.id }) !== null && p.live(p.address)) reload(); };
  return (
    <div className={s.stack}>
      {x.kind !== 'oauth' && (
        <form className={s.form} onSubmit={(e) => void submit(e)}>
          <Field label={say('RTT.keys.field')} type="password" autoComplete="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.currentTarget.value)} problem={problem} />
          <Button submit disabled={save.sent.kind === 'sending'}>{say(x.present ? 'RTT.keys.replace' : 'RTT.keys.save')}</Button>
        </form>
      )}
      <Said sent={save.sent} done={() => say('RTT.keys.saved')} language={p.language} />
      {x.present && (
        <span><AskTwice label={say('RTT.keys.remove')} ask={say('RTT.keys.removeAsk', { name: c.label })} confirmLabel={say('RTT.keys.remove')}
          onConfirm={() => void drop()} language={p.language} disabled={remove.sent.kind === 'sending'} /></span>
      )}
      <Said sent={remove.sent} done={(r) => say(r.removed ? 'RTT.keys.removed' : 'RTT.keys.nothingRemoved')} language={p.language} />
    </div>
  );
}
