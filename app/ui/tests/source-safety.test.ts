import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { checkCatalogs, checkCssSource, checkLocalModules, checkReadingBudget, checkTypeScriptSource, loadTypeScript, readingCeilings, resolveTypeScriptPath, staticButtonMessageIds } from '../../../scripts/check-ui-source.mjs';

const ts = await loadTypeScript();
const rules = (source: string, file = 'parts/Fixture.tsx') => new Set(checkTypeScriptSource(source, file, ts).map(item => item.rule));

test('real TypeScript lookup prefers explicit environment, then repo-local, then frozen workspace fallback', () => {
  const root = resolve(tmpdir(), 'chausar-ui-compiler-location');
  const local = resolve(root, 'node_modules/typescript/lib/typescript.js');
  const environmentPath = resolve(root, 'operators/typescript.js');
  assert.equal(resolveTypeScriptPath({ root, environment: { UI_TYPESCRIPT_PATH: ' operators/typescript.js ' }, fileExists: () => true }), environmentPath);
  assert.equal(resolveTypeScriptPath({ root, environment: {}, fileExists: path => path === local }), local);
  assert.equal(resolveTypeScriptPath({ root, environment: { UI_TYPESCRIPT_PATH: '   ' }, fileExists: () => true }), local);
  assert.match(resolveTypeScriptPath({ root, environment: {}, fileExists: () => false }), /task\/integration\/node_modules\/typescript\/lib\/typescript\.js$/);
  assert.equal(resolveTypeScriptPath({ root, environment: { UI_TYPESCRIPT_PATH: environmentPath }, fileExists: () => false }), environmentPath);
});

async function moduleFixture(files: Record<string, string>) {
  const base = mkdtempSync(join(tmpdir(), 'chausar-ui-module-check-'));
  try {
    const entries = Object.entries(files).map(([name, text]) => {
      const path = join(base, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      return { path, text };
    });
    return await checkLocalModules(entries.filter(entry => /\.tsx?$/.test(entry.path)), ts);
  } finally {
    const target = resolve(base);
    const allowed = resolve(tmpdir()) + sep;
    assert.ok(target.startsWith(allowed) && target.split(sep).at(-1)?.startsWith('chausar-ui-module-check-'));
    rmSync(target, { recursive: true, force: true });
  }
}

test('TSX syntax diagnostics are actual TypeScript parser diagnostics', () => {
  assert.ok(rules('export function Broken() { return <div>{; }</div>; }').has('typescript-syntax'));
  assert.equal(checkTypeScriptSource('export function View() { return <div />; }', 'parts/View.tsx', ts).length, 0);
});

test('components accept type-only presentation imports and callback intents', () => {
  const source = `import type { RowView } from '../bridge/presentation';
    import { type Figure } from '../bridge/presentation';
    export function View(props: { row: RowView; figure: Figure; onOpen: (id: string) => void }) {
      return <button onClick={() => props.onOpen(props.row.id)}>{props.row.title}</button>;
    }`;
  assert.deepEqual(checkTypeScriptSource(source, 'parts/View.tsx', ts), []);
  assert.ok(rules("import { request } from '../bridge/adapter'; request('dashboard.get');").has('part-bridge-import'));
});

test('network, storage, files, bridge calls and dynamic code are detected', () => {
  const found = rules(`import fs from 'node:fs';
    fetch('/api'); new WebSocket('wss://example.invalid');
    navigator.sendBeacon('/send'); localStorage.setItem('x','y');
    new FileReader(); showOpenFilePicker(); window.chausar.request('reports.get');
    eval('x'); new Function('return 1'); setInterval(() => {}, 100);`);
  for (const rule of ['forbidden-runtime-import', 'renderer-network', 'renderer-storage', 'renderer-files', 'renderer-bridge-call', 'dynamic-code', 'repeating-timer']) assert.ok(found.has(rule), rule);
  assert.ok(rules('const transport = require("node:fs");').has('forbidden-runtime-import'));
  assert.ok(rules('const transport = import("node:fs");').has('forbidden-runtime-import'));
  assert.ok(rules('export { readFile } from "node:fs";').has('forbidden-runtime-import'));
  assert.ok(rules('export * from "node:fs";').has('forbidden-runtime-import'));
  assert.ok(!rules('export type { Stats } from "node:fs";').has('forbidden-runtime-import'));
});

test('raw HTML and credential plumbing fail, source text nodes pass', () => {
  assert.ok(rules('element.innerHTML = source;').has('raw-html'));
  assert.ok(rules('export const View = () => <div dangerouslySetInnerHTML={{__html: source}} />;').has('raw-html'));
  assert.ok(rules('const accessToken = props.accessToken;').has('renderer-secret-plumbing'));
  assert.deepEqual(checkTypeScriptSource('export const View = (props: { title: string }) => <div>{props.title}</div>;', 'parts/View.tsx', ts), []);
});

test('exact amount conversion and aggregation fail while coordinate geometry passes', () => {
  assert.ok(rules('const money = Number(figure.paise);').has('unsafe-amount-number'));
  assert.ok(rules('const coordinate = Number(BigInt(exact));', 'parts/charts/scale.ts').has('unsafe-amount-number'));
  assert.ok(rules('const coordinate = Number(BigInt(digits));', 'parts/charts/scale.ts').has('unsafe-amount-number'));
  assert.ok(rules('const coordinate = Number((globalThis.BigInt(input)));', 'parts/charts/scale.ts').has('unsafe-amount-number'));
  assert.ok(rules('const coordinate = Number(BigInt(input) / denominator);', 'parts/charts/scale.ts').has('unsafe-amount-number'));
  assert.deepEqual(checkTypeScriptSource('const coordinate = Number(boundedPixelCoordinate);', 'parts/charts/scale.ts', ts), []);
  assert.ok(rules('const total = rows.reduce((sum, row) => sum + row.amountMinor, 0);').has('business-reduction'));
  assert.ok(rules('const after = figure.count - previous.count;').has('business-arithmetic'));
  assert.deepEqual(checkTypeScriptSource('const x = index * width; const y = height - coordinate; const next = rows.length - 1;', 'parts/charts/Coordinates.ts', ts), []);
});

test('structural length and local const dimensions pass without hiding monetary arithmetic', () => {
  const source = `function draw(width: number, height: number) {
    const LABEL_H = 18;
    const total = height + LABEL_H;
    const last = chart.values.length - 1;
    const lastFigure = figures['length'] - 1;
    return total - 4;
  }`;
  assert.deepEqual(checkTypeScriptSource(source, 'parts/charts/Fixture.ts', ts), []);
  assert.ok(rules('function business() { const total = receipt.totalMinor; return total - 4; }').has('business-arithmetic'));
  assert.ok(rules('function draw(height: number) { const total = height + 18; return total - 4; } function business(total: number) { return total - 4; }').has('business-arithmetic'));
  assert.ok(rules('function draw(height: number) { const total = height + 18; return () => { const total = figure.totalMinor; return total - 4; }; }').has('business-arithmetic'));
  assert.ok(rules('function draw(height: number) { let total = height + 18; return total - 4; }').has('business-arithmetic'));
  assert.ok(rules('const coordinate = Number(BigInt(exact));', 'parts/charts/Fixture.ts').has('unsafe-amount-number'));
});

test('typed safety is not silently suppressed', () => {
  assert.ok(rules('const value: any = unknownValue;').has('untyped-any'));
  assert.ok(rules('const value = unknownValue as any;').has('untyped-any'));
  assert.ok(rules('// @ts-ignore\nconst value = unknownValue;').has('type-suppression'));
  // Syntax is still checked in boundary modules, but renderer restrictions do not claim adapter qualification.
  assert.deepEqual(checkTypeScriptSource('fetch("/api");', 'bridge/adapter.ts', ts, { rendering: false }), []);
});

test('colors belong in tokens and reserved series names cannot become spacing', () => {
  assert.equal(checkCssSource(':root { --fg: #0B0D0E; }', 'tokens/tokens.css').length, 0);
  assert.equal(checkCssSource('.view { color: var(--fg); background: transparent; }', 'parts/View.module.css').length, 0);
  assert.equal(checkCssSource('.view { color: var(--red); }', 'parts/View.module.css').length, 0);
  assert.equal(checkTypeScriptSource('export const View = () => <path fill="var(--red)" />;', 'parts/View.tsx', ts).length, 0);
  assert.ok(checkCssSource('.view { color: #0B0D0E; }', 'parts/View.module.css').some(item => item.rule === 'literal-color'));
  assert.ok(checkCssSource('.view { color: red; }', 'parts/View.module.css').some(item => item.rule === 'literal-color'));
  assert.ok(checkCssSource(':root { --s1: 4px; }', 'tokens/tokens.css').some(item => item.rule === 'reserved-series-token'));
  assert.ok(rules('export const View = () => <path stroke="#0B0D0E" />;').has('literal-color'));
});

test('remote CSS resources and repeating animations fail; local fonts and once motion pass', () => {
  assert.ok(checkCssSource('@import url("https://example.invalid/font.css");', 'tokens/fonts.css').some(item => item.rule === 'remote-css-resource'));
  assert.ok(checkCssSource('@import "https://example.invalid/font.css";', 'tokens/fonts.css').some(item => item.rule === 'remote-css-resource'));
  assert.ok(checkCssSource('.view { background: url(//example.invalid/image.png); }', 'parts/View.module.css').some(item => item.rule === 'remote-css-resource'));
  assert.ok(checkCssSource('.view { animation: appear 200ms infinite; }', 'parts/View.module.css').some(item => item.rule === 'repeating-animation'));
  assert.ok(checkCssSource('.view { animation-iteration-count: 2; }', 'parts/View.module.css').some(item => item.rule === 'repeating-animation'));
  assert.deepEqual(checkCssSource('@font-face { font-family: "Instrument Sans"; src: url("../fonts/InstrumentSans.woff2"); }', 'tokens/fonts.css'), []);
  assert.deepEqual(checkCssSource('@import "./tokens.css";', 'tokens/index.css'), []);
  assert.deepEqual(checkCssSource('.view { animation: appear var(--t-press) 1; }', 'parts/View.module.css'), []);
});

test('chart series cannot use the Chausar green identity token', () => {
  assert.ok(checkCssSource('.bar { fill: var(--cha); }', 'parts/charts/Columns.module.css').some(item => item.rule === 'chart-green'));
  assert.ok(rules('export const Chart = () => <path stroke="var(--cha)" />;', 'parts/charts/Line.tsx').has('chart-green'));
  assert.deepEqual(checkCssSource('.square { background: var(--cha); }', 'parts/Square.module.css'), []);
});

test('English/Hindi parity includes nested message keys', () => {
  assert.deepEqual(checkCatalogs({ 'SH-01': { title: 'Today' } }, { 'SH-01': { title: 'आज' } }), []);
  assert.ok(checkCatalogs({ title: 'Today' }, {}).some(item => item.rule === 'catalogue-parity'));
  assert.ok(checkCatalogs({}, { title: 'आज' }).some(item => item.rule === 'catalogue-parity'));
});

test('copy punctuation, explicit banned list and button label limits use real text', () => {
  const found = checkCatalogs({ button: 'This label is far too long', note: 'Done! — ready', banned: 'Please leverage this' }, { button: 'खोलें', note: 'पूरा', banned: 'देखें' }, { buttonMessageIds: ['button'], banned: ['leverage'] });
  for (const rule of ['button-label-length', 'catalogue-punctuation', 'banned-copy']) assert.ok(found.some(item => item.rule === rule), rule);
  assert.equal(checkCatalogs({ button: 'a'.repeat(22) }, { button: 'a'.repeat(22) }, { buttonMessageIds: ['button'] }).length, 0);
  assert.ok(checkCatalogs({}, {}, { buttonMessageIds: ['button'] }).some(item => item.rule === 'button-message-missing'));
  assert.equal(checkCatalogs({ button: '{count, plural, one {Review item} other {Review items}}' }, { button: '{count, plural, one {देखें} other {देखें}}' }, { buttonMessageIds: ['button'] }).length, 0);
});

test('only literal localized action-button labels are statically identified', () => {
  const source = `export const View = () => <>
    <Button><T k="WK-02.button.approve" /></Button>
    <Button>{t('WK-02.button.notNow')}</Button>
    <Button><FormattedMessage id="WK-02.button.change" /></Button>
    <Button>{t(dynamicKey)}</Button>
    <p><T k="WK-02.title" /></p>
  </>;`;
  assert.deepEqual(staticButtonMessageIds(source, 'patterns/Approval.tsx', ts), ['WK-02.button.approve', 'WK-02.button.change', 'WK-02.button.notNow']);
});

test('real local module resolution follows named/type/default exports and aliases', async () => {
  const result = await moduleFixture({
    'data.ts': 'export interface Row { id: string } export const read = () => "ok"; export default read;',
    'barrel.ts': 'export { read as readRow, type Row } from "./data.ts"; export { default } from "./data.ts";',
    'view.ts': 'import readDefault, { readRow, type Row } from "./barrel.ts"; const row: Row = { id: readRow() };',
  });
  assert.deepEqual(result.findings, []);
  assert.ok(result.references.length >= 3);
});

test('missing local modules and drifted named exports fail while absent packages remain blockers', async () => {
  const result = await moduleFixture({
    'data.ts': 'export const read = () => "ok";',
    'view.ts': 'import { typo } from "./data.ts"; import { absent } from "./missing.ts"; import { runtime } from "operator-ui-runtime";',
  });
  assert.ok(result.findings.some(item => item.rule === 'local-module-not-found'));
  assert.ok(result.findings.some(item => item.rule === 'local-export-not-found'));
  assert.ok(result.externalDependencies.some(item => item.name === 'operator-ui-runtime' && !item.resolved));
});

test('cyclic export-star barrels reach a stable export table and never export a default implicitly', async () => {
  const result = await moduleFixture({
    'a.ts': 'export * from "./b.ts"; export * from "./c.ts";',
    'b.ts': 'export * from "./a.ts";',
    'c.ts': 'export const named = 1; export default named;',
    'view.ts': 'import { named } from "./b.ts"; import nope from "./a.ts";',
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, 'local-export-not-found');
  assert.match(result.findings[0].message, /default/);
});

test('names behind unresolved external export-star barrels are explicitly unverified', async () => {
  const result = await moduleFixture({
    'barrel.ts': 'export * from "operator-ui-runtime";',
    'view.ts': 'import { suppliedByOperator } from "./barrel.ts";',
  });
  assert.deepEqual(result.findings, []);
  assert.equal(result.unverifiedExports.length, 1);
  assert.equal(result.unverifiedExports[0].name, 'suppliedByOperator');
});

test('reading ceilings are inclusive, separate for each view and sheet', () => {
  for (const [view, ceiling] of Object.entries(readingCeilings)) {
    assert.equal(checkReadingBudget([{ id: view, view, language: 'en', text: 'word '.repeat(ceiling), primaryButtons: 1 }]).length, 0);
    assert.ok(checkReadingBudget([{ id: view, view, language: 'en', text: 'word '.repeat(ceiling + 1), primaryButtons: 1 }]).some(item => item.rule === 'reading-budget'));
  }
  assert.ok(checkReadingBudget([{ id: 'two-actions', view: 'guided', language: 'hi', text: 'देखें', primaryButtons: 2 }]).some(item => item.rule === 'primary-button-limit'));
  assert.ok(checkReadingBudget([{ id: 'not-rendered', view: 'guided', language: 'en', primaryButtons: 1 }]).some(item => item.rule === 'reading-fixture-shape'));
  assert.ok(checkReadingBudget([{ id: 'label', view: 'guided', language: 'en', text: 'Review', primaryButtons: 1, buttonLabels: ['a'.repeat(23)] }]).some(item => item.rule === 'button-label-length'));
  assert.ok(checkReadingBudget([null]).some(item => item.rule === 'reading-fixture-shape'));
});
