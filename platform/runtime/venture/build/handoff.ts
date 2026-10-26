// Chausar venture launcher: builder handoff links (package P4).
// Lovable gets the brief in the link's hash, Replit gets it LZ-compressed in the query. Bolt and v0 have no
// official link and a pasted link may start building at once, so Chausar copies the brief instead.
// The engine opens nothing: the renderer opens the URL from the owner's click, then reports back.
import { authorize, check, type Context } from '../../contracts.ts';
import { BUILDER_IDS } from '../contracts.ts';
import type { BuilderId, HandoffPlan, HandoffRecord, VentureDeps } from '../contracts.ts';
import { digest, exactPayload, identifier, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { acceptedBlueprint, latestBrief } from './brief.ts';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from './lz.ts';
import { checkConnectorFields } from './connector-truth.ts';

/** "ours" is Chausar's own margin; the builder limits come from R5 (docs and shipped code). */
export const LIMITS = Object.freeze({
  briefMaxChars: 9000, // ours
  lovablePromptMax: 50000, // Lovable drops the whole link above this
  replitEncodedSafe: 8000, // Replit slices re-encoded prompts at this length
  openUrlMaxChars: 30000, // ours: under the Windows command line limit shell.openExternal uses
});

const BUILDER_NAMES: Readonly<Record<BuilderId, string>> = Object.freeze({ lovable: 'Lovable', replit: 'Replit', bolt: 'Bolt', v0: 'v0' });
const BARE_SITES: Readonly<Record<BuilderId, string>> = Object.freeze({
  lovable: 'https://lovable.dev/', replit: 'https://replit.com/', bolt: 'https://bolt.new/', v0: 'https://v0.app/',
});

export const HANDOFF_NOTES = Object.freeze({
  lovable: Object.freeze([
    'Lovable keeps your brief in this browser until you press send.',
    'To follow the build, open Project settings, then Git, then GitHub, then Connect.',
  ]),
  replit: Object.freeze([
    'Replit receives this brief as soon as the page opens.',
    "To follow the build, open Replit's Git tool, connect GitHub and turn on auto-sync.",
  ]),
  copyOnly: 'No official link exists, and a pasted link may start building at once, so Chausar copies the brief for you to paste.',
});

export type PlannedHandoff = Omit<HandoffPlan, 'handoffId'>;

export function lovableUrl(brief: string): string {
  return `https://lovable.dev/#prompt=${encodeURIComponent(brief)}`;
}

export function replitUrl(brief: string): string {
  return `https://replit.com/?stack=Build&prompt=${compressToEncodedURIComponent(brief)}&referrer=chausar`;
}

/** Pure: the link or copy plan for one builder. Never adds autosubmit or any other send-at-once parameter. */
export function planHandoff(builder: BuilderId, rawBrief: string): PlannedHandoff {
  check((BUILDER_IDS as readonly string[]).includes(builder), 'INVALID_VENTURE_REQUEST', 'Choose Lovable, Replit, Bolt or v0.');
  check(typeof rawBrief === 'string', 'INVALID_VENTURE_REQUEST', 'The brief must be text.');
  const brief = rawBrief.replace(/\r\n/g, '\n').trim();
  check(brief.length > 0, 'INVALID_VENTURE_REQUEST', 'Write the build brief first.');
  const bare = BARE_SITES[builder];
  const copy = (notes: string[]): PlannedHandoff => ({
    builder, mode: 'copy', url: bare, clipboardText: brief, promptChars: brief.length, urlChars: bare.length, notes, label: 'handoff', status: 'available',
  });

  if (builder === 'bolt' || builder === 'v0') return copy([HANDOFF_NOTES.copyOnly]);

  let url: string;
  let linkAllowed: boolean;
  if (builder === 'lovable') {
    url = lovableUrl(brief);
    linkAllowed = brief.length <= LIMITS.lovablePromptMax;
  } else {
    url = replitUrl(brief);
    const encoded = new URL(url).searchParams.get('prompt') ?? '';
    linkAllowed = encoded.length <= LIMITS.replitEncodedSafe && decompressFromEncodedURIComponent(encoded) === brief;
  }
  if (url.length > LIMITS.openUrlMaxChars) linkAllowed = false;
  const notes = HANDOFF_NOTES[builder];
  if (!linkAllowed) {
    return copy([`Your brief is too long for a ${BUILDER_NAMES[builder]} link, so Chausar copies it for you to paste.`, notes[1]]);
  }
  return { builder, mode: 'link', url, clipboardText: null, promptChars: brief.length, urlChars: url.length, notes: [...notes], label: 'handoff', status: 'available' };
}

/** venture.build.handoff { builder } (level prepare). Stores the URL's digest, never the URL. */
export async function prepareHandoff(deps: VentureDeps, ctx: Context, payload: unknown): Promise<HandoffPlan> {
  const body = exactPayload(payload ?? {}, ['builder'], ['builder']);
  check(typeof body.builder === 'string' && (BUILDER_IDS as readonly string[]).includes(body.builder), 'INVALID_VENTURE_REQUEST', 'Choose Lovable, Replit, Bolt or v0.');
  const builder = body.builder as BuilderId;
  authorize(deps.store, ctx, 'prepare');
  const { state, venture } = readVenture(deps, ctx);
  const brief = latestBrief(state, venture.id);
  check(brief, 'BRIEF_NOT_FOUND', 'Write the build brief first.');
  check(brief.lint.ok, 'BRIEF_LINT_FAILED', `Fix the brief before you open a builder: ${brief.lint.findings[0]?.message ?? 'it did not pass its checks.'}`);
  // 4J7 (K6): the builder takes the brief and nothing else.
  checkConnectorFields(builder, builder === 'lovable' || builder === 'replit' ? 'open-with-brief' : 'copy-brief', ['brief']);
  const plan = planHandoff(builder, brief.markdown);

  return ventureAction(deps, ctx, 'prepare', 'build.handoff', tx => {
    const current = latestBrief(tx.state, tx.venture!.id);
    check(current && current.id === brief.id, 'APPROVAL_STALE', 'A newer brief was written. Open the builder again.');
    const accepted = acceptedBlueprint(tx.state, tx.venture!);
    check(accepted.digest === current.blueprintDigest, 'APPROVAL_STALE', 'Your plan changed after this brief was written. Write the brief again.');
    const record: HandoffRecord = {
      ...tx.base('venture-handoff'),
      builder, mode: plan.mode, briefId: current.briefId, briefDigest: current.digest, urlChars: plan.urlChars, urlDigest: digest(plan.url), openedAt: null,
    };
    tx.put(record);
    tx.emit('handoff-prepared', { handoffId: record.id, builder, mode: plan.mode, briefId: current.briefId });
    const result: HandoffPlan = { handoffId: record.id, ...plan };
    return result;
  });
}

/**
 * venture.build.handoffOpened { handoffId } (level prepare, app only). The renderer sends it only after the
 * browser opened the link or the copy worked, so the checklist never says a builder opened when it did not.
 */
export async function markHandoffOpened(deps: VentureDeps, ctx: Context, payload: unknown): Promise<HandoffRecord> {
  requireAppChannel(ctx, 'venture.build.handoffOpened');
  const body = exactPayload(payload ?? {}, ['handoffId'], ['handoffId']);
  const handoffId = identifier(body.handoffId, 'handoffId');
  return ventureAction(deps, ctx, 'prepare', 'build.handoffOpened', tx => {
    const record = tx.find('venture-handoff', handoffId);
    check(record, 'HANDOFF_NOT_FOUND', 'That builder link is not known. Open the builder again.');
    if (record.openedAt !== null) return record;
    const opened = tx.replace({ ...record, openedAt: tx.now });
    tx.emit('handoff-opened', { handoffId, builder: record.builder });
    return opened;
  });
}
