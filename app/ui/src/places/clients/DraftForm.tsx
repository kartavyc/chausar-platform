/**
 * "Write to them" (Ink v2 wave 4, 4E4; the engine's 4E2 venture.outreach.draft): what to draft (an intro through a
 * confirmed connector, a note, a LinkedIn connection note, a reply, a cold email), on which channel, in English or
 * Hindi, with the owner's own words on what it is about. A cold email asks for its lawful basis (they wrote first, an
 * existing contact, a public business contact) and, the first time, the postal address its footer carries; a
 * connection note asks for the owner's LinkedIn limit (200, or 300 with Premium). The engine drafts, checks and keeps it;
 * the outreach sheet then shows it. Chausar never sends: the owner sends it from their own app.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Segmented } from '../../parts/Segmented';
import type { LawfulBasis, OutreachChannel, OutreachKind, PipelineCardView } from '../../engine/types';
import { NeverContactLost } from './NeverContactLost';
import { codeOf, messageOf } from './network';
import { clientsChanged } from './signals';
import { askOf, draftSheetId, keepAsk, type DraftAsk } from './handoff';
import { CHANNELS_OF } from './pipeline';
import s from './Pipeline.module.css';

const BASES: readonly LawfulBasis[] = ['they-wrote-first', 'existing-contact', 'public-business-contact'];

/**
 * picked: the kind and channel a draft again on a cold channel asked for (the card sheet's `write-<kind>-<channel>`
 * tab); the owner's words, basis and postal address it was asked with fill the form, so none of them is lost.
 */
export function DraftForm({ card, picked = null }: { card: PipelineCardView; picked?: { kind: OutreachKind; channel: OutreachChannel } | null }) {
  const t = useT();
  const engine = useEngine();
  const ids = useId();
  const intro = Boolean(card.path?.via && card.path.confirmed);
  // A reply answers someone who wrote: offered only once the card has a thread.
  const wrote = Boolean(card.thread) || card.timeline.some((item) => item.what === 'reply');
  const kinds: OutreachKind[] = [...(intro ? ['intro-request' as const] : []), 'follow-up', 'double-opt-in', 'connection-note', ...(wrote ? ['reply' as const] : []), 'cold-email'];
  const [asked] = useState(() => (picked ? askOf(engine, `card:${card.id}`) : undefined));
  const [kind, setKind] = useState<OutreachKind>(picked && kinds.includes(picked.kind) ? picked.kind : kinds[0]!);
  const [channel, setChannel] = useState<OutreachChannel>(picked?.channel ?? 'email');
  const [basis, setBasis] = useState<LawfulBasis | ''>(asked?.basis ?? '');
  const [limit, setLimit] = useState<200 | 300>(200);
  const [language, setLanguage] = useState<'en' | 'hi'>(asked?.language ?? 'en');
  const [about, setAbout] = useState(asked?.about ?? '');
  const [postal, setPostal] = useState<string | null>(asked?.postalAddress ?? null);
  const [introduce, setIntroduce] = useState('');
  // Who a double opt-in introduces: anyone else in the network (Happenstance's second button).
  const people = useResource('venture.network.people', {}, { skip: kind !== 'double-opt-in' });
  const others = (people.data?.people ?? []).filter((person) => person.id !== card.personId);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const channels = CHANNELS_OF[kind];
  const shownChannel = channels.includes(channel) ? channel : channels[0]!;
  // The engine says, per kind and channel, whether this draft is cold (the footer goes on it) and still needs its basis.
  const choice = card.outreach?.find((item) => item.kind === kind && item.channel === shownChannel);
  const cold = choice?.cold ?? false;
  const needsBasis = choice?.needsBasis ?? false;

  // What the draft still needs before it can go to the engine: Draft it stays locked, and says so, until it is there.
  const waiting = needsBasis && !basis ? t('clients.outreach.basisFirst') : kind === 'double-opt-in' && !introduce ? t('clients.outreach.introduceFirst') : null;

  async function draft() {
    if (waiting) return;
    setBusy(true);
    setProblem(null);
    const ask: DraftAsk = {
      kind, channel: shownChannel, language,
      ...(needsBasis && basis ? { basis } : {}),
      ...(about.trim() ? { about: about.trim() } : {}),
      ...(postal?.trim() ? { postalAddress: postal.trim() } : {}),
    };
    try {
      const { draft: view } = await engine.request('venture.outreach.draft', {
        opportunityId: card.id, kind, channel: shownChannel, language,
        ...(ask.basis ? { basis: ask.basis } : {}),
        ...(kind === 'double-opt-in' ? { introduce } : {}),
        ...(kind === 'connection-note' ? { limit } : {}),
        ...(ask.about ? { about: ask.about } : {}),
        ...(ask.postalAddress ? { postalAddress: ask.postalAddress } : {}),
      });
      keepAsk(engine, view.id, ask);
      clientsChanged(engine);
      openSheet('outreach', draftSheetId(card.personId, view.id));
    } catch (error) {
      const code = codeOf(error);
      if (code === 'LEADS_ADDRESS_MISSING' && postal === null) setPostal('');
      setProblem({ code, message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.form}>
      <div className={s.choice}>
        <label className={s.label} htmlFor={`${ids}-kind`}>{t('clients.outreach.kind')}</label>
        <select id={`${ids}-kind`} className={s.select} value={kind} onChange={(event) => setKind(event.currentTarget.value as OutreachKind)}>
          {kinds.map((one) => <option key={one} value={one}>{t(`clients.outreach.kind.${one}`)}</option>)}
        </select>
      </div>
      <Segmented
        mode="buttons"
        label={t('clients.outreach.channel')}
        value={shownChannel}
        onChange={(id) => setChannel(id as OutreachChannel)}
        options={channels.map((one) => ({ id: one, label: t(`clients.outreach.channel.${one}`) }))}
      />
      {kind === 'connection-note' && (
        <Segmented
          mode="buttons"
          label={t('clients.outreach.limit')}
          value={String(limit)}
          onChange={(id) => setLimit(id === '300' ? 300 : 200)}
          options={[{ id: '200', label: t('clients.outreach.limit.free') }, { id: '300', label: t('clients.outreach.limit.premium') }]}
        />
      )}
      {kind === 'double-opt-in' && (
        <div className={s.choice}>
          <label className={s.label} htmlFor={`${ids}-introduce`}>{t('clients.outreach.introduce')}</label>
          <select id={`${ids}-introduce`} className={s.select} value={introduce} onChange={(event) => setIntroduce(event.currentTarget.value)}>
            <option value="">{t('clients.outreach.introduce.choose')}</option>
            {others.map((person) => <option key={person.id} value={person.id}>{person.company ? `${person.name}, ${person.company}` : person.name}</option>)}
          </select>
        </div>
      )}
      {needsBasis && (
        <div className={s.choice}>
          <label className={s.label} htmlFor={`${ids}-basis`}>{t('clients.outreach.basis')}</label>
          <select id={`${ids}-basis`} className={s.select} value={basis} onChange={(event) => setBasis(event.currentTarget.value as LawfulBasis | '')}>
            <option value="">{t('clients.outreach.basis.choose')}</option>
            {BASES.map((one) => <option key={one} value={one}>{t(`clients.outreach.basis.${one}`)}</option>)}
          </select>
          <p className={s.quiet}>{t('clients.outreach.basis.line')}</p>
        </div>
      )}
      {cold && !needsBasis && <p className={s.quiet} data-cold="">{t('clients.outreach.coldFooter')}</p>}
      <Segmented
        mode="buttons"
        label={t('clients.outreach.language')}
        value={language}
        onChange={(id) => setLanguage(id === 'hi' ? 'hi' : 'en')}
        options={[{ id: 'en', label: t('clients.outreach.language.en') }, { id: 'hi', label: t('clients.outreach.language.hi') }]}
      />
      <Field label={t('clients.outreach.about')} hint={t('clients.outreach.about.hint')} value={about} maxLength={300} onChange={(event) => setAbout(event.currentTarget.value)} autoComplete="off" />
      {postal !== null && <Field label={t('clients.leads.address')} hint={t('clients.leads.addressHint')} value={postal} onChange={(event) => setPostal(event.currentTarget.value)} />}
      <div className={s.actions}>
        <Button disabled={busy} locked={waiting !== null} lockedReason={waiting ?? undefined} onClick={() => void draft()}>{busy ? t('clients.outreach.drafting') : t('clients.outreach.draft')}</Button>
      </div>
      {problem && (problem.code === 'NEVER_CONTACT_LOST' ? <NeverContactLost /> : <p className={s.problem} role="alert">{problem.message}</p>)}
    </div>
  );
}
