/**
 * TL-08 Other assistants (tools/assistants): the verified-numbers server for other AI
 * assistants. Off by default with a switch; the server card; one row per allowed assistant
 * with its last call and Remove; pairing that shows the code once; the call list with the
 * client, the calculation, the receipt id (which opens the receipt) and what the
 * disclosure check removed; a call that asked to change something is shown as refused.
 */
import { useState, type FormEvent } from 'react';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { KeyValue } from '../../parts/KeyValue';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { Group, Note, Screen } from '../trust/kit/Screen';
import { Line, Lines, SentLine, day, isAdmin, toolsWords, type Words } from './shared';
import { assistants, pairing, type Assistants } from './validate.ts';
import { fill } from './words.ts';
import s from './Assistants.module.css';

function Pair({ props, w, onPaired }: { props: PlaceRenderProps; w: Words; onPaired: () => void }) {
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const pair = useSend(props.rpc, pairing);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === '') return;
    setCopied(false);
    if (await pair.send('trustx.pairAssistant', { name }) !== null) { setName(''); onPaired(); }
  };
  const shown = pair.sent.kind === 'done' ? pair.sent.value : null;
  return (
    <Group title={w.pair}>
      {shown === null ? (
        <>
          <form className={s.form} onSubmit={submit}>
            <Field label={w.assistantName} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            <Button submit disabled={name.trim() === '' || pair.sent.kind === 'sending'}>{w.pairIt}</Button>
          </form>
          <SentLine sent={pair.sent} w={w} />
        </>
      ) : (
        <div className={s.token} role="region" aria-label={w.code}>
          <p className={s.small}>{w.code}</p>
          <code className={[s.code, 'fig'].join(' ')}>{shown.token}</code>
          <p className={s.p}>{w.shownOnce}</p>
          <p className={s.note}>{fill(w.useBy, { date: day(shown.expiresAt, props.language) })}</p>
          <div className={s.buttons}>
            <Button onClick={async () => { try { await navigator.clipboard.writeText(shown.token); setCopied(true); } catch { setCopied(false); } }}>{w.copy}</Button>
            <Button variant="link" onClick={() => { setCopied(false); pair.clear(); }}>{w.done}</Button>
          </div>
          {copied && <p className={s.note} role="status">{w.copied}</p>}
        </div>
      )}
    </Group>
  );
}

function Body({ value, props, w, reload }: { value: Assistants; props: PlaceRenderProps; w: Words; reload: () => void }) {
  const admin = isAdmin(props), books = props.view === 'books';
  const change = useSend(props.rpc, assistants);
  const sendChange = async (method: string, payload: Record<string, unknown>) => { if (await change.send(method, payload) !== null) reload(); };
  return (
    <>
      <p className={s.rule}>{w.rule}</p>
      {props.viewer && <Note>{w.readOnly}</Note>}
      <div className={s.switch}>
        {admin
          ? <Choice<'off' | 'on'> label={w.letAssistants} form="pair" value={value.on ? 'on' : 'off'} disabled={change.sent.kind === 'sending'}
              options={[{ value: 'off', label: w.off }, { value: 'on', label: w.on }]}
              onChange={(v) => { if ((v === 'on') !== value.on) void sendChange('trustx.setAssistants', { on: v === 'on' }); }} />
          : <KeyValue onReceipt={props.openReceipt} pairs={[{ name: w.letAssistants, value: value.on ? w.on : w.off }]} />}
        <Note>{w.offByDefault}</Note>
      </div>
      <SentLine sent={change.sent} w={w} />
      <Group title={w.server}>
        <KeyValue onReceipt={props.openReceipt} pairs={[{ name: w.serverVersion, value: value.server.version, mono: true }, { name: w.reach, value: w.thisComputer }]} />
      </Group>
      <Group title={w.allowed}>
        {value.assistants.length === 0 ? <Note>{w.noAssistants}</Note> : (
          <Lines label={w.allowed}>
            {value.assistants.map((a) => (
              <Line key={a.id} title={a.name} notes={[
                fill(w.pairedOn, { date: day(a.pairedAt, props.language) }),
                a.lastCall === null ? w.noCallYet : fill(w.lastCall, { date: day(a.lastCall, props.language) }),
                a.active ? null : w.removedSeat, books ? a.id : null,
              ]} after={admin && a.active ? <Button disabled={change.sent.kind === 'sending'} onClick={() => { void sendChange('trustx.revokeAssistant', { id: a.id }); }}>{w.remove}</Button> : undefined} />
            ))}
          </Lines>
        )}
      </Group>
      {props.member.role === 'owner' && !props.viewer && <Pair props={props} w={w} onPaired={reload} />}
      <Group title={w.calls}>
        {value.calls.length === 0 ? <Note>{w.noCalls}</Note> : (
          <Lines label={w.calls}>
            {value.calls.map((c) => (
              <Line key={c.id} title={c.calculation} notes={[
                c.client, fill(w.callOn, { date: day(c.at, props.language) }),
                c.refused ? w.refusedCall : c.removed.length === 0 ? w.removedNothing : null, books ? c.id : null,
              ]} after={c.receiptId === null ? <span className={s.note}>{w.noReceipt}</span>
                : <Button variant="link" className="fig" aria-label={fill(w.receiptOf, { id: c.receiptId })} onClick={() => props.openReceipt(c.receiptId as string)}>{c.receiptId}</Button>}>
                {!c.refused && c.removed.length > 0 && <div><p className={s.note}>{w.removedBy}</p><ul className={s.list}>{c.removed.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              </Line>
            ))}
          </Lines>
        )}
      </Group>
    </>
  );
}

export function AssistantsPlace(props: PlaceRenderProps) {
  const w = toolsWords(props.language);
  const { state, reload } = useEngine(props.rpc, 'trustx.assistants', {}, assistants);
  return (
    <Screen where={w.where} title={w['title.assistants']} loaded={state}>
      {(value) => <Body value={value} props={props} w={w} reload={reload} />}
    </Screen>
  );
}
