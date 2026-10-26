// Chausar venture launcher, core (P1): venture, preview, countries, interview, blueprint, terms, checklist, events.
// The host loads this package on first use of a method it owns. listCountries, previewPlan and listWays answer the
// three pre-vault methods: they take no deps, read no state of their own and write nothing.
import { ChausarError } from '../../contracts.ts';
import type { VentureHandlerTable } from '../contracts.ts';
import { blueprintAccept, blueprintDraft, blueprintGet, blueprintUpdate } from './blueprint.ts';
import { ventureEvents } from './events.ts';
import { interviewAnswer, interviewNext } from './interview.ts';
import { ownerGet, ownerSet } from './owner.ts';
import { settingsDraftHandler, settingsDraftsHandler } from './settings-drafts.ts';
import { blueprintSuggest } from './suggest.ts';
import { createVenture, getVenture } from './venture.ts';
import { evidenceApply, evidenceDismiss, evidenceList } from '../evidence/ledger.ts';

/** A wave 4 method whose package has not landed yet: listed, so the contract and the desktop see it, and refused. */
const notBuiltYet = async (): Promise<never> => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); };

export const handlers: VentureHandlerTable = {
  'venture.create': createVenture,
  'venture.get': getVenture,
  'venture.events': ventureEvents,
  'venture.interview.next': interviewNext,
  'venture.interview.answer': interviewAnswer,
  'venture.blueprint.draft': blueprintDraft,
  'venture.blueprint.get': blueprintGet,
  'venture.blueprint.update': blueprintUpdate,
  'venture.blueprint.accept': blueprintAccept,
  // The evidence ledger lives in ../evidence/; core owns its two methods because it backs business and client fields.
  'venture.evidence.list': evidenceList,
  'venture.evidence.apply': evidenceApply,
  'venture.evidence.dismiss': evidenceDismiss,
  // Ink v2 wave 4 (package 4-0 registered these; each package replaces its own lines). 4J2 settings drafts; 4J9 the
  // owner profile. venture.playbooks.list (4J8) is answered before any vault, by the listWays export below; 4J8's plan
  // suggestion for an open business ("Add this to {business}").
  'venture.settings.draft': settingsDraftHandler,
  'venture.settings.drafts': settingsDraftsHandler,
  'venture.owner.get': ownerGet,
  'venture.owner.set': ownerSet,
  'venture.blueprint.suggest': blueprintSuggest,
};

export { listCountries } from './countries.ts';
export { previewPlan } from './preview.ts';
// venture.playbooks.list (4J8): the ways to earn, and the open business a way shows as "You run this".
export { listWays, openWayBusiness } from './ways.ts';
export { classifyIdea, serviceTemplate } from './service-types.ts';
export { structureOf, blueprintDigest } from './blueprint.ts';
export { taxInvoiceFields } from './tax-fields.ts';
export { buildView } from './venture.ts';
