/**
 * TL-09 Phone (tools/phone), over hosted-link's methods through adapters/phone.ts.
 * Guided and Books: your phone number with Verify (hosted-link pairs this computer with a code
 * sent to it); WhatsApp, Telegram and mail, each with its switch, which turns on only after the
 * exact opt-in text is agreed to; your mail address, with Check (`phone.verify {channel:'mail'}`:
 * confirmed once the link in the confirmation mail was used) and the same check for WhatsApp; the
 * exact text of every message; your agreement with its date; messages this month against 30, what
 * they cost, and one line per channel with its count and, as the engine gives them, its cost and
 * price per message (otherwise words, never zero); what may be approved from the phone;
 * HELP and STOP. Books adds message ids, the engine's own reply texts and the count per channel.
 * Simple: two switches, WhatsApp and mail, the count, HELP and STOP, and a link that opens the
 * exact messages (nothing is hidden for good). The relay sentence shows whenever the
 * hosted part is not set up; test mode shows in demo.
 */
import { useState, type FormEvent } from 'react';
import { count } from '../../format/index.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice, YesNo } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { rupees } from '../trust/kit/figure.ts';
import { Group, Note, Screen } from '../trust/kit/Screen';
import { CHANNEL_IDS, MESSAGE_BUDGET, PAIR_CODE, PHONE, PHONE_NUMBER, VERIFIABLE, channels, counts, pairStarted, paired, preview, relayCode, status, verified,
  type Channel, type ChannelId, type Counts, type Preview, type Status } from './adapters/phone.ts';
import { LaneSent, laneSay, type Say } from './lane';
import { Line, Lines, Names, Part, Quoted, SentLine, Warn, day, isAdmin, toolsWords, type Words } from './shared';
import { anyObject } from './validate.ts';
import { fill } from './words.ts';
import s from './Phone.module.css';

/** Turning a channel on needs the ticked opt-in; turning it off withdraws it. */
function ChannelLine({ c, optInText, st, props, w, simple, onChanged }: {
  c: Channel; optInText: string | null; st: Status; props: PlaceRenderProps; w: Words; simple: boolean; onChanged: () => void;
}) {
  const admin = isAdmin(props);
  const [agreed, setAgreed] = useState(false);
  const [address, setAddress] = useState(c.relay?.address ?? '');
  const [badAddress, setBadAddress] = useState(false);
  const change = useSend(props.rpc, anyObject);
  const [done, setDone] = useState<string | undefined>(undefined);
  const send = async (payload: Record<string, unknown>, sentence: string) => {
    setDone(sentence);
    if (await change.send(PHONE.set, payload) !== null && props.live(props.address)) { setAgreed(false); onChanged(); }
  };
  const busy = change.sent.kind === 'sending';
  const agreedAt = c.agreedAt ?? c.relay?.agreedAt ?? null;
  const relay = c.relay?.status ?? null;
  const notes = [
    relay === null ? (c.on ? w.on : w.off) : w[`relay.${relay}`],
    agreedAt === null ? w.notAgreed : fill(w.agreedOn, { date: day(agreedAt, props.language) }),
    c.id === 'mail' ? null : st.paired ? null : w.notVerified,
  ];
  const verifiable = (VERIFIABLE as readonly string[]).includes(c.id) && !simple && !props.viewer;
  const saveAddress = (e: FormEvent) => {
    e.preventDefault();
    const typed = address.trim();
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,63}$/.test(typed)) { setBadAddress(true); return; }
    setBadAddress(false);
    void send({ channel: 'mail', enabled: false, optIn: false, address: typed }, w.saved);
  };
  return (
    <Line title={w[`channel.${c.id}`]} notes={notes} after={!admin ? undefined : (
      <Choice<'off' | 'on'> label={w[`channel.${c.id}`]} labelHidden form="pair" value={c.on ? 'on' : 'off'} disabled={busy || (!c.on && !agreed)}
        options={[{ value: 'off', label: w.off }, { value: 'on', label: w.on }]}
        onChange={(v) => {
          if (v === 'off' && c.on) void send({ channel: c.id, enabled: false, optIn: false }, w.turnedOff);
          if (v === 'on' && !c.on && agreed) void send({ channel: c.id, enabled: true, optIn: true }, w.turnedOn);
        }} />
    )}>
      {relay === 'stopped' && <p className={s.note}>{w.stoppedNote}</p>}
      {relay === 'awaiting-start' && c.relay?.connectUrl != null && <><p className={s.note}>{w.connect}</p><Quoted>{c.relay.connectUrl}</Quoted></>}
      {admin && !c.on && (
        <div className={s.agree}>
          {optInText === null ? <p className={s.note}>{w.optInUnknown}</p> : <Quoted label={w.optInLabel}>{optInText}</Quoted>}
          {optInText !== null && <YesNo label={fill(w.agreeTo, { channel: w[`channel.${c.id}`] })} value={agreed} onChange={setAgreed} disabled={busy} />}
        </div>
      )}
      {c.id === 'mail' && !simple && admin && (c.on ? <p className={s.note}>{w.addressWhileOn}</p> : (
        <form className={s.address} onSubmit={saveAddress} noValidate>
          <Field label={w['field.mail']} type="email" autoComplete="email" maxLength={254} value={address}
            onChange={(e) => { setAddress(e.target.value); setBadAddress(false); }} problem={badAddress ? w.badAddress : undefined} />
          <Button submit disabled={busy || address.trim() === '' || address.trim() === c.relay?.address}>{w.save}</Button>
        </form>
      ))}
      {c.id === 'mail' && !simple && !admin && c.relay?.address != null && <p className={s.note}>{c.relay.address}</p>}
      {verifiable && <VerifyAddress channel={c.id as (typeof VERIFIABLE)[number]} props={props} w={w} />}
      <SentLine sent={change.sent} done={done} w={w} />
    </Line>
  );
}

/**
 * TL-09 Verify: asks hosted-link whether this channel's address is confirmed (`phone.verify`). Mail
 * is confirmed once the link in its confirmation mail was used; nothing is sent until it is. A relay
 * that is absent, unconfigured or unpaired reads as the relay sentence (RELAY_NOT_AVAILABLE).
 */
function VerifyAddress({ channel, props, w }: { channel: (typeof VERIFIABLE)[number]; props: PlaceRenderProps; w: Words }) {
  const say = laneSay(props.language);
  const check = useSend(props.rpc, verified);
  return (
    <div className={s.agree}>
      <div><Button disabled={check.sent.kind === 'sending'} onClick={() => { void check.send(PHONE.verify, { channel }); }}>{say(`phone.verify.${channel}`)}</Button></div>
      {check.sent.kind === 'done'
        ? <p className={s.note} role="status">{check.sent.value.verified ? say(`phone.verified.${channel}`) : say(`phone.notVerified.${channel}`)}</p>
        : <LaneSent sent={check.sent} say={say} w={w} map={relayCode} />}
    </div>
  );
}

/** Your phone number, verified by the code hosted-link sends to it: this pairs the computer. */
function YourPhone({ st, props, w, onPaired }: { st: Status; props: PlaceRenderProps; w: Words; onPaired: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState(w.computerName);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const start = useSend(props.rpc, pairStarted);
  const finish = useSend(props.rpc, paired);
  if (st.paired) return <p className={s.p}>{fill(w.phoneVerified, { phone: st.phoneMasked ?? '', date: st.pairedAt === null ? '' : day(st.pairedAt, props.language) })}</p>;
  if (!isAdmin(props)) return <p className={s.note}>{w.notVerified}</p>;
  if (!st.configured) return <p className={s.note}>{w.verifyNeedsRelay}</p>;
  const started = start.sent.kind === 'done' ? start.sent.value : null;
  const ask = (e: FormEvent) => {
    e.preventDefault();
    const typed = phone.replace(/[\s-]/g, '');
    if (!PHONE_NUMBER.test(typed)) { setProblem(w.badPhone); return; }
    setProblem(undefined);
    void start.send(PHONE.pairStart, { phone: typed });
  };
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (started === null) return;
    if (!PAIR_CODE.test(code.trim()) || name.trim() === '') { setProblem(w.badCode); return; }
    setProblem(undefined);
    if (await finish.send(PHONE.pairFinish, { challengeId: started.challengeId, code: code.trim(), deviceName: name.trim() }) !== null && props.live(props.address)) onPaired();
  };
  return started === null ? (
    <form className={s.address} onSubmit={ask}>
      <Field label={w['field.phone']} type="tel" autoComplete="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} problem={problem} />
      <Button submit disabled={start.sent.kind === 'sending' || phone.trim() === ''}>{w.verify}</Button>
      <SentLine sent={start.sent} w={w} />
    </form>
  ) : (
    <form className={s.address} onSubmit={(e) => void confirm(e)}>
      <p className={s.note}>{fill(w.codeSent, { phone: started.phoneMasked })}</p>
      <Field label={w.codeField} inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} problem={problem} />
      <Field label={w.computerField} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <Button submit disabled={finish.sent.kind === 'sending'}>{w.confirmCode}</Button>
      <SentLine sent={finish.sent} done={w.phoneDone} w={w} />
    </form>
  );
}

function Messages({ value, w, books }: { value: Preview; w: Words; books: boolean }) {
  return (
    <div className={s.messages}>
      {value.channels.map((c) => (
        <section key={c.id} className={s.messages} aria-label={w[`channel.${c.id}`]}>
          <h3 className={s.small}>{w[`channel.${c.id}`]}</h3>
          {c.messages.map((m) => (
            <div key={m.event} className={s.message}>
              {books && <p className={[s.note, 'fig'].join(' ')}>{m.event}</p>}
              <Quoted>{m.body}</Quoted>
              <Names names={m.buttons} w={w} />
            </div>
          ))}
          {c.footer !== null && <Quoted>{c.footer}</Quoted>}
        </section>
      ))}
    </div>
  );
}

/** One line per channel: its messages, and its cost and price per message as the engine gives them. */
function costLine(x: Counts['byChannel'][number], w: Words, say: Say): string {
  const cost = x.costPaise === undefined ? say('phone.costNotGiven') : x.costPaise === null ? say('phone.costUnknown') : rupees(x.costPaise);
  const line = say('phone.costLine', { channel: w[`channel.${x.id}`], sent: count(String(x.sent)), cost });
  return x.perMessagePaise === undefined || x.perMessagePaise === null ? line : say('phone.costLinePrice', { line, price: rupees(x.perMessagePaise) });
}

function Month({ props, w, books }: { props: PlaceRenderProps; w: Words; books: boolean }) {
  const month = useEngine(props.rpc, PHONE.counts, {}, counts);
  const say = laneSay(props.language);
  const detail = books || props.view === 'guided';
  return (
    <Part loaded={month.state} w={w}>
      {(m) => (
        <>
          <p className={s.p}>{fill(w.usage, { sent: count(String(m.sent)), budget: count(String(m.budget)), month: m.month })}</p>
          <p className={s.note}>{m.costPaise === null ? w.costUnknown : fill(w.cost, { cost: rupees(m.costPaise) })}</p>
          {detail && m.byChannel.length > 0 && <Names names={m.byChannel.map((x) => costLine(x, w, say))} w={w} />}
        </>
      )}
    </Part>
  );
}

function Ready({ st, props, w, reload }: { st: Status; props: PlaceRenderProps; w: Words; reload: () => void }) {
  const simple = props.view === 'simple', books = props.view === 'books';
  const list = useEngine(props.rpc, PHONE.channels, {}, channels);
  const texts = useEngine(props.rpc, PHONE.preview, {}, preview);
  const optIn = (id: ChannelId) => texts.state.kind === 'ready' ? texts.state.value.channels.find((c) => c.id === id)?.optInText ?? null : null;
  const shown: readonly ChannelId[] = simple ? ['whatsapp', 'mail'] : CHANNEL_IDS;
  const [showTexts, setShowTexts] = useState(false);
  const channelLines = (
    <Part loaded={list.state} w={w}>
      {(value) => (
        <>
          {value.stale && <Note>{value.refreshedAt === null ? w.staleNever : fill(w.stale, { date: day(value.refreshedAt, props.language) })}</Note>}
          <Lines label={w.channels}>
            {shown.flatMap((id) => value.channels.filter((c) => c.id === id)).map((c) => (
              <ChannelLine key={c.id} c={c} optInText={optIn(c.id)} st={st} props={props} w={w} simple={simple} onChanged={list.reload} />
            ))}
          </Lines>
        </>
      )}
    </Part>
  );
  return (
    <>
      {!st.configured && <Warn>{w.relay}</Warn>}
      {st.demo && <p className={s.p} role="status">{w.testMode}</p>}
      {props.viewer && <Note>{w.readOnly}</Note>}
      {simple ? (
        <>
          {channelLines}
          <Group title={w.month}><p className={s.note}>{fill(w.budgetLine, { budget: count(String(MESSAGE_BUDGET)) })}</p><Month props={props} w={w} books={false} /></Group>
          <Group title={w.helpStop}>
            <p className={s.p}>{w.help}</p>
            <p className={s.p}>{w.stop}</p>
          </Group>
          <div><Button variant="link" aria-expanded={showTexts} onClick={() => setShowTexts((o) => !o)}>{showTexts ? w.hideMessages : w.showMessages}</Button></div>
          {showTexts && <Group title={w.messages} note={w.noDigits}><Part loaded={texts.state} w={w}>{(v) => <Messages value={v} w={w} books={false} />}</Part></Group>}
        </>
      ) : (
        <>
          <Group title={w.yourPhone}><YourPhone st={st} props={props} w={w} onPaired={reload} /></Group>
          <Group title={w.channels}>{channelLines}</Group>
          <Group title={w.messages} note={w.noDigits}><Part loaded={texts.state} w={w}>{(v) => <Messages value={v} w={w} books={books} />}</Part></Group>
          <Group title={w.month}><Month props={props} w={w} books={books} /></Group>
          <Group title={w.fromPhone}>
            <p className={s.p}>{w.fromPhoneRule}</p>
            <p className={s.note}>{w.mailNoApprove}</p>
            {books && texts.state.kind === 'ready' && <Quoted>{texts.state.value.approvalNote}</Quoted>}
          </Group>
          <Group title={w.helpStop}>
            <p className={s.p}>{w.help}</p>
            <p className={s.p}>{w.stop}</p>
            {books && texts.state.kind === 'ready' && texts.state.value.replies.map((r) => <Quoted key={r.id} label={r.id}>{r.text}</Quoted>)}
          </Group>
        </>
      )}
    </>
  );
}

export function PhonePlace(props: PlaceRenderProps) {
  const w = toolsWords(props.language);
  const { state, reload } = useEngine(props.rpc, PHONE.status, {}, status);
  return (
    <div className={s.page}>
      <Screen where={w.where} title={w['title.phone']} loaded={state}>
        {(st) => <Ready st={st} props={props} w={w} reload={reload} />}
      </Screen>
      {state.kind === 'not-built' && <Warn>{w.relay}</Warn>}
    </div>
  );
}
