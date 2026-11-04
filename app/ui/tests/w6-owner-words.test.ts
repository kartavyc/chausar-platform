import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
  ['fixture', /\bfixtures?\b|fixture-tested/i],
  ['vault', /\bvaults?\b/i],
  ['engine', /\bengines?\b/i],
  ['gateway', /\bgateways?\b/i],
  ['probe', /\bprobes?\b/i],
  ['manifest', /\bmanifests?\b/i],
  ['credential', /\bcredentials?\b/i],
  ['outcome is unknown', /outcome is unknown/i],
  ['npm', /\bnpm run\b|build:ui/i],
  ['printed by', /printed by/i],
  ['counted by code', /counted by code/i],
  ['priced on receipt', /priced on receipt/i],
  ['runs as code', /runs as code/i],
  ['open by folder name', /by folder name/i],
  ['experimental storage', /experimental storage/i],
];
const OUTSIDE_TOOLS: readonly [string, RegExp][] = [
  ['engine', /^(?:pb-seo-visibility\.|kit-intake-words\.)/],
  ['manifest', /^pb-connector-guides\.website-cloudflare\./],
  ['credential', /^(?:pb-|kit-intake-words\.)/],
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
