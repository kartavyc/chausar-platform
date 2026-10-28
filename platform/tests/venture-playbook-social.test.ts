// Social media agency playbook: the data. Offers, fourteen typed steps with agent roles, approvals (owner first, then
// the client through a share link record), the channel capability table, the draft-before-schedule rule, calendar
// slots made by code, the dated platform-rules register, and the registration that makes the playbook pickable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doneClaimFindings, houseStyleFindings } from '../runtime/venture/records.ts';
import { validatePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { NOT_PROBED, OWNER_SESSION_RISK } from '../runtime/venture/build/posting.ts';
import { PLAYBOOK_REGISTRY, pickPlaybook, playbookLabel, validateRegistry } from '../runtime/venture/playbooks/registry.ts';
import {
  SOCIAL_AGENCY_ID, SOCIAL_AGENCY_LABEL, SOCIAL_AGENCY_REGISTRATION,
} from '../runtime/venture/playbooks/social/index.ts';
import {
  DRAFT_BEFORE_SCHEDULE, SOCIAL_APPROVALS, SOCIAL_CONNECTORS, SOCIAL_NOT_BUILT, SOCIAL_OFFERS, SOCIAL_ROLES, SOCIAL_STEPS,
  socialPlaybookSteps, socialWords,
} from '../runtime/venture/playbooks/social/playbook.ts';
import {
  CHANNEL_CAPABILITIES, SOCIAL_CHANNELS, channelCapability, channelModes,
} from '../runtime/venture/playbooks/social/channels.ts';
import {
  RULE_STALE_AFTER_DAYS, SOCIAL_RULES_REGISTER, daysBetween, platformRule, rulesFreshness, validateRulesRegister,
} from '../runtime/venture/playbooks/social/register.ts';
import {
  SHARE_LINK_SERVING, calendarExport, createShareLink, draftDigest, promoteDrafts, recordClientDecision, scheduleGate,
  type DraftApproval,
} from '../runtime/venture/playbooks/social/approvals.ts';
import { planCalendar } from '../runtime/venture/playbooks/social/calendar.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

test('social playbook: registered as the social media agency, picked by the phrases owners use', () => {
  assert.equal(SOCIAL_AGENCY_ID, 'social-agency');
  assert.equal(SOCIAL_AGENCY_LABEL, 'Social media agency');
  assert.equal(SOCIAL_AGENCY_REGISTRATION.serviceType, 'agency');
  assert.ok(PLAYBOOK_REGISTRY.includes(SOCIAL_AGENCY_REGISTRATION));
  validateRegistry();
  assert.equal(playbookLabel('social-agency'), 'Social media agency');
  for (const idea of [
    'I want to start a social media agency for cafes',
    'Instagram management for local gyms',
    'A content marketing studio for coaches',
  ]) assert.equal(pickPlaybook(idea)?.id, 'social-agency', idea);
  assert.equal(pickPlaybook('A bakery that sells bread'), null);
});

test('social playbook: thirteen offers, each priced by the owner, each naming the steps it uses', () => {
  assert.deepEqual(SOCIAL_OFFERS.map(offer => offer.id), ['content-calendar', 'community-replies', 'monthly-report', 'ugc-ads', 'repurpose-pack','linkedin-ghostwriting','reel-from-clips','hook-variations','local-instagram','reply-inbox','post-diagnosis','video-ads','cross-posting']);
  const stepIds = new Set(SOCIAL_STEPS.map(step => step.id));
  for (const offer of SOCIAL_OFFERS) {
    assert.equal(offer.price, 'owner-sets');
    assert.ok(offer.steps.length > 0 && offer.steps.every(id => stepIds.has(id)), offer.id);
  }
  const ugc = SOCIAL_OFFERS.find(offer => offer.id === 'ugc-ads')!;
  assert.deepEqual([...ugc.disclosure].sort(), ['ai', 'paid']);
  assert.ok(ugc.includes.some(line => /never speaks as a real customer/i.test(line)));
  assert.equal(SOCIAL_OFFERS.find(offer => offer.id === 'monthly-report')!.steps.includes('figures'), true);
});

test('social playbook: fourteen typed steps with agent roles pass the engine playbook validator', () => {
  assert.equal(SOCIAL_STEPS.length, 14);
  assert.deepEqual(SOCIAL_STEPS.map(step => step.kind), [
    'gather', 'question', 'write', 'approve', 'write', 'write', 'write', 'verify', 'approve', 'operator', 'gather', 'compute', 'write', 'approve',
  ]);
  for (const step of SOCIAL_STEPS) assert.ok(SOCIAL_ROLES[step.role], `${step.id} has role ${step.role}`);
  const steps = socialPlaybookSteps();
  assert.ok(steps.every(step => !('role' in step)), 'the engine steps carry only engine fields');
  const { validated } = validatePlaybook(steps);
  assert.equal(validated, true);
  const drafts = SOCIAL_STEPS.find(step => step.id === 'approve-drafts')!;
  assert.deepEqual(drafts.approvers, ['owner', 'client']);
  assert.ok(SOCIAL_STEPS.find(step => step.id === 'calendar')!.codeOwns!.includes('dates'));
  assert.equal(SOCIAL_STEPS.find(step => step.id === 'figures')!.model, null);
  assert.ok(SOCIAL_STEPS.find(step => step.id === 'report')!.checks.includes('no-numeric-prose'));
});

test('social playbook: approvals start with the owner; drafts go to the client only after the owner', () => {
  const drafts = SOCIAL_APPROVALS.find(point => point.id === 'every-draft')!;
  assert.deepEqual(drafts.who, ['owner', 'client']);
  assert.equal(drafts.floor, true);
  for (const point of SOCIAL_APPROVALS) assert.equal(point.who[0], 'owner', point.id);
  assert.ok(SOCIAL_APPROVALS.some(point => point.id === 'spend-before-generation' && point.floor));
  assert.match(DRAFT_BEFORE_SCHEDULE, /exact text/);
});

test('social playbook: every word shown to people is plain, with no long dash, no avoided words and no done claims', () => {
  const words = socialWords();
  assert.ok(words.length > 40);
  for (const line of words) {
    assert.deepEqual(houseStyleFindings(line), [], line);
    assert.deepEqual(doneClaimFindings(line), [], line);
  }
});

test('social playbook: connectors carry honest labels and the never list names evasion', () => {
  const labels = new Set(['handoff', 'read', 'write', 'planned', 'planned: handoff', 'planned: read', 'planned: write']);
  for (const connector of SOCIAL_CONNECTORS) assert.ok(labels.has(connector.label), connector.id);
  assert.equal(SOCIAL_CONNECTORS.find(item => item.id === 'platform-analytics')!.label, 'planned: read');
  assert.equal(SOCIAL_CONNECTORS.find(item => item.id === 'client-files')!.label, 'read');
  assert.ok(SOCIAL_NOT_BUILT.some(line => /proxy or VPN/i.test(line)));
  assert.ok(SOCIAL_NOT_BUILT.some(line => /real customer/i.test(line)));
});

test('channels: a capability table per platform, with limits tied to dated rules', () => {
  assert.deepEqual([...SOCIAL_CHANNELS], ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'youtube-shorts']);
  for (const id of SOCIAL_CHANNELS) {
    const channel = CHANNEL_CAPABILITIES[id];
    assert.equal(channel.id, id);
    assert.ok(channel.maxChars > 0);
    assert.ok(platformRule(channel.charsRule));
    if (channel.hashtagsRule) assert.ok(platformRule(channel.hashtagsRule));
    for (const ruleId of channel.media.rules) assert.ok(platformRule(ruleId), `${id} ${ruleId}`);
    assert.deepEqual(Object.keys(channel.modes).sort(), ['api', 'handoff', 'owner-browser-session']);
  }
  assert.equal(channelCapability('x').counting, 'x-weighted');
  assert.equal(channelCapability('instagram').maxHashtags, 5);
  assert.equal(channelCapability('instagram').media.maxItems, 20);
  assert.equal(channelCapability('instagram').modes.api.maxMediaItems, 10);
  assert.equal(channelCapability('youtube-shorts').media.maxVideoSeconds, 180);
  assert.throws(() => channelCapability('myspace' as any), code('INVALID_VENTURE_REQUEST'));
});

test('channels: what each mode can do comes from the posting connector; channels without one are planned', () => {
  const env = { ...NOT_PROBED, browser: { present: true, reason: 'Playwright with Chromium is here.' } };
  const linkedin = channelModes('linkedin', env);
  assert.deepEqual(linkedin.map(mode => [mode.mode, mode.status]), [['api', 'planned'], ['owner-browser-session', 'planned'], ['handoff', 'planned']]);
  assert.equal(linkedin[1].risk, null, 'No automated LinkedIn posting is offered');
  assert.equal(linkedin[0].can.length, 0, 'LinkedIn API has no automated publish capability');
  assert.equal(linkedin[1].can.length, 0, 'LinkedIn stays manual');
  const instagram = channelModes('instagram', env);
  assert.equal(instagram[1].status, 'planned', 'a picture through the browser is not built');
  const threads = channelModes('threads', env);
  assert.ok(threads.every(mode => mode.status === 'planned'));
  assert.match(threads[0].reason!, /no posting connector/i);
});

test('register: every platform rule has a source, a checked-on date and how it was read', () => {
  validateRulesRegister();
  assert.ok(SOCIAL_RULES_REGISTER.length >= 20);
  for (const rule of SOCIAL_RULES_REGISTER) {
    assert.match(rule.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['official', 'secondary', 'house', 'unconfirmed'].includes(rule.read), rule.id);
    if (rule.read !== 'house') assert.ok(rule.sources.length > 0 && rule.sources.every(source => /^https:\/\//.test(source.url)), rule.id);
  }
  assert.equal(platformRule('x-weighted-280').value, 280);
  assert.equal(platformRule('x-weighted-280').read, 'official');
  assert.equal(platformRule('ig-hashtags-5').value, 5);
  assert.throws(() => platformRule('no-such-rule'), code('INVALID_VENTURE_REQUEST'));
  const broken = [{ ...SOCIAL_RULES_REGISTER[0] }, { ...SOCIAL_RULES_REGISTER[0] }];
  assert.throws(() => validateRulesRegister(broken), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateRulesRegister([{ ...SOCIAL_RULES_REGISTER[0], sources: [] }]), code('INVALID_VENTURE_REQUEST'));
});

test('register: rules go stale after ninety days, and unconfirmed rules are named for a check', () => {
  assert.equal(RULE_STALE_AFTER_DAYS, 90);
  assert.equal(daysBetween('2026-10-21', '2027-01-19'), 90);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  const now = rulesFreshness('2026-11-01');
  assert.equal(now.stale.length, 0);
  assert.ok(now.unconfirmed.length > 0);
  assert.ok(now.lines.some(line => /not confirmed/i.test(line)));
  const later = rulesFreshness('2027-02-01');
  assert.equal(later.stale.length, SOCIAL_RULES_REGISTER.length);
  assert.match(later.stale[0].line, /days ago/);
});

test('calendar: code makes the post slots, spread over the allowed weekdays of the month', () => {
  const slots = planCalendar({ month: '2026-11', channels: ['instagram', 'linkedin'], postsPerChannel: 3, weekdays: [1, 3, 5] });
  assert.equal(slots.length, 6);
  const instagram = slots.filter(slot => slot.channel === 'instagram').map(slot => slot.date);
  assert.deepEqual(instagram, ['2026-11-02', '2026-11-11', '2026-11-20']);
  for (const slot of slots) assert.ok([1, 3, 5].includes(((new Date(`${slot.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1));
  assert.deepEqual(planCalendar({ month: '2026-11', channels: ['x'], postsPerChannel: 3, weekdays: [1, 3, 5] }).map(slot => slot.id), ['x-1', 'x-2', 'x-3']);
  assert.throws(() => planCalendar({ month: '2026-02', channels: ['x'], postsPerChannel: 9, weekdays: [1] }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => planCalendar({ month: '2026-13', channels: ['x'], postsPerChannel: 1, weekdays: [1] }), code('INVALID_VENTURE_REQUEST'));
});

const draft = { id: 'post-1', channel: 'instagram' as const, text: 'Sunday table at Lumen Studio.', media: [{ kind: 'image' as const, width: 1080, height: 1350, altText: 'A long table set for lunch.' }] };

function approval(over: Partial<DraftApproval> = {}): DraftApproval {
  return {
    draftId: draft.id, digest: draftDigest(draft), checks: 'passed',
    owner: { decision: 'approved', by: 'member_owner', at: '2026-10-21T09:00:00.000Z' },
    client: { decision: null, via: null, at: null, comment: null },
    ...over,
  };
}

test('share link: made only for drafts that passed the checks and that the owner approved first', () => {
  const made = createShareLink({ drafts: [approval()], clientId: 'client_1', by: 'member_owner', now: '2026-10-21T09:05:00.000Z' });
  assert.equal(made.record.state, 'open');
  assert.equal(made.record.expiresAt, '2026-10-28T09:05:00.000Z');
  assert.ok(made.token.length >= 32);
  assert.ok(!JSON.stringify(made.record).includes(made.token), 'the record keeps a hash, never the token');
  assert.equal(SHARE_LINK_SERVING.status, 'planned');
  assert.throws(() => createShareLink({ drafts: [approval({ owner: { decision: null, by: null, at: null } })], clientId: 'client_1', by: 'member_owner', now: '2026-10-21T09:05:00.000Z' }), code('OWNER_APPROVAL_FIRST'));
  assert.throws(() => createShareLink({ drafts: [approval({ checks: 'failed' })], clientId: 'client_1', by: 'member_owner', now: '2026-10-21T09:05:00.000Z' }), code('CHECKS_NOT_PASSED'));
});

test('share link: the client decides each draft once, on the exact text, before the link ends', () => {
  const { record, token } = createShareLink({ drafts: [approval()], clientId: 'client_1', by: 'member_owner', now: '2026-10-21T09:05:00.000Z' });
  const digestSeen = draftDigest(draft);
  assert.throws(() => recordClientDecision(record, { via: 'share-link', token: 'wrong-token-wrong-token-wrong-token' }, { draftId: draft.id, digest: digestSeen, decision: 'approved', now: '2026-10-21T10:00:00.000Z' }), code('SHARE_LINK_REFUSED'));
  assert.throws(() => recordClientDecision(record, { via: 'share-link', token }, { draftId: draft.id, digest: 'stale', decision: 'approved', now: '2026-10-21T10:00:00.000Z' }), code('APPROVAL_STALE'));
  assert.throws(() => recordClientDecision(record, { via: 'share-link', token }, { draftId: draft.id, digest: digestSeen, decision: 'approved', now: '2026-10-29T10:00:00.000Z' }), code('SHARE_LINK_EXPIRED'));
  const decided = recordClientDecision(record, { via: 'share-link', token }, { draftId: draft.id, digest: digestSeen, decision: 'approved', now: '2026-10-21T10:00:00.000Z' });
  assert.equal(decided.decisions[0].decision, 'approved');
  assert.equal(decided.decisions[0].via, 'share-link');
  assert.equal(decided.state, 'closed', 'every draft on the link is decided');
  assert.throws(() => recordClientDecision(decided, { via: 'share-link', token }, { draftId: draft.id, digest: digestSeen, decision: 'changes', now: '2026-10-21T10:01:00.000Z' }), code('ALREADY_DECIDED'));
  const byOwner = recordClientDecision(record, { via: 'owner-recorded', by: 'member_owner' }, { draftId: draft.id, digest: digestSeen, decision: 'changes', comment: 'Warmer, please.', now: '2026-10-21T10:00:00.000Z' });
  assert.equal(byOwner.decisions[0].via, 'owner-recorded');
  assert.equal(byOwner.decisions[0].comment, 'Warmer, please.');
});

test('draft before schedule: only checked drafts with the approvals the offer asks for are scheduled', () => {
  const clientApproved = approval({ client: { decision: 'approved', via: 'share-link', at: '2026-10-21T10:00:00.000Z', comment: null } });
  assert.deepEqual(scheduleGate(clientApproved, draft, { clientApproval: true }), { allowed: true, reasons: [] });
  const ownerOnly = scheduleGate(approval(), draft, { clientApproval: true });
  assert.equal(ownerOnly.allowed, false);
  assert.match(ownerOnly.reasons[0], /client has not approved/i);
  assert.equal(scheduleGate(approval(), draft, { clientApproval: false }).allowed, true);
  const edited = scheduleGate(clientApproved, { ...draft, text: 'Sunday table, edited after approval.' }, { clientApproval: true });
  assert.equal(edited.allowed, false);
  assert.match(edited.reasons[0], /changed after/i);
  const promoted = promoteDrafts([
    { approval: clientApproved, draft },
    { approval: approval({ draftId: 'post-2', checks: 'not-run' }), draft: { ...draft, id: 'post-2' } },
  ], { clientApproval: true });
  assert.deepEqual(promoted.scheduled, ['post-1']);
  assert.equal(promoted.blocked[0].draftId, 'post-2');
  assert.match(promoted.blocked[0].reasons.join(' '), /checks/i);
});

test('calendar export: approved drafts only, as a file the owner imports or copies from', () => {
  const clientApproved = approval({ client: { decision: 'approved', via: 'share-link', at: '2026-10-21T10:00:00.000Z', comment: null } });
  const csv = calendarExport([
    { approval: clientApproved, draft, date: '2026-11-02' },
    { approval: approval({ draftId: 'post-2', checks: 'failed' }), draft: { ...draft, id: 'post-2', text: 'Not ready.' }, date: '2026-11-04' },
  ], { clientApproval: true });
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'date,channel,text,alt_text,owner_approved_at,client_approved_at');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^2026-11-02,instagram,"?Sunday table at Lumen Studio\."?,/);
});
