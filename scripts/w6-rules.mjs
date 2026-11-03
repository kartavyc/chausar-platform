// Repository-only checks. Never read developer credentials or scan historical documents.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const sourceFile = (text, file) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
  file.endsWith('.json') ? ts.ScriptKind.JSON : file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const literal = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) ? node.text : null;
const member = node => ts.isPropertyAccessExpression(node) ? node.name.text
  : ts.isElementAccessExpression(node) && node.argumentExpression ? literal(node.argumentExpression) : null;
const globalObject = node => ts.isIdentifier(node) && ['window', 'globalThis', 'self'].includes(node.text);
const visit = (root, fn) => { fn(root); ts.forEachChild(root, child => visit(child, fn)); };

/** This is a regression guard for browser language access, not a general JavaScript data-flow analyser. */
export function inspectUiSource(text, file = 'source.tsx') {
  const source = sourceFile(text, file), aliases = new Set(['navigator']);
  const navigatorObject = node => ts.isIdentifier(node) && aliases.has(node.text)
    || member(node) === 'navigator' && globalObject(node.expression);
  let changed;
  do {
    changed = false;
    visit(source, node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && navigatorObject(node.initializer) && !aliases.has(node.name.text)) {
        aliases.add(node.name.text); changed = true;
      }
    });
  } while (changed);
  let found = false;
  visit(source, node => {
    if (['language', 'languages'].includes(member(node)) && navigatorObject(node.expression)) found = true;
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && navigatorObject(node.initializer)) {
      if (node.name.elements.some(item => ['language', 'languages'].includes(item.propertyName ? item.propertyName.text : ts.isIdentifier(item.name) ? item.name.text : null))) found = true;
    }
  });
  return found ? ['browser-language-read'] : [];
}

// Match only parsed literal values. Patterns themselves and fragmented test constructions are not credentials.
const providers = [
  ['Anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['OpenAI', /\bsk-(?!ant-)[A-Za-z0-9_-]{32,}\b/],
  ['GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['Telegram', /\b[0-9]{6,12}:[A-Za-z0-9_-]{30,}\b/],
  ['Razorpay', /\brzp_(?:live|test)_[A-Za-z0-9]{14,}\b/],
];
export function inspectFixtureSource(text, file = 'fixture.ts') {
  const found = new Set();
  visit(sourceFile(text, file), node => {
    const value = literal(node);
    if (value !== null) for (const [provider, pattern] of providers) if (pattern.test(value)) found.add(provider);
  });
  return [...found].sort();
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) return [];
    const file = join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.(?:[cm]?js|tsx?|json)$/.test(file) ? [file] : [];
  });
}
/** Findings contain paths and rule/provider names only. No source text or credential value reaches test output. */
export function inspectRepository(root) {
  const ui = join(root, 'app/ui/src'), engineFixtures = join(ui, 'engine');
  const fixtureFiles = [...files(join(root, 'platform/tests')), ...files(join(root, 'app/ui/tests')),
    ...files(engineFixtures).filter(file => relative(engineFixtures, file).startsWith('fixtures'))];
  const findings = [];
  const add = (file, rules) => { for (const rule of rules) findings.push({ file: relative(root, file).split(sep).join('/'), rule }); };
  for (const file of files(ui).filter(file => /\.tsx?$/.test(file))) add(file, inspectUiSource(readFileSync(file, 'utf8'), file));
  for (const file of fixtureFiles) add(file, inspectFixtureSource(readFileSync(file, 'utf8'), file));
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
}
