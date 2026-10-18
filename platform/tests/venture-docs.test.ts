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

test('onboarding.md names every block id and view id, gives the ChatGPT row its exact words and its sources, and models.md describes the Claude Code gate', async () => {
  const contracts = await import('../runtime/venture/onboarding-contracts.ts');
  const onboarding = lf(await readFile(new URL('onboarding.md', docsFolder), 'utf8'));
  const blockIds = [
    ...contracts.OFFER_BLOCK_IDS, ...contracts.STEP_BLOCK_IDS, ...contracts.APPROVAL_BLOCK_IDS, ...contracts.PAGE_BLOCK_IDS,
    ...contracts.TOOL_BLOCK_IDS, ...contracts.QUESTION_BLOCK_IDS, ...contracts.NOTE_BLOCK_IDS,
  ];
  for (const id of blockIds) assert.ok(onboarding.includes(`\`${id}\``), `onboarding.md names the block ${id}`);
  for (const id of contracts.VIEW_IDS) assert.ok(onboarding.includes(`\`${id}\``), `onboarding.md names the view ${id}`);
  for (const view of contracts.VIEW_REGISTRY) assert.ok(onboarding.includes(view.heading), `onboarding.md gives the heading of ${view.id}`);
  assert.ok(onboarding.includes(contracts.AI_OPTION_WORDS['chatgpt-sign-in'].why), 'the ChatGPT row is described in its exact words');
  assert.ok(onboarding.includes('checked 18 Oct 2026'));
  for (const source of [
    'https://developers.openai.com/siwc',
    'https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites',
    'https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt',
    'https://openai.com/form/sign-in-with-chatgpt-interest/',
  ]) assert.ok(onboarding.includes(source), source);
  for (const words of [contracts.NOT_A_SERVICE_WORDS, contracts.COMPOSE_REFUSED_WORDS]) assert.ok(onboarding.includes(words), words);
  for (const method of contracts.ONBOARDING_METHODS) assert.ok(onboarding.includes(`\`${method}\``), `onboarding.md names ${method}`);
  assert.ok(onboarding.includes('CHAUSAR_PORT=4391') && onboarding.includes('.b2c-work/demo-data'), 'the demo runs on its own port and folder');

  const models = lf(await readFile(new URL('models.md', docsFolder), 'utf8'));
  const { AVAILABILITY_REASONS } = await import('../runtime/venture/models/presets.ts');
  assert.match(models, /^## The Claude Code terms gate$/m);
  assert.ok(models.includes('CHAUSAR_CLAUDE_CODE_TERMS'));
  assert.ok(models.includes(AVAILABILITY_REASONS.claudeTerms), 'models.md quotes the gate words the code shows');
  assert.ok(models.includes(contracts.AI_OPTION_WORDS.codex.why), 'models.md quotes the Codex words');

  const readme = lf(await readFile(new URL('README.md', docsFolder), 'utf8'));
  assert.ok(readme.includes('[onboarding.md](onboarding.md)'), 'README links the onboarding page');
  assert.equal(readme.includes('One question: "What service business do you want to start?"'), false, 'the journey no longer starts with the old question');
});

test('every relative link in the venture docs points at a file that exists', async () => {
  const names = (await readdir(docsFolder)).filter(name => name.endsWith('.md'));
  for (const name of names) {
    // Code spans and fenced blocks are not links.
    const text = lf(await readFile(new URL(name, docsFolder), 'utf8')).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      try { await readFile(new URL(target, new URL(name, docsFolder))); } catch (error: any) {
        if (error?.code === 'EISDIR') continue;
        assert.fail(`docs/venture/${name} links to ${match[1]}, which does not exist`);
      }
    }
  }
});

/** The onboarding v2 captures the spec asks for: fifteen screens, each in four variants. */
const ONBOARDING_SCREENS = [
  '40-pair', '41-connect', '42-connect-key', '43-open-box', '44-working', '45-plan-idea', '46-plan-skill', '47-plan-problem',
  '48-prices', '49-refused', '50-keep-safe', '51-recovery-code', '52-accept', '53-build', '54-welcome-back',
];
const VARIANTS = ['-light', '-dark', '-375-light', '-375-dark'];

test('the onboarding v2 captures are all there or none are, and the docs say they are pending while none are', async () => {
  const saved = new Set(await readdir(new URL('screens/', docsFolder)));
  const wanted = ONBOARDING_SCREENS.flatMap(screen => VARIANTS.map(variant => `${screen}${variant}.png`));
  assert.equal(wanted.length, 60);
  const present = wanted.filter(name => saved.has(name));
  // Every saved capture in the 40 to 54 range is one of the names above.
  for (const name of saved) if (/^(4\d|5[0-4])-/.test(name)) assert.ok(wanted.includes(name), `screens/${name} is not one of the spec's captures`);
  if (present.length === 0) {
    // Until the renderer package lands, the README says the captures are still to do.
    const readme = lf(await readFile(new URL('README.md', docsFolder), 'utf8'));
    assert.ok(readme.includes('Still to do, because they need the renderer package'), 'README says the captures are pending');
    return;
  }
  assert.deepEqual(wanted.filter(name => !saved.has(name)), [], 'once any capture is saved, all sixty are');
});

test('the venture docs cite no file from the local .b2c-work folder as a source, since a clone does not have it', async () => {
  const names = (await readdir(docsFolder)).filter(name => name.endsWith('.md') && name !== 'architecture.md');
  for (const name of names) {
    const text = lf(await readFile(new URL(name, docsFolder), 'utf8'));
    // The demo's own vault folder is the one .b2c-work path a reader is meant to type.
    for (const match of text.matchAll(/\.b2c-work\/[^\s`'")]+/g)) assert.equal(match[0], '.b2c-work/demo-data', `docs/venture/${name} cites ${match[0]}`);
  }
});
