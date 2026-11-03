import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES, format, pluralForm, type Message } from '../src/text';

const dir = (lang: string) => join(import.meta.dirname, '../src/text', lang) + '/';

describe('plural by exact digits', () => {
  it('English: one only for exactly 1', () => {
    expect(pluralForm('1', 'en')).toBe('one');
    expect(pluralForm('01', 'en')).toBe('one');
    expect(pluralForm('0', 'en')).toBe('other');
    expect(pluralForm('2', 'en')).toBe('other');
    expect(pluralForm('11', 'en')).toBe('other');
    expect(pluralForm('1.0', 'en')).toBe('other');
    expect(pluralForm('1,001', 'en')).toBe('other');
  });

  it('never turns a long count into a float', () => {
    expect(pluralForm('100000000000000000001', 'en')).toBe('other');
    expect(pluralForm('000000000000000000001', 'en')).toBe('one');
    expect(pluralForm('not a count', 'en')).toBe('other');
  });
});

describe('format', () => {
  const catalogue: Record<string, Message> = {
    plain: 'Close',
    named: '{agent} · run {id}',
    count: { zero: 'Nothing needs you.', one: '{count} needs you', other: '{count} need you' },
  };
  it('fills named values as text', () => {
    expect(format(catalogue, 'en', 'named', { agent: 'Editor', id: '31' })).toBe('Editor · run 31');
    expect(format(catalogue, 'en', 'named', { agent: '<b>x</b>', id: 1 })).toBe('<b>x</b> · run 1');
  });
  it('chooses the plural form from the count digits', () => {
    expect(format(catalogue, 'en', 'count', { count: '0' })).toBe('Nothing needs you.');
    expect(format(catalogue, 'en', 'count', { count: '1' })).toBe('1 needs you');
    expect(format(catalogue, 'en', 'count', { count: 3 })).toBe('3 need you');
  });
  it('a missing key shows the key, never a blank', () => {
    expect(format(catalogue, 'en', 'nope')).toBe('nope');
  });
});

describe('catalogues', () => {

  it('a place file only holds its own keys and each key is unique', () => {
    const en = readdirSync(dir('en')).sort();
    expect(en).toContain('common.json');
    const seen = new Set<string>();
    for (const file of en) {
      const place = file.replace(/\.json$/, '');
      const keys = Object.keys(JSON.parse(readFileSync(dir('en') + file, 'utf8')) as object);
      for (const key of keys) {
        if (place !== 'common') expect(key.startsWith(`${place}.`), `${file}: ${key}`).toBe(true);
        expect(seen.has(key), `duplicate ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });
  it('English copy has no em dashes', () => {
    for (const message of Object.values(CATALOGUES.en)) expect(JSON.stringify(message)).not.toContain('—');
  });
});

const texts = (message: Message | undefined): string[] => (message === undefined ? [] : typeof message === 'string' ? [message] : Object.values(message).filter((m): m is string => typeof m === 'string'));

/**
 * Words the house style keeps out of English copy (catalogue U14): hype and "AI-ish" words. "Unlocks" stays legal
 * because a locked button really does unlock ("Approve unlocks after you watch it"); "unlock your" is the hype.
 */
const HYPE = /\b(?:AI[- ]powered|powered by AI|magic(?:al|ally)?|seamless(?:ly)?|revolutionar\w*|revolutioni[sz]\w*|supercharg\w*|unlock (?:your|the|new|more)|delv\w*|leverag\w*|empower\w*|journey\w*|game[- ]chang\w*|cutting[- ]edge|state[- ]of[- ]the[- ]art|next[- ]level|effortless\w*|robust\w*|elevat\w*|streamlin\w*|tapestry|testament|unleash\w*|skyrocket\w*|transform your|in today's|dive (?:in|into)|embark\w*|realm|boost your)\b/i;

describe('English copy in the house style (catalogue U14)', () => {
  it('the hype check catches what it should, on samples', () => {
    for (const bad of ['Our AI-powered team', 'Seamless invoices', 'Unlock your potential', 'Let us delve in', 'Leverage AI', 'Start your journey', 'Supercharge sales', 'magic']) expect(HYPE.test(bad), bad).toBe(true);
    for (const good of ['Approve unlocks after you watch it', 'Tick that you saved it, then Continue unlocks.', 'Your AI', 'Invoices in INR.']) expect(HYPE.test(good), good).toBe(false);
  });
  it('an engine-failed run reads "Failed", never "Stopped": that word is the owner\'s own Stop (W4 4F)', () => {
    const FAILED = ['run.stopped', 'thread.runFailed', 'state.run.failed', 'state.step.failed', 'state.delivery.failed', 'story.status.failed', 'story.name.failed', 'ring.stepsFailed', 'ring.indeterminateFailed', 'steps.failed', 'team.dept.stopped', 'today.team.failed', 'today.working.stopped', 'clients.draft.failed', 'work.failedRun.chip', 'work.failedRun.noReason'];
    for (const key of FAILED) {
      expect(texts(CATALOGUES.en[key]).length, key).toBeGreaterThan(0);
      for (const text of texts(CATALOGUES.en[key])) expect(text, key).toMatch(/fail/i);
    }
  });
  it('no hype words, "AI-ish" words or exclamation marks in English copy', () => {
    const found = Object.entries(CATALOGUES.en).flatMap(([key, message]) => texts(message).filter((text) => HYPE.test(text) || text.includes('!')).map((text) => `${key}: ${text}`));
    expect(found).toEqual([]);
  });
});
