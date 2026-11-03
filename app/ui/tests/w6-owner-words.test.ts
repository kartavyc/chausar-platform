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
