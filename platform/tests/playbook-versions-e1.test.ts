import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PLAYBOOK_REGISTRY } from '../runtime/venture/playbooks/registry.ts';
import { DIGEST_PATTERN } from '../shared/digest.ts';

test('every installed playbook has an explicit positive version', () => {
  assert.ok(PLAYBOOK_REGISTRY.length > 0);
  for (const entry of PLAYBOOK_REGISTRY) {
    const version = (entry as typeof entry & { version?: number }).version;
    assert.ok(Number.isSafeInteger(version) && version! >= 1, `${entry.id} needs an explicit playbook version.`);
  }
});

test('each version pins the installed steps, tools, connections, checks and roles', async () => {
  const { playbookDefinitionDigest } = await import('../runtime/venture/playbooks/' + 'definition-digest.ts');
  const pins = JSON.parse(await readFile(new URL('./fixtures/playbook-digests.json', import.meta.url), 'utf8')) as { id: string; version: number; digest: string }[];
  assert.deepEqual(pins.map(pin => pin.id).sort(), PLAYBOOK_REGISTRY.map(entry => entry.id).sort());
  assert.equal(new Set(pins.map(pin => pin.id)).size, pins.length);
  for (const entry of PLAYBOOK_REGISTRY) {
    const pin = pins.find(pin => pin.id === entry.id)!;
    const version = (entry as typeof entry & { version?: number }).version;
    assert.equal(version, pin.version, `Pin ${entry.id}'s current version.`);
    assert.match(pin.digest, DIGEST_PATTERN);
    assert.equal(playbookDefinitionDigest(entry.id), pin.digest, `Bump ${entry.id}'s version and pin its changed definition.`);
  }
});
