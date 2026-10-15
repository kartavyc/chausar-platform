// P6: the venture docs stay honest. The architecture page is the founder's document, copied as is, and its
// Connectors table claims exactly the modes the catalogue makes available today. Every venture doc keeps house style.
// Written in Phase B; it passes once the build package has landed (Phase C).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import { digest, houseStyleFindings, ventureAction } from '../runtime/venture/records.ts';
import type { ConnectorCard, ConnectorModeName, CountryProfile, VentureDeps, VentureRecord } from '../runtime/venture/contracts.ts';
import { createSecretShelf } from '../runtime/venture/host.ts';
import { VentureTestStore } from './venture-test-store.ts';

const docsFolder = new URL('../../docs/venture/', import.meta.url);
const lf = (text: string) => text.replace(/\r\n/g, '\n');

async function readOptional(url: URL): Promise<string | null> {
  try { return await readFile(url, 'utf8'); } catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
}

test('docs/venture/architecture.md is the architecture document, copied as is', async () => {
  const copy = await readFile(new URL('architecture.md', docsFolder), 'utf8');
  assert.match(copy, /^# Chausar B2C: target architecture/);
  const source = await readOptional(new URL('../../.b2c-work/ARCHITECTURE-B2C.md', import.meta.url));
  if (source !== null) assert.equal(lf(copy), lf(source));
});

test('every venture doc is free of em dashes and the banned words', async () => {
  const names = (await readdir(docsFolder)).filter(name => name.endsWith('.md'));
  assert.ok(names.includes('architecture.md') && names.includes('README.md') && names.includes('shell.md'));
  for (const name of names) {
    const findings = houseStyleFindings(await readFile(new URL(name, docsFolder), 'utf8'));
    assert.deepEqual(findings, [], `docs/venture/${name}`);
  }
});

/** The rows of the "## 6. Connectors" table: category, example names and the modes cell. */
function connectorRows(markdown: string): { category: string; examples: string[]; modes: string }[] {
  const lines = lf(markdown).split('\n');
  const start = lines.findIndex(line => /^## 6\. Connectors\b/.test(line));
  assert.ok(start >= 0, 'the architecture page has a Connectors section');
  const rows: { category: string; examples: string[]; modes: string }[] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|')) { if (inTable) break; continue; }
    inTable = true;
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map(cell => cell.trim());
    if (cells[0] === 'Category' || /^-+$/.test(cells[0].replace(/:/g, ''))) continue;
    rows.push({ category: cells[0], examples: cells[1].split(',').map(item => item.trim()).filter(Boolean), modes: cells[2] });
  }
  return rows;
}

/** Modes a cell claims are available: every handoff, read or write in a segment that does not start with "planned". */
function claimedModes(cell: string): Set<ConnectorModeName> {
  const claims = new Set<ConnectorModeName>();
  for (const segment of cell.split(';').map(part => part.trim())) {
    if (/^planned/i.test(segment)) continue;
    for (const match of segment.matchAll(/\b(handoff|read|write)\b/gi)) claims.add(match[1].toLowerCase() as ConnectorModeName);
  }
  return claims;
}

const plainName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();

/** The live catalogue, read through the real venture.connectors.list handler on a seeded test venture. */
async function catalogueCards(): Promise<ConnectorCard[]> {
  const build = await import('../runtime/venture/build/index.ts');
  const core = await import('../runtime/venture/core/index.ts');
  const country = core.listCountries().find((row: CountryProfile) => row.code === 'IN');
  assert.ok(country);
  const store = new VentureTestStore();
  const refuse = () => { throw new Error('The connector list must not use this.'); };
  const deps = {
    store, clock: () => new Date('2026-10-15T10:00:00.000Z'), secrets: createSecretShelf(), host: 'test', demo: true, storage: 'experimental-file',
    models: { status: refuse, presets: refuse, checkCli: refuse, generate: refuse, preview: refuse, runPreview: refuse },
    github: { kind: 'fixture', read: refuse },
    services: { calculator: { calculate: refuse, receipt: refuse }, ontology: { current: refuse, publish: refuse }, trust: { updatePolicy: refuse } },
  } as unknown as VentureDeps;
  const ctx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
  const idea = 'Monthly bookkeeping for cafes and small shops in Pune.';
  await ventureAction(deps, ctx, 'admin', 'create', tx => {
    const venture: VentureRecord = {
      ...tx.base('venture-record'), idea, ideaDigest: digest(idea), workingName: 'Ledger Cafe Books', country, serviceType: 'bookkeeping',
      status: 'interview', launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
    };
    tx.put(venture);
  }, { create: true });
  const list = build.handlers['venture.connectors.list'];
  assert.equal(typeof list, 'function');
  return await list!(deps, ctx, {}) as ConnectorCard[];
}

test('the architecture Connectors table claims exactly the modes the catalogue makes available', async () => {
  const cards = await catalogueCards();
  assert.equal(cards.length, 64);
  const rows = connectorRows(await readFile(new URL('architecture.md', docsFolder), 'utf8'));
  assert.equal(rows.length, 12, 'one row per connector category');
  for (const row of rows) {
    const matched = cards.filter(card => row.examples.some(item => item.toLowerCase() === plainName(card.name)));
    const claims = claimedModes(row.modes);
    for (const card of matched) {
      for (const mode of card.modes.filter(m => m.status === 'available')) {
        assert.ok(claims.has(mode.mode), `${row.category}: ${card.name} has ${mode.mode} available, but the table does not say so`);
      }
    }
    for (const claim of claims) {
      assert.ok(matched.some(card => card.modes.some(m => m.mode === claim && m.status === 'available')),
        `${row.category}: the table claims ${claim}, but no example it names has it available`);
    }
  }
});
