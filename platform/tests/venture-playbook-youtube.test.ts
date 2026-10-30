// Flagship playbook (design 7.8): the YouTube channel, as data. Offers, eleven typed steps with agent roles, the four
// approvals, the always-ask floor, connectors with honest modes, and a dated register of platform rules with sources.
// Clipping other people's shows needs recorded rights; AI voice or presenter is always disclosed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import { validatePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { RIGHTS_BASES } from '../runtime/venture/delivery/rights.ts';
import { NOT_PROBED, postingOptions } from '../runtime/venture/build/posting.ts';
import { pickPlaybook, playbookLabel, validateRegistry, PLAYBOOK_REGISTRY } from '../runtime/venture/playbooks/registry.ts';
import {
  YOUTUBE_ID, YOUTUBE_LABEL, YOUTUBE_REGISTRATION, YOUTUBE_PLAYBOOK, YOUTUBE_OFFERS, YOUTUBE_STEPS, YOUTUBE_APPROVALS,
  YOUTUBE_INTAKE_FIELDS, YOUTUBE_HARD_LINES, floorSteps, youtubeConnectors, youtubeEngineSteps, validateYoutubePlaybook,
  offerAcceptsRights, PLATFORM_RULES, ruleFreshness, platformRule, validatePlatformRules,
} from '../runtime/venture/playbooks/youtube/index.ts';

const everyString = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(item => everyString(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => everyString(item, out));
  return out;
};
const SERVICES=['channel-audit','weekly-plan','packaging-per-video','comment-triage','comment-insights','niche-report','screencast-tutorial','after-publish-review'];

test('registration: the label is "YouTube channel", it extends the studio type, and ideas pick it', () => {
  assert.equal(YOUTUBE_ID, 'youtube');
  assert.equal(YOUTUBE_LABEL, 'YouTube channel');
  assert.equal(YOUTUBE_REGISTRATION.serviceType, 'studio');
  assert.ok(PLAYBOOK_REGISTRY.some(entry => entry.id === 'youtube'), 'registered in the shared registry');
  assert.doesNotThrow(() => validateRegistry());
  for (const idea of [
    'I want to start a YouTube channel about cricket',
    'A faceless channel that explains stock market news',
    'Podcast clips for Indian business podcasts',
    'Turning long podcast episodes into YouTube Shorts for creators',
  ]) assert.equal(pickPlaybook(idea)?.id, 'youtube', idea);
  assert.equal(playbookLabel('youtube'), 'YouTube channel');
  assert.equal(pickPlaybook('Monthly bookkeeping for cafes in Pune')?.id === 'youtube', false);
  assert.equal(pickPlaybook('dog walking in Bandra'), null);
});

test('offers: an episode package, shorts from the client\'s own long video, and clips under a recorded licence or clip programme', () => {
  assert.deepEqual(YOUTUBE_OFFERS.map(offer => offer.id), ['episode-package', 'shorts-from-own-video', 'licensed-clips',...SERVICES]);
  const [episode, shorts, clips] = YOUTUBE_OFFERS;
  assert.deepEqual([...shorts.rightsBases], ['own-footage']);
  assert.deepEqual([...clips.rightsBases], ['licence', 'creator-clip-programme']);
  assert.ok(episode.rightsBases.includes('own-footage'));
  for (const offer of YOUTUBE_OFFERS) {
    assert.ok(offer.rightsBases.every(basis => (RIGHTS_BASES as readonly string[]).includes(basis)));
    assert.ok(offer.deliverables.length >= (SERVICES.includes(offer.id)?1:2), offer.id);
    assert.equal(/\d/.test(offer.name + offer.description), false, 'offer words carry no prices or counts');
  }
  assert.equal(offerAcceptsRights('licensed-clips', 'own-footage'), false);
  assert.equal(offerAcceptsRights('licensed-clips', 'creator-clip-programme'), true);
  assert.equal(offerAcceptsRights('shorts-from-own-video', 'licence'), false);
});

test('steps: media and explicit service steps each have a role; code and owner steps use no model', () => {
  assert.equal(YOUTUBE_STEPS.length, 19);
  assert.deepEqual(YOUTUBE_STEPS.map(step => step.id), ['intake', 'clarify', 'probe', 'find', 'score', 'edit', 'assemble', 'package', 'verify',...SERVICES, 'review', 'publish']);
  for (const step of YOUTUBE_STEPS) {
    if (step.role.kind === 'agent') {
      assert.ok(['gather', 'question', 'work', 'write'].includes(step.kind), step.id);
      assert.ok(step.role.name.length > 0 && step.model !== null, step.id);
    } else {
      assert.equal(step.model, null, step.id);
      assert.equal(step.tools.length, 0, step.id);
    }
    if (step.role.kind === 'owner') assert.ok(['approve', 'operator'].includes(step.kind), step.id);
  }
  // Cutting footage is clipping: it needs the rights recorded at intake.
  assert.equal(YOUTUBE_STEPS.find(step => step.id === 'assemble')!.clipping, true);
  assert.equal(YOUTUBE_STEPS.filter(step => step.clipping).length, 1);
  assert.doesNotThrow(() => validateYoutubePlaybook(YOUTUBE_PLAYBOOK));
});

test('approvals: rights at intake, a quote before paid generation, the draft after viewing, and the owner publishes', () => {
  assert.deepEqual(YOUTUBE_APPROVALS.map(item => item.id), ['rights-at-intake', 'quote-before-paid-generation', 'draft-after-viewing', 'owner-publishes']);
  const by = Object.fromEntries(YOUTUBE_APPROVALS.map(item => [item.id, item]));
  assert.equal(by['rights-at-intake'].step, 'intake');
  assert.equal(by['quote-before-paid-generation'].step, 'assemble');
  assert.equal(by['quote-before-paid-generation'].expiresAfterMinutes, 60);
  assert.equal(by['quote-before-paid-generation'].secondAsk, true);
  assert.equal(by['draft-after-viewing'].requiresView, true);
  assert.equal(by['owner-publishes'].step, 'publish');
  for (const approval of YOUTUBE_APPROVALS) assert.equal(YOUTUBE_STEPS.find(step => step.id === approval.step)?.gate, approval.id);
});

test('floor: rights, paid generation, sending to the client and publishing ask at every posture', () => {
  assert.deepEqual(floorSteps().map(step => step.id), ['intake', 'assemble', 'review', 'publish']);
  for (const step of floorSteps()) assert.ok(step.floor && step.floor.length > 10, step.id);
});

test('engine: media and service steps map onto the delivery harness and pass its validation', () => {
  const steps = youtubeEngineSteps();
  assert.equal(steps.length, 19);
  const checked = validatePlaybook(steps);
  assert.equal(checked.validated, true);
  assert.equal(steps.find(step => step.id === 'package')!.kind, 'write');
  assert.ok(steps.find(step => step.id === 'package')!.checks.includes('no-done-claims'));
  assert.equal(steps.at(-1)!.kind, 'operator');
});

test('validation refuses a playbook that clips without the rights gate, or publishes before review', () => {
  const broken = (change: (copy: any) => void) => { const copy = structuredClone(YOUTUBE_PLAYBOOK) as any; change(copy); return () => validateYoutubePlaybook(copy); };
  assert.throws(broken(copy => { copy.steps[0].gate = null; copy.approvals = copy.approvals.filter((a: any) => a.id !== 'rights-at-intake'); }), /rights/i);
  assert.throws(broken(copy => { copy.steps.find((s: any) => s.id === 'probe').clipping = true; }), /clip/i);
  assert.throws(broken(copy => { const index = copy.steps.findIndex((step: any) => step.id === 'review'); const [review, publish] = copy.steps.splice(index, 2); copy.steps.splice(index, 0, publish, review); }), /approve|review/i);
  assert.throws(broken(copy => { copy.offers[2].rightsBases = ['own-footage', 'licence']; }), /own footage|clips/i);
  assert.throws(broken(copy => { copy.steps.find((s: any) => s.id === 'publish').floor = null; }), /floor/i);
});

test('connectors: upload, comments and messages are handoffs; nothing claims a mode the code lacks', () => {
  const absent = youtubeConnectors({ ffmpeg: false });
  const upload = absent.find(item => item.id === 'youtube-upload')!;
  assert.deepEqual(upload.posting, postingOptions('youtube', NOT_PROBED), 'upload modes come from the posting module, never restated');
  assert.ok(upload.posting.every(option => option.status === 'planned'));
  for (const id of ['youtube-comments', 'messages']) {
    const card = absent.find(item => item.id === id)!;
    assert.ok(card.modes.some(mode => mode.mode === 'handoff'), id);
    assert.ok(card.modes.filter(mode => mode.mode === 'write').every(mode => mode.status === 'planned'), id);
  }
  const ffmpeg = absent.find(item => item.id === 'ffmpeg')!;
  assert.equal(ffmpeg.modes[0].status, 'planned');
  assert.match(ffmpeg.modes[0].reason!, /ffmpeg not found/);
  assert.equal(youtubeConnectors({ ffmpeg: true }).find(item => item.id === 'ffmpeg')!.modes[0].status, 'available');
  for (const card of absent) for (const mode of card.modes) {
    assert.ok(mode.status === 'planned' ? mode.reason : mode.reason === null, `${card.id} ${mode.mode}`);
  }
  assert.ok(absent.find(item => item.id === 'paid-generation')!.modes.every(mode => mode.status === 'planned'));
});

test('platform rules: dated, sourced, and they go stale visibly', () => {
  assert.doesNotThrow(() => validatePlatformRules(PLATFORM_RULES));
  const ids: string[] = PLATFORM_RULES.map(rule => rule.id);
  for (const id of ['api-upload-privacy', 'altered-synthetic-disclosure', 'reused-content', 'inauthentic-content', 'chapters', 'shorts-length', 'metadata-limits', 'paid-promotion']) {
    assert.ok(ids.includes(id), id);
  }
  for (const rule of PLATFORM_RULES) {
    if (rule.id === 'cleanup-thresholds') assert.equal(rule.sourceUrl, 'house:youtube-cleanup');
    else if (rule.id === 'after-publish-thresholds') assert.equal(rule.sourceUrl, 'house:youtube-after-publish');
    else if (rule.id === 'finishing-house') assert.equal(rule.sourceUrl, 'house:youtube-finishing');
    else if (rule.id.startsWith('safe-zone-')) assert.equal(rule.sourceUrl, 'house:youtube-' + rule.id);
    else if (rule.id === 'caption-profile') assert.match(rule.sourceUrl, /^https:\/\/partnerhelp\.netflixstudios\.com\//, rule.id);
    else assert.match(rule.sourceUrl, /^https:\/\/(support\.google\.com|developers\.google\.com)\//, rule.id);
    assert.match(rule.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
  }
  // The API rule changed: Google's page (updated 15 October 2026) no longer locks unverified uploads to private.
  const api = platformRule('api-upload-privacy');
  assert.match(api.rule, /not restricted to private/);
  assert.match(api.previously!.rule, /private/);
  assert.equal(platformRule('chapters').limits.minimumCount, 3);
  assert.equal(platformRule('chapters').limits.minimumSeconds, 10);
  assert.equal(platformRule('shorts-length').limits.maxSeconds, 180);
  assert.equal(platformRule('metadata-limits').limits.titleChars, 100);
  assert.equal(platformRule('metadata-limits').limits.descriptionBytes, 5000);
  assert.equal(ruleFreshness(api, api.checkedOn), 'current');
  assert.equal(ruleFreshness(api, '2027-06-01'), 'recheck');
  assert.throws(() => validatePlatformRules([{ ...api, sourceUrl: 'http://example.com' }]), /source/);
  assert.throws(() => validatePlatformRules([{ ...api, checkedOn: '21 Oct' }]), /date/);
});

test('every word in the playbook data is in house style, and the hard lines name rights and disclosure', () => {
  for (const line of everyString({ YOUTUBE_PLAYBOOK, PLATFORM_RULES, YOUTUBE_INTAKE_FIELDS, YOUTUBE_HARD_LINES })) {
    assert.deepEqual(houseStyleFindings(line), [], line);
  }
  const joined = YOUTUBE_HARD_LINES.join(' ');
  assert.match(joined, /rights/);
  assert.match(joined, /AI voice/);
  assert.match(joined, /estimate/);
  const rights = YOUTUBE_INTAKE_FIELDS.find(field => field.id === 'rights')!;
  assert.ok(rights, 'the shared rights field is part of intake');
  for (const id of ['ai-voice', 'ai-presenter', 'paid-promotion', 'format']) assert.ok(YOUTUBE_INTAKE_FIELDS.some(field => field.id === id), id);
});
