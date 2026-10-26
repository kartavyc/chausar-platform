/**
 * The Pipeline tab (#/clients/pipeline; the old #/clients/leads opens it too): the leads as a board of the engine's
 * own stages, in its order (New, Drafted, Contacted, Replied, Won), with Lost and Blocked folded away until the owner
 * opens them. A card shows the person's initials, name and company, the email check in the engine's words, and the
 * latest draft or send. Opening a card shows the lead sheet, where the owner drafts, says he sent it, or blocks.
 *
 * Chausar never sends: the owner sends every message from his own mailbox. Cards do not move by drag or key: a lead
 * moves only when the engine records why (a draft, a send). The pipeline's own stages (Found to Not now), strength,
 * warm paths, follow-ups and handoffs arrive with W4 4D and 4E.
 *
 * "Has a draft" (held in the address as `show=drafts`) narrows the board to the people with a draft not yet sent. The
 * chips show only when someone has one, since otherwise they would filter to nothing.
 */

import { useEffect } from 'react';
import { useT, type T } from '../../text';
import type { Resource } from '../../engine/context';
import { openSheet, setQuery, useRoute } from '../../shell/navigation';
import { Board, BoardCard, type BoardColumn } from '../../parts/Board';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { FilterChips } from '../../parts/FilterChips';
import { Icon } from '../../parts/Icon';
import type { IconName } from '../../parts/icons';
import { stateText } from '../../parts/states';
import type { LeadEmailCheck, LeadStage, LeadView } from '../../engine/types';
import { useMoment } from '../money/words';
import s from './Clients.module.css';

/** The engine's lead stages in its own order. A typed record, so a stage the engine adds fails the typecheck here.
 *  Lost and Blocked are where a lead ends: they fold away, one step from the board. */
const STAGES: Readonly<Record<LeadStage, { folded: boolean }>> = {
  new: { folded: false },
  drafted: { folded: false },
  contacted: { folded: false },
  replied: { folded: false },
  won: { folded: false },
  lost: { folded: true },
  blocked: { folded: true },
};

const CHECK_ICONS: Readonly<Record<LeadEmailCheck['status'], IconName>> = {
  verified: 'check',
  unverified: 'circle-help',
  failed: 'x',
};

type Show = 'all' | 'drafts';

/** The drafts the owner has not said he sent. */
function unsent(lead: LeadView) {
  return lead.drafts.filter((draft) => !lead.sends.some((send) => send.draftId === draft.id));
}

/** The latest of the lead's unsent drafts and the owner's sends, by the engine's own timestamps (compared as text,
 *  which orders ISO times; nothing is worked out). */
function latestOf(lead: LeadView): { kind: 'draft' } | { kind: 'sent'; at: string } | { kind: 'none' } {
  const draftAt = unsent(lead).reduce<string | null>((latest, draft) => (latest === null || draft.at > latest ? draft.at : latest), null);
  const sentAt = lead.sends.reduce<string | null>((latest, send) => (latest === null || send.sentAt > latest ? send.sentAt : latest), null);
  if (draftAt !== null && (sentAt === null || draftAt > sentAt)) return { kind: 'draft' };
  if (sentAt !== null) return { kind: 'sent', at: sentAt };
  return { kind: 'none' };
}

function columnsOf(t: T, leads: readonly LeadView[]): BoardColumn[] {
  const known = Object.keys(STAGES) as LeadStage[];
  // An engine newer than this screen may send a stage it does not know yet: those people still show, folded, under
  // the stage's own words ("Unknown"), never dropped.
  const unknown = [...new Set(leads.map((lead) => lead.status))].filter((stage) => !Object.hasOwn(STAGES, stage));
  const columns: BoardColumn[] = [];
  for (const stage of [...known, ...unknown]) {
    const folded = Object.hasOwn(STAGES, stage) ? STAGES[stage].folded : true;
    const cards = leads.filter((lead) => lead.status === stage).map((lead) => ({ id: lead.id, node: <LeadCard lead={lead} /> }));
    // A folded stage with nobody in it would be a control that opens nothing, so it is left out.
    if (folded && cards.length === 0) continue;
    const hint = Object.hasOwn(STAGES, stage) ? t(`clients.pipeline.hint.${stage}`) : undefined;
    columns.push({ id: stage, title: stateText(t, 'lead', stage), hint, cards, folded });
  }
  return columns;
}

export function PipelineTab({ leads }: { leads: Resource<{ leads: LeadView[] }> }) {
  const t = useT();
  const route = useRoute();
  const all = leads.data?.leads ?? [];
  const withDrafts = all.filter((lead) => unsent(lead).length > 0);
  const show: Show = route.query.show === 'drafts' && withDrafts.length > 0 ? 'drafts' : 'all';
  const shown = show === 'drafts' ? withDrafts : all;
  // A `show` the board cannot honour (nobody has a draft ready, or a value it does not know) leaves the address, so
  // the address always says what the board shows. Only once the engine has answered.
  const stale = leads.data !== undefined && route.query.show !== undefined && show === 'all';
  useEffect(() => {
    if (!stale) return;
    const rest = { ...route.query };
    delete rest.show;
    setQuery(rest);
  }, [stale, route.query]);

  if (leads.error) return <p className={s.failed} role="alert">{t('sheet.failed', { message: leads.error.message })}</p>;
  if (leads.data && all.length === 0) {
    return (
      <EmptyState
        title={t('clients.leads.empty')}
        action={<Button variant="primary" data-add-lead="" onClick={(event) => openSheet('lead', 'new', event.currentTarget)}>{t('clients.leads.add')}</Button>}
      />
    );
  }
  if (all.length === 0) return null;

  const choose = (id: string) => {
    const query: Record<string, string> = { ...route.query };
    if (id === 'drafts') query.show = 'drafts';
    else delete query.show;
    setQuery(query);
  };

  return (
    <>
      {withDrafts.length > 0 && (
        <FilterChips
          className={s.filters}
          label={t('clients.pipeline.show')}
          value={show}
          onChange={choose}
          options={[
            { id: 'all', label: t('clients.pipeline.all'), count: all.length },
            { id: 'drafts', label: t('clients.pipeline.drafts'), count: withDrafts.length },
          ]}
        />
      )}
      <Board label={t('clients.pipeline.board')} columns={columnsOf(t, shown)} limit={5} />
    </>
  );
}

function LeadCard({ lead }: { lead: LeadView }) {
  const t = useT();
  const moment = useMoment();
  const latest = latestOf(lead);
  return (
    <BoardCard name={lead.name} sub={lead.company} rowId={lead.id} onOpen={() => openSheet('lead', lead.id)}>
      <p className={s.check} data-check={lead.emailCheck.status}>
        <Icon name={CHECK_ICONS[lead.emailCheck.status] ?? 'circle-help'} size={12} />
        <span>{lead.emailCheck.line || t('clients.leads.noEmail')}</span>
      </p>
      <p className={s.latest}>
        {latest.kind === 'draft' && (
          <span className={s.draftChip}><Icon name="file-pen" size={12} />{t('clients.pipeline.draftReady')}</span>
        )}
        {latest.kind === 'sent' && (
          <span className={s.draftChip} data-sent=""><Icon name="send" size={12} />{t('clients.pipeline.sent', { date: moment(latest.at) })}</span>
        )}
        {latest.kind === 'none' && <span className={s.noDraft}>{t('clients.pipeline.noDraft')}</span>}
      </p>
    </BoardCard>
  );
}
