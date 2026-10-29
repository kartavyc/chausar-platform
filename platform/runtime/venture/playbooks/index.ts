// Chausar venture launcher, playbooks (Ink v2 wave 5): the kit's methods (5A1 the chain, 5A2 the proposal and the GO
// card, 5A3 the idea pipeline, 5A4 brand kits, assets and voice consent, 5A5 reports and their share links), the CA
// firm's new methods (5C1, 5C2) and every business's desk (venture.desk.list, .get and .act over playbooks/desks.ts).
// The host loads this file on first use of a method it owns. Package 5-0 registered every method with a NOT_BUILT_YET
// stub; each package replaces only its own lines. 5A6's methods are build's (build/index.ts). Written for Chausar;
// nothing here is learned from an outside source.
import { ChausarError } from '../../contracts.ts';
import type { VentureHandlerTable } from '../contracts.ts';
import { orderChainHandler } from './kit/chain.ts';
import { deskRoute } from './kit/desk-route.ts';

/** A wave 5 method whose package has not landed yet: listed, so the contract and the desktop see it, and refused. */
const notBuiltYet = async (): Promise<never> => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); };

export const handlers: VentureHandlerTable = Object.freeze({
  // 5A1 the chain of an order's stages
  'venture.order.chain': orderChainHandler,
  // 5A2 the sales proposal and the GO card
  'venture.salesProposal.draft': async (deps, ctx, payload) => (await import('./kit/sales-methods.ts')).salesProposalDraftHandler(deps, ctx, payload),
  'venture.salesProposal.get': async (deps, ctx, payload) => (await import('./kit/sales-methods.ts')).salesProposalGetHandler(deps, ctx, payload),
  'venture.goNoGo.card': async (deps, ctx, payload) => (await import('./kit/sales-methods.ts')).goNoGoCardHandler(deps, ctx, payload),
  'venture.goNoGo.list': async (deps, ctx, payload) => (await import('./kit/sales-methods.ts')).goNoGoListHandler(deps, ctx, payload),
  // 5A3 the idea pipeline
  'venture.ideas.add': async (deps, ctx, payload) => (await import('./kit/ideas.ts')).ideasAddHandler(deps, ctx, payload),
  'venture.ideas.move': async (deps, ctx, payload) => (await import('./kit/ideas.ts')).ideasMoveHandler(deps, ctx, payload),
  'venture.ideas.grade': async (deps, ctx, payload) => (await import('./kit/ideas.ts')).ideasGradeHandler(deps, ctx, payload),
  // 5A4 brand kits, asset records and voice consent
  'venture.brandKit.get': async (deps, ctx, payload) => (await import('./kit/media-methods.ts')).brandKitGetHandler(deps, ctx, payload),
  'venture.brandKit.set': async (deps, ctx, payload) => (await import('./kit/media-methods.ts')).brandKitSetHandler(deps, ctx, payload),
  'venture.assets.list': async (deps, ctx, payload) => (await import('./kit/media-methods.ts')).assetsListHandler(deps, ctx, payload),
  'venture.assets.rerun': async (deps, ctx, payload) => (await import('./kit/media-methods.ts')).assetsRerunHandler(deps, ctx, payload),
  'venture.assets.reuse': async (deps, ctx, payload) => (await import('./kit/media-methods.ts')).assetsReuseHandler(deps, ctx, payload),
  'venture.voiceConsent.record': async (deps, ctx, payload) => (await import('./kit/media-methods.ts')).voiceConsentRecordHandler(deps, ctx, payload),
  'venture.voiceConsent.revoke': async (deps, ctx, payload) => (await import('./kit/media-methods.ts')).voiceConsentRevokeHandler(deps, ctx, payload),
  'venture.voiceConsent.list': async (deps, ctx, payload) => (await import('./kit/media-methods.ts')).voiceConsentListHandler(deps, ctx, payload),
  // 5A5 client reports and their share links
  'venture.report.render': async (deps, ctx, payload) => (await import('./kit/report/methods.ts')).reportRender(deps, ctx, payload),
  'venture.report.share': async (deps, ctx, payload) => (await import('./kit/report/share.ts')).reportShare(deps, ctx, payload),
  'venture.report.shareRotate': async (deps, ctx, payload) => (await import('./kit/report/share.ts')).reportShareRotate(deps, ctx, payload),
  'venture.report.shareDisable': async (deps, ctx, payload) => (await import('./kit/report/share.ts')).reportShareDisable(deps, ctx, payload),
  'venture.report.list': async (deps, ctx, payload) => (await import('./kit/report/methods.ts')).reportList(deps, ctx, payload),
  // 5C1 the citations table and the stored sign-off; 5C2 differential cases and the ITR data pack
  'venture.ca.confirmCitations': async (deps, ctx, payload) => (await import('./ca-firm/citations.ts')).caConfirmCitations(deps, ctx, payload),
  'venture.ca.signoff.get': async (deps, ctx, payload) => (await import('./ca-firm/stored-signoff.ts')).caSignoffGet(deps, ctx, payload),
  'venture.ca.differential.add': async (deps, ctx, payload) => (await import('./ca-firm/differential.ts')).caDifferentialAdd(deps, ctx, payload),
  'venture.ca.dataPack.export': async (deps,ctx,payload)=>(await import('./ca-firm/data-pack.ts')).caDataPackExport(deps,ctx,payload),
  // Every business's desk: 5A1 routes these through playbooks/desks.ts deskHandler
  'venture.desk.list': deskRoute('list'),
  'venture.desk.get': deskRoute('get'),
  'venture.desk.act': deskRoute('act'),
});

/** 5A5: the hosted /share/<token> page for a report link (VentureHost.shareLink). Trusted host only; no RPC reaches it. */
export const reportSharePage: typeof import('./kit/report/share.ts').reportSharePage = async (...args) => (await import('./kit/report/share.ts')).reportSharePage(...args);

/** 5G: trusted hosted customer rating entry; no RPC method exposes it. */
export const supportRatingEntry: typeof import('./support-desk/rating-link.ts').supportRatingEntry = async (...args) => (await import('./support-desk/rating-link.ts')).supportRatingEntry(...args);

/** 5P trusted hosted form entry. No owner RPC exposes it. */
export const siteFormEntry: typeof import('./website-studio/form-entry.ts').siteFormEntry = async (...args) => (await import('./website-studio/form-entry.ts')).siteFormEntry(...args);
export const storefrontEntry: typeof import('./online-seller/storefront-entry.ts').storefrontEntry = async (...args) => (await import('./online-seller/storefront-entry.ts')).storefrontEntry(...args);
