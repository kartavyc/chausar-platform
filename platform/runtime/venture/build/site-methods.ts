// Chausar venture launcher: staged website edits as engine methods. venture.site.stage { path, after, summary },
// venture.site.apply { editId, reviewedHash } and venture.site.revert { editId, reviewedHash }.
// The site is the folder on this computer the host names (CHAUSAR_SITE_FOLDER, never a payload, never on the hosted
// web server), else the GitHub repo this business follows. Chausar only reads that repo: no GitHub writer ships, so an
// edit staged from it can be reviewed but applying it is refused (SITE_WRITE_NOT_GRANTED). reviewedHash is the edit's
// plan digest, the one the owner read; site-edits.ts checks it, the live file, and the file again after writing.
import { ChausarError, type Context, type State } from '../../contracts.ts';
import type { SiteEditRecord, VentureDeps } from '../contracts.ts';
import { currentVenture, exactPayload, listRecords, requireAppChannel } from '../records.ts';
import { secretNameFor } from './github.ts';
import { applySiteEdit, githubSiteTarget, localFolderTarget, rollbackSiteEdit, stageSiteEdit, type SiteTarget } from './site-edits.ts';

const NO_SITE = 'Link your website repo under Connections first. Applying edits needs the site folder on this computer.';

/** Where this business's website edits go: the host's site folder, else the followed repo (read only), else a refusal. */
export function siteTargetFor(deps: VentureDeps, state: State): SiteTarget {
  if (deps.siteFolder && deps.host !== 'hosted-web') return localFolderTarget(deps.siteFolder);
  const venture = currentVenture(state);
  const follows = venture ? listRecords(state, 'venture-build-follow', venture.id) : [];
  const follow = follows[follows.length - 1];
  if (!follow) throw new ChausarError('REPO_NOT_LINKED', NO_SITE);
  const branch = follow.lastStatus?.repo.defaultBranch ?? null;
  if (!branch) throw new ChausarError('REPO_NOT_LINKED', 'Check your repo once under Connections, so Chausar knows its main branch.');
  return githubSiteTarget({ repo: follow.repo, branch, transport: deps.github, token: deps.secrets.get(secretNameFor(follow.repo)) });
}

function reviewed(payload: unknown): { editId: unknown; planDigest: unknown } {
  const body = exactPayload(payload, ['editId', 'reviewedHash'], ['editId', 'reviewedHash']);
  return { editId: body.editId, planDigest: body.reviewedHash };
}

/** venture.site.stage (prepare): an agent or the owner stages an edit to one existing file. Nothing is written. */
export async function siteStage(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SiteEditRecord> {
  exactPayload(payload, ['path', 'after', 'summary'], ['path', 'after', 'summary']);
  return stageSiteEdit(deps, ctx, siteTargetFor(deps, deps.store.read()), payload);
}

/** venture.site.apply (approve, inside the app): writes the edit the owner reviewed, then reads it back. */
export async function siteApply(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SiteEditRecord> {
  requireAppChannel(ctx, 'venture.site.apply');
  const decision = reviewed(payload);
  return applySiteEdit(deps, ctx, siteTargetFor(deps, deps.store.read()), decision);
}

/** venture.site.revert (approve, inside the app): puts back the file from before an applied edit, with the same checks. */
export async function siteRevert(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SiteEditRecord> {
  requireAppChannel(ctx, 'venture.site.revert');
  const decision = reviewed(payload);
  return rollbackSiteEdit(deps, ctx, siteTargetFor(deps, deps.store.read()), decision);
}
