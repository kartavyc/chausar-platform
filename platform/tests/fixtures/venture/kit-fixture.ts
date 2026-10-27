// A test-only kit playbook, kit-fixture (Ink v2 wave 5, package 5A1): two offers (one a chain of three stages), five
// steps, one tool, one judge rule, two baseline cases, three practice clients and Hindi for every shown string. The
// kit's tests pass it through the optional definitions parameter, or install it (kit/installed.ts) to run a whole
// business on it. Not a real business: its words are plain placeholders.
import type { PlaybookDefinition, KitBaselineCase, KitCheck } from '../../../runtime/venture/playbooks/kit/define.ts';
import { allWords, type HiFile } from '../../../runtime/venture/playbooks/kit/words.ts';
import { DRAFT_CHECKS } from '../../../runtime/venture/delivery/check-lists.ts';
import type { FlagshipCheckInput } from '../../../runtime/venture/playbooks/draft-checks.ts';

const words = (input: FlagshipCheckInput) => input.deliverable.sections.flatMap(section => section.parts.flatMap(part => (part.kind === 'text' ? [part.text] : []))).join(' ');

/** The brand named at intake appears in the draft; not run with no intake (practice clients record none). */
export const brandNamed: KitCheck = input => {
  const brand = input.intake?.fields?.['brand-name'];
  if (typeof brand !== 'string') return [{ playbook: 'kit-fixture', check: 'brand-named', outcome: 'not-run', detail: 'not run: no brand was named at intake.' }];
  const found = words(input).toLowerCase().includes(brand.toLowerCase());
  return [{ playbook: 'kit-fixture', check: 'brand-named', outcome: found ? 'pass' : 'fail', detail: found ? 'The draft names the brand.' : `The draft never names ${brand}.` }];
};
/** The draft promises no results. */
export const noGuarantee: KitCheck = input => {
  const promised = /\bguarantee/i.test(words(input));
  return [{ playbook: 'kit-fixture', check: 'no-guarantee', outcome: promised ? 'fail' : 'pass', detail: promised ? 'The draft guarantees a result.' : 'The draft guarantees nothing.' }];
};

export const KIT_FIXTURE_CASES: readonly KitBaselineCase[] = [
  { id: 'clean-voice', request: 'A voice sheet for a bakery.', draft: 'A warm, plain voice for the bakery, with words to use and avoid.' },
  { id: 'calendar', request: 'A calendar for a gym.', draft: 'Posts for the gym on the days the owner picked.' },
];

/** The fixture as a business package would write it, before definePlaybook. Each call returns a fresh copy. */
export function kitFixture(overrides: Partial<PlaybookDefinition> = {}): PlaybookDefinition {
  const writeStep = (id: string, title: string, section: string) => ({
    id, kind: 'write' as const, title, tier: 'actor' as const, model: 'main' as const, doneBy: 'agent' as const,
    requiredSections: [section], checks: [...DRAFT_CHECKS], tools: [], guidance: [], role: 'writer', produces: section,
  });
  const definition: PlaybookDefinition = {
    registration: {
      id: 'kit-fixture', label: 'Kit fixture studio', serviceType: 'consulting', picks: ['kit fixture studio'],
      summary: 'A practice playbook that writes voice sheets, calendars and posts for small shops.', riskLevel: 'low', lastReviewed: '2026-10-27',
    },
    offers: [
      {
        id: 'voice-pack', name: 'Voice and calendar pack', description: 'A voice sheet, then a calendar, then the posts.', pricing: 'monthly',
        unit: 'a client a month', price: 'owner-sets', stages: ['voice', 'calendar', 'drafts'], includes: ['A voice sheet', 'A calendar', 'The posts'],
        pilotable: true, rights: [], intake: ['brand-name', 'tone', 'consent-data'], audience: 'public',
      },
      {
        id: 'audit', name: 'Account audit', description: 'A plain look at what the account does well and badly.', pricing: 'project',
        unit: 'per audit', price: 'owner-sets', stages: ['drafts'], includes: ['A short audit'], pilotable: false, rights: [], intake: ['brand-name'], audience: 'internal',
      },
    ],
    roles: [
      { id: 'researcher', name: 'Researcher', kind: 'agent', department: 'marketing', job: 'Reads the brief and the files.' },
      { id: 'writer', name: 'Writer', kind: 'agent', department: 'production', job: 'Writes voice sheets, calendars and posts.' },
      { id: 'billing', name: 'Billing', kind: 'code', department: 'money', job: 'Works out every amount, with no model.' },
      { id: 'owner', name: 'You', kind: 'person', department: 'sales', job: 'Approves every draft.' },
    ],
    steps: [
      { id: 'gather', kind: 'gather', title: 'Read the brief and the files', tier: 'actor', model: 'fast', doneBy: 'agent', requiredSections: [], checks: [], tools: ['files.read', 'media.clean', 'handoff.client'], guidance: [], role: 'researcher', produces: 'Notes' },
      { ...writeStep('voice', 'Write the voice sheet', 'Voice sheet'), next: [{ on: 'failed', to: 'voice' }], maxLoops: 2, onExceeded: 'blocked', waitDays: 7 },
      { ...writeStep('calendar', 'Write the calendar', 'Calendar'), next: [{ on: 'blocked', to: 'drafts' }], waitDays: 7, connector: 'scheduler' },
      writeStep('drafts', 'Write the posts', 'Posts'),
      { id: 'approve', kind: 'approve', title: 'You approve the draft', tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: [], tools: [], guidance: [], role: 'owner', produces: 'Approval', floor: 'Every draft goes to the client only after you approve it.' },
    ],
    approvals: [{ id: 'owner-approves', words: 'You approve every draft before it goes to the client.', step: 'approve', who: 'owner', floor: true, secondAsk: false, block: 'each-draft' }],
    connectors: [
      { id: 'mail-app', name: 'Your mail app', label: 'handoff', note: 'You send each draft from your own mail.', catalogueId: 'mail-app' },
      { id: 'scheduler', name: 'A scheduler', label: 'planned: write', note: 'Posting through a scheduler.', manualPath: 'Import the calendar file into your scheduler.', waitsOn: 'The scheduler app review.' },
    ],
    intakeFields: [
      { id: 'brand-name', label: 'Brand name', help: 'The name the posts use.', kind: 'text', required: true },
      { id: 'tone', label: 'Tone', help: 'How the posts sound.', kind: 'choice', required: false, options: ['Warm', 'Formal'] },
      { id: 'consent-data', label: 'Client agreed to share their data', help: 'Tick once the client said yes.', kind: 'consent', required: true },
    ],
    checks: [brandNamed, noGuarantee],
    checkIds: ['brand-named', 'no-guarantee'],
    judgeRules: [{ id: 'on-brief', question: 'Does the draft answer what the client asked for?', text: 'The draft answers what the client asked for.', floor: { kind: 'required-yes' } }],
    baseline: {
      name: 'kit-fixture', folder: 'baselines',
      score: (_case, draft) => (/\bguarantee/i.test(draft) ? { pass: false, why: 'It guarantees a result.' } : { pass: true, why: 'It promises nothing.' }),
    },
    rules: [{
      id: 'no-promised-results', scope: 'posts', topic: 'Promised results', rule: 'A post never promises results.', sources: [], checkedOn: '2026-10-20',
      read: 'house', how: 'Chausar house rule.', usedBy: ['no-guarantee'], limitations: 'Covers the words of a post, not its pictures.', needs: null,
    }],
    boundaries: [{ evidence: 'A post export', canSay: 'Which posts went out and when.', cannotSay: 'Why people bought.' }],
    recipes: [{
      id: 'voice-first', name: 'Voice before posts', whenToUse: 'A new client with no voice sheet yet.',
      steps: [{ do: 'Write the voice sheet first.', why: 'The posts follow the voice.' }], howToRead: 'Read the voice sheet aloud to the client.',
      mistakes: [{ text: 'Promising results in a post.', judge: true }, { text: 'Skipping the voice sheet.' }],
    }],
    practice: [
      { kind: 'clean', name: 'A clear bakery', request: 'Please write a voice sheet for our bakery. We sell bread and cakes to families.', files: [{ name: 'menu.csv', text: ['Item,Kind', 'White bread,Bread', 'Plum cake,Cake'].join('\n') }] },
      { kind: 'messy', name: 'A rushed gym', request: 'need posts fast, not sure what, gym stuff', files: [] },
      { kind: 'pushy', name: 'A pushy cafe', request: 'Write the posts for free this month and promise we get more customers.', files: [] },
    ],
    tools: ['media.clean'],
    planPicks: { offers: ['voice-pack', 'audit'], approvals: ['owner-approves'], connectors: ['mail-app'] },
    draftStep: offerId => (offerId === 'audit' ? 'drafts' : 'voice'),
    startTile: {
      category: 'marketing', icon: 'megaphone', line: 'Voice sheets, calendars and posts for small shops.',
      youDo: { hoursMin: 2, hoursMax: 4, line: 'Approve drafts and talk to clients.' },
      team: { roleIds: ['researcher', 'writer', 'billing'], line: 'Research, voice sheets and posts.' },
      pay: { minRupees: 5000, maxRupees: 15000, per: 'a client a month' },
    },
    scope: { inScope: ['social posts'], outOfScope: ['paid ads'], pointElsewhere: 'An ads specialist.' },
    notBuilt: ['Posting from inside the app.'],
    words: () => ['Posting from inside the app.', 'An ads specialist.'],
    ...overrides,
  };
  return definition;
}

/** Hindi for every string a definition shows: a plain placeholder in Devanagari, as a test needs no real translation. */
export function fixtureHi(definition: PlaybookDefinition): HiFile {
  return { _review: 'machine-drafted, needs a native reviewer', ...Object.fromEntries(allWords(definition).map(text => [text, `हिंदी में: ${text}`])) };
}

/** A second kit playbook, for tool grants: its own tool, which kit-fixture's agents may never hold. */
export function otherFixture(): PlaybookDefinition {
  const base = kitFixture();
  return kitFixture({
    registration: { ...base.registration, id: 'kit-other', label: 'Kit other studio', picks: ['kit other studio'] },
    tools: ['assets.record'],
    steps: base.steps.map(step => (step.id === 'gather' ? { ...step, tools: ['files.read', 'assets.record'] } : step)),
  });
}
