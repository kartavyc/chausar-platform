import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

test('text ownership keeps shared, dynamic and cross-place keys initial, and isolates one-place text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-text-owners-'));
  try {
    for (const path of ['text/en', 'parts', 'places/money', 'places/clients']) await mkdir(join(root, path), { recursive: true });
    const catalogues = { common: { 'common.ok': 'OK' }, money: { 'money.total': 'Total' }, shared: { 'shared.name': 'Name' }, dynamic: { 'kind.one': 'One' }, cross: { 'cross.label': 'Label' } };
    for (const [name, words] of Object.entries(catalogues)) await writeFile(join(root, `text/en/${name}.json`), JSON.stringify(words));
    await writeFile(join(root, 'places/money/index.tsx'), "import './SharedCard'; const money = t('money.total'); const choice = t(`kind.${kind}`);");
    await writeFile(join(root, 'places/money/SharedCard.tsx'), "const title = t('cross.label');");
    await writeFile(join(root, 'places/clients/index.tsx'), "import '../money/SharedCard'; const label = 'shared.name';");
    await writeFile(join(root, 'parts/Card.tsx'), "const label = t('shared.name');");
    const result = spawnSync(process.execPath, [resolve('scripts/text-owners.mjs'), '--root', root, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const groups = Object.fromEntries(report.files.map((file: { file: string; group: string }) => [file.file, file.group]));
    assert.deepEqual(groups, { 'common.json': 'initial', 'cross.json': 'initial', 'dynamic.json': 'initial', 'money.json': 'money', 'shared.json': 'initial' });
    assert.deepEqual(report.files.find((file: { file: string }) => file.file === 'cross.json').owners, ['clients', 'money']);
    assert.ok(report.dynamicPrefixes.includes('kind.'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
