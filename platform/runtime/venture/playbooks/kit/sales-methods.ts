// Chausar playbook kit: the sales mechanics' methods (Ink v2 wave 5, package 5A2), as playbooks/index.ts registers
// them, loaded on first use: venture.salesProposal.draft and .get (kit/proposal.ts, P2 and P3, with the honest exit of
// kit/exit.ts, P4), venture.goNoGo.card and .list (kit/go-no-go.ts, M18). Written for Chausar; nothing here is learned
// from an outside source.
import type { Context } from '../../../contracts.ts';
import type { VentureDeps } from '../../contracts.ts';
import type { GoNoGoCardView, GoNoGoListView, SalesProposalView } from './records-sales.ts';
import { goNoGoCard, goNoGoList } from './go-no-go.ts';
import { draftSalesProposal, getSalesProposal } from './proposal.ts';

/** venture.salesProposal.draft (prepare): a proposal for a client or a pipeline person, waiting for the owner on Today. */
export const salesProposalDraftHandler = (deps: VentureDeps, ctx: Context, payload: unknown): Promise<SalesProposalView> => draftSalesProposal(deps, ctx, payload);
/** venture.salesProposal.get (read): one proposal by id, or the newest for a client or a person. */
export const salesProposalGetHandler = (deps: VentureDeps, ctx: Context, payload: unknown): Promise<SalesProposalView> => getSalesProposal(deps, ctx, payload);
/** venture.goNoGo.card (prepare): GO, HOLD or NO-GO by code, stored. */
export const goNoGoCardHandler = (deps: VentureDeps, ctx: Context, payload: unknown): Promise<GoNoGoCardView> => goNoGoCard(deps, ctx, payload);
/** venture.goNoGo.list (read): the stored cards, newest first. */
export const goNoGoListHandler = (deps: VentureDeps, ctx: Context, payload: unknown): Promise<GoNoGoListView> => goNoGoList(deps, ctx, payload);
