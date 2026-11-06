// D2 tasks 14 to 16: the prompt-weight budget. What each AI call receives is held to "fixed instructions first, the
// changing parts after", so a provider's prompt cache can reuse the fixed part, and its size only shrinks.
import test from 'node:test';
import ts from 'typescript';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MODEL_PURPOSES } from '../runtime/venture/contract-values.ts';
import { instructionSites, VENTURE_ROOTS, shape } from './prompt-weight/static.ts';
import { FIXTURES, PASS_THROUGH, REGISTRY, WRAPPERS } from './prompt-weight/tasks.ts';
import { capture } from './prompt-weight/capture.ts';

const sites = instructionSites(WRAPPERS);
const covered = (file: string, purpose: string | null) => REGISTRY.some(builder => builder.site === file && (purpose === null || builder.purpose === purpose));

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(join(folder, entry.name))
    : entry.name.endsWith('.ts') ? [join(folder, entry.name)] : []);
}

test('part 1: every purpose literal on a model task belongs to a scanned site, and the registry is not stale', () => {
  const known = new Set<string>(MODEL_PURPOSES);
  const missing: string[] = [];
  for (const root of VENTURE_ROOTS) for (const path of sources(root)) {
    const file = relative(root, path).replaceAll('\\', '/');
    readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/purpose:\s*'([a-z-]+)'/g)) {
        if (!known.has(match[1])) continue; // record kinds and labels that share the word
        if (!sites.some(site => site.file === file && Math.abs(site.line - (index + 1)) <= 3)) missing.push(`${file}:${index + 1} ${match[1]}`);
      }
    });
  }
  assert.deepEqual(missing, [], 'a model task the scan did not find: build it with an instructions property next to its purpose');
  for (const builder of REGISTRY) {
    assert.ok(sites.some(site => site.file === builder.site && (site.purpose === builder.purpose || site.purpose === null)), `${builder.name}: ${builder.site} builds no ${builder.purpose} task`);
  }
  assert.equal(new Set(REGISTRY.map(builder => builder.name)).size, REGISTRY.length);
});

test('part 1: every site whose instructions go through a wrapper is run by a registry builder, or only passes a task through', () => {
  const unrun = sites.filter(site => site.verdict === 'wrapper' && !covered(site.file, site.purpose) && !PASS_THROUGH.some(item => item.file === site.file));
  assert.deepEqual(unrun.map(site => `${site.file}:${site.line} ${site.wrappers.join(',')}`), []);
});

test('part 1: the routes send the fixed instructions first, then the changing input', () => {
  for (const builder of REGISTRY) {
    const captured = capture(builder.build(FIXTURES.A));
    if (!captured.bodies) continue;
    const anthropic = JSON.parse(captured.bodies.anthropic), openai = JSON.parse(captured.bodies.openai), cli = JSON.parse(captured.bodies.claudeCli);
    assert.equal(anthropic.system, captured.instructions, builder.name);
    assert.equal(anthropic.messages[0].content, captured.input, builder.name);
    assert.equal(openai.instructions, captured.instructions, builder.name);
    assert.ok(cli.args.includes(captured.instructions), builder.name);
    assert.equal(cli.stdin, captured.input, builder.name);
  }
});

/** The string leaves of a value. */
function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) leaves(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) leaves(item, out);
  return out;
}

test('part 2: no instructions in the engine change from call to call, except through a reviewed wrapper', () => {
  assert.deepEqual(sites.filter(site => site.verdict === 'changing').map(site => `${site.file}:${site.line} ${site.why}`), [],
    'move the changing part into the input and keep a fixed line in the instructions');
});

test('part 2: every builder sends the same instructions for two different businesses, clients, dates and amounts', () => {
  const problems: string[] = [];
  for (const builder of REGISTRY) {
    const a = builder.build(FIXTURES.A), b = builder.build(FIXTURES.B);
    const variants = builder.variants?.();
    if (variants) {
      if (!variants.includes(a.instructions) || !variants.includes(b.instructions)) problems.push(`${builder.name}: a text outside its variants`);
    } else if (a.instructions !== b.instructions) problems.push(`${builder.name}: the instructions differ between the two contexts`);
    // What changes between the contexts must not reach the instructions: no changing ISO date or time, no changing
    // string of six characters or more, no changing number of three digits or more. (A fixed date, such as a protocol
    // version written in the instructions, is the same in both and is not a changing part.)
    const changingA = new Set(leaves(a.input)), leavesB = leaves(b.input), inB = new Set(leavesB);
    for (const value of inB) changingA.delete(value);
    const isoIn = (text: string) => (text.match(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}[:\d.]*Z?)?/g) ?? []).sort().join(' ');
    if (isoIn(a.instructions) !== isoIn(b.instructions)) problems.push(`${builder.name}: an ISO date or time that changes is in the instructions`);
    const numbersB = new Set(leavesB.flatMap(value => value.match(/\d{3,}/g) ?? []));
    for (const value of changingA) {
      if (value.length >= 6 && a.instructions.includes(value)) problems.push(`${builder.name}: the input value "${value.slice(0, 40)}" is in the instructions`);
      for (const number of value.match(/\d{3,}/g) ?? []) {
        if (!numbersB.has(number) && a.instructions.includes(number)) problems.push(`${builder.name}: the number ${number} from the input is in the instructions`);
      }
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test('part 3: each builder stays within its weight budget (baselines/prompt-weight.json), which only shrinks', async () => {
  const budget = JSON.parse(readFileSync(new URL('baselines/prompt-weight.json', import.meta.url), 'utf8')) as Record<string, Record<string, number | null>>;
  const { measure } = await import('../../scripts/prompt-weight.mjs');
  const over: string[] = [];
  for (const row of await measure() as Record<string, string | number | null>[]) {
    const limit = budget[row.name as string];
    if (!limit) { over.push(`${row.name}: no budget; run node scripts/prompt-weight.mjs --write-baseline and say why in the pull request`); continue; }
    for (const key of ['instructionChars', 'inputChars', 'schemaChars', 'toolManifestChars']) {
      if (row[key] === undefined || row[key] === null) continue;
      if (typeof limit[key] !== 'number' || (row[key] as number) > limit[key]!) over.push(`${row.name}: ${key} ${row[key]} is over its budget ${limit[key]}`);
    }
  }
  assert.deepEqual(over, [], 'a raise goes to the founder in the pull request, with its reason');
  for (const name of Object.keys(budget)) assert.ok(REGISTRY.some(builder => builder.name === name), `${name} is in the budget but not in the registry`);
});

test('the prompt guard follows fixed export-star constants but refuses changing, cyclic and ambiguous exports', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-prompt-forwarders-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtures: Record<string, string> = {
    'fixed.ts': "export const RULE = 'fixed instructions';",
    'changing.ts': 'export const RULE = Date.now().toString();',
    'other.ts': "export const RULE = 'other instructions';",
    'forward-fixed.ts': "export * from './fixed.ts';",
    'forward-changing.ts': "export * from './changing.ts';",
    'forward-cycle.ts': "export * from './cycle.ts';",
    'cycle.ts': "export * from './forward-cycle.ts';",
    'forward-ambiguous.ts': "export * from './fixed.ts'; export * from './other.ts';",
  };
  for (const [name, body] of Object.entries(fixtures)) await writeFile(join(directory, name), body);
  for (const kind of ['fixed', 'changing', 'cycle', 'ambiguous']) {
    const source = ts.createSourceFile(join(directory, kind + '-entry.ts'), `import { RULE } from './forward-${kind}.ts'; const instructions = RULE;`, ts.ScriptTarget.Latest, true);
    const declaration = source.statements.filter(ts.isVariableStatement)[0].declarationList.declarations[0];
    const result = shape(source, declaration.initializer!, new Map());
    assert.equal(result.fixed, kind === 'fixed', kind);
    if (kind === 'fixed') assert.equal(result.text, 'fixed instructions');
  }
});