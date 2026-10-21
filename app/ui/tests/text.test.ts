import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES, format, placeholders, pluralForm, type Message } from '../src/text';

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
  it('Hindi: one for 0 and 1', () => {
    expect(pluralForm('0', 'hi')).toBe('one');
    expect(pluralForm('1', 'hi')).toBe('one');
    expect(pluralForm('2', 'hi')).toBe('other');
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
  it('every English key exists in Hindi, with the same placeholders and plural forms', () => {
    const en = CATALOGUES.en; const hi = CATALOGUES.hi;
    const missing = Object.keys(en).filter((k) => !(k in hi));
    expect(missing).toEqual([]);
    for (const [key, message] of Object.entries(en)) {
      expect(placeholders(hi[key]!), key).toEqual(placeholders(message));
      expect(typeof hi[key], key).toBe(typeof message);
    }
  });
  it('Hindi has no keys English lacks', () => {
    expect(Object.keys(CATALOGUES.hi).filter((k) => !(k in CATALOGUES.en))).toEqual([]);
  });
  it('the same files exist for both languages, and a place file only holds its own keys', () => {
    const en = readdirSync(dir('en')).sort(); const hi = readdirSync(dir('hi')).sort();
    expect(hi).toEqual(en);
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
    for (const message of Object.values(CATALOGUES.hi)) expect(JSON.stringify(message)).not.toContain('—');
  });
});
