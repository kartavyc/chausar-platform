// Intake display words must cover every landed kit and the additional social form fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYBOOK_DEFINITIONS } from '../runtime/venture/playbooks/definitions.ts';
import { socialIntakeFields } from '../runtime/venture/playbooks/social/intake-fields.ts';

test('all shipped intake labels help and options have registered English and Hindi display words', () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL('../../app/ui/src/text/' + path, import.meta.url), 'utf8'));
  const english = read('en/kit-intake-words.json') as Record<string, string>, hindi = read('hi/kit-intake-words.json') as Record<string, string>;
  const keys = new Map(Object.entries(english).map(([key, value]) => [value, key]));
  const review = new Set(read('hi-review.json').machineDrafted as string[]);
  const fields = [...PLAYBOOK_DEFINITIONS.flatMap(definition => definition.intakeFields), ...['community-replies', 'repurpose-pack', 'linkedin-ghostwriting', 'monthly-report'].flatMap(offer => socialIntakeFields(offer) ?? [])];
  for (const field of fields) for (const words of [field.label, field.help, ...(field.options ?? [])]) {
    const key = keys.get(words); assert.ok(key, 'Missing intake words: ' + words);
    assert.ok(hindi[key]?.trim(), 'Missing Hindi: ' + words);
    assert.ok(review.has(key), 'Hindi review not registered: ' + words);
  }
});
