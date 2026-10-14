/**
 * Phone, desktop side (PH-01..PH-03): a read-only preview of what reaches the phone.
 *
 * The four fixed messages exactly as sent, each a headline and a link; whether each kind
 * is sent; the state of each channel; this month's count against the monthly budget; the
 * mail fallback, which carries the same headline and one link; and which buttons a
 * message can carry. Nothing here changes a setting: the Tools · Phone screen (another
 * lane) owns the switches and draws this component inside its page.
 *
 * `PhoneMessagesFromEngine` reads `todayx.phoneMessages` through `rpc` and checks the reply
 * before drawing it. `PhoneLinkPage` is the body of the link page (PH-02): the wordmark and
 * one line. It holds no data.
 */

import { useEffect, useId, useState } from 'react';
import type { Address } from '../../app/presentation.ts';
import type { PlaceRpc } from '../../places/types.ts';
import { isPhoneMessagesReply, notBuilt, type PhoneMessagesReply } from '../../bridge/todayx-contract.ts';
import { useT } from '../../app/text';
import { count } from '../../format/counts.ts';
import { State } from '../../patterns/States';
import { PHONE_LINK_KEY, PHONE_MESSAGE_KINDS, PHONE_MESSAGES } from './phone-messages.ts';
import s from './Today.module.css';

export const PHONE_MESSAGES_METHOD = 'todayx.phoneMessages';

export function PhoneMessages({ reply }: { reply: PhoneMessagesReply }) {
  const t = useT();
  const titleId = useId();
  const mailId = useId();
  const sent = reply.sentThisMonth;
  const budget = count(reply.monthlyBudget);
  return (
    <section className={s.section} aria-labelledby={titleId} data-phone-messages="">
      <h2 id={titleId} className={s.label}>
        {t('PH-01.title')}
      </h2>
      <ul className={s.phoneList}>
        {PHONE_MESSAGE_KINDS.map((kind) => (
          <li key={kind} className={s.phoneMessage} data-phone-kind={kind}>
            <span className={s.phoneBody} data-phone-body="">
              <span className={s.phoneHeadline}>{t(PHONE_MESSAGES[kind].headlineKey)}</span>
              <span className={s.phoneLink}>{t(PHONE_LINK_KEY)}</span>
            </span>
            <span className={s.missing}>{t(reply.kinds.includes(kind) ? 'PH-01.kind.on' : 'PH-01.kind.off')}</span>
          </li>
        ))}
      </ul>
      <p className={s.quiet}>{t('PH-01.buttons')}</p>
      <p className={s.quiet}>{t('PH-01.rules')}</p>

      <h3 className={s.label}>{t('PH-01.channels')}</h3>
      <ul className={s.phoneList}>
        {reply.channels.map((c) => (
          <li key={c.channel} className={s.phoneMessage} data-phone-channel={c.channel}>
            <span>{t(`PH-01.channel.${c.channel}`)}</span>
            <span className={s.missing}>{t(`PH-01.channel.state.${c.state}`)}</span>
          </li>
        ))}
      </ul>
      <p className="fig">{sent !== null ? t('PH-01.count', { sent: count(sent), budget }) : t('PH-01.count.unknown', { budget })}</p>

      <h3 id={mailId} className={s.label}>
        {t('PH-03.title')}
      </h3>
      <p className={s.quiet}>{t('PH-03.note')}</p>
      <ul className={s.phoneList} aria-labelledby={mailId}>
        {PHONE_MESSAGE_KINDS.map((kind) => (
          <li key={kind} className={s.phoneMessage} data-mail-kind={kind}>
            <span className={s.phoneBody} data-phone-body="">
              <span className={s.phoneHeadline}>{t(PHONE_MESSAGES[kind].headlineKey)}</span>
              <span className={s.phoneLink}>{t(PHONE_LINK_KEY)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type PhoneLoad = { readonly phase: 'loading' } | { readonly phase: 'not-built' } | { readonly phase: 'failed'; readonly code: string } | { readonly phase: 'ready'; readonly reply: PhoneMessagesReply };

/** Reads `todayx.phoneMessages` once for this address and draws the checked reply. */
export function PhoneMessagesFromEngine({ rpc, live, address }: { rpc: PlaceRpc; live: (address: Address) => boolean; address: Address }) {
  const [load, setLoad] = useState<PhoneLoad>({ phase: 'loading' });
  useEffect(() => {
    let current = true;
    rpc.request(PHONE_MESSAGES_METHOD, {}).then(
      (reply) => {
        if (!current || !live(address)) return;
        setLoad(isPhoneMessagesReply(reply) ? { phase: 'ready', reply } : { phase: 'failed', code: 'INVALID_REPLY' });
      },
      (error: unknown) => {
        if (!current || !live(address)) return;
        setLoad(notBuilt(error) ? { phase: 'not-built' } : { phase: 'failed', code: 'REQUEST_FAILED' });
      },
    );
    return () => {
      current = false;
    };
  }, [rpc, live, address]);
  if (load.phase === 'loading') return <State state={{ kind: 'loading' }} />;
  if (load.phase === 'not-built') return <State state={{ kind: 'not-built' }} />;
  if (load.phase === 'failed') return <State state={{ kind: 'failed', code: load.code }} />;
  return <PhoneMessages reply={load.reply} />;
}

/** PH-02: the link page. The wordmark and one line; the page holds no data. */
export function PhoneLinkPage({ state }: { state: 'open' | 'expired' }) {
  const t = useT();
  return (
    <main className={s.linkPage}>
      <p className={s.wordmark}>{t('PH-02.wordmark')}</p>
      <p>{t(state === 'open' ? 'PH-02.open' : 'PH-02.expired')}</p>
    </main>
  );
}
