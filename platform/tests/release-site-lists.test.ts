import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFeatureLists, checkClaims, DEMOTION_REASON, parseLaneDoc, readEvidence, type Evidence } from '../../scripts/release/feature-lists.ts';

const cli = fileURLToPath(new URL('../../scripts/release/feature-lists.ts', import.meta.url));

async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-release-lists-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const connectorsDoc = `# connectors-ext

## Features

| Feature | Label | Notes |
|---|---|---|
| **Tally read** | **supported** | Tested on the demo shop. |
| \`Zoho Books\` read | \`Experimental\` | Needs a live account. |
| Shopify read | live service | not a label |

- **Bank statement PDF** reads any bank: **supported**
- GST matching: supported
- Razorpay read (experimental)
- The updater is supported only when the drill passed.

\`\`\`
| Inside a fence | supported |
\`\`\`

## Still missing

- Amazon settlement reports
- Form 26AS
`;

const proven = (feature: string, lane: string): Evidence => ({ feature, lane, bench: 'passed', hiddenCase: 'passed' });

test('parses table rows and list items with their labels and line numbers', () => {
  const parsed = parseLaneDoc(connectorsDoc, 'connectors-ext', 'docs/lanes/connectors-ext.md');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.items.map((item) => [item.name, item.labels, item.line]), [
    ['Tally read', ['supported'], 7],
    ['Zoho Books read', ['experimental'], 8],
    ['Bank statement PDF', ['supported'], 11],
    ['GST matching', ['supported'], 12],
    ['Razorpay read', ['experimental'], 13],
  ]);
  assert.deepEqual(parsed.later.map((item) => [item.text, item.line]), [['Amazon settlement reports', 22], ['Form 26AS', 23]]);
});

test('later headings are recognised in their common spellings', () => {
  for (const heading of ['## Gaps', '### Remaining gaps', '## What is still missing', '**Still missing:**']) {
    const parsed = parseLaneDoc(`# x\n\n${heading}\n\n- One thing\n\n## Next\n\n- Other: experimental\n`, 'x', 'x.md');
    assert.deepEqual(parsed.later.map((item) => item.text), ['One thing'], heading);
    assert.equal(parsed.items[0]?.name, 'Other');
  }
});

test('a feature with both labels is an error, inside one item or across lanes', () => {
  const one = buildFeatureLists({ a: '- **Sync** **supported** but also **experimental**\n' }, []);
  assert.equal(one.errors[0]?.code, 'FEATURE_BOTH_LABELS');
  assert.equal(one.errors[0]?.line, 1);
  const two = buildFeatureLists({ a: '- Sync: supported\n', b: '| Sync | experimental |\n' }, []);
  assert.equal(two.errors.length, 1);
  assert.equal(two.errors[0].code, 'FEATURE_BOTH_LABELS');
  assert.equal(two.errors[0].file, 'docs/lanes/b.md');
});

test('supported items without bench and hidden-case evidence are demoted to experimental', () => {
  const evidence = [proven('Tally read', 'connectors-ext'), { feature: 'GST matching', lane: 'connectors-ext', bench: 'passed', hiddenCase: null } as Evidence, proven('Bank statement PDF', 'other-lane')];
  const { lists, errors } = buildFeatureLists({ 'connectors-ext': connectorsDoc }, evidence);
  assert.deepEqual(errors, []);
  assert.deepEqual(lists.supported.map((feature) => feature.name), ['Tally read']);
  const demoted = lists.experimental.filter((feature) => feature.reason);
  assert.deepEqual(demoted.map((feature) => feature.name), ['Bank statement PDF', 'GST matching']);
  for (const feature of demoted) {
    assert.equal(feature.reason, DEMOTION_REASON);
    assert.equal(feature.claimed, 'supported');
    assert.equal(feature.lane, 'connectors-ext');
  }
  assert.deepEqual(lists.later.map((item) => item.lane), ['connectors-ext', 'connectors-ext']);
});

test('the CLI writes the four files and refuses parse errors', async (t) => {
  const directory = await scratch(t);
  const lanes = join(directory, 'lanes');
  await mkdir(lanes);
  await writeFile(join(lanes, 'connectors-ext.md'), connectorsDoc);
  const evidence = join(directory, 'evidence.json');
  await writeFile(evidence, JSON.stringify([proven('tally READ', 'connectors-ext')]));
  const out = join(directory, 'site', 'nested');
  const ok = spawnSync(process.execPath, [cli, '--lanes', lanes, '--evidence', evidence, '--out', out], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const lists = JSON.parse(await readFile(join(out, 'lists.json'), 'utf8'));
  assert.deepEqual(lists.supported.map((feature: { name: string }) => feature.name), ['Tally read']);
  assert.match(await readFile(join(out, 'supported.md'), 'utf8'), /^# Supported\n[\s\S]*- Tally read \(connectors-ext\)/);
  assert.match(await readFile(join(out, 'experimental.md'), 'utf8'), /GST matching \(connectors-ext; claimed supported, no bench and hidden-case evidence/);
  assert.match(await readFile(join(out, 'later.md'), 'utf8'), /- Form 26AS \(connectors-ext\)/);
  await writeFile(join(lanes, 'bad.md'), '| Sync | supported | experimental |\n');
  const bad = spawnSync(process.execPath, [cli, '--lanes', lanes, '--evidence', evidence, '--out', join(directory, 'other')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /bad\.md:1 FEATURE_BOTH_LABELS/);
});

test('missing evidence means nothing is proven, and malformed evidence is refused', async (t) => {
  const directory = await scratch(t);
  assert.deepEqual(await readEvidence(join(directory, 'none.json')), []);
  await writeFile(join(directory, 'bad.json'), JSON.stringify([{ feature: 'x', lane: 'y', bench: 'yes', hiddenCase: null }]));
  await assert.rejects(readEvidence(join(directory, 'bad.json')), { code: 'EVIDENCE_INVALID' });
});

test('the claims check flags an experimental feature without the word, and passes with it', () => {
  const { lists } = buildFeatureLists({ 'connectors-ext': connectorsDoc }, [proven('Tally read', 'connectors-ext')]);
  const flagged = checkClaims('Chausar reads Tally. It also handles Razorpay read for you.', lists);
  assert.deepEqual(flagged.map((finding) => [finding.kind, finding.feature]), [['experimental-unlabelled', 'Razorpay read']]);
  assert.deepEqual(checkClaims('Chausar reads Tally. Razorpay read is experimental.', lists), []);
  const html = checkClaims('<p>Form 26AS import works today.</p><p>Form 26AS is planned for later.</p>', lists, ['26']);
  assert.deepEqual(html.map((finding) => finding.kind), ['later-unlabelled']);
});

test('the claims check flags numbers that have no bench run', () => {
  const lists = { experimental: [], later: [] };
  const findings = checkClaims('The bench scored 48 of 50. It answers in 3 seconds.', lists, ['48', 50]);
  assert.deepEqual(findings.map((finding) => [finding.kind, finding.number]), [['unbacked-number', '3']]);
  assert.deepEqual(checkClaims('Scores: 1,200 rows checked.', lists, ['1200']), []);
});
