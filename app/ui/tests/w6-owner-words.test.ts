import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEVELOPER_WORDS } from '../../../platform/runtime/owner-flag';
import { FakeEngine } from '../src/engine/fake';

const folder = join(import.meta.dirname, '../src/text/en');
const catalogue = Object.assign({}, ...readdirSync(folder).filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(readFileSync(join(folder, name), 'utf8')))) as Record<string, string>;

describe('wave 6 owner-facing words', () => {
  it('names the controls in the founder-agreed plain English', () => {
    expect(catalogue['team.posture']).toBe('How much it asks you');
    expect(catalogue['team.posture.shadow']).toBe('Practice on real orders');
    expect(catalogue['work.judge.heading']).toBe('Quality check');
    expect(catalogue['business.plan']).toBe('How the work is done');
    expect(catalogue['connector.handoff']).toBe('You send it');
    expect(catalogue['kit-connect.webhook.open']).toBe('Send to n8n or Make');
  });

  it('does not put founder approval or internal mode names in customer copy', () => {
    const internal = /\b(?:founder|posture|shadow|playbook|handoff)\b/i;
    const found = Object.entries(catalogue).filter(([, value]) => typeof value === 'string' && internal.test(value.replace(/\{[^}]+\}/g, '')));
    expect(found, folder).toEqual([]);
  });
});

/**
 * One-shot B1 (SCREENS P1, PLAN batch 12): engine and developer words never reach the owner. A few keys keep a word
 * because it is the outside tool's own (search and answer engines in the SEO pack; the Cloudflare upload guide's
 * manifest; a third-party app's credentials in a connector or playbook guide).
 */
const BANNED: readonly [string, RegExp][] = [
  // The one list the app's error edge uses too (platform/runtime/owner-flag.ts DEVELOPER_WORDS).
  ...DEVELOPER_WORDS.map((word): [string, RegExp] => [word, new RegExp(`\\b${word}s?\\b`, 'i')]),
  ['fixture-tested', /fixture-tested/i],
  ['outcome is unknown', /outcome is unknown/i],
  ['npm run', /build:ui/i],
  ['printed by', /printed by/i],
  ['counted by code', /counted by code/i],
  ['priced on receipt', /priced on receipt/i],
  ['runs as code', /runs as code/i],
  ['open by folder name', /by folder name/i],
  ['experimental storage', /experimental storage/i],
  // B1 fix round 1 (spec 2): a raw record id (run_1a2b3c4d) never sits in a line.
  ['record id', /_[0-9a-f]{8}/],
];
/** Keys where the word is the outside tool's own, each named. */
const OUTSIDE_TOOLS: readonly [string, RegExp][] = [
  ['engine', /^(?:pb-seo-visibility\.|kit-intake-words\.)/],
  ['manifest', /^pb-connector-guides\.website-cloudflare\./],
  // B1 fix round 1 (spec 9): an outside app's own credentials, key by key (Shopify, WordPress, the open networks, a
  // client's staff login), never a whole pack.
  ['credential', new RegExp(`^(?:${[
    'kit-intake-words.app-testing.testAccount.help',
    'pb-connector-guides.seo-wordpress.step1', 'pb-connector-guides.seo-wordpress.checks',
    ...['bluesky', 'mastodon', 'telegram', 'discord'].flatMap((network) => [`pb-connector-guides.${network}.step2`, `pb-connector-guides.${network}.checks`]),
    'pb-connector-guides.docker-local.skipped', 'pb-forms.staff', 'pb-open-posting.scope',
    'pb-seller-connectors.shopifyHelp', 'pb-seller-connectors.error.SHOPIFY_API_REFUSED', 'pb-seller-connectors.error.SHOPIFY_SETUP_REQUIRED',
    'pb-seller-guides.shopify-admin.skipped', 'pb-seller-guides.shopify-admin.sends', 'pb-seller-guides.shopify-storefront.step1',
    ...['amazon-sp-api', 'amazon-ads', 'flipkart-api', 'shiprocket', 'delhivery', 'sorftime', 'shopify-store-assistant'].map((card) => `pb-seller-guides.${card}.step1`),
    'pb-seo-connect.scope', 'pb-seo-connect.failed', 'pb-youtube-research.guideEnable',
  ].map((key) => key.replace(/\./g, '\\.')).join('|')})$`)],
  // A software client's own words in the dev-agency pack: the source snapshot, and the npm registry it queries.
  ['snapshot', /^(?:kit-intake-words\.dev-agency\.source\.label|pb-dev\.source|pb-dev\.error\.DEV_SOURCE_INVALID)$/],
  ['npm', /^pb-dev\.auditHelp$/],
];
const flat = (value: unknown): string => (typeof value === 'string' ? value : value && typeof value === 'object' ? Object.values(value).map(flat).join(' ') : '');

describe('one-shot B1: no engine or developer words on a screen', () => {
  it('no catalogue line uses an engine or developer word', () => {
    const found = Object.entries(catalogue).flatMap(([key, value]) => {
      const text = flat(value).replace(/\{[^}]+\}/g, '');
      return BANNED.filter(([name, pattern]) => pattern.test(text) && !OUTSIDE_TOOLS.some(([allowed, keys]) => allowed === name && keys.test(key))).map(([name]) => `${key} (${name}): ${text}`);
    });
    expect(found).toEqual([]);
  });

  it('says the plain words the copy pass chose', () => {
    expect(catalogue['status.offline']).toBe("Chausar isn't answering. Nothing here is live until it's back.");
    expect(catalogue['money-pay.fixture']).toBe('Not tried live yet');
    expect(catalogue['team.keeper.code']).toBe('Fixed rules, no AI');
    expect(catalogue['chats.counted.title']).toBe("Counts from your records. The summary didn't work this time.");
    expect(catalogue['business.experimental']).toBe("Test version: practise here, don't send real invoices yet.");
    expect(catalogue['chats.thread.role']).toBe('Reads your books, team and receipts');
  });
});

// One-shot B1 (A5 notes, line 67): one wording for start at login. The founder read "start at login" as a Chausar
// login, so onboarding, Today's ask and Settings say whose sign-in it is: this computer's.
describe('one-shot B1: start at login reads the same everywhere', () => {
  it('onboarding, Today and Settings say "when you sign in to this computer"', () => {
    expect(catalogue['first-run.login.label']).toBe('Start Chausar when you sign in to this computer');
    expect(catalogue['business.notify.login']).toBe(catalogue['first-run.login.label']);
    const loginWords = Object.entries(catalogue).filter(([, value]) => /(?:start|starts|open|opens) (?:chausar )?at (?:log ?in|login)/i.test(flat(value)));
    expect(loginWords).toEqual([]);
  });
});

// B1 fix round 1 (quality findings 3 and 4): the words the fake engine puts in its views (Team's role lines, the needs
// list, the bell) use none of the same developer words; the engine's own copies are checked in
// platform/tests/owner-words-engine-b1.test.ts against the same list.
describe('B1 fix round 1: the fake engine\'s screen words carry no developer word', () => {
  it('team roles, needs and alerts', async () => {
    const engine = new FakeEngine();
    const team = await engine.request('venture.team.list', {});
    const needs = await engine.request('venture.needs.list', {});
    const bell = await engine.request('venture.notify.list', {});
    const lines = [
      ...team.agents.flatMap((agent) => [agent.name, agent.role, agent.now]),
      ...flat(needs).split(/(?<=[.!?])\s+/),
      ...bell.items.flatMap((item) => [item.title, flat(item)]),
    ].filter((line): line is string => typeof line === 'string');
    expect(lines.length).toBeGreaterThan(5);
    const found = lines.flatMap((line) => DEVELOPER_WORDS.filter((word) => new RegExp(`\b${word}s?\b`, 'i').test(line)).map((word) => `${word}: ${line}`));
    expect(found).toEqual([]);
    expect(team.agents.find((agent) => agent.id === 'keeper')?.role).toBe('Keeps Chausar running by fixed rules, not AI: backups, delivery checks, connection checks, rule and rate dates, posting steps and network strength.');
  });
});
