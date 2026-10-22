// Chausar venture launcher, package P4: build brief, its lint, builder handoff links, the GitHub reader and the
// connector catalogue. The host loads this file on first use of a method it owns.
import type { VentureHandler, VentureHandlerTable } from '../contracts.ts';
import { writeBrief } from './brief.ts';
import { listConnectors } from './connectors.ts';
import { buildStatus, linkRepo, syncRepo } from './github.ts';
import { markHandoffOpened, prepareHandoff } from './handoff.ts';
import { bankConsent, bankImport } from './bank-methods.ts';
import { siteApply, siteRevert, siteStage } from './site-methods.ts';
import { leadsAdd, leadsBlock, leadsDraft, leadsList, leadsRecordSend } from '../customers/lead-methods.ts';
import { shareCreate, shareList, shareRevoke } from './share-links.ts';

const brief: VentureHandler<'venture.build.brief'> = writeBrief;
const handoff: VentureHandler<'venture.build.handoff'> = prepareHandoff;
const handoffOpened: VentureHandler<'venture.build.handoffOpened'> = markHandoffOpened;
const link: VentureHandler<'venture.build.link'> = linkRepo;
const sync: VentureHandler<'venture.build.sync'> = syncRepo;
const status: VentureHandler<'venture.build.status'> = buildStatus;
const connectors: VentureHandler<'venture.connectors.list'> = listConnectors;

export const handlers: VentureHandlerTable = Object.freeze({
  'venture.build.brief': brief,
  'venture.build.handoff': handoff,
  'venture.build.handoffOpened': handoffOpened,
  'venture.build.link': link,
  'venture.build.sync': sync,
  'venture.build.status': status,
  'venture.connectors.list': connectors,
  // Connectors made real (P2-connectors' shapes as methods): statement import and consent, staged website edits, leads.
  'venture.bank.import': bankImport satisfies VentureHandler<'venture.bank.import'>,
  'venture.bank.consent': bankConsent satisfies VentureHandler<'venture.bank.consent'>,
  'venture.site.stage': siteStage satisfies VentureHandler<'venture.site.stage'>,
  'venture.site.apply': siteApply satisfies VentureHandler<'venture.site.apply'>,
  'venture.site.revert': siteRevert satisfies VentureHandler<'venture.site.revert'>,
  'venture.leads.add': leadsAdd satisfies VentureHandler<'venture.leads.add'>,
  'venture.leads.list': leadsList satisfies VentureHandler<'venture.leads.list'>,
  'venture.leads.draft': leadsDraft satisfies VentureHandler<'venture.leads.draft'>,
  'venture.leads.recordSend': leadsRecordSend satisfies VentureHandler<'venture.leads.recordSend'>,
  'venture.leads.block': leadsBlock satisfies VentureHandler<'venture.leads.block'>,
  // Read-only preview links for clients (share-links.ts); the hosted web server serves /share/<token>.
  'venture.share.create': shareCreate satisfies VentureHandler<'venture.share.create'>,
  'venture.share.list': shareList satisfies VentureHandler<'venture.share.list'>,
  'venture.share.revoke': shareRevoke satisfies VentureHandler<'venture.share.revoke'>,
});

export { defaultGitHubTransport, createFixtureGitHubTransport, TOKEN_LINK } from './github.ts';
export { planHandoff } from './handoff.ts';
export { lintBrief, REQUIRED_BRIEF_LINES, UI_POLICY } from './brief-lint.ts';
export { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from './lz.ts';
export { CONNECTOR_CATALOGUE } from './catalogue.ts';
// The journal sweep the host runs when a vault opens and on the engine's tick: a trusted host entry point, not a method.
export { JOURNAL_CLAIM_LIMIT_MS, sweepWholeJournal } from './journal-sweep.ts';
// The hosted /share/<token> page: trusted host entry points, never RPC methods (VentureHost.shareLink).
export { shareDecide, sharePage } from './share-links.ts';
