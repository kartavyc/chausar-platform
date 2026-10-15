/**
 * Trust, Channels (enterprise part 3): per channel, what may be sent (a brief, an approval
 * link) and as whom (the company, or a named person). Administrators change it one channel
 * at a time with `enterprise.channels.set`; everyone else reads it.
 */
import { useState } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import type { PlaceRenderProps } from '../../../places/types.ts';
import { Frame, Note, Outcome, useWhere } from './Frame';
import { canChange, useRead, useSend } from './kit.ts';
import { CHANNEL_MAY, validateChannels, type Channel, type ChannelMay } from './validate.ts';
import s from './Enterprise.module.css';

export function ChannelsScreen({ p }: { p: PlaceRenderProps }) {
  const t = useT();
  const where = useWhere();
  const { state, replace } = useRead(p, 'enterprise.channels.get', validateChannels);
  const edit = canChange(p);
  return (
    <Frame where={where('trust', 'channels')} title={t('SH-01.sub.trust.channels')} loaded={state}>
      {({ channels }) => (
        <>
          <Note>{t('ENX-channels.intro')}</Note>
          {channels.length === 0 ? <Note>{t('ENX-channels.none')}</Note> : (
            <ul className={s.list}>
              {channels.map((c) => <ChannelRow key={c.id} p={p} channel={c} edit={edit} onSaved={(v) => replace(v)} />)}
            </ul>
          )}
          {!edit && <Note>{t('ENX-readOnly')}</Note>}
        </>
      )}
    </Frame>
  );
}

function ChannelRow({ p, channel, edit, onSaved }: { p: PlaceRenderProps; channel: Channel; edit: boolean; onSaved: (v: { channels: Channel[] }) => void }) {
  const t = useT();
  const [may, setMay] = useState<readonly ChannelMay[]>(channel.may);
  const [as, setAs] = useState<'company' | 'person'>(channel.as);
  const { sent, send } = useSend(p.rpc, validateChannels);
  const changed = as !== channel.as || may.length !== channel.may.length || may.some((m) => !channel.may.includes(m));
  const save = async () => {
    const ordered = CHANNEL_MAY.filter((m) => may.includes(m));
    const done = await send('enterprise.channels.set', { id: channel.id, may: ordered, as });
    if (done !== null && p.live(p.address)) onSaved(done);
  };
  const name = t(`ENX-channel.${channel.id}`);
  return (
    <li className={s.item} data-channel={channel.id}>
      <span className={s.itemHead}><span className={s.name}>{name}</span></span>
      {edit ? (
        <>
          <fieldset className={s.checks}>
            <legend>{t('ENX-channels.may')}</legend>
            {CHANNEL_MAY.map((m) => (
              <label key={m} className={s.check}>
                <input type="checkbox" checked={may.includes(m)} disabled={sent.kind === 'sending'}
                  onChange={(e) => { const on = e.currentTarget.checked; setMay((cur) => (on ? [...cur.filter((x) => x !== m), m] : cur.filter((x) => x !== m))); }} />
                {t(`ENX-channels.may.${m}`)}
              </label>
            ))}
          </fieldset>
          <Choice label={t('ENX-channels.as')} options={[{ value: 'company', label: t('ENX-channels.as.company') }, { value: 'person', label: t('ENX-channels.as.person') }]}
            value={as} onChange={setAs} disabled={sent.kind === 'sending'} />
          <span><Button onClick={() => void save()} disabled={!changed || sent.kind === 'sending'}>{t('ENX-channels.save', { channel: name })}</Button></span>
          <Outcome sent={sent} />
        </>
      ) : (
        <>
          <span>{channel.may.length === 0 ? t('ENX-channels.mayNothing') : t('ENX-channels.mayList', { list: channel.may.map((m) => t(`ENX-channels.may.${m}`)).join(', ') })}</span>
          <span className={s.note}>{t(`ENX-channels.as.${channel.as}.sentence`)}</span>
        </>
      )}
    </li>
  );
}
