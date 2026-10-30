// Chausar venture launcher, package P4: build brief, its lint, builder handoff links, the GitHub reader and the
// connector catalogue. The host loads this file on first use of a method it owns.
import { ChausarError } from '../../contracts.ts';
import type { VentureHandler, VentureHandlerTable } from '../contracts.ts';
import { writeBrief } from './brief.ts';
import { listConnectors } from './connectors.ts';
import { buildStatus, linkRepo, syncRepo } from './github.ts';
import { markHandoffOpened, prepareHandoff } from './handoff.ts';
import { bankAlertsGet, bankAlertsSet, bankApply, bankConsent, bankImport, bankLedger } from './bank-methods.ts';
import { siteApply, siteRevert, siteStage } from './site-methods.ts';
import { leadsAdd, leadsBlock, leadsDraft, leadsList, leadsRecordSend } from '../customers/lead-methods.ts';
import { shareCreate, shareList, shareRecordAnswer, shareRevoke } from './share-links.ts';
import { postingPropose, postingSignIn } from './posting.ts';
import { postingCheckSteps } from './posting-steps.ts';
import { postingLimitsGet, postingLimitsSet } from './posting-limits.ts';
import { socialCalendarHandler } from '../playbooks/social/calendar-export.ts';
import { connectorsCheckHandler } from './connector-check.ts';
import { shareRequestHandler } from './file-requests.ts';
// Ink v2 wave 5, 5A6: monitors, mail in, local apps, the webhook handoff and speech out.
import { monitorsAdd, monitorsList, monitorsRemove } from './monitors.ts';
import { webhookSet } from './webhook-handoff.ts';
import { localAppsList } from './local-apps.ts';
import { mailImport, mailThreads } from './mail-in.ts';
import { speechProviders } from './speech-out.ts';

const brief: VentureHandler<'venture.build.brief'> = writeBrief;
const handoff: VentureHandler<'venture.build.handoff'> = prepareHandoff;
const handoffOpened: VentureHandler<'venture.build.handoffOpened'> = markHandoffOpened;
const link: VentureHandler<'venture.build.link'> = linkRepo;
const sync: VentureHandler<'venture.build.sync'> = syncRepo;
const status: VentureHandler<'venture.build.status'> = buildStatus;
const connectors: VentureHandler<'venture.connectors.list'> = listConnectors;
/** A wave 2 method whose package has not landed yet: listed, so the contract and the desktop see it, and refused. */
const notBuiltYet = async (): Promise<never> => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); };

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
  // Ink v2 wave 2: posting from a checked draft (2B1, 2B2), the client's answer the owner records (2B1), the calendar
  // file (2F2), and bank statements into the books with their alerts (2D).
  'venture.posting.propose': postingPropose satisfies VentureHandler<'venture.posting.propose'>,
  'venture.posting.signIn': postingSignIn satisfies VentureHandler<'venture.posting.signIn'>,
  'venture.posting.limits.get': postingLimitsGet satisfies VentureHandler<'venture.posting.limits.get'>,
  'venture.posting.limits.set': postingLimitsSet satisfies VentureHandler<'venture.posting.limits.set'>,
  'venture.posting.checkSteps': postingCheckSteps satisfies VentureHandler<'venture.posting.checkSteps'>,
  'venture.share.recordAnswer': shareRecordAnswer satisfies VentureHandler<'venture.share.recordAnswer'>,
  'venture.social.calendar': socialCalendarHandler satisfies VentureHandler<'venture.social.calendar'>,
  'venture.bank.ledger': bankLedger satisfies VentureHandler<'venture.bank.ledger'>,
  'venture.bank.apply': bankApply satisfies VentureHandler<'venture.bank.apply'>,
  'venture.bank.alerts.get': bankAlertsGet satisfies VentureHandler<'venture.bank.alerts.get'>,
  'venture.bank.alerts.set': bankAlertsSet satisfies VentureHandler<'venture.bank.alerts.set'>,
  // Ink v2 wave 4 (package 4-0 registered these; 4J7 replaces them): connection checks and the client's file request.
  'venture.connectors.check': connectorsCheckHandler satisfies VentureHandler<'venture.connectors.check'>,
  'venture.share.request': shareRequestHandler satisfies VentureHandler<'venture.share.request'>,
  // Ink v2 wave 5 (package 5-0 registered these; 5A6 replaces them): monitors, mail import, the owner's local apps, the
  // webhook handoff and speech providers.
  'venture.monitors.list': monitorsList satisfies VentureHandler<'venture.monitors.list'>,
  'venture.monitors.add': monitorsAdd satisfies VentureHandler<'venture.monitors.add'>,
  'venture.monitors.remove': monitorsRemove satisfies VentureHandler<'venture.monitors.remove'>,
  'venture.mail.import': mailImport satisfies VentureHandler<'venture.mail.import'>,
  'venture.mail.threads': mailThreads satisfies VentureHandler<'venture.mail.threads'>,
  'venture.localApps.list': localAppsList satisfies VentureHandler<'venture.localApps.list'>,
  'venture.webhook.set': webhookSet satisfies VentureHandler<'venture.webhook.set'>,
  'venture.speechOut.providers': speechProviders satisfies VentureHandler<'venture.speechOut.providers'>,
});

export { defaultGitHubTransport, createFixtureGitHubTransport, TOKEN_LINK } from './github.ts';
export { planHandoff } from './handoff.ts';
export { lintBrief, REQUIRED_BRIEF_LINES, UI_POLICY } from './brief-lint.ts';
export { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from './lz.ts';
export { CONNECTOR_CATALOGUE } from './catalogue.ts';
// The journal sweep the host runs when a vault opens and on the engine's tick: a trusted host entry point, not a method.
export { JOURNAL_CLAIM_LIMIT_MS, sweepWholeJournal } from './journal-sweep.ts';
// The hosted /share/<token> page: trusted host entry points, never RPC methods (VentureHost.shareLink).
export { shareComment, shareDecide, sharePage } from './share-links.ts';
// The hosted /share/<token>/upload page (4J7, K9): a trusted host entry point, never an RPC method.
export { fileRequestEntry } from './file-requests.ts';
