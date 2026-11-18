// Seen in the real app on Windows (15 Nov 2026): a second business did not get the real onboarding. "New business"
// opened the old one-sentence start, which made a business at once from a built-in template with no AI conversation,
// no plan to review, no way to earn and no team. Every new business now goes through the same conversational
// onboarding, before any vault, on the draft desk. This file holds the engine's side of that for a business that is
// not the first: the open business is locked, the AI the owner already connected on this computer (Codex or Claude
// Code; a key never carries over) is connected in the new draft with one request, passing every gate a connect runs
// and with the agreement given before, and venture.create, the team hire and the kept way and needs then work as they
// do for the first business. Through the real Engine, on a temp folder, with no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DRAFT_METHODS, METHOD_OWNERS } from '../runtime/venture/contracts.ts';
import { ONBOARDING_METHODS } from '../runtime/venture/onboarding-contracts.ts';
import type { AiOptionsView, AiReuseView, AiStatusView } from '../runtime/venture/onboarding-contracts.ts';
import type { ModelReplayFixture } from '../runtime/venture/contracts.ts';
import { METHOD_HINTS, METHOD_LEVEL_OF } from '../runtime/venture/method-hints.ts';
import { BOOTSTRAP_ONLY_METHODS } from '../runtime/server.ts';
import { presetSpec } from '../runtime/venture/models/presets.ts';
import { teamCardDigest } from '../runtime/venture/agents/team-proposal.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { engineFor, presetOf, PASSPHRASE, TEST_KEY } from './fixtures/venture/compose-unit/harness.ts';

const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk wholesale orders from cafes and hotels in Pune.';
const AC = 'I repair and service air conditioners in Lucknow and I want yearly maintenance contracts from offices and housing societies.';
const WAY = {
  customer: 'Offices and housing societies in Lucknow that run many air conditioners.',
  reach: 'A list of societies found from public listings, then a first message you send to each secretary.',
  teamDoes: 'Finds the societies, drafts each message and quote, and keeps track of who replied.',
  youDo: 'Do the visits, set the prices, send each message and take the calls.',
  firstWeek: ['Decide what a yearly contract covers and your price for it.', 'Approve the first list of societies.', 'Send the first five messages.'],
};
const SCOUT = { name: 'Asha', job: 'Finds societies that need yearly service.', duties: ['Lists housing societies in Lucknow from public listings', 'Flags the ones that fit your contract'], reads: ['plan', 'trackers'], department: 'sales' };
const OFFERS = [{ name: 'Yearly AC contract', line: 'Two services a year and priority repair visits.' }];
/** Claude Code's answer to About you for the AC technician, as a synthetic recording: offers, a way to earn and a team. */
const AC_ANSWER: ModelReplayFixture['responses'][number] = {
  purpose: 'decide', kind: 'claude-cli', model: 'claude-sonnet-5-5', status: 200, mustInclude: [AC],
  body: {
    type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 900, output_tokens: 240 },
    structured_output: { familyId: 'local-services', professionId: null, offers: OFFERS, countryCode: null, evidence: null, reply: 'Which areas of Lucknow do you cover?', way: WAY, team: [SCOUT] },
  },
};
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };

/** The first business, made the way the first run makes it: Claude Code connected before the vault, then kept. */
async function firstBusiness(t: any) {
  const { engine, directory } = await engineFor(t, { responses: [AC_ANSWER] });
  const options = await engine.request('venture.ai.options', {}) as AiOptionsView;
  await engine.request('venture.ai.connect', { presetId: 'claude-code-cli', consentDigest: presetOf(options, 'claude-code-cli').consentDigest });
  await engine.request('workspace.create', { name: 'Pune Handmade Pottery', passphrase: PASSPHRASE, pack: 'services', folder: 'pottery' });
  await engine.request('venture.create', { idea: POTTER, countryCode: 'IN', workingName: 'Pune Handmade Pottery' });
  const agreed = listRecords(engine.vault!.read(), 'venture-model-connection')[0]!.consentedAt;
  return { engine, directory, agreed };
}

test('venture.ai.reuse is a draft method like the others: listed everywhere a draft method is', () => {
  assert.ok((DRAFT_METHODS as readonly string[]).includes('venture.ai.reuse'));
  assert.ok((ONBOARDING_METHODS as readonly string[]).includes('venture.ai.reuse'));
  assert.ok(BOOTSTRAP_ONLY_METHODS.includes('venture.ai.reuse'));
  assert.equal(METHOD_OWNERS['venture.ai.reuse'], 'models');
  assert.equal(METHOD_LEVEL_OF['venture.ai.reuse'], 'approve');
  assert.deepEqual(METHOD_HINTS['venture.ai.reuse'], { readOnly: false, undoable: true, idempotent: true, reachesOutside: false });
});

test('a second business: the AI already connected on this computer is connected in the new draft, and the business is kept with it', async t => {
  const { engine, agreed } = await firstBusiness(t);
  // While the first business is open the draft desk answers nothing, as before.
  await assert.rejects(engine.request('venture.ai.reuse', {}), code('VENTURE_EXISTS'));
  assert.equal((await engine.request('workspace.status', {})).folder, 'pottery');
  await engine.request('workspace.lock', {});
  assert.equal('folder' in await engine.request('workspace.status', {}), false);

  // A new draft starts with nothing connected; one request connects what the owner already uses.
  const empty = await engine.request('venture.ai.status', {}) as AiStatusView;
  assert.deepEqual(empty.connections, []);
  const reused = await engine.request('venture.ai.reuse', {}) as AiReuseView;
  assert.deepEqual(reused.reused, { from: 'Pune Handmade Pottery' });
  assert.equal(reused.scope, 'before-vault');
  assert.deepEqual(reused.connections.map(connection => [connection.presetId, connection.status]), [['claude-code-cli', 'connected']]);
  assert.deepEqual([reused.tiers.fast.presetId, reused.tiers.main.presetId, reused.tiers.main.usable], ['claude-code-cli', 'claude-code-cli', true]);
  assert.equal(engine.vault, null, 'nothing is kept yet');
  // Asked again it answers the same and connects nothing twice.
  const again = await engine.request('venture.ai.reuse', {}) as AiReuseView;
  assert.deepEqual([again.reused, again.connections.length], [{ from: 'Pune Handmade Pottery' }, 1]);
  // About you is the same conversation as the first business had: the reused AI reads the owner's words and answers
  // with offers, a way to earn and a team, before any vault.
  const read = await engine.request('venture.about.read', { text: AC }) as any;
  assert.deepEqual([read.source, read.idea, read.family.id, read.offers.map((offer: any) => offer.name)], ['ai', AC, 'local-services', ['Yearly AC contract']]);
  assert.deepEqual(read.way, WAY);
  assert.deepEqual(read.team.map((agent: any) => [agent.name, agent.digest]), [['Asha', teamCardDigest(SCOUT as never)]]);
  assert.equal(engine.vault, null, 'nothing is kept yet');

  // Keeping it: the new vault, the business, and the connection with the agreement given in the first business.
  await engine.request('workspace.create', { name: 'Lucknow Cool Care', passphrase: PASSPHRASE, pack: 'services', folder: 'cool-care' });
  const kept = await engine.request('venture.create', { idea: AC, countryCode: 'IN', workingName: 'Lucknow Cool Care' }) as any;
  assert.equal(kept.venture.workingName, 'Lucknow Cool Care');
  // The status names the open business's folder, so the window can come back to it after a new business is set up.
  assert.deepEqual([(await engine.request('workspace.status', {})).open, (await engine.request('workspace.status', {})).folder], [true, 'cool-care']);
  const state = engine.vault!.read();
  assert.deepEqual(listRecords(state, 'venture-model-connection').map(item => [item.presetId, item.status, item.consentDigest, item.consentedAt]),
    [['claude-code-cli', 'connected', presetSpec('claude-code-cli').consentDigest, agreed]]);
  assert.deepEqual(listRecords(state, 'venture-decision').filter(item => item.action === 'reuse-ai').map(item => [item.who, item.reason]), [['chausar', 'This business uses the same AI as Pune Handmade Pottery.']]);
  assert.equal((await engine.request('venture.models.status', {}) as any).tiers.main.presetId, 'claude-code-cli');
  // Nothing of the first business came along.
  assert.equal(JSON.stringify(state).includes('pottery by hand'), false);
  // The draft is over once the business exists.
  await assert.rejects(engine.request('venture.ai.status', {}), code('VENTURE_EXISTS'));

  // The plan card's team, way and needs are kept in the second business as in the first.
  const hired = await engine.request('venture.agents.hire.team', { agents: read.team }) as any;
  assert.deepEqual(hired.hired.map((view: any) => [view.role.name, view.status]), [['Asha', 'hired']]);
  assert.deepEqual((await engine.request('venture.owner.set', { way: WAY }) as any).way, WAY);
  assert.deepEqual((await engine.request('venture.owner.set', { needs: ['find-customers', 'payments'] }) as any).needs, ['find-customers', 'payments']);

  // Switching back to the first business just works, and it still has its own connection.
  await engine.request('workspace.lock', {});
  await engine.request('workspace.open', { folder: 'pottery', passphrase: PASSPHRASE });
  assert.equal((await engine.request('venture.get', {}) as any).venture.workingName, 'Pune Handmade Pottery');
});

test('nothing carries over when there is nothing safe to carry: a key, a gate that fails, changed words, or no business yet', async t => {
  // No business on this computer yet: nothing to reuse.
  const fresh = (await engineFor(t)).engine;
  assert.deepEqual([(await fresh.request('venture.ai.reuse', {}) as AiReuseView).reused, (await fresh.request('venture.ai.status', {}) as AiStatusView).connections], [null, []]);

  // A business that uses a key: the key stays in its own vault.
  const keyed = (await engineFor(t)).engine;
  const options = await keyed.request('venture.ai.options', {}) as AiOptionsView;
  await keyed.request('venture.ai.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: presetOf(options, 'anthropic-haiku-5-5').consentDigest, apiKey: TEST_KEY });
  await keyed.request('workspace.create', { name: 'Synthetic Key Studio', passphrase: PASSPHRASE, pack: 'services' });
  await keyed.request('venture.create', { idea: POTTER, countryCode: 'IN', workingName: 'Synthetic Key Studio' });
  await keyed.request('workspace.lock', {});
  const none = await keyed.request('venture.ai.reuse', {}) as AiReuseView;
  assert.deepEqual([none.reused, none.connections], [null, []]);

  // The words the owner agreed to changed since: connect again and read them.
  const { engine, directory } = await firstBusiness(t);
  await engine.request('workspace.lock', {});
  const path = join(directory, 'custody', 'ai-setup.json');
  const note = JSON.parse(await readFile(path, 'utf8'));
  note.connections[0].consentDigest = 'e'.repeat(64);
  await writeFile(path, JSON.stringify(note));
  const changed = await engine.request('venture.ai.reuse', {}) as AiReuseView;
  assert.deepEqual([changed.reused, changed.connections], [null, []]);

  // Claude Code's terms closed on this computer: it is not connected behind the owner's back.
  const first = await firstBusiness(t);
  await first.engine.request('workspace.lock', {});
  await first.engine.close();
  const closed = (await engineFor(t, { directory: first.directory, claudeCodeTerms: 'pending' })).engine;
  t.after(() => closed.close().catch(() => {}));
  const refused = await closed.request('venture.ai.reuse', {}) as AiReuseView;
  assert.deepEqual([refused.reused, refused.connections], [null, []]);
});

test('an AI the owner disconnected in the new draft does not come along, and is not connected again by itself', async t => {
  const { engine } = await firstBusiness(t);
  await engine.request('workspace.lock', {});
  const reused = await engine.request('venture.ai.reuse', {}) as AiReuseView;
  await engine.request('venture.ai.disconnect', { connectionId: reused.connections[0]!.id });
  assert.deepEqual((await engine.request('venture.ai.status', {}) as AiStatusView).connections.filter(connection => connection.status === 'connected'), []);
  await engine.request('workspace.create', { name: 'Synthetic No AI Studio', passphrase: PASSPHRASE, pack: 'services', folder: 'no-ai' });
  await engine.request('venture.create', { idea: AC, countryCode: 'IN', workingName: 'Synthetic No AI Studio' });
  const state = engine.vault!.read();
  assert.deepEqual(listRecords(state, 'venture-model-connection').filter(item => item.status === 'connected'), []);
  assert.deepEqual(listRecords(state, 'venture-decision').filter(item => item.action === 'reuse-ai'), []);
});

test('venture.create takes no reuseAi any more: the AI comes along through the draft, where the owner sees it', async t => {
  const { engine } = await firstBusiness(t);
  await engine.request('workspace.lock', {});
  await engine.request('workspace.create', { name: 'Synthetic Plain Studio', passphrase: PASSPHRASE, pack: 'services', folder: 'plain' });
  await assert.rejects(engine.request('venture.create', { idea: AC, countryCode: 'IN', reuseAi: true }), code('INVALID_VENTURE_REQUEST'));
});
