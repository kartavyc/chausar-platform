// D2 tasks 14 to 16: the prompt-weight budget. What each AI call receives is held to "fixed instructions first, the
// changing parts after", so a provider's prompt cache can reuse the fixed part, and its size only shrinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MODEL_PURPOSES } from '../runtime/venture/contracts.ts';
import { instructionSites, VENTURE } from './prompt-weight/static.ts';
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
  for (const path of sources(VENTURE)) {
    const file = relative(VENTURE, path).replaceAll('\\', '/');
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
