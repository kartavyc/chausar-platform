import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SOCIAL_OFFERS, SOCIAL_STEPS } from '../runtime/venture/playbooks/social/playbook.ts';
import { SOCIAL_AGENCY_REGISTRATION } from '../runtime/venture/playbooks/social/registration.ts';
import { socialIntakeFields } from '../runtime/venture/playbooks/social/intake-fields.ts';
test('the browser social plan metadata stays pinned to the real thirteen offers and exact intake fields', async () => {
 const fixture = JSON.parse(await readFile(new URL('../../app/ui/src/engine/fixtures-social-plan.json', import.meta.url), 'utf8'));
 assert.deepEqual(fixture,{registration:SOCIAL_AGENCY_REGISTRATION,offers:SOCIAL_OFFERS.map(offer=>({...offer,intake:socialIntakeFields(offer.id)})),steps:SOCIAL_STEPS});
});
