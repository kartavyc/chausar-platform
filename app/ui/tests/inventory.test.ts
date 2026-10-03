import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const inventoryUrl = new URL('../design-screen-inventory.json', import.meta.url);
const inventory = JSON.parse(readFileSync(inventoryUrl, 'utf8'));
const root = new URL('../../../', import.meta.url);
const inputRoot = process.env.UI_DESIGN_INPUTS ? resolve(process.env.UI_DESIGN_INPUTS) : fileURLToPath(new URL('inputs/', root));
const source = (name: string) => readFileSync(resolve(inputRoot, name), 'utf8');
const sourceLines = (name: string) => source(name).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
const unique = (values: string[]) => [...new Set(values)];
const screen = (code: string) => {
  const result = inventory.screens.find((entry: { code: string }) => entry.code === code);
  assert.ok(result, `Missing screen ${code}`);
  return result;
};

test('all 123 source screen entries survive, with exact codes, titles and per-area counts', () => {
  const expectedAreas = { SH: 13, FR: 14, TD: 4, AS: 18, WK: 16, BK: 20, RP: 8, TL: 10, TR: 15, PH: 5 };
  assert.equal(inventory.screens.length, 123);
  assert.equal(new Set(inventory.screens.map((entry: { code: string }) => entry.code)).size, 123);
  assert.deepEqual(inventory.counts.areaCounts, expectedAreas);
  const expected = sourceLines('screens.md').flatMap(line => {
    const match = /^### ([A-Z]{2}-\d{2}) (.+)$/.exec(line);
    return match ? [{ code: match[1], title: match[2] }] : [];
  });
  assert.deepEqual(inventory.screens.map(({ code, title }: { code: string; title: string }) => ({ code, title })), expected);
  for (const [area, count] of Object.entries(expectedAreas)) {
    assert.deepEqual(inventory.screens.filter((entry: { area: string }) => entry.area === area).map((entry: { code: string }) => entry.code), Array.from({ length: count }, (_, index) => `${area}-${String(index + 1).padStart(2, '0')}`));
  }
});

test('every screen retains its exact source schedule and stated or explicitly inherited purpose', () => {
  const lines = sourceLines('screens.md');
  for (const entry of inventory.screens) {
    assert.equal(lines[entry.source.lineStart - 1], `### ${entry.code} ${entry.title}`);
    const section = lines.slice(entry.source.lineStart - 1, entry.source.lineEnd);
    assert.ok(section.includes(entry.schedule.sourceText), `Source schedule lost: ${entry.code}`);
    assert.equal(entry.schedule.scheduleStatus, 'source-plan-only');
    assert.ok(entry.effectivePurpose, `Source purpose lost: ${entry.code}`);
    if (entry.purpose !== null) assert.ok(section.includes(`- **For:** ${entry.purpose}`));
    else assert.equal(entry.effectivePurpose, screen(entry.purposeInheritedFrom).purpose);
  }
  assert.deepEqual(screen('TD-03').schedule.mentionedBuildDays, [1, 4, 5, 6]);
  assert.deepEqual(screen('SH-13').schedule.mentionedBuildDays, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(screen('AS-12').schedule.mentionedBuildDays, [5]);
  assert.equal(screen('WK-16').schedule.sourceText, 'Day 8, a proposal beyond the day files.');
  assert.equal(screen('AS-13').schedule.experimental, true);
});

test('inventory and proposed methods make no working-screen or live-engine claim', () => {
  assert.equal(inventory.status, 'planned-reference-inventory');
  assert.equal(inventory.implementationStatus, 'no-working-screen-or-live-method-claim');
  assert.match(inventory.contractBoundary.sourceText, /Nothing here is built/);
  assert.match(inventory.contractBoundary.sourceText, /recommendation/);
  assert.match(inventory.contractBoundary.sourceText, /engine's owners agree the final shape/);
  assert.equal(inventory.contractBoundary.existingEngineAvailability, 'not-evaluated-by-this-inventory');
  for (const entry of [...inventory.screens, ...inventory.enterpriseSurfaces, ...inventory.caScreens]) {
    assert.equal(entry.scope.status, 'planned-reference');
    assert.equal(entry.scope.implementationStatus, 'not-asserted');
    assert.equal(Object.hasOwn(entry, 'live'), false);
    assert.equal(Object.hasOwn(entry, 'implemented'), false);
  }
  const methods = inventory.proposedEngineMethods;
  assert.equal(new Set(methods.map((entry: { name: string }) => entry.name)).size, methods.length);
  for (const method of methods) {
    assert.equal(method.status, 'proposed');
    assert.equal(method.contractStatus, 'requires-engine-owner-agreement');
    const line = sourceLines('build.md')[method.source.line - 1];
    assert.ok(line.split('|')[1].includes(`\`${method.name}\``));
  }
});

test('direct engine references are exact source references, with reuse recorded separately', () => {
  const methods = new Set(inventory.proposedEngineMethods.map((entry: { name: string }) => entry.name));
  for (const entry of inventory.screens) {
    const expected = unique([...String(entry.engineSourceText ?? '').matchAll(/`([^`]+)`/g)].map(match => match[1]));
    assert.deepEqual(entry.engineMethodRefs.map((ref: { name: string }) => ref.name), expected);
    assert.equal(entry.engineContractStatus, 'proposed-screen-requirement');
    for (const ref of entry.engineMethodRefs) {
      assert.equal(ref.status, 'proposed');
      assert.ok(methods.has(ref.name), `Undocumented proposed method: ${entry.code} ${ref.name}`);
    }
  }
  assert.deepEqual(screen('AS-12').engineMethodRefs.map((ref: { name: string }) => ref.name), ['forecasts.run']);
  assert.deepEqual(screen('BK-04').engineMethodRefs, []);
  assert.deepEqual(screen('BK-04').engineInheritedFrom, ['FR-07']);
  assert.deepEqual(screen('BK-04').effectiveEngineMethodRefs, screen('FR-07').effectiveEngineMethodRefs);
  assert.deepEqual(screen('BK-18').engineInheritedFrom, ['WK-13']);
  assert.deepEqual(screen('TD-02').engineInheritedFrom, ['TD-01']);
  assert.ok(screen('TD-02').effectiveEngineMethodRefs.includes('briefs.saveClosing'));
  assert.ok(screen('TD-02').effectiveEngineMethodRefs.includes('briefs.tiles'));
  assert.equal(screen('AS-03').engineMappingStatus, 'not-specified');
});

test('all seven desktop places and every source sub-place remain available in the inventory', () => {
  assert.deepEqual(inventory.desktopNavigation.map((entry: { place: string }) => entry.place), ['Today', 'Ask', 'Work', 'Books', 'Reports', 'Tools', 'Trust']);
  assert.deepEqual(Object.fromEntries(inventory.desktopNavigation.map((entry: { place: string; subPlaces: string[] }) => [entry.place, entry.subPlaces])), {
    Today: ['Today', 'Activity'],
    Ask: ['New', 'Saved', 'Decisions', 'Checks', 'Not yet'],
    Work: ['Approvals', 'Jobs', 'Actions', 'What it can do'],
    Books: ['Sources', 'Meanings', 'Accounts', 'Customers', 'History', 'Memory'],
    Reports: ['Packs', 'The week ahead', 'Due dates', 'Exports'],
    Tools: ['Small apps', 'Plugins', 'Other assistants', 'Phone'],
    Trust: ['Rules', 'People', 'Models', 'Network', 'Record', 'Sharing', 'Vault'],
  });
});

test('expanded enterprise inventory preserves exact IDs, editions and all 176 surfaces', () => {
  assert.equal(inventory.enterpriseSurfaces.length, 176);
  assert.equal(new Set(inventory.enterpriseSurfaces.map((entry: { id: string }) => entry.id)).size, 176);
  assert.deepEqual(inventory.counts.enterpriseEditionCounts, { Both: 133, Enterprise: 26, 'Chausar only': 17 });
  const groupCounts = [9, 17, 13, 18, 5, 14, 13, 13, 13, 4, 9, 8, 4, 7, 25, 4];
  const expectedIds = groupCounts.flatMap((count, groupIndex) => Array.from({ length: count }, (_, index) => `A${groupIndex + 1}.${index + 1}`));
  assert.deepEqual(inventory.enterpriseSurfaces.map((entry: { id: string }) => entry.id), expectedIds);
  const lines = sourceLines('enterprise.md');
  for (const entry of inventory.enterpriseSurfaces) {
    const columns = lines[entry.source.line - 1].split('|').slice(1, -1).map(value => value.trim());
    assert.deepEqual([entry.declaredId, entry.title, entry.edition, entry.location, entry.builtFrom], columns);
  }
  assert.match(inventory.preservedRules.enterpriseNavigation.text, /\*\*Plans\*\*/);
  assert.match(inventory.preservedRules.enterpriseNavigation.text, /\*\*Cases\*\*/);
  assert.match(inventory.preservedRules.enterpriseNavigation.text, /\*\*Agents\*\*/);
  assert.match(inventory.preservedRules.enterpriseNavigation.text, /\*\*Companies\*\*/);
  assert.match(inventory.preservedRules.enterpriseNavigation.text, /\*\*Retention\*\*/);
  assert.match(inventory.preservedRules.enterpriseNavigation.text, /\*\*Licence\*\*/);
});

test('customer window and seventeen internal console surfaces remain rules-only and undrawn', () => {
  const internal = inventory.enterpriseSurfaces.filter((entry: { edition: string }) => entry.edition === 'Chausar only');
  assert.equal(internal.length, 17);
  for (const entry of internal) {
    assert.equal(entry.scope.audience, 'internal-only');
    assert.equal(entry.referenceCoverage, 'rules-only');
    assert.equal(entry.drawingStatus, 'not-drawn');
  }
  const customer = inventory.enterpriseSurfaces.find((entry: { id: string }) => entry.id === 'A12.1');
  assert.ok(customer);
  assert.equal(customer.referenceCoverage, 'rules-only');
  assert.equal(customer.drawingStatus, 'not-drawn');
  assert.equal(inventory.preservedRules.customerWindow.coverage, 'rules-only');
  assert.match(inventory.preservedRules.customerWindow.text, /leaves the drawing for later/);
  assert.match(inventory.preservedRules.customerWindow.text, /It never shows another customer's data/);
  assert.equal(inventory.preservedRules.internalConsoles.coverage, 'rules-only');
  assert.match(inventory.preservedRules.internalConsoles.text, /None of these shows customer content/);
});

test('all eleven CA screens retain separate client vaults and source-only post-day-ten timing', () => {
  assert.equal(inventory.caScreens.length, 11);
  assert.deepEqual(inventory.caScreens.map((entry: { code: string }) => entry.code), Array.from({ length: 11 }, (_, index) => `CA-${String(index + 1).padStart(2, '0')}`));
  assert.equal(new Set(inventory.caScreens.map((entry: { code: string }) => entry.code)).size, 11);
  for (const entry of inventory.caScreens) {
    assert.equal(entry.scope.edition, 'ca-console');
    assert.equal(entry.engineContractStatus, 'not-specified');
    assert.deepEqual(entry.engineMethodRefs, []);
    assert.equal(entry.schedule.afterDayTen, true);
    assert.deepEqual(entry.schedule.mentionedBuildDays, []);
    const columns = sourceLines('enterprise.md')[entry.source.line - 1].split('|').slice(1, -1).map(value => value.trim());
    assert.deepEqual([entry.code, entry.title, entry.shows], columns);
  }
  assert.match(inventory.preservedRules.caBoundary.text, /It holds no figure, no name of a client's customer, and no document/);
  assert.match(inventory.preservedRules.caBoundary.text, /The rail of the console/);
  assert.match(inventory.preservedRules.caBoundary.text, /There is no Ask and no Books at the firm's level/);
  assert.match(inventory.preservedRules.caBoundary.text, /the firm cannot add itself to a client/);
});

test('phone scope preserves five entries, headline-only boundaries and deferred PH-04', () => {
  const phone = inventory.screens.filter((entry: { area: string }) => entry.area === 'PH');
  assert.equal(phone.length, 5);
  assert.deepEqual(phone.map((entry: { code: string }) => entry.code), ['PH-01', 'PH-02', 'PH-03', 'PH-04', 'PH-05']);
  assert.deepEqual(screen('PH-01').schedule.mentionedBuildDays, [5, 9]);
  assert.deepEqual(screen('PH-04').schedule.mentionedBuildDays, []);
  assert.equal(screen('PH-04').schedule.afterDayTen, true);
  assert.match(screen('PH-04').details.Rules, /Figures and receipts stay on the computer/);
  assert.match(screen('PH-01').details.Rules, /no amounts, no names/i);
  assert.match(screen('PH-01').details.Rules, /expires after 30 minutes/);
  assert.match(screen('PH-02').details.Rules, /page holds no data/);
  assert.match(screen('PH-03').details.Shows, /Never "reply yes"/);
  assert.match(screen('PH-05').details.Rules, /nothing is stored before you confirm/);
  assert.match(screen('TL-09').details.States, /planned, not available yet/);
});

test('canonical source bytes and deterministic regeneration match the checked-in inventory', () => {
  for (const entry of inventory.sources) {
    assert.match(entry.file, /^inputs\/[\w.-]+\.md$/);
    const bytes = readFileSync(resolve(inputRoot, entry.file.slice('inputs/'.length)));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length, entry.lines);
  }
  const result = execFileSync(process.execPath, [fileURLToPath(new URL('scripts/generate-design-inventory.mjs', root)), '--check'], { cwd: fileURLToPath(root), encoding: 'utf8' });
  assert.match(result, /matches all four source documents/);
});
