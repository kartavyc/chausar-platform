// Chausar venture launcher, package P4: build brief, its lint, builder handoff links, the GitHub reader and the
// connector catalogue. The host loads this file on first use of a method it owns.
import type { VentureHandler, VentureHandlerTable } from '../contracts.ts';
import { writeBrief } from './brief.ts';
import { listConnectors } from './connectors.ts';
import { buildStatus, linkRepo, syncRepo } from './github.ts';
import { markHandoffOpened, prepareHandoff } from './handoff.ts';

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
});

export { defaultGitHubTransport, createFixtureGitHubTransport, TOKEN_LINK } from './github.ts';
export { planHandoff } from './handoff.ts';
export { lintBrief, REQUIRED_BRIEF_LINES, UI_POLICY } from './brief-lint.ts';
export { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from './lz.ts';
export { CONNECTOR_CATALOGUE } from './catalogue.ts';
