/**
 * The draft sheet (`?sheet=outreach:<person id>:<draft id>`; D-Network's intro panel; the engine's 4E2 OutreachView): who it goes
 * to, who wrote it, the note itself (quoted), the note a connector can forward, a connection note's characters against
 * the owner's limit, the footer only on a cold email (the unsubscribe line and the postal address, founder decision),
 * the advisory warnings, then "Send it yourself from" Mail, LinkedIn or WhatsApp and "I sent it". The draft's own
 * channel opens its handoff (venture.outreach.open); another channel drafts it again on that channel first. The line
 * "Chausar never sends" is always there. "I sent it" records the owner's own send on the draft's channel, or by phone
 * (venture.outreach.sent). A platform that restricted the owner's account pauses that channel for three days
 * (venture.outreach.restricted), after a second ask.
 *
 * The draft is read from the person's sheet (venture.network.person lists the drafts to them or on their cards), so it
 * opens again after a reload. A draft that is not there (a lead's own email, a link without its person) shows only its
 * handoff: its own app shows the words.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { useClock } from '../../shell/clock';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import { Inner } from '../../parts/Card';
import { Sheet } from '../../parts/Sheet';
import type { OutreachChannel, OutreachHandoff, OutreachSentChannel, OutreachView } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { reserveTab } from '../connections/external';
import { NeverContactLost } from './NeverContactLost';
import { codeOf, messageOf } from './network';
import { clientsChanged } from './signals';
import {
  askOf, channelOf, draftSheetId, handoffText, keepAsk, keepDraft, keptDraft, opensPage, parseDraftSheetId, performHandoff, SENT_OF, writeTab, type DraftAsk,
} from './handoff';
import { CHANNELS_OF, pipelineRefresh } from './pipeline';
import s from './Pipeline.module.css';


export function OutreachSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const { personId, draftId } = parseDraftSheetId(id);
  const person = useResource('venture.network.person', { id: personId ?? '' }, { skip: !personId, refreshOn: pipelineRefresh });
  // What the engine answered since the sheet opened (I sent it, a draft on another channel) stands until it reads again.
  // A draft no person lists (an invoice reminder) is the one its place kept when the engine answered it.
  const [answered, setAnswered] = useState<OutreachView | null>(() => (personId ? null : keptDraft(engine, draftId) ?? null));
  const stored = person.data?.drafts.find((item) => item.id === draftId);
  const view = answered && (answered.id === draftId || !stored) ? answered : stored ?? answered ?? undefined;
  const settled = !personId || person.data !== undefined || person.error !== undefined;
  const title = view ? t(`clients.outreach.kind.${view.kind}`) : t('clients.outreach.sheet');
  return (
    <Sheet label={t('clients.outreach.sheet')} title={title} line={view?.to ?? undefined} onClose={onClose} returnFocus={returnFocus}>
      {view ? (
        <Draft
          view={view}
          onView={(next) => {
            setAnswered(next);
            if (!personId) keepDraft(engine, next);
            if (personId && next.id !== draftId) openSheet('outreach', draftSheetId(personId, next.id));
          }}
        />
      ) : settled ? <NotKept id={draftId} /> : null}
    </Sheet>
  );
}

type Said = { text: string; problem: boolean; code?: string };

function Said({ said }: { said: Said | null }) {
  if (!said) return null;
  if (said.code === 'NEVER_CONTACT_LOST') return <NeverContactLost />;
  return <p className={said.problem ? s.problem : s.said} role="status">{said.text}</p>;
}

function Draft({ view, onView }: { view: OutreachView; onView: (view: OutreachView) => void }) {
  const t = useT();
  const engine = useEngine();
  const clock = useClock();
  const ids = useId();
  const [said, setSaid] = useState<Said | null>(null);
  const [copy, setCopy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const channels = view.kind === 'double-opt-in' || view.kind === 'reminder' || !view.opportunityId ? [view.channel] : CHANNELS_OF[view.kind];
  // The card's choices say which channel would make this draft cold (the engine's coldOutreach, per kind and channel).
  const board = useResource('venture.pipeline.list', {}, { skip: !view.opportunityId || channels.length < 2, refreshOn: pipelineRefresh });
  const card = board.data?.columns.flatMap((column) => column.cards).find((one) => one.id === view.opportunityId);

  /** The draft's own channel opens its handoff; another drafts it again on that channel, then opens that one. */
  async function sendFrom(channel: OutreachChannel) {
    setSaid(null);
    setCopy(null);
    let tab: Window | null = null;
    try {
      tab = opensPage(channel) ? reserveTab() : null;
      let draftId = view.id;
      if (channel !== view.channel && view.opportunityId) {
        // The owner's words go with it. A cold one needs its basis, footer and address: the draft form opens with them.
        const language = view.language ?? 'en';
        const asked = askOf(engine, view.id);
        const ask: DraftAsk = {
          kind: view.kind, channel, language,
          ...(asked?.about ? { about: asked.about } : {}),
          ...(asked?.basis ? { basis: asked.basis } : {}),
          ...(asked?.postalAddress ?? view.footer?.postalAddress ? { postalAddress: asked?.postalAddress ?? view.footer!.postalAddress } : {}),
        };
        if (card?.outreach?.find((item) => item.kind === view.kind && item.channel === channel)?.cold) {
          tab?.close();
          keepAsk(engine, `card:${view.opportunityId}`, ask);
          openSheet('card', view.opportunityId, null, writeTab(view.kind, channel));
          return;
        }
        const again = await engine.request('venture.outreach.draft', { opportunityId: view.opportunityId, kind: view.kind, channel, language, ...(ask.about ? { about: ask.about } : {}) });
        keepAsk(engine, again.draft.id, ask);
        onView(again.draft);
        draftId = again.draft.id;
        clientsChanged(engine);
      }
      const handoff: OutreachHandoff = await engine.request('venture.outreach.open', { draftId });
      const done = await performHandoff(handoff, tab);
      if (done === 'copy-failed') setCopy(handoffText(handoff));
      setSaid({ text: handoff.line, problem: false });
    } catch (error) {
      tab?.close();
      setSaid({ text: messageOf(error), problem: true, code: codeOf(error) });
    }
  }

  async function sent(channel: OutreachSentChannel) {
    setBusy(true);
    setSaid(null);
    try {
      const result = await engine.request('venture.outreach.sent', { draftId: view.id, at: clock().toISOString(), channel });
      onView(result.draft);
      setSaid({ text: result.line, problem: false });
      clientsChanged(engine);
    } catch (error) {
      setSaid({ text: messageOf(error), problem: true, code: codeOf(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className={s.quiet} data-author={view.author ?? 'template'}>{t(`clients.outreach.by.${view.author ?? 'template'}`)}</p>
      {view.subject && <p className={s.cardLine}><span className={s.timelineWhat}>{t('clients.outreach.subject')}</span><span data-content="">{view.subject}</span></p>}
      <Inner card={false} className={s.note}>
        <p className={s.noteText} data-content="" data-note="">{view.text}</p>
      </Inner>
      {view.counter && (
        <p className={s.counter} data-over={view.counter.used > view.counter.limit ? '' : undefined}>
          {t('clients.outreach.counter', { used: view.counter.used, limit: view.counter.limit })}
        </p>
      )}
      {view.blurb && (
        <details className={s.blurb}>
          <summary className={s.blurbSummary}>
            <Icon name="file-text" size={14} />
            <span>{t('clients.outreach.blurb')}</span>
            {typeof view.blurbSentences === 'number' && <span className="mono">{t('clients.outreach.sentences', { count: view.blurbSentences })}</span>}
          </summary>
          <p className={s.noteText} data-content="" data-blurb="">{view.blurb}</p>
        </details>
      )}
      {view.footer && (
        <section className={s.section} aria-labelledby={`${ids}-footer`} data-footer="">
          <h3 id={`${ids}-footer`} className={s.heading}>{t('clients.outreach.footer')}</h3>
          <p className={s.quiet} data-content="">{view.footer.postalAddress}</p>
          <p className={s.quiet} data-content="">{view.footer.unsubscribe}</p>
        </section>
      )}
      {view.lints.length > 0 && (
        <ul className={s.lints} aria-label={t('clients.outreach.lints')}>
          {view.lints.map((lint, index) => <li key={index} className={s.lint} data-rule={lint.rule}><Icon name="triangle-alert" size={14} />{lint.line}</li>)}
        </ul>
      )}
      {view.accepted && <p className={s.said} data-accepted="">{view.accepted.line}</p>}

      {view.sent ? (
        <p className={s.said} data-sent="">{t('clients.outreach.wasSent')}</p>
      ) : (
        <section className={s.section} aria-labelledby={`${ids}-send`}>
          <h3 id={`${ids}-send`} className={s.heading}>{t('clients.outreach.sendFrom')}</h3>
          <div className={s.channels}>
            {channels.map((channel) => (
              <Button key={channel} size="lg" data-channel={channel} onClick={() => void sendFrom(channel)}>
                <Icon name={CHANNEL_ICON[channel]} size={16} />
                {t(`clients.outreach.channel.${channel}`)}
              </Button>
            ))}
          </div>
          <Button size="lg" className={s.wide} disabled={busy} onClick={() => void sent(SENT_OF[view.channel])}><Icon name="check" size={16} />{t('clients.outreach.sent')}</Button>
          <div className={s.actions}>
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => void sent('phone')}>{t('clients.outreach.phoned')}</Button>
            {view.channel !== 'email' && <Restricted channel={view.channel} />}
          </div>
        </section>
      )}
      {copy && <p className={s.copy} data-content="">{copy}</p>}
      <Said said={said} />
      <p className={s.never} data-never=""><Icon name="shield-check" size={14} />{view.line ?? t('clients.outreach.never')}</p>
    </>
  );
}

const CHANNEL_ICON = { email: 'send', linkedin: 'users', whatsapp: 'message-square' } as const;

/** "LinkedIn restricted my account": asks once more, then pauses that channel for three days. */
function Restricted({ channel }: { channel: OutreachChannel }) {
  const t = useT();
  const engine = useEngine();
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);

  async function pause() {
    try {
      const result = await engine.request('venture.outreach.restricted', { channel });
      setSaid({ text: result.line, problem: false });
      setAsking(false);
    } catch (error) {
      setSaid({ text: messageOf(error), problem: true });
    }
  }

  return (
    <>
      {!asking && !said && <Button variant="quiet" size="sm" onClick={() => setAsking(true)}>{t(`clients.outreach.restricted.${channel}`)}</Button>}
      {asking && (
        <Inner card={false} className={s.ask}>
          <p>{t('clients.outreach.restricted.ask')}</p>
          <div className={s.actions}>
            <Button variant="quiet" size="sm" onClick={() => setAsking(false)}>{t('clients.outreach.restricted.keep')}</Button>
            <Button size="sm" onClick={() => void pause()}>{t('clients.outreach.restricted.yes')}</Button>
          </div>
        </Inner>
      )}
      <Said said={said} />
    </>
  );
}

/** A draft from before this session: only its handoff, then "I sent it" on the channel it opened. */
function NotKept({ id }: { id: string }) {
  const t = useT();
  const engine = useEngine();
  const clock = useClock();
  const [said, setSaid] = useState<Said | null>(null);
  const [copy, setCopy] = useState<string | null>(null);
  const [channel, setChannel] = useState<OutreachChannel | null>(null);

  async function open() {
    setSaid(null);
    setCopy(null);
    try {
      const handoff = await engine.request('venture.outreach.open', { draftId: id });
      const done = await performHandoff(handoff, null);
      if (done === 'copy-failed') setCopy(handoffText(handoff));
      setChannel(channelOf(handoff));
      setSaid({ text: handoff.line, problem: false });
    } catch (error) {
      setSaid({ text: messageOf(error), problem: true, code: codeOf(error) });
    }
  }

  async function sent(by: OutreachChannel) {
    try {
      const result = await engine.request('venture.outreach.sent', { draftId: id, at: clock().toISOString(), channel: SENT_OF[by] });
      setSaid({ text: result.line, problem: false });
      clientsChanged(engine);
    } catch (error) {
      setSaid({ text: messageOf(error), problem: true, code: codeOf(error) });
    }
  }

  return (
    <>
      <p className={s.quiet}>{t('clients.outreach.notKept')}</p>
      <div className={s.actions}>
        <Button onClick={() => void open()}>{t('clients.outreach.openIt')}</Button>
        {channel && <Button onClick={() => void sent(channel)}>{t('clients.outreach.sent')}</Button>}
      </div>
      {copy && <p className={s.copy} data-content="">{copy}</p>}
      <Said said={said} />
      <p className={s.never}><Icon name="shield-check" size={14} />{t('clients.outreach.never')}</p>
    </>
  );
}
