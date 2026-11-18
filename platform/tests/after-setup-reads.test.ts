// 15 Nov 2026 (the first walk of the built Windows app): Settings, About you failed two requests once a business
// existed. venture.compliance.get was refused by the host ("This venture request is not supported") and
// venture.about.families by the draft desk (VENTURE_EXISTS): both were treated as before-the-business methods only,
// while a screen the owner opens after setup reads them. The fake engine answered both, so no screen test saw it.
//
// This test walks the app's own source: every read (engine/reads.ts READS) that is one of the before-the-business
// methods (DRAFT_METHODS, PRE_VAULT_METHODS) and is named by a screen outside the first run must answer on a real engine
// with a business kept. A read a screen asks only while no business exists yet is listed below with the line that
// guards it, and that line is checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAFT_METHODS, PRE_VAULT_METHODS } from '../runtime/venture/contracts.ts';
import { outsideTables } from '../runtime/venture/host.ts';
import { engineFor, PASSPHRASE } from './fixtures/venture/compose-unit/harness.ts';

const UI = fileURLToPath(new URL('../../app/ui/src/', import.meta.url));
const posix = (path: string) => path.split(sep).join('/');

/** Every source file of the app, as [path under app/ui/src, text]. */
function sources(folder = UI): [string, string][] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry): [string, string][] => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [[posix(relative(UI, path)), readFileSync(path, 'utf8')]] : [];
  });
}

/** The methods the screens read (engine/reads.ts READS), from its text: the app's sources do not load under plain Node. */
function uiReads(): Set<string> {
  const text = readFileSync(join(UI, 'engine', 'reads.ts'), 'utf8');
  const list = /export const READS = \[([\s\S]*?)\] as const/.exec(text)?.[1] ?? '';
  return new Set([...list.matchAll(/'([a-zA-Z0-9.]+)'/g)].map(match => match[1]!));
}

/**
 * A before-the-business read a screen asks only while the open workspace has no business yet, with the file and the
 * line that guards it. After a business exists these refuse on purpose ("Your business already has its AI settings
 * under Trust."), and the screen reads venture.models.* instead.
 */
const ONLY_BEFORE: Record<string, { file: string; guard: string }> = {
  'venture.ai.status': { file: 'places/connections/YourAi.tsx', guard: "useResource(draft ? 'venture.ai.status' : 'venture.models.status'" },
  'venture.ai.options': { file: 'places/connections/YourAi.tsx', guard: "useResource('venture.ai.options', {}, { skip: !draft" },
};

/**
 * What a read needs to be asked with, where an empty request is not one. The side-work question with nothing recorded
 * and no profession named answers "Choose a profession." on purpose (Settings, About you reads that as "not picked
 * yet"), so it is asked here for a profession.
 */
const ASK_WITH: Record<string, unknown> = { 'venture.compliance.get': { profession: 'own-work' } };

/** The first run's own files, and the engine layer (types, the read list, the fake): neither is an after-setup screen. */
const firstRunOrEngine = (file: string) => file.startsWith('places/onboarding/') || file.startsWith('engine/');

test('every before-the-business read a screen asks after setup is answered with a business kept', async t => {
  const reads = uiReads();
  assert.ok(reads.size > 100, 'the read list was found');
  const before = [...new Set([...DRAFT_METHODS, ...PRE_VAULT_METHODS] as string[])].filter(method => reads.has(method));
  const files = sources().filter(([file]) => !firstRunOrEngine(file));
  const askedAfter = new Map<string, string[]>();
  for (const method of before) {
    const users = files.filter(([, text]) => text.includes(`'${method}'`)).map(([file]) => file);
    if (users.length) askedAfter.set(method, users);
  }
  // The walk is not empty: the two the Windows walk found are in it.
  assert.ok(askedAfter.has('venture.about.families'), 'Settings, About you reads the fields');
  assert.ok(askedAfter.has('venture.compliance.get'), 'Settings, About you reads the side-work question');

  for (const [method, { file, guard }] of Object.entries(ONLY_BEFORE)) {
    assert.deepEqual(askedAfter.get(method), [file], `${method} is asked after setup by ${file} alone`);
    assert.ok(files.find(([name]) => name === file)![1].includes(guard), `${file} asks ${method} only while no business exists`);
  }

  const { engine } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Pottery', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: 'I make pottery by hand, mostly mugs and bowls, for cafes in Pune.', countryCode: 'IN', workingName: 'Pottery' });
  const refused: string[] = [];
  for (const [method, users] of askedAfter) {
    if (ONLY_BEFORE[method]) continue;
    await engine.request(method, ASK_WITH[method] ?? {}).catch((error: { code?: string; message?: string }) => { refused.push(`${method} (${users.join(', ')}): ${error.code} ${error.message}`); });
  }
  assert.deepEqual(refused, [], 'a screen the owner opens after setup reads these');

  // And the ones that are refused on purpose still are, so the list above stays true.
  for (const method of Object.keys(ONLY_BEFORE)) await assert.rejects(engine.request(method, {}), { code: 'VENTURE_EXISTS' });
});

test('About you\'s fields are the same list before a business exists and after, and the host owns the read then', async t => {
  const { engine } = await engineFor(t);
  const before = await engine.request('venture.about.families', {}) as { families: { id: string; professions: unknown[] }[] };
  assert.ok(before.families.length > 5);
  await engine.request('workspace.create', { name: 'Pottery', passphrase: PASSPHRASE, pack: 'services' });
  // A workspace with no business yet: still the first run's answer.
  assert.deepEqual(await engine.request('venture.about.families', {}), before);
  await engine.request('venture.create', { idea: 'I make pottery by hand, mostly mugs and bowls, for cafes in Pune.', countryCode: 'IN', workingName: 'Pottery' });
  assert.deepEqual(await engine.request('venture.about.families', {}), before, 'Settings, About you lists the same fields');
  await assert.rejects(engine.request('venture.about.families', { more: true }), { code: 'INVALID_VENTURE_REQUEST' });
  assert.equal(outsideTables('venture.about.families'), false);
  // The rest of About you's first-run methods stay with the draft desk.
  for (const method of ['venture.about.read', 'venture.about.pick']) {
    assert.equal(outsideTables(method), true, method);
    await assert.rejects(engine.request(method, method.endsWith('pick') ? { familyId: 'local-services' } : { text: 'I fix air conditioners.' }), { code: 'VENTURE_EXISTS' });
  }
});
