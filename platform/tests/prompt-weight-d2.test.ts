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
