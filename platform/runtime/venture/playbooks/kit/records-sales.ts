// Chausar playbook kit: the sales mechanics' shapes (Ink v2 wave 5, package 5A2): the GO card's record body and inputs,
// the proposal and the share price. Package 5-0 named them as placeholders; 5A2 replaces them here, never in
// contracts.ts. Types only. Written for Chausar; nothing here is learned from an outside source.
import type { BpsString, MinorString } from '../../contracts.ts';

/** venture-go-no-go: one GO, HOLD or NO-GO card, a placeholder until 5A2 lands. */
export type GoNoGoBody = { placeholder: true };
/** The GO card's typed inputs by name; money as minor units in text, null for an input the owner does not know. */
export type GoNoGoInputs = Readonly<Record<string, string | null>>;
/** venture.goNoGo.card's answer. */
export type GoNoGoCardView = { placeholder: true };
/** venture.salesProposal.draft's and .get's answer. */
export type SalesProposalView = { placeholder: true };
/** An offer priced as a share of a recorded amount (5A2 money/share-price.ts): basis points the owner sets, of a base with its evidence. */
export type SharePrice = { kind: 'share'; bps: BpsString; baseMinor: MinorString | null; baseEvidenceFileId: string | null };
