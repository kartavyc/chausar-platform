import { socialIntakeFields } from './social/intake-fields.ts';
import { caIntakeFields } from './ca-firm/intake-fields.ts';
// Chausar flagship playbooks: what each one puts on the plan (playbook wiring, design 7.8). When an idea picks a flagship
// playbook (registry.ts), the instant plan, the template plan, the plan the AI rewrites and the plan the AI composes all
// take these words instead of the base service type's template words: the playbook's label, its summary as the one
// line, three of its offers with the pricing each is sold by, up to four of its approvals and the starter connectors
// its connectors map to. The base service type stays underneath, so prices, invoices and the books keep working.
//
// Everything here is data picked from each playbook's own playbook.ts, never new words: the picks below only say which
// offers and approvals go on the one-page plan, and which library block each one refines, so a plan the AI composes
// keeps its block structure (core/blocks.ts). Owner-set prices stay unpriced until the owner sets them.
import type { CountryProfile, PricingModel, ServiceType } from '../contracts.ts';
import type { ApprovalBlockId, OfferBlockId } from '../onboarding-contracts.ts';
import type { RightsBasis } from '../delivery/rights.ts';
import { PLAYBOOK_REGISTRY, pickPlaybook, type PlaybookRegistration } from './registry.ts';
import { CA_APPROVALS, CA_CONNECTORS, CA_OFFERS } from './ca-firm/playbook.ts';
import { CA_FIRM_ID } from './ca-firm/registration.ts';
import { YOUTUBE_APPROVALS, YOUTUBE_CONNECTOR_IDS, YOUTUBE_OFFERS } from './youtube/playbook.ts';
import { YOUTUBE_ID } from './youtube/registration.ts';
import { SOCIAL_APPROVALS, SOCIAL_CONNECTORS, SOCIAL_OFFERS } from './social/playbook.ts';
import { SOCIAL_AGENCY_ID } from './social/registration.ts';
import type { KitIntakeField, PlaybookDefinition } from './kit/define.ts';
import { kitDefinition, kitDefinitions } from './kit/installed.ts';

/** One offer on the plan: the playbook's own name, description and pricing, and the library block it refines. */
export type FlagshipOffer = {
  /** The playbook's offer id, kept on the plan's offer as playbookOffer. */
  key: string;
  name: string;
  description: string;
  model: PricingModel;
  block: OfferBlockId;
  /** The rights to footage this offer accepts at intake; empty when it cuts no footage. */
  rights: readonly RightsBasis[];
  /** Ink v2 wave 5 (5A1): a kit offer's own intake fields, in its order (playbooks/kit/intake.ts); absent on the flagships. */
  intake?: readonly KitIntakeField[];
};
/** One approval on the plan, in the playbook's own words, and the library approval it refines. */
export type FlagshipApproval = { key: string; words: string; block: ApprovalBlockId };
export type FlagshipPlan = {
  id: string;
  label: string;
  serviceType: ServiceType;
  oneLiner: string;
  offers: readonly FlagshipOffer[];
  approvals: readonly FlagshipApproval[];
  /** Connector catalogue ids the playbook's connectors map to, started on the plan beside the builder, the rail and the books. */
  connectors: readonly string[];
};

type Source = { key: string; name: string; description: string; model: PricingModel; rights?: readonly RightsBasis[]; intake?: readonly KitIntakeField[] };
type Picks = {
  offers: readonly { key: string; block: OfferBlockId }[];
  approvals: readonly { key: string; block: ApprovalBlockId }[];
  /** from: the playbook's connector id; id: the catalogue connector it is. */
  connectors: readonly { from: string; id: string }[];
};

const fail = (message: string): never => { throw new Error(message); };

function build(registration: PlaybookRegistration, offers: readonly Source[], approvals: readonly { key: string; words: string }[], connectorIds: readonly string[], picks: Picks): FlagshipPlan {
  return Object.freeze({
    id: registration.id,
    label: registration.label,
    serviceType: registration.serviceType,
    oneLiner: registration.summary,
    offers: Object.freeze(picks.offers.map(pick => {
      const offer = offers.find(item => item.key === pick.key) ?? fail(`The ${registration.id} playbook has no offer ${pick.key}.`);
      return Object.freeze({ key: offer.key, name: offer.name, description: offer.description, model: offer.model, block: pick.block, rights: Object.freeze([...(offer.rights ?? [])]), ...(offer.intake ? { intake: offer.intake } : {}) });
    })),
    approvals: Object.freeze(picks.approvals.map(pick => {
      const approval = approvals.find(item => item.key === pick.key) ?? fail(`The ${registration.id} playbook has no approval ${pick.key}.`);
      return Object.freeze({ key: approval.key, words: approval.words, block: pick.block });
    })),
    connectors: Object.freeze([...new Set(picks.connectors.map(pick => (connectorIds.includes(pick.from) ? pick.id : fail(`The ${registration.id} playbook has no connector ${pick.from}.`))))]),
  });
}

const registration = (id: string) => PLAYBOOK_REGISTRY.find(entry => entry.id === id) ?? fail(`The playbook ${id} is not registered.`);

const CA_FIRM_PLAN = build(
  registration(CA_FIRM_ID),
  CA_OFFERS.map(offer => ({ key: offer.id, name: offer.name, description: offer.description, model: offer.pricing, intake: caIntakeFields(offer.id) })),
  CA_APPROVALS.map(item => ({ key: item.id, words: item.words })),
  CA_CONNECTORS.map(item => item.id),
  {
    // The three offers a new firm starts with; the other regulated offers and the CA's own work are added later.
    offers: [{ key: 'monthly-books', block: 'retainer' }, { key: 'gst-working', block: 'retainer' }, { key: 'itr-salaried', block: 'one-off-project' }, ...CA_OFFERS.filter(offer => ['books-health-check','itr-form-and-regime','itr-computation-only','itr-check-draft','itr-checklist','check-return-elsewhere','advance-tax-freelancer','tax-question-desk'].includes(offer.id)).map(offer => ({key:offer.id,block:(offer.pricing==='monthly'?'retainer':'one-off-project') as OfferBlockId}))],
    approvals: [
      { key: 'owner-approves-draft', block: 'each-draft' }, { key: 'ca-signs-regulated', block: 'each-draft' },
      { key: 'ca-confirms-rates', block: 'prices-invoices' }, { key: 'human-files', block: 'posts-in-your-name' },
    ],
    connectors: [{ from: 'mail-app', id: 'mail-app' }, { from: 'tally', id: 'tally' }, { from: 'zoho-books', id: 'zoho-books' }, { from: 'account-aggregator', id: 'bank-account' }],
  },
);

const YOUTUBE_PLAN = build(
  registration(YOUTUBE_ID),
  YOUTUBE_OFFERS.map(offer => ({ key: offer.id, name: offer.name, description: offer.description, model: offer.pricing, rights: offer.rightsBases })),
  YOUTUBE_APPROVALS.map(item => ({ key: item.id, words: item.words })),
  [...YOUTUBE_CONNECTOR_IDS], // a static list: loading the plan never calls into build/posting.ts
  {
    offers: [{ key: 'episode-package', block: 'package' }, { key: 'shorts-from-own-video', block: 'package' }, { key: 'licensed-clips', block: 'retainer' }],
    approvals: [
      { key: 'rights-at-intake', block: 'client-files' }, { key: 'quote-before-paid-generation', block: 'prices-invoices' },
      { key: 'draft-after-viewing', block: 'each-draft' }, { key: 'owner-publishes', block: 'posts-in-your-name' },
    ],
    connectors: [{ from: 'youtube-upload', id: 'youtube' }, { from: 'messages', id: 'mail-app' }],
  },
);

const SOCIAL_PLAN = build(
  registration(SOCIAL_AGENCY_ID),
  SOCIAL_OFFERS.map(offer => ({ key: offer.id, name: offer.name, description: offer.description, model: offer.charge, intake: socialIntakeFields(offer.id) })),
  SOCIAL_APPROVALS.map(item => ({ key: item.id, words: item.when })),
  SOCIAL_CONNECTORS.map(item => item.id),
  {
    // The three things a client buys, then the monthly report as its own offer (Ink v2 wave 2), so an order for it runs
    // the report steps on the exports the client uploads. Fourth, so the other offers keep their refs.
    offers: [{ key: 'content-calendar', block: 'retainer' }, { key: 'community-replies', block: 'retainer' }, { key: 'ugc-ads', block: 'package' }, { key: 'monthly-report', block: 'retainer' }, { key: 'repurpose-pack', block: 'retainer' }, { key: 'linkedin-ghostwriting', block: 'retainer' }],
    approvals: [
      { key: 'every-draft', block: 'each-draft' }, { key: 'spend-before-generation', block: 'prices-invoices' },
      { key: 'every-post', block: 'posts-in-your-name' }, { key: 'report-and-invoice', block: 'prices-invoices' },
    ],
    connectors: [
      { from: 'mail-app', id: 'mail-app' }, { from: 'posting', id: 'linkedin' }, { from: 'posting', id: 'x' }, { from: 'posting', id: 'instagram' },
      { from: 'scheduler-tools', id: 'buffer' },
    ],
  },
);

/**
 * One plan per hand-written flagship playbook, in registry order. A kit playbook's plan comes from its definition
 * (kitPlan); a kit registration whose definition has not landed has none, and the plain service type serves it.
 */
export const FLAGSHIP_PLANS: readonly FlagshipPlan[] = Object.freeze(
  PLAYBOOK_REGISTRY.flatMap(entry => [CA_FIRM_PLAN, YOUTUBE_PLAN, SOCIAL_PLAN].find(plan => plan.id === entry.id) ?? []),
);

// ---------------------------------------------------------------------------
// Kit playbooks (Ink v2 wave 5, 5A1): the plan words from a definition's planPicks
// ---------------------------------------------------------------------------

/** The library offer block a kit offer refines, by how it is sold. */
const KIT_OFFER_BLOCKS: Readonly<Record<PricingModel, OfferBlockId>> = Object.freeze({ monthly: 'retainer', project: 'one-off-project', hourly: 'hourly-help' });
const kitPlans = new WeakMap<PlaybookDefinition, FlagshipPlan>();

/**
 * A kit definition's plan words: its label and summary, the offers its planPicks name with their pricing, intake fields
 * and rights, the approvals with the library approval each refines, and the catalogue connectors its picked connectors
 * are (a planned connector, or one with no catalogue entry, starts nothing).
 */
export function kitPlan(definition: PlaybookDefinition): FlagshipPlan {
  const ready = kitPlans.get(definition);
  if (ready) return ready;
  const id = definition.registration.id;
  const plan: FlagshipPlan = Object.freeze({
    id, label: definition.registration.label, serviceType: definition.registration.serviceType, oneLiner: definition.registration.summary,
    offers: Object.freeze(definition.planPicks.offers.map(key => {
      const offer = definition.offers.find(item => item.id === key) ?? fail(`The ${id} playbook has no offer ${key}.`);
      const intake = offer.intake.map(field => definition.intakeFields.find(item => item.id === field) ?? fail(`The ${id} playbook has no intake field ${field}.`));
      return Object.freeze({
        key: offer.id, name: offer.name, description: offer.description, model: offer.pricing, block: KIT_OFFER_BLOCKS[offer.pricing],
        rights: Object.freeze([...offer.rights]), intake: Object.freeze(intake.map(field => Object.freeze({ ...field }))),
      });
    })),
    approvals: Object.freeze(definition.planPicks.approvals.map(key => {
      const approval = definition.approvals.find(item => item.id === key) ?? fail(`The ${id} playbook has no approval ${key}.`);
      return Object.freeze({ key: approval.id, words: approval.words, block: approval.block ?? 'each-draft' as const });
    })),
    connectors: Object.freeze([...new Set(definition.planPicks.connectors.flatMap(key => {
      const connector = definition.connectors.find(item => item.id === key) ?? fail(`The ${id} playbook has no connector ${key}.`);
      return connector.catalogueId && !connector.label.startsWith('planned') ? [connector.catalogueId] : [];
    }))]),
  });
  kitPlans.set(definition, plan);
  return plan;
}

/**
 * The plan words for a registered playbook id, or null: a flagship's own, else a kit definition's (definitions: the
 * kit definitions to look in; default the landed ones, kit/installed.ts).
 */
export function flagshipPlanById(id: string | null | undefined, definitions: readonly PlaybookDefinition[] = kitDefinitions()): FlagshipPlan | null {
  if (!id) return null;
  const flagship = FLAGSHIP_PLANS.find(plan => plan.id === id);
  if (flagship) return flagship;
  const definition = kitDefinition(id, definitions);
  return definition ? kitPlan(definition) : null;
}

/** The plan words of the flagship playbook an idea picks, or null when the plain service type serves. */
export function flagshipPlan(idea: string): FlagshipPlan | null {
  return flagshipPlanById(pickPlaybook(idea)?.id);
}

/** Starter connectors for a flagship plan: the builder, GitHub, the country's payment rail, the playbook's own, the books. */
export function flagshipStarterIds(plan: FlagshipPlan, country: Pick<CountryProfile, 'paymentRails'>): string[] {
  return [...new Set(['lovable', 'github', country.paymentRails[0], ...plan.connectors, 'chausar-books'])];
}

/**
 * The plan offer a blueprint offer is, by the playbook offer id it keeps; null for an offer from another plan. An offer
 * the owner added to a flagship playbook's plan (4J8) runs that playbook's steps, so it takes intake as the playbook's
 * own first offer does (YouTube's episode package: the footage rights included), under the owner's offer name.
 */
export function flagshipOffer(plan: FlagshipPlan | null, offer: { playbookOffer?: string; addedByOwner?: true; name?: { value: string } } | null | undefined): FlagshipOffer | null {
  if (plan && offer?.addedByOwner && plan.offers[0]) return { ...plan.offers[0], name: offer.name?.value ?? plan.offers[0].name };
  return plan && offer?.playbookOffer ? plan.offers.find(item => item.key === offer.playbookOffer) ?? null : null;
}
