/**
 * Messages whose result was lost (tools/phonelog), over TL-09 and TR-09. A message the relay
 * never answered for may or may not have been sent; Chausar never sends it again on its own.
 * Each row is the fixed headline words of its event (never a figure), the channel, the day,
 * and its status in words. Check asks the relay what happened and sends nothing.
 * Simple: lost messages only. Guided: lost only or all. Books adds the message id, its buttons,
 * the error code, and the exact instants.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../app/text';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import type { PlaceRenderProps } from '../../places/types.ts';
import { METHODS, isLost, messageChecked, messageLog, ReplyError, type MessageEntry } from './contract.ts';
import { useRead, useSend } from './engine.ts';
import { Note, Page, PhoneLink, SentLine, canChange, day, type T } from './Frame';
import s from './hosted-link.module.css';

type Filter = 'lost' | 'all';

function MessageRow({ entry, props, t }: { entry: MessageEntry; props: PlaceRenderProps; t: T }) {
  const simple = props.view === 'simple', books = props.view === 'books';
  const validate = useMemo(() => (reply: unknown) => {
    const updated = messageChecked(reply);
    if (updated.id !== entry.id) throw new ReplyError('reply.id');
    return updated;
  }, [entry.id]);
  const check = useSend(props.rpc, validate);
  const shown = check.sent.kind === 'done' ? check.sent.value : entry;
  const lost = isLost(shown);
  const headline = t(`HL.log.event.${shown.event}`);
  const done = check.sent.kind === 'done' ? t(lost ? 'HL.log.stillUnknown' : 'HL.log.checked') : undefined;
  // Sending again stays an explicit action elsewhere in the app: this screen only says so, it offers no resend.
  const sendAgain = check.sent.kind === 'done' && check.sent.value.sendAgain;
  return (
    <li className={s.line}>
      <div className={s.lineTop}>
        <div className={s.lineMain}>
          <span className={s.lineTitle}>{headline}</span>
          <span className={lost || shown.status === 'not-sent' ? s.warn : s.lineNote}>{t(`HL.log.status.${shown.status}`)}</span>
          <span className={s.lineNote}>{t('HL.log.sentBy', { channel: t(`HL.channel.${shown.channel}`), date: day(shown.at, props.language) })}</span>
          {shown.errorCode === 'MESSAGE_OTHER_PAIRING' && <span className={s.lineNote}>{t('HL.refusal.MESSAGE_OTHER_PAIRING')}</span>}
          {!simple && shown.status === 'delivered' && <span className={s.lineNote}>{t('HL.log.deliveredNote')}</span>}
          {!simple && shown.checkedAt !== null && <span className={s.lineNote}>{t('HL.log.checkedOn', { date: day(shown.checkedAt, props.language) })}</span>}
          {books && (
            <>
              <span className={[s.lineNote, 'fig'].join(' ')}>{t('HL.log.id', { id: shown.id })}</span>
              <span className={s.lineNote}>{t(`HL.log.buttons.${shown.buttons}`)}</span>
              {shown.errorCode !== null && <span className={[s.lineNote, 'fig'].join(' ')}>{t('HL.log.error', { code: shown.errorCode })}</span>}
              <span className={[s.lineNote, 'fig'].join(' ')}>{t('HL.log.at', { at: shown.at })}</span>
            </>
          )}
        </div>
        {lost && canChange(props) && (
          <div className={s.lineAfter}>
            <Button aria-label={t('HL.log.checkLabel', { headline })} disabled={check.sent.kind === 'sending'}
              onClick={() => void check.send(METHODS.check, { id: entry.id })}>{t('HL.log.check')}</Button>
          </div>
        )}
      </div>
      <SentLine sent={check.sent} done={done} />
      {sendAgain && <Note>{t('HL.log.sendAgain')}</Note>}
    </li>
  );
}

export function LostMessagesPlace(props: PlaceRenderProps) {
  const t = useT();
  const simple = props.view === 'simple';
  const [chosen, setChosen] = useState<Filter>('lost');
  const filter: Filter = simple ? 'lost' : chosen;
  const { read } = useRead(props.rpc, METHODS.log, { filter }, messageLog);
  const title = t('HL.log.title');
  const top = read.kind === 'ready' ? (
    <>
      <Note>{t('HL.log.intro')}</Note>
      {props.viewer && <Note>{t('HL.readOnly')}</Note>}
      {read.value.truncated && <p className={s.warn} role="note">{t('HL.log.truncated')}</p>}
      <div className={s.bar}>
        {!simple && (
          <Choice<Filter> label={t('HL.log.filter')} value={chosen} onChange={setChosen}
            options={[{ value: 'lost', label: t('HL.log.filter.lost') }, { value: 'all', label: t('HL.log.filter.all') }]} />
        )}
        <PhoneLink navigate={props.navigate} />
      </div>
    </>
  ) : null;
  return (
    <Page where={`${t('SH-01.place.tools')} · ${t('SH-01.sub.tools.phonelog')}`} title={title} read={read} top={top}
      emptyKey={filter === 'lost' ? 'HL.log.empty.lost' : 'HL.log.empty.all'} isEmpty={(v) => v.messages.length === 0}>
      {(value) => (
        <ul className={s.lines} aria-label={t('HL.log.list')}>
          {value.messages.map((m) => <MessageRow key={m.id} entry={m} props={props} t={t} />)}
        </ul>
      )}
    </Page>
  );
}
