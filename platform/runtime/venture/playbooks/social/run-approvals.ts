// Chausar flagship playbook, social media agency: each post of a delivery draft with its approval (Ink v2 wave 2, 2B1).
// Posting (build/posting.ts venture.posting.propose) and the calendar file (venture.social.calendar) read posts here,
// so they read them the same way. A post is one line "Channel: text" of the words the client sees (build/draft-text.ts),
// numbered from 1 in text order over every channel: '<delivery run id>.post-<n>', the numbering the social checks use.
// Its DraftApproval comes from the checks on that exact post, the owner's review verdict and the client's answers on
// the run's share links, so scheduleGate (approvals.ts) decides with every reason.
// Light on load-time work on purpose: posting imports this inside the channels/posting import cycle, so nothing here
// calls an import before a function runs.
import { check, type State } from '../../../contracts.ts';
import type { DeliveryRunRecord, DraftPostView } from '../../contracts.ts';
import { currentVenture, listRecords } from '../../records.ts';
import { clientDraft } from '../../build/draft-text.ts';
import { draftPostChecks } from '../../build/posting.ts';
import { postOfLine } from './post-lines.ts';
import { channelCapability, type SocialChannel } from './channels.ts';
import { draftDigest, scheduleGate, type DraftApproval, type DraftLike, type GateOptions } from './approvals.ts';
import { SOCIAL_AGENCY_ID } from './registration.ts';

const POST_ID = /^([A-Za-z0-9_-]{1,120})\.post-([1-9][0-9]{0,2})$/;

/**
 * One post of a draft. n counts every post line in the text, from 1; part counts the posts for the same posting
 * connector, from 1, the way build/posting.ts picks one of several. connectorId is null when this build has no
 * posting connector for the channel.
 */
export type DraftPost = { draftId: string; runId: string; n: number; channel: SocialChannel; text: string; connectorId: string | null; part: number | null };

/** '<delivery run id>.post-<n>' read back into the run id and n; null when the id is not shaped like a post. */
export function parsePostId(value: unknown): { runId: string; n: number } | null {
  const match = typeof value === 'string' ? POST_ID.exec(value) : null;
  return match ? { runId: match[1], n: Number(match[2]) } : null;
}

/** The posts in one text, in order. */
export function postsOfText(runId: string, text: string | null): DraftPost[] {
  const posts: DraftPost[] = [];
  const perConnector = new Map<string, number>();
  for (const line of (text ?? '').split(/\r?\n/)) {
    const post = postOfLine(line);
    if (!post) continue;
    const connectorId = channelCapability(post.channel).connectorId;
    const part = connectorId ? (perConnector.get(connectorId) ?? 0) + 1 : null;
    if (connectorId) perConnector.set(connectorId, part!);
    posts.push({ draftId: `${runId}.post-${posts.length + 1}`, runId, n: posts.length + 1, channel: post.channel, text: post.text, connectorId, part });
  }
  return posts;
}

/** The posts a draft holds now, in the words the client sees (the owner's edit, else the rendered draft, screened). */
export function draftPostsOf(run: DeliveryRunRecord): DraftPost[] {
  return postsOfText(run.id, clientDraft(run).text);
}

/** The posts as the screens read them (venture.share.list with a draft's id). */
export function draftPostViews(run: DeliveryRunRecord): DraftPostView[] {
  return draftPostsOf(run).map(post => ({ draftId: post.draftId, channel: post.channel, name: channelCapability(post.channel).name, connectorId: post.connectorId, text: post.text }));
}

function runOf(state: State, runId: string): DeliveryRunRecord {
  const venture = currentVenture(state);
  const run = venture ? listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === runId) : undefined;
  check(run, 'DELIVERY_NOT_FOUND', 'That draft was not found.');
  return run;
}

/**
 * Whether this draft's posts need the client's approval: the social agency approves every draft with the client
 * (SOCIAL_APPROVALS 'every-draft'), the rule build/posting.ts applies too.
 */
export function needsClientApproval(state: State, run: DeliveryRunRecord): boolean {
  return listRecords(state, 'venture-playbook', run.ventureId).find(playbook => playbook.id === run.playbookId)?.flagship === SOCIAL_AGENCY_ID;
}

/** One post with its approval, and why its checks did not pass, in the owner's words. */
export type RunPostApproval = { post: DraftPost; draft: DraftLike; approval: DraftApproval; checkLines: string[] };

/**
 * Each post's DraftApproval, in text order. checks: the code checks on that exact post (build/posting.ts
 * draftPostChecks). owner: the review verdict (accepted or edited is the owner's approval of the text as it is now).
 * client: the newest answer on any of the run's share links. digest: what the decisions are for. Where the client must
 * approve and has answered, it is that post as the answered link showed it, so a draft changed since reads as changed;
 * otherwise it is the post as it is now, which the owner's verdict covers. The client approves the whole draft, as
 * posting reads it (build/posting.ts clientReasons): when the newest answer is not on the draft's words as they are
 * now, every post reads as changed, even one whose own line is the same.
 */
export function draftApprovalsOfRun(state: State, runId: string): RunPostApproval[] {
  const run = runOf(state, runId);
  const clientMust = needsClientApproval(state, run);
  const current = clientDraft(run).digest;
  const links = listRecords(state, 'venture-share-link', run.ventureId).filter(link => link.deliveryId === run.id);
  const answers = links.flatMap(link => link.decisions.map(decision => ({ decision, link })))
    .sort((a, b) => (a.decision.at < b.decision.at ? -1 : a.decision.at > b.decision.at ? 1 : 0));
  const latest = answers.at(-1);
  const answeredPosts = latest ? postsOfText(run.id, latest.link.text) : [];
  const owner: DraftApproval['owner'] = run.status === 'accepted' || run.status === 'edited'
    ? { decision: 'approved', by: null, at: run.verdict?.at ?? null }
    : { decision: run.status === 'rejected' ? 'changes' : null, by: null, at: run.verdict?.at ?? null };
  const client: DraftApproval['client'] = latest
    ? { decision: latest.decision.decision, via: latest.decision.via, at: latest.decision.at, comment: latest.decision.comment }
    : { decision: null, via: null, at: null, comment: null };
  return draftPostsOf(run).map(post => {
    const draft: DraftLike = { id: post.draftId, channel: post.channel, text: post.text };
    const answered = answeredPosts.find(item => item.n === post.n);
    const approvedDigest = clientMust && latest
      ? (latest.decision.digest !== current ? 'the-draft-changed-since-the-answer'
        : answered ? draftDigest({ id: post.draftId, channel: answered.channel, text: answered.text }) : 'not-on-the-answered-link')
      : draftDigest(draft);
    const checked = draftPostChecks(state, run, post);
    return { post, draft, approval: { draftId: post.draftId, digest: approvedDigest, checks: checked.checks, owner, client }, checkLines: checked.lines };
  });
}

/** The codes posting refuses with, one per kind of reason the draft-before-schedule gate gives. */
export type ScheduleRefusal = { code: 'POST_DRAFT_CHANGED' | 'POST_DRAFT_UNCHECKED' | 'POST_NOT_APPROVED' | 'POST_CLIENT_NOT_APPROVED'; line: string };

/**
 * Every reason scheduleGate gives for one post, in its order and words, each with the code posting refuses with. The
 * codes follow the gate's own conditions one for one; for checks that did not pass, the lines say which check and why.
 */
export function scheduleReasons(item: RunPostApproval, options: GateOptions): ScheduleRefusal[] {
  const { approval, draft } = item;
  const gate = scheduleGate(approval, draft, options);
  const codes: ScheduleRefusal['code'][] = [];
  if (approval.draftId !== draft.id || approval.digest !== draftDigest(draft)) codes.push('POST_DRAFT_CHANGED');
  if (approval.checks !== 'passed') codes.push('POST_DRAFT_UNCHECKED');
  if (approval.owner.decision !== 'approved') codes.push('POST_NOT_APPROVED');
  if (options.clientApproval && approval.client.decision !== 'approved') codes.push('POST_CLIENT_NOT_APPROVED');
  return gate.reasons.flatMap((line, index) => {
    const code = codes[index] ?? 'POST_DRAFT_UNCHECKED';
    return code === 'POST_DRAFT_UNCHECKED' && item.checkLines.length ? item.checkLines.map(detail => ({ code, line: detail })) : [{ code, line }];
  });
}
