/**
 * TL-09 Phone (tools/phone): WhatsApp and mail, each with its switch; your mail address and
 * phone number, each with Save and Verify; the exact text of each message; your agreement
 * with its date; messages this month against 30; the cost of each; what may be approved
 * from the phone. The relay is a paid hosted part that is planned and not available yet:
 * that sentence is shown whenever it is so, and also when the phone methods are not built.
 */
import { useState } from 'react';
import type { PlaceRenderProps } from '../../places/types.ts';
import { count } from '../../format/index.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { State } from '../../patterns/States';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { rupees } from '../trust/kit/figure.ts';
import { Group, Note, Screen, screenState } from '../trust/kit/Screen';
import { PHONE, channels, preview, usage, type Channel, type Channels } from './adapters/phone.ts';
import { Line, Lines, Quoted, SentLine, Warn, day, toolsWords, type Words } from './shared';
import { anyObject } from './validate.ts';
import { fill } from './words.ts';
import s from './Phone.module.css';

function ChannelLine({ c, props, w, onChanged }: { c: Channel; props: PlaceRenderProps; w: Words; onChanged: () => void }) {
  const [address, setAddress] = useState(c.address ?? '');
  const change = useSend(props.rpc, anyObject);
  const [done, setDone] = useState<string | undefined>(undefined);
  const send = async (method: string, payload: Record<string, unknown>, sentence: string) => {
    setDone(sentence);
    if (await change.send(method, payload) !== null) onChanged();
  };
  const busy = change.sent.kind === 'sending';
  return (
    <Line title={w[`channel.${c.id}`]} notes={[
      c.verified ? w.verified : w.notVerified,
      c.agreedOn === null ? w.notAgreed : fill(w.agreedOn, { date: day(c.agreedOn, props.language) }),
      c.costMinor === null ? w.costUnknown : fill(w.cost, { cost: rupees(c.costMinor) }),
    ]} after={props.viewer ? <span className={s.note}>{c.on ? w.on : w.off}</span> : (
      <Choice<'off' | 'on'> label={w[`channel.${c.id}`]} labelHidden form="pair" value={c.on ? 'on' : 'off'} disabled={busy}
        options={[{ value: 'off', label: w.off }, { value: 'on', label: w.on }]}
        onChange={(v) => { if ((v === 'on') !== c.on) void send(PHONE.optIn, { channel: c.id, on: v === 'on' }, ''); }} />
    )}>
      {!props.viewer && (
        <form className={s.address} onSubmit={(e) => { e.preventDefault(); if (address.trim() !== '' && address !== c.address) void send(PHONE.optIn, { channel: c.id, on: c.on, address }, w.saved); }}>
          <Field label={w[`field.${c.id}`]} type={c.id === 'mail' ? 'email' : 'tel'} autoComplete={c.id === 'mail' ? 'email' : 'tel'} maxLength={320}
            value={address} onChange={(e) => setAddress(e.target.value)} />
          <Button submit disabled={busy || address.trim() === '' || address === c.address}>{w.save}</Button>
          <Button disabled={busy || c.address === null || c.verified} onClick={() => { void send(PHONE.verify, { channel: c.id }, w.verifySent); }}>{w.verify}</Button>
        </form>
      )}
      <SentLine sent={change.sent} done={done === '' ? undefined : done} w={w} />
    </Line>
  );
}

function Ready({ value, props, w, reload }: { value: Channels; props: PlaceRenderProps; w: Words; reload: () => void }) {
  const messages = useEngine(props.rpc, PHONE.preview, {}, preview);
  const month = useEngine(props.rpc, PHONE.usage, {}, usage);
  const ordered = (['whatsapp', 'mail'] as const).flatMap((id) => value.channels.filter((c) => c.id === id));
  return (
    <>
      {value.relay === 'not-available' && <Warn>{w.relay}</Warn>}
      {value.testMode && <p className={s.p} role="status">{w.testMode}</p>}
      {props.viewer && <Note>{w.readOnly}</Note>}
      <Group title={w.channels}>
        <Lines label={w.channels}>{ordered.map((c) => <ChannelLine key={c.id} c={c} props={props} w={w} onChanged={reload} />)}</Lines>
      </Group>
      <Group title={w.messages}>
        {messages.state.kind !== 'ready' ? <State state={screenState(messages.state)} />
          : messages.state.value.length === 0 ? <Note>{w.noMessages}</Note>
          : <div className={s.messages}>{messages.state.value.map((m) => <Quoted key={m.id}>{m.text}</Quoted>)}</div>}
      </Group>
      <Group title={w.month}>
        {month.state.kind !== 'ready' ? <State state={screenState(month.state)} />
          : <p className={s.p}>{fill(w.usage, { sent: count(String(month.state.value.sent)), budget: count(String(month.state.value.budget)), month: month.state.value.month })}</p>}
      </Group>
      <Group title={w.fromPhone}><p className={s.p}>{w.fromPhoneRule}</p></Group>
      <Group title={w.helpStop}><p className={s.p}>{w.help}</p><p className={s.p}>{w.stop}</p></Group>
    </>
  );
}

export function PhonePlace(props: PlaceRenderProps) {
  const w = toolsWords(props.language);
  const { state, reload } = useEngine(props.rpc, PHONE.channels, {}, channels);
  return (
    <div className={s.page}>
      <Screen where={w.where} title={w['title.phone']} loaded={state}>
        {(value) => <Ready value={value} props={props} w={w} reload={reload} />}
      </Screen>
      {state.kind === 'not-built' && <Warn>{w.relay}</Warn>}
    </div>
  );
}
