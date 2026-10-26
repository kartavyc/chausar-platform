import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeEngine } from '../../src/engine/fake';
import { SETTINGS_FIELDS } from '../../src/engine/fake-setup';

/*
 * 4Z3: the fake's settings drafts take exactly the fields the engine's do (platform/runtime/venture/core/settings-drafts.ts
 * SETTINGS_FIELDS), so a form that drafts a field the engine refuses fails a UI test, as the real engine would refuse it.
 */

const ENGINE = readFileSync(join(import.meta.dirname, '../../../../platform/runtime/venture/core/settings-drafts.ts'), 'utf8');

/** The engine's SETTINGS_FIELDS, read from its source: each form and its fields. */
function engineFields(): Record<string, string[]> {
  const block = /export const SETTINGS_FIELDS[^{]*\{([\s\S]*?)\n\}\);/.exec(ENGINE)?.[1] ?? '';
  const fields: Record<string, string[]> = {};
  for (const match of block.matchAll(/^\s*'?([a-z-]+)'?:\s*\[([^\]]*)\]/gm)) {
    fields[match[1]!] = [...match[2]!.matchAll(/'([A-Za-z]+)'/g)].map((field) => field[1]!);
  }
  return fields;
}

describe('the fake settings drafts check fields as the engine does', () => {
  it('holds the engine\'s forms and fields, field for field', () => {
    const engine = engineFields();
    expect(Object.keys(engine).length).toBeGreaterThan(5);
    expect(engine['spend-policy']).toContain('currencyLead');
    expect(Object.fromEntries(Object.entries(SETTINGS_FIELDS).map(([form, list]) => [form, [...list]]))).toEqual(engine);
  });

  it('refuses a field the form\'s real method does not take, and keeps one it does', async () => {
    const fake = new FakeEngine();
    await expect(fake.request('venture.settings.draft', { form: 'spend-policy', values: { capUsd: '20', colour: 'red' } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(fake.request('venture.settings.draft', { form: 'spend-policy', values: { capUsd: '20', currencyLead: 'usd' } })).resolves.toMatchObject({ line: 'Saved' });
    await expect(fake.request('venture.settings.draft', { form: 'goals', values: { month: '2026-10', firstName: 'Asha' } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });
});
