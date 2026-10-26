// Chausar venture launcher, views (Ink v2 wave 4, package 4A1): the team's flagship playbook, in one place. Which
// flagship playbook the team follows and the playbook in use, read as delivery/playbook.ts reads them (currentPlaybook,
// deliveryFlagship): the playbook the business points at, else its newest; else the accepted plan's flagship when the
// idea picks one and the plan sells its offers. views/team.ts, views/health.ts and money/department-spend.ts all read
// the team through this file, so Team, agent health and the department figures never disagree about who the team is.
// It does not import delivery/playbook.ts: the money package loads this file, and that import closes a module cycle
// (money/sums, delivery/playbook, the playbooks' checks) that breaks loading.
import type { State } from '../../contracts.ts';
import type { PlaybookRecord, VentureRecord } from '../contracts.ts';
import { findRecord } from '../records.ts';
import { acceptedBlueprintOrNull, latestPlaybook } from '../delivery/shared.ts';
import { pickPlaybook } from '../playbooks/registry.ts';
import { flagshipDelivery, type FlagshipDelivery } from '../playbooks/steps.ts';

/** The playbook in use: the one the business points at, else its newest (delivery/playbook.ts currentPlaybook). */
export function playbookInUse(state: State, venture: VentureRecord): PlaybookRecord | null {
  const pointed = venture.playbookId ? findRecord(state, 'venture-playbook', venture.playbookId) : undefined;
  return pointed && pointed.ventureId === venture.id ? pointed : latestPlaybook(state, venture.id);
}

/** The flagship playbook the team follows (playbooks/steps.ts): the playbook in use's, else the accepted plan's; null on the eight fixed steps. */
export function teamFlagship(state: State, venture: VentureRecord): FlagshipDelivery | null {
  const playbook = playbookInUse(state, venture);
  if (playbook) return flagshipDelivery(playbook.flagship);
  const plan = acceptedBlueprintOrNull(state, venture);
  if (!plan) return null;
  const id = pickPlaybook(venture.idea)?.id ?? null;
  return id && plan.offers.some(offer => offer.playbookOffer) ? flagshipDelivery(id) : null;
}
