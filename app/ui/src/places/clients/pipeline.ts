/**
 * Small pieces the Pipeline tab, the card sheet and the outreach sheet share (Ink v2 wave 4, 4E4): the stage order, a
 * warm path as PathLine's steps, the reload event, and the channels a draft kind may go on.
 */

import type { LinkStrength, PathPerson } from '../../parts/PathLine';
import type { OutreachChannel, OutreachKind, PipelineCardView, PipelineStage, TieBand, VentureRunEvent, WarmPathView } from '../../engine/types';
import { useLanguage, useT } from '../../text';
import { useDay } from '../money/words';

/** The engine's stages, in its order (contracts.ts PIPELINE_STAGES): forward only, the last three closed. */
export const STAGE_ORDER: readonly PipelineStage[] = ['found', 'asked', 'talking', 'proposal', 'won', 'lost', 'not-now'];
/** The stages a card has closed in (won, lost, not now): it moves no more. */
export const CLOSED_STAGES: ReadonlySet<PipelineStage> = new Set(['won', 'lost', 'not-now']);

/** The board, the due list and the sheets reload on a pipeline change or a queue change (a follow-up came due). */
export const pipelineRefresh = (event: VentureRunEvent) => event.type === 'pipeline.changed' || event.type === 'queue.changed';

/** A band as PathLine's two strengths: the engine's band, never a guess. Cold claims no strength. */
function strengthOf(band: TieBand): LinkStrength | undefined {
  if (band === 'close' || band === 'know-well') return 'strong';
  if (band === 'know' || band === 'met-once') return 'fair';
  return undefined;
}

/** A path's steps after the owner: the connector, when there is one, then the person. */
export function pathPeople(path: WarmPathView, name: string): PathPerson[] {
  return path.via
    ? [{ name: path.via.name, confirmed: true }, { name, confirmed: path.confirmed }]
    : [{ name, confirmed: path.confirmed, strength: path.confirmed ? strengthOf(path.strength) : undefined }];
}

/** The strength of a confirmed path through a connector, for its caption ("via Tara Iyer, strong"). */
export const pathStrength = (path: WarmPathView): LinkStrength | undefined => (path.confirmed && path.via ? strengthOf(path.strength) : undefined);

/** The channels a draft of each kind may go on (the engine's draft rules: a connection note on LinkedIn, a cold email by mail). */
export const CHANNELS_OF: Readonly<Record<OutreachKind, readonly OutreachChannel[]>> = {
  'intro-request': ['email', 'linkedin', 'whatsapp'],
  'double-opt-in': ['email', 'linkedin', 'whatsapp'],
  'connection-note': ['linkedin'],
  'follow-up': ['email', 'linkedin', 'whatsapp'],
  reply: ['email', 'linkedin', 'whatsapp'],
  'cold-email': ['email'],
  reminder: ['email', 'whatsapp'],
};

/**
 * A card's lines as the reader reads them. In English they are the engine's own words; in Hindi, the lines the engine
 * also gives in parts (the next step's day and whether it is late, the draft's channel, how long since they wrote, the
 * blocklist) are worded here from those parts, so a Hindi card does not read half in English. A line the engine gives
 * only in words (a client's "since", a tile's sub line, a nudge's own text) stays the engine's.
 */
export function useCardWords() {
  const t = useT();
  const language = useLanguage();
  const day = useDay('short');
  const hindi = language === 'hi';
  return {
    next: (next: NonNullable<PipelineCardView['next']>) =>
      hindi ? t(next.late ? 'clients.pipeline.card.nextLate' : 'clients.pipeline.card.nextOn', { text: next.text, day: day(next.due) }) : next.line,
    /** The engine's own line ("Intro drafted, for Mail"); in Hindi from its channel, since the engine sends no kind apart. */
    draft: (card: PipelineCardView) => (hindi && card.draftChannel ? t('clients.pipeline.card.draftFor', { channel: t(`clients.outreach.channel.${card.draftChannel}`) }) : card.draft),
    thread: (thread: NonNullable<PipelineCardView['thread']>) => {
      if (!hindi) return thread.line;
      const when = thread.days === 0 ? t('clients.pipeline.when.today') : thread.days === 1 ? t('clients.pipeline.when.yesterday') : t('clients.pipeline.when.days', { count: thread.days });
      return t(`clients.pipeline.thread.${thread.age}`, { when });
    },
    blocked: (line: string) => (hindi ? t('clients.pipeline.card.blockedLine') : line),
  };
}
