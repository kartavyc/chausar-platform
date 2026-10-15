// Chausar venture launcher, core (P1): venture, preview, countries, interview, blueprint, terms, checklist, events.
// The host loads this package on first use of a method it owns. listCountries and previewPlan answer the two
// pre-vault methods: they take no deps, read no state and write nothing.
import type { VentureHandlerTable } from '../contracts.ts';
import { blueprintAccept, blueprintDraft, blueprintGet, blueprintUpdate } from './blueprint.ts';
import { ventureEvents } from './events.ts';
import { interviewAnswer, interviewNext } from './interview.ts';
import { createVenture, getVenture } from './venture.ts';

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
};

export { listCountries } from './countries.ts';
export { previewPlan } from './preview.ts';
export { classifyIdea, serviceTemplate } from './service-types.ts';
export { structureOf, blueprintDigest } from './blueprint.ts';
export { taxInvoiceFields } from './tax-fields.ts';
export { buildView } from './venture.ts';
