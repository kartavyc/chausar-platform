// Chausar venture launcher, playbooks (Ink v2 wave 5): the kit's methods (5A1 the chain, 5A2 the proposal and the GO
// card, 5A3 the idea pipeline, 5A4 brand kits, assets and voice consent, 5A5 reports and their share links), the CA
// firm's new methods (5C1, 5C2) and every business's desk (venture.desk.list, .get and .act over playbooks/desks.ts).
// The host loads this file on first use of a method it owns. Package 5-0 registered every method with a NOT_BUILT_YET
// stub; each package replaces only its own lines. 5A6's methods are build's (build/index.ts). Written for Chausar;
// nothing here is learned from an outside source.
import { ChausarError } from '../../contracts.ts';
import type { VentureHandlerTable } from '../contracts.ts';

/** A wave 5 method whose package has not landed yet: listed, so the contract and the desktop see it, and refused. */
const notBuiltYet = async (): Promise<never> => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); };

export const handlers: VentureHandlerTable = Object.freeze({
  // 5A1 the chain of an order's stages
  'venture.order.chain': notBuiltYet,
  // 5A2 the sales proposal and the GO card
  'venture.salesProposal.draft': notBuiltYet,
  'venture.salesProposal.get': notBuiltYet,
  'venture.goNoGo.card': notBuiltYet,
  // 5A3 the idea pipeline
  'venture.ideas.add': notBuiltYet,
  'venture.ideas.move': notBuiltYet,
  'venture.ideas.grade': notBuiltYet,
  // 5A4 brand kits, asset records and voice consent
  'venture.brandKit.get': notBuiltYet,
  'venture.brandKit.set': notBuiltYet,
  'venture.assets.list': notBuiltYet,
  'venture.assets.rerun': notBuiltYet,
  'venture.assets.reuse': notBuiltYet,
  'venture.voiceConsent.record': notBuiltYet,
  'venture.voiceConsent.revoke': notBuiltYet,
  'venture.voiceConsent.list': notBuiltYet,
  // 5A5 client reports and their share links
  'venture.report.render': notBuiltYet,
  'venture.report.share': notBuiltYet,
  'venture.report.shareRotate': notBuiltYet,
  'venture.report.shareDisable': notBuiltYet,
  // 5C1 the citations table and the stored sign-off; 5C2 differential cases and the ITR data pack
  'venture.ca.confirmCitations': notBuiltYet,
  'venture.ca.signoff.get': notBuiltYet,
  'venture.ca.differential.add': notBuiltYet,
  'venture.ca.dataPack.export': notBuiltYet,
  // Every business's desk: 5A1 routes these through playbooks/desks.ts deskHandler
  'venture.desk.list': notBuiltYet,
  'venture.desk.get': notBuiltYet,
  'venture.desk.act': notBuiltYet,
});
