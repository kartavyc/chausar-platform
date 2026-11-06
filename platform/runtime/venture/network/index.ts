// Chausar venture launcher, network (Ink v2 wave 4): the owner's network from their own files (4D1), relationship
// strength and warm paths (4D2), plain-English search (4D3), the pipeline and follow-ups (4E1), drafts and handoffs the
// owner sends (4E2), the read-only mailbox and inbound mail (4E3). The host loads this file on first use of a method it
// owns. Package 4-0 registered every method with a NOT_BUILT_YET stub; each package replaces only its own lines.
import { ChausarError } from '../../contracts.ts';
import type { VentureHandlerTable } from '../contracts.ts';
import { networkForget } from './forget.ts';
import { networkImport, networkImportUndo } from './import.ts';
import { networkHide, networkMerge, networkPeople, networkPerson, networkSources, networkSplit } from './methods.ts';
import { networkKnow, networkLink, networkRecompute } from './methods.ts';
import { pipelineAdd, pipelineFollowups, pipelineList, pipelineMove, pipelineSetNext, pipelineSettingsHandler } from './pipeline-methods.ts';
import { mailboxConnect, mailboxDisconnect, mailboxSync } from './mailbox.ts';
import { inboundConfirm, inboundList } from './inbound.ts';
import { networkCalendar } from './calendar-feed.ts';
import { meetingDigest } from './meeting.ts';
import { networkSearch, networkSearchMore } from './search.ts';
import { networkSaveSearch } from './saved-searches.ts';
import { networkResearch } from './research.ts';
import { outreachDraft, outreachOpen, outreachRestricted, outreachSent } from './outreach.ts';

/** A wave 4 method whose package has not landed yet: listed, so the contract and the desktop see it, and refused. */
const notBuiltYet = async (): Promise<never> => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); };

export const handlers: VentureHandlerTable = Object.freeze({
  // 4D1 import, people, merge and privacy
  'venture.network.import': networkImport,
  'venture.network.importUndo': networkImportUndo,
  'venture.network.merge': networkMerge,
  'venture.network.split': networkSplit,
  'venture.network.forget': networkForget,
  'venture.network.hide': networkHide,
  'venture.network.people': networkPeople,
  'venture.network.person': networkPerson,
  'venture.network.sources': networkSources,
  // 4D2 strength and warm paths
  'venture.network.recompute': networkRecompute,
  'venture.network.know': networkKnow,
  'venture.network.link': networkLink,
  // 4D3 search, saved searches and "Before you write"
  'venture.network.search': networkSearch,
  'venture.network.searchMore': networkSearchMore,
  'venture.network.saveSearch': networkSaveSearch,
  'venture.network.research': networkResearch,
  // 4E1 the pipeline and follow-ups
  'venture.pipeline.list': pipelineList,
  'venture.pipeline.followups': pipelineFollowups,
  'venture.pipeline.add': pipelineAdd,
  'venture.pipeline.setNext': pipelineSetNext,
  'venture.pipeline.move': pipelineMove,
  'venture.pipeline.settings': pipelineSettingsHandler,
  // 4E2 drafts, handoffs and the send governor
  'venture.outreach.draft': outreachDraft,
  'venture.outreach.open': outreachOpen,
  'venture.outreach.sent': outreachSent,
  'venture.outreach.restricted': outreachRestricted,
  // 4E3 the mailbox, inbound mail, the calendar address and "after a call"
  'venture.mailbox.connect': mailboxConnect,
  'venture.mailbox.disconnect': mailboxDisconnect,
  'venture.mailbox.sync': mailboxSync,
  'venture.inbound.list': inboundList,
  'venture.inbound.confirm': inboundConfirm,
  'venture.network.calendar': networkCalendar,
  'venture.meeting.digest': meetingDigest,
});

// The reads of people the network packages share (package 4-0).
export { listPeople, personById } from './store.ts';
