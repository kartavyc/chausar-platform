/**
 * Headless source checks for the isolated frontend. This is deliberately not a
 * React typecheck, build, rendered DOM test, accessibility audit, or pixel test.
 * Uses the already installed TypeScript parser read-only; installs nothing.
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const frozenCompiler = 'C:/Users/karta/Documents/Codex/2026-10-01/task/integration/node_modules/typescript/lib/typescript.js';
const renderRoots = new Set(['app', 'parts', 'patterns', 'screens', 'tokens', 'views', 'text']);
const forbiddenModules = /^(?:node:|fs(?:\/|$)|path$|os$|http(?:s)?(?:\/|$)|net$|tls$|child_process$|worker_threads$|electron$|axios$|undici$|node-fetch$|cross-fetch$|ws$|socket\.io-client$|https?:|data:|blob:)/i;
const transportCalls = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon']);
const storageNames = new Set(['localStorage', 'sessionStorage', 'indexedDB', 'caches']);
const fileCalls = new Set(['FileReader', 'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker', 'createWritable', 'readAsText', 'readAsArrayBuffer', 'readAsDataURL']);
const rawHtmlNames = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'dangerouslySetInnerHTML', 'srcDoc']);
const secretNames = /^(?:apiKey|apiSecret|secret|privateKey|accessToken|refreshToken|authToken|authorization|bearerToken)$/i;
const amountNames = /^(?:amount|minor|paise|basisPoints|money|billed|received|revenue|profit|margin|balance|total|subtotal|count|figure)(?:s|Minor|Paise|Cents|Amount|Value)?$/i;
const colorLiteral = /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const namedColor = /\b(?:black|white|gray|grey|red|green|blue|magenta|violet|cyan|yellow|orange|purple|pink|brown|navy|teal|olive|silver|maroon|lime|aqua|fuchsia|rebeccapurple)\b/i;
const colorProperty = /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|accent-color|caret-color)$/i;
const arithmeticKinds = new Set(['PlusToken', 'MinusToken', 'AsteriskToken', 'SlashToken', 'PercentToken', 'AsteriskAsteriskToken', 'LessThanLessThanToken', 'GreaterThanGreaterThanToken', 'GreaterThanGreaterThanGreaterThanToken', 'PlusEqualsToken', 'MinusEqualsToken', 'AsteriskEqualsToken', 'SlashEqualsToken', 'PercentEqualsToken']);
export const readingCeilings = Object.freeze({ guided: 120, wide: 150, simple: 90, books: 170, sheet: 110 });
export const pendingRuntimeChecks = Object.freeze([
  'Separate full strict React typecheck and production build evidence; this static check alone does not verify them.',
  'Rendered English/Hindi main-area and sheet word counts, visible primary-button count, and labels.',
  'Receipt opening and keyboard access for every numeric chart mark, including missing-value gaps.',
  'Playwright browser/Electron journeys, 200 percent zoom, axe and human screen-reader checks.',
  'Approved reference pixel comparisons in both OS themes and all three views.',
  'Hindi review by a native reader and exact local font assets.',
]);

export function resolveTypeScriptPath({ root = defaultRoot, environment = process.env, fileExists = existsSync } = {}) {
  const configured = environment.UI_TYPESCRIPT_PATH?.trim();
  if (configured) return resolve(root, configured);
  const local = resolve(root, 'node_modules/typescript/lib/typescript.js');
  return fileExists(local) ? local : frozenCompiler;
}

export async function loadTypeScript(compilerPath = resolveTypeScriptPath()) {
  const imported = await import(pathToFileURL(resolve(compilerPath)).href);
  return imported.default ?? imported;
}

function portable(path) { return path.split(sep).join('/').replace(/\\/g, '/'); }
function withoutTokenReferences(value) { return value.replace(/var\(\s*--[\w-]+\s*\)/gi, ''); }
function isTokens(path) { return /(?:^|\/)tokens\//.test(portable(path)); }
function isChart(path) { return /(?:^|\/)charts\/|(?:^|\/)(?:Columns|OrderedBar|Chart|Line|Stat)\.(?:module\.)?(?:tsx?|css)$/i.test(portable(path)); }
function nodeName(node, ts) {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text;
  return '';
}
function financialReference(node, ts, { conversion = false, safeGeometryIdentifier = () => false } = {}) {
  let found = false;
  const visit = child => {
    // Collection/string length is structural metadata, not the values it contains.
    if (ts.isPropertyAccessExpression(child) && child.name.text === 'length') return;
    if (ts.isElementAccessExpression(child) && child.argumentExpression && ts.isStringLiteral(child.argumentExpression) && child.argumentExpression.text === 'length') return;
    if (ts.isIdentifier(child) && (amountNames.test(child.text) || (conversion && child.text === 'exact')) && !safeGeometryIdentifier(child)) found = true;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}
function containsBigIntParse(node, ts) {
  let found = false;
  const visit = child => {
    if (ts.isCallExpression(child) && nodeName(child.expression, ts) === 'BigInt') found = true;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** A narrow lexical check for const dimensions, not a TypeScript semantic/type analysis. */
function geometryIdentifierChecker(source, ts) {
  const bindings = new Map();
  const coordinateNames = new Set(['width', 'height', 'index', 'i', 'n', 'x', 'y', 'cx', 'cy', 'x0', 'coordinate', 'PAD', 'LABEL_H', 'BAR_H', 'GAP', 'BAR_MAX', 'BAR_RADIUS', 'HIT_RADIUS']);
  const isScope = node => ts.isBlock(node) || ts.isSourceFile(node) || ts.isFunctionLike(node);
  const scopeOf = node => {
    let parent = node.parent;
    while (parent && !isScope(parent)) parent = parent.parent;
    return parent;
  };
  const bind = (scope, name, value) => {
    if (!bindings.has(scope)) bindings.set(scope, new Map());
    bindings.get(scope).set(name, value);
  };
  const collect = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bind(scopeOf(node), node.name.text, { initializer: node.initializer, constant: ts.isVariableDeclarationList(node.parent) && Boolean(node.parent.flags & ts.NodeFlags.Const) });
    if (ts.isFunctionLike(node)) for (const parameter of node.parameters) if (ts.isIdentifier(parameter.name)) bind(node, parameter.name.text, { parameter: true });
    ts.forEachChild(node, collect);
  };
  collect(source);
  const bindingOf = identifier => {
    let node = identifier.parent;
    while (node) {
      const binding = bindings.get(node)?.get(identifier.text);
      if (binding) return binding;
      node = node.parent;
    }
    return null;
  };
  const geometry = (node, seen = new Set()) => {
    if (ts.isNumericLiteral(node)) return true;
    if (ts.isParenthesizedExpression(node) || ts.isPrefixUnaryExpression(node)) return geometry(node.expression ?? node.operand, seen);
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'length') return true;
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'length') return true;
    if (ts.isIdentifier(node)) {
      const binding = bindingOf(node);
      if (binding?.constant && binding.initializer && !seen.has(binding)) return geometry(binding.initializer, new Set([...seen, binding]));
      if (binding && !binding.parameter) return false;
      return coordinateNames.has(node.text);
    }
    if (ts.isBinaryExpression(node) && arithmeticKinds.has(ts.SyntaxKind[node.operatorToken.kind])) return geometry(node.left, seen) && geometry(node.right, seen);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Math' && ['min', 'max', 'floor', 'ceil', 'round', 'abs'].includes(node.expression.name.text)) return node.arguments.every(argument => geometry(argument, seen));
    return false;
  };
  return identifier => geometry(identifier);
}
function typeOnlyImport(node, ts) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  return !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
    && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(item => item.isTypeOnly);
}

export function checkTypeScriptSource(text, file, ts, { rendering = true } = {}) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const safeGeometryIdentifier = geometryIdentifierChecker(source, ts);
  const findings = [];
  const add = (rule, node, message) => {
    const start = typeof node === 'number' ? node : node.getStart(source);
    const position = source.getLineAndCharacterOfPosition(start);
    findings.push({ file: portable(file), line: position.line + 1, column: position.character + 1, rule, message });
  };
  for (const diagnostic of source.parseDiagnostics) add('typescript-syntax', diagnostic.start ?? 0, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  if (!rendering) return findings;
  for (const match of text.matchAll(/@ts-(?:ignore|nocheck)\b/g)) add('type-suppression', match.index, 'Do not suppress the typed presentation boundary.');
  const visit = node => {
    // Any is checked even inside types; other capability rules inspect runtime expressions.
    if (node.kind === ts.SyntaxKind.AnyKeyword) add('untyped-any', node, 'Frontend contracts must not use any.');
    if (ts.isTypeNode(node)) { ts.forEachChild(node, visitTypes); return; }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text;
      if (forbiddenModules.test(name) && !typeOnlyImport(node, ts)) add('forbidden-runtime-import', node, `Rendering source imports a host or transport module: ${name}.`);
      if (/(?:^|\/)parts\//.test(portable(file)) && /(?:^|\/)bridge(?:\/|$)/.test(name) && !typeOnlyImport(node, ts)) add('part-bridge-import', node, 'Parts may import presentation types, never a runtime bridge.');
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly));
      if (forbiddenModules.test(node.moduleSpecifier.text) && !typeOnly) add('forbidden-runtime-import', node, 'Rendering source must not re-export host or transport capabilities.');
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = nodeName(node.expression, ts);
      if ((name === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword) && node.arguments?.some(argument => ts.isStringLiteral(argument) && forbiddenModules.test(argument.text))) add('forbidden-runtime-import', node, 'Rendering source must not dynamically import a host or transport module.');
      if (transportCalls.has(name)) add('renderer-network', node, `${name} belongs outside rendering source.`);
      if (fileCalls.has(name)) add('renderer-files', node, `${name} belongs outside rendering source.`);
      if (name === 'eval' || name === 'Function') add('dynamic-code', node, 'Source text must never become executable code.');
      if (name === 'setInterval') add('repeating-timer', node, 'Rendering source must not start a repeating timer.');
      const expression = node.expression.getText(source);
      if (/\b(?:chausar(?:Engine)?|engine|bridge)\b.*\b(?:request|invoke|send|subscribe)\b/i.test(expression)) add('renderer-bridge-call', node, 'Rendering source receives props and callback intents, never bridge calls.');
      if (/^document\.(?:write|writeln)$/.test(expression) || /^.+\.parseFromString$/.test(expression)) add('raw-html', node, 'Source text must remain React text nodes, never parsed markup.');
      if (['Number', 'parseFloat', 'parseInt'].includes(name) && node.arguments?.some(argument => containsBigIntParse(argument, ts) || financialReference(argument, ts, { conversion: true }))) add('unsafe-amount-number', node, 'Do not directly convert freshly parsed BigInt or raw figure fields to floating-point numbers; normalize a bounded coordinate first.');
      if (name === 'reduce' && node.arguments?.some(argument => {
        let arithmetic = false;
        const find = child => {
          if (ts.isBinaryExpression(child) && arithmeticKinds.has(ts.SyntaxKind[child.operatorToken.kind])) arithmetic = true;
          ts.forEachChild(child, find);
        };
        find(argument);
        return arithmetic && /\b(?:sum|total|subtotal|amount|minor|paise|basisPoints|figure|count)\b/i.test(argument.getText(source));
      })) add('business-reduction', node, 'Do not aggregate business figures or rows in rendering source.');
    }
    if (ts.isIdentifier(node)) {
      if (storageNames.has(node.text)) add('renderer-storage', node, `${node.text} belongs outside rendering source.`);
      if (secretNames.test(node.text)) add('renderer-secret-plumbing', node, 'Rendering source must not hold credential or key fields.');
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isPropertyAssignment(node) || ts.isJsxAttribute(node)) {
      const name = ts.isPropertyAssignment(node) || ts.isJsxAttribute(node) ? nodeName(node.name, ts) : nodeName(node, ts);
      if (rawHtmlNames.has(name)) add('raw-html', node, `${name} can turn untrusted text into markup.`);
      if (secretNames.test(name)) add('renderer-secret-plumbing', node, 'Rendering source must not hold credential or key fields.');
    }
    if (ts.isBinaryExpression(node) && arithmeticKinds.has(ts.SyntaxKind[node.operatorToken.kind]) && (financialReference(node.left, ts, { safeGeometryIdentifier }) || financialReference(node.right, ts, { safeGeometryIdentifier }))) add('business-arithmetic', node, 'Business figure arithmetic belongs in the engine; chart geometry may use coordinate variables.');
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isTokens(file) && colorLiteral.test(node.text)) add('literal-color', node, 'Literal colors belong in the named tokens only.');
      const parent = node.parent;
      const propertyName = ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent) ? nodeName(parent.name, ts) : '';
      if (!isTokens(file) && colorProperty.test(propertyName) && namedColor.test(withoutTokenReferences(node.text))) add('literal-color', node, 'Named CSS colors belong in tokens; use a named token reference here.');
      if (ts.isJsxAttribute(parent) && /^(?:src|srcSet|poster|href)$/i.test(propertyName) && /^(?:https?:)?\/\//i.test(node.text)) add('remote-resource', node, 'Remote resources and external links must use the trusted shell boundary.');
      if (/\binfinite\b/i.test(node.text) && /animation/i.test(propertyName)) add('repeating-animation', node, 'Animations happen once.');
      if (isChart(file) && /var\(\s*--cha\s*\)/i.test(node.text)) add('chart-green', node, 'Green is reserved for Chausar identity squares; series use ink and grey.');
    }
    ts.forEachChild(node, visit);
  };
  const visitTypes = node => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) add('untyped-any', node, 'Frontend contracts must not use any.');
    ts.forEachChild(node, visitTypes);
  };
  visit(source);
  // One violation per rule/location, even when a property name is also an identifier.
  return findings.filter((item, index, all) => all.findIndex(other => other.rule === item.rule && other.line === item.line && other.column === item.column) === index);
}

export function checkCssSource(text, file) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, value => value.replace(/[^\n]/g, ' '));
  const findings = [];
  const add = (rule, index, message) => {
    const before = clean.slice(0, index);
    findings.push({ file: portable(file), line: before.split('\n').length, column: index - before.lastIndexOf('\n'), rule, message });
  };
  for (const match of clean.matchAll(/@import\s*['"](?:https?:|\/\/|data:)[^;]*|url\(\s*['"]?(?:https?:|\/\/|data:)[^)]*\)/gi)) add('remote-css-resource', match.index, 'CSS must use bundled local assets, never remote imports or URLs.');
  for (const match of clean.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const [, property, value] = match;
    if (!isTokens(file) && (colorLiteral.test(value) || (colorProperty.test(property) && namedColor.test(withoutTokenReferences(value))))) add('literal-color', match.index, 'CSS literal colors belong in tokens only.');
    if (/^--s[123]$/.test(property) && /\b[\d.]+(?:px|rem|em|vw|vh|%)\b/.test(value)) add('reserved-series-token', match.index, `${property} is reserved for a series hue, never spacing.`);
    if (/\binfinite\b/i.test(value) || (/^animation-iteration-count$/i.test(property) && value.split(',').some(part => Number(part.trim()) > 1))) add('repeating-animation', match.index, 'Animations happen once.');
    if (isChart(file) && /var\(\s*--cha\s*\)/i.test(value)) add('chart-green', match.index, 'Chart series must use ink/grey; green is reserved for identity squares.');
  }
  return findings;
}

/** Only literal message IDs inside the action Button component are identifiable statically. */
function literalButtonMessages(button, source, ts) {
  const messages = [];
  const readLabel = node => {
    if (ts.isCallExpression(node) && nodeName(node.expression, ts) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) messages.push({ id: node.arguments[0].text, node, kind: 'calls' });
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const name = node.tagName.getText(source);
      if (name === 'T' || name === 'FormattedMessage') {
        const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(source) === (name === 'T' ? 'k' : 'id'));
        if (attribute?.initializer && ts.isStringLiteral(attribute.initializer)) messages.push({ id: attribute.initializer.text, node, kind: 'elements' });
      }
    }
    ts.forEachChild(node, readLabel);
  };
  for (const child of button.children) readLabel(child);
  return messages;
}

export function staticButtonMessageIds(text, file, ts) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ids = new Set();
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Button') for (const { id } of literalButtonMessages(node, source, ts)) ids.add(id);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...ids].sort();
}

/**
 * The one documented local layer: FirstRunScreen -> FirstRunText -> its existing
 * FirstRun/Meanings components. This is a narrow JSX reachability check, not a
 * general React provider analysis. Unreachable buttons, other files and explicit
 * reading-fixture IDs remain shared. A shared caller of a scoped component also
 * requires its labels in the shared catalogue; local keys never form a global union.
 */
function firstRunButtonScopes(entries, references, src, ts) {
  const entryFile = resolve(src, 'screens/first-run/FirstRun.tsx');
  const providerFile = resolve(src, 'screens/first-run/text.tsx');
  const owned = new Set([entryFile, resolve(src, 'screens/first-run/Meanings.tsx')]);
  const sharedProviderFile = resolve(src, 'app/text.tsx');
  const resolvedImports = new Map(references.map(item => [`${resolve(item.importer)}\0${item.name}`, resolve(item.resolvedPath)]));
  const tables = new Map();
  for (const entry of entries) {
    if (!/\.tsx$/.test(entry.path)) continue;
    const source = ts.createSourceFile(entry.path, entry.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const table = { path: resolve(entry.path), source, imports: new Map(), declarations: new Map() };
    for (const node of source.statements) {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) table.declarations.set(node.name.text, node);
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer) table.declarations.set(declaration.name.text, declaration.initializer);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
        const module = node.moduleSpecifier.text;
        const target = resolvedImports.get(`${table.path}\0${module}`) ?? resolve(dirname(table.path), module);
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) if (!item.isTypeOnly) table.imports.set(item.name.text, { target, name: (item.propertyName ?? item.name).text, module });
        if (node.importClause?.name) table.imports.set(node.importClause.name.text, { target, name: 'default', module });
      }
    }
    tables.set(table.path, table);
  }
  const provider = tables.get(providerFile);
  const unwrap = node => node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) ? unwrap(node.expression) : node;
  const returned = declaration => declaration && ts.isFunctionDeclaration(declaration) && declaration.body?.statements.length === 1 && ts.isReturnStatement(declaration.body.statements[0]) ? unwrap(declaration.body.statements[0].expression) : null;
  const imported = (table, name, target, exported) => table?.imports.get(name)?.target === target && (!exported || table.imports.get(name)?.name === exported);
  const catalogueMap = (name, directory) => {
    const value = unwrap(provider?.declarations.get(name));
    return value && ts.isObjectLiteralExpression(value) && value.properties.length === 2 && ['en', 'hi'].every(language => {
      const property = value.properties.find(item => (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && nodeName(item.name, ts) === language);
      const initializer = property && (ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer);
      return initializer && ts.isIdentifier(initializer) && imported(provider, initializer.text, resolve(src, directory, `${language}.json`), 'default');
    });
  };
  const messages = returned(provider?.declarations.get('firstRunMessages'));
  const layeredMessages = messages && ts.isObjectLiteralExpression(messages) && messages.properties.length === 2 && messages.properties.every((property, index) => ts.isSpreadAssignment(property) && ts.isElementAccessExpression(property.expression) && ts.isIdentifier(property.expression.expression) && property.expression.expression.text === ['SHARED', 'LOCAL'][index] && property.expression.argumentExpression?.getText(provider.source) === 'language');
  const wrapper = returned(provider?.declarations.get('FirstRunText'));
  const intl = wrapper && ts.isJsxElement(wrapper) ? wrapper.children.find(child => ts.isJsxElement(child) && provider.imports.get(child.openingElement.tagName.getText(provider.source))?.module === 'react-intl' && provider.imports.get(child.openingElement.tagName.getText(provider.source))?.name === 'IntlProvider') : null;
  const messagesAttribute = intl?.openingElement.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(provider.source) === 'messages');
  const messagesCall = messagesAttribute?.initializer && ts.isJsxExpression(messagesAttribute.initializer) ? messagesAttribute.initializer.expression : null;
  const renderedChildren = node => node?.children?.filter(child => !ts.isJsxText(child) || child.text.trim());
  const children = renderedChildren(intl);
  const enclosedChildren = renderedChildren(wrapper)?.length === 1 && renderedChildren(wrapper)[0] === intl && children?.length === 1 && ts.isJsxExpression(children[0]) && children[0].expression && ts.isIdentifier(children[0].expression) && children[0].expression.text === 'children';
  const verifiedProvider = catalogueMap('SHARED', 'text') && catalogueMap('LOCAL', 'screens/first-run/text') && layeredMessages && wrapper && ts.isJsxElement(wrapper) && imported(provider, wrapper.openingElement.tagName.getText(provider.source), sharedProviderFile, 'TextProvider') && enclosedChildren && messagesCall && ts.isCallExpression(messagesCall) && messagesCall.expression.getText(provider.source) === 'firstRunMessages' && messagesCall.arguments.length === 1 && messagesCall.arguments[0].getText(provider.source) === 'language';
  const layeredLabels = new Set();
  const sharedLabels = new Set();
  const visited = new Set();
  const component = (table, name) => {
    if (table.declarations.has(name)) return { table, declaration: table.declarations.get(name), name };
    const binding = table.imports.get(name);
    const target = binding && owned.has(binding.target) ? tables.get(binding.target) : null;
    return target?.declarations.has(binding.name) ? { table: target, declaration: target.declarations.get(binding.name), name: binding.name } : null;
  };
  const intrinsicTag = tag => ts.isIdentifier(tag) && /^[a-z]/.test(tag.text);
  // Prove only direct JSX slot forwarding under DOM/fragment ancestors. A wrapper
  // with an unknown/provider ancestor may render its passed labels in another layer.
  const preservesSlot = (table, name, slot) => {
    const binding = table.imports.get(name);
    const target = table.declarations.has(name) ? table : binding && tables.get(binding.target);
    const declaration = target?.declarations.get(binding?.name ?? name);
    let uses = 0;
    let safe = Boolean(declaration?.body);
    const inspect = node => {
      if (ts.isIdentifier(node) && node.text === slot) {
        uses++;
        let rendered = false;
        for (let parent = node.parent; parent && parent !== declaration; parent = parent.parent) {
          if (ts.isJsxExpression(parent)) rendered = true;
          const tag = ts.isJsxElement(parent) ? parent.openingElement.tagName : ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) ? parent.tagName : null;
          if (ts.isFunctionLike(parent) || ts.isCallExpression(parent) || ts.isNewExpression(parent) || ts.isTaggedTemplateExpression(parent) || (tag && !intrinsicTag(tag))) safe = false;
        }
        // Aliases, calls and other non-JSX uses cannot prove a provider context.
        if (!rendered) safe = false;
      }
      ts.forEachChild(node, inspect);
    };
    if (declaration?.body) inspect(declaration.body);
    return safe && uses > 0;
  };
  const hasJsx = node => {
    let found = false;
    const inspect = child => {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) found = true;
      ts.forEachChild(child, inspect);
    };
    inspect(node);
    return found;
  };
  const walkComponent = (item, layered) => {
    const key = `${item.table.path}\0${item.name}\0${layered}`;
    if (visited.has(key)) return;
    visited.add(key);
    walk(item.declaration, item.table, layered, layered);
  };
  const walk = (node, table, layered, evaluated = layered, withinButton = false) => {
    if (ts.isJsxElement(node)) {
      const name = node.openingElement.tagName.getText(table.source);
      const binding = table.imports.get(name);
      if (binding?.target === providerFile && binding.name === 'FirstRunText') {
        for (const child of node.children) walk(child, table, Boolean(verifiedProvider), evaluated, withinButton);
        return;
      }
      if ((binding?.target === sharedProviderFile && binding.name === 'TextProvider') || (binding?.module === 'react-intl' && binding.name === 'IntlProvider')) {
        for (const child of node.children) walk(child, table, false, evaluated, withinButton);
        return;
      }
      if (name === 'Button') withinButton = true;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = opening.tagName.getText(table.source);
      if (!intrinsicTag(opening.tagName) && name !== 'T' && name !== 'FormattedMessage') {
        const slots = opening.attributes.properties.filter(item => ts.isJsxAttribute(item) && item.initializer && hasJsx(item.initializer)).map(item => item.name.getText(table.source));
        if (ts.isJsxElement(node) && renderedChildren(node)?.length) slots.push('children');
        const passedLayer = layered && slots.every(slot => preservesSlot(table, name, slot));
        const item = component(table, name);
        if (item) walkComponent(item, layered);
        walk(opening.attributes, table, passedLayer, evaluated, withinButton);
        if (ts.isJsxElement(node)) for (const child of node.children) walk(child, table, passedLayer, evaluated, withinButton);
        return;
      }
    }
    // t() runs in the owning component; JSX message components run below the nearest provider.
    if (withinButton && ts.isCallExpression(node) && nodeName(node.expression, ts) === 't') (evaluated ? layeredLabels : sharedLabels).add(`${table.path}\0${node.pos}\0calls`);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(table.source);
      if (withinButton && (name === 'T' || name === 'FormattedMessage')) (layered ? layeredLabels : sharedLabels).add(`${table.path}\0${node.pos}\0elements`);
      const item = component(table, name);
      if (item) walkComponent(item, layered);
    }
    ts.forEachChild(node, child => walk(child, table, layered, evaluated, withinButton));
  };
  const entry = tables.get(entryFile);
  const root = entry && component(entry, 'FirstRunScreen');
  if (root) walkComponent(root, false);
  // Direct JSX use from outside the configured subtree must not borrow its layer.
  for (const table of tables.values()) if (!owned.has(table.path) && table.path !== providerFile) walk(table.source, table, false);
  const result = { shared: new Set(), layered: new Set() };
  for (const table of tables.values()) {
    const collect = node => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(table.source) === 'Button') {
        for (const { id, node: label, kind } of literalButtonMessages(node, table.source, ts)) {
          const key = `${table.path}\0${label.pos}\0${kind}`;
          const scopes = layeredLabels.has(key) ? sharedLabels.has(key) ? [result.shared, result.layered] : [result.layered] : [result.shared];
          for (const scope of scopes) scope.add(id);
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(table.source);
  }
  return result;
}

/** Real TS resolution plus syntactic export tables; no semantic program or React stand-ins. */
export async function checkLocalModules(entries, ts, { compilerOptions = {} } = {}) {
  const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, allowImportingTsExtensions: true, resolveJsonModule: true, ...compilerOptions };
  const canonical = path => ts.sys.useCaseSensitiveFileNames ? resolve(path) : resolve(path).toLowerCase();
  const tables = new Map();
  const external = new Map();
  const findings = [];
  const references = [];
  const unverifiedExports = [];
  const localName = name => /^(?:\.{1,2}[\/\\]|[\/\\]|[a-zA-Z]:[\/\\])/.test(name);
  const add = (table, node, rule, message) => {
    const position = table.source.getLineAndCharacterOfPosition(node.getStart(table.source));
    findings.push({ file: portable(table.path), line: position.line + 1, column: position.character + 1, rule, message });
  };
  const exported = node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const defaultExport = node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  const boundNames = name => ts.isIdentifier(name) ? [name.text] : name.elements.flatMap(element => ts.isBindingElement(element) ? boundNames(element.name) : []);
  const parse = (path, text) => {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const table = { path, source, exports: new Set(), stars: [], unknownStar: false, refs: [] };
    tables.set(canonical(path), table);
    for (const node of source.statements) {
      if (exported(node)) {
        if (defaultExport(node)) table.exports.add('default');
        else if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) for (const name of boundNames(declaration.name)) table.exports.add(name);
        else if (node.name && ts.isIdentifier(node.name)) table.exports.add(node.name.text);
      }
      if (ts.isExportAssignment(node) && !node.isExportEquals) table.exports.add('default');
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const names = [];
        if (node.importClause?.name) names.push('default');
        if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) for (const item of node.importClause.namedBindings.elements) names.push((item.propertyName ?? item.name).text);
        table.refs.push({ node, name: node.moduleSpecifier.text, names, star: false });
      }
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) for (const item of node.exportClause.elements) table.exports.add(item.name.text);
        else if (node.exportClause && ts.isNamespaceExport(node.exportClause)) table.exports.add(node.exportClause.name.text);
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) table.refs.push({ node, name: node.moduleSpecifier.text, names: node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map(item => (item.propertyName ?? item.name).text) : [], star: !node.exportClause });
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) table.refs.push({ node, name: node.moduleReference.expression.text, names: [], star: false });
    }
    return table;
  };
  for (const entry of entries) parse(resolve(entry.path), entry.text);
  const queue = [...tables.values()];
  for (let index = 0; index < queue.length; index++) {
    const table = queue[index];
    for (const ref of table.refs) {
      const resolved = ts.resolveModuleName(ref.name, table.path, options, ts.sys).resolvedModule;
      if (!localName(ref.name) && (!resolved || resolved.isExternalLibraryImport)) {
        const previous = external.get(ref.name);
        external.set(ref.name, { name: ref.name, resolved: Boolean(resolved), importers: [...(previous?.importers ?? []), portable(table.path)] });
        if (ref.star) table.unknownStar = true;
        continue;
      }
      if (!resolved) {
        // CSS modules and JSON are actual source assets; TS may rely on a wildcard
        // CSS declaration. Their runtime/build semantics are not qualified here.
        const asset = resolve(dirname(table.path), ref.name);
        if (/\.(?:css|json)$/.test(ref.name) && existsSync(asset)) continue;
        add(table, ref.node, 'local-module-not-found', `TypeScript cannot resolve local module ${ref.name}.`);
        continue;
      }
      const targetPath = resolve(resolved.resolvedFileName);
      if (/\.json$/.test(targetPath)) continue;
      let target = tables.get(canonical(targetPath));
      if (!target) {
        target = parse(targetPath, await readFile(targetPath, 'utf8'));
        queue.push(target);
      }
      ref.target = target;
      references.push({ importer: portable(table.path), name: ref.name, resolvedPath: portable(targetPath) });
      if (ref.star) table.stars.push(target);
    }
  }
  // Fixpoint handles cycles between barrel files without declaring partial tables final.
  let changed = true;
  while (changed) {
    changed = false;
    for (const table of tables.values()) for (const target of table.stars) {
      if (target.unknownStar && !table.unknownStar) { table.unknownStar = true; changed = true; }
      for (const name of target.exports) if (name !== 'default' && !table.exports.has(name)) { table.exports.add(name); changed = true; }
    }
  }
  for (const table of tables.values()) for (const ref of table.refs) if (ref.target) for (const name of ref.names) {
    if (!ref.target.exports.has(name)) {
      if (ref.target.unknownStar) unverifiedExports.push({ importer: portable(table.path), module: ref.name, name, reason: 'External export-star requires dependency semantic checking.' });
      else add(table, ref.node, 'local-export-not-found', `${ref.name} does not declare or re-export ${name}.`);
    }
  }
  return { findings, references, externalDependencies: [...external.values()].map(item => ({ ...item, importers: [...new Set(item.importers)].sort() })).sort((a, b) => a.name.localeCompare(b.name)), unverifiedExports };
}

function flattenCatalog(value, path = '', result = {}) {
  if (typeof value === 'string') result[path] = value;
  else if (value && typeof value === 'object' && !Array.isArray(value)) for (const [key, entry] of Object.entries(value)) flattenCatalog(entry, path ? `${path}.${key}` : key, result);
  else throw new Error(`Catalogue entry ${path || '<root>'} must be a string or a message object.`);
  return result;
}

/** Supply explicit button message IDs from a fixture, not a guessed key naming convention. */
export function checkCatalogs(en, hi, { buttonMessageIds = [], banned = [] } = {}) {
  const catalogs = { en: flattenCatalog(en), hi: flattenCatalog(hi) };
  const findings = [];
  for (const language of ['en', 'hi']) {
    const other = language === 'en' ? 'hi' : 'en';
    for (const key of Object.keys(catalogs[language])) if (!(key in catalogs[other])) findings.push({ file: `text/${other}.json`, rule: 'catalogue-parity', message: `Missing message ${key}.` });
    for (const [key, message] of Object.entries(catalogs[language])) {
      if (/[\u2014!]/u.test(message)) findings.push({ file: `text/${language}.json`, rule: 'catalogue-punctuation', message: `${key} contains an em dash or exclamation mark.` });
      for (const term of banned) if (message.toLocaleLowerCase(language).includes(term.toLocaleLowerCase(language))) findings.push({ file: `text/${language}.json`, rule: 'banned-copy', message: `${key} contains a banned term: ${term}.` });
    }
    for (const key of buttonMessageIds) {
      const value = catalogs[language][key];
      if (value === undefined) findings.push({ file: `text/${language}.json`, rule: 'button-message-missing', message: `Button message ${key} does not exist.` });
      // The source length of an ICU template is not its rendered label length.
      else if (!/[{}]/.test(value) && [...value].length > 22) findings.push({ file: `text/${language}.json`, rule: 'button-label-length', message: `${key} exceeds 22 Unicode code points.` });
    }
  }
  return findings;
}

/** Counts complete, rendered fixture text only, including figures/labels/chart words. */
export function checkReadingBudget(cases) {
  const findings = [];
  for (const item of cases) {
    const ceiling = readingCeilings[item?.view];
    if (ceiling === undefined || typeof item?.text !== 'string' || !Number.isInteger(item?.primaryButtons) || item.primaryButtons < 0 || !['en', 'hi'].includes(item.language)) {
      findings.push({ file: 'tests/reading-budget-cases.json', rule: 'reading-fixture-shape', message: `${item?.id ?? '<unnamed>'} needs view, language, complete text, and a non-negative primaryButtons count.` });
      continue;
    }
    const count = [...new Intl.Segmenter(item.language, { granularity: 'word' }).segment(item.text)].filter(part => part.isWordLike).length;
    if (count > ceiling) findings.push({ file: 'tests/reading-budget-cases.json', rule: 'reading-budget', message: `${item.id}: ${count} words exceeds ${item.view}'s ${ceiling} word ceiling.` });
    if (item.primaryButtons > 1) findings.push({ file: 'tests/reading-budget-cases.json', rule: 'primary-button-limit', message: `${item.id}: ${item.primaryButtons} filled primary buttons exceeds one.` });
    if (item.buttonLabels !== undefined && (!Array.isArray(item.buttonLabels) || item.buttonLabels.some(label => typeof label !== 'string'))) findings.push({ file: 'tests/reading-budget-cases.json', rule: 'reading-fixture-shape', message: `${item.id}: buttonLabels must contain complete rendered strings.` });
    else for (const label of item.buttonLabels ?? []) if ([...label].length > 22) findings.push({ file: 'tests/reading-budget-cases.json', rule: 'button-label-length', message: `${item.id}: rendered button label exceeds 22 Unicode code points.` });
  }
  return findings;
}

async function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(entry => entry.isSymbolicLink() ? [] : entry.isDirectory() ? filesUnder(resolve(directory, entry.name)) : [resolve(directory, entry.name)]));
  return paths.flat().sort();
}

export async function checkUiSource({ root = defaultRoot, compilerPath } = {}) {
  const ts = await loadTypeScript(compilerPath ?? resolveTypeScriptPath({ root }));
  const src = resolve(root, 'app/ui/src');
  const files = await filesUnder(src);
  const findings = [];
  let syntaxFiles = 0;
  let renderFiles = 0;
  let cssFiles = 0;
  const sourceButtonIds = new Set();
  const moduleEntries = [];
  for (const file of files) {
    const path = portable(relative(src, file));
    const text = await readFile(file, 'utf8');
    const rendering = renderRoots.has(path.split('/')[0]);
    if (/\.tsx?$/.test(file)) {
      moduleEntries.push({ path: file, text });
      syntaxFiles++;
      if (rendering) renderFiles++;
      findings.push(...checkTypeScriptSource(text, path, ts, { rendering }));
      if (rendering && /\.tsx$/.test(file)) for (const id of staticButtonMessageIds(text, path, ts)) sourceButtonIds.add(id);
    } else if (/\.css$/.test(file) && rendering) {
      cssFiles++;
      findings.push(...checkCssSource(text, path));
    }
  }
  const pending = [...pendingRuntimeChecks];
  const tsconfig = resolve(root, 'app/ui/tsconfig.json');
  let compilerOptions = {};
  if (existsSync(tsconfig)) {
    const config = ts.readConfigFile(tsconfig, ts.sys.readFile);
    if (config.error) findings.push({ file: 'tsconfig.json', rule: 'tsconfig-syntax', message: ts.flattenDiagnosticMessageText(config.error.messageText, '\n') });
    else compilerOptions = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(tsconfig)).options;
  }
  const modules = await checkLocalModules(moduleEntries, ts, { compilerOptions });
  const buttonScopes = firstRunButtonScopes(moduleEntries.filter(entry => renderRoots.has(portable(relative(src, entry.path)).split('/')[0])), modules.references, src, ts);
  findings.push(...modules.findings.map(item => ({ ...item, file: portable(relative(src, item.file)) })));
  for (const dependency of modules.externalDependencies) if (!dependency.resolved) pending.push(`External import ${dependency.name} is unresolved; operator provisioning is required.`);
  if (modules.unverifiedExports.length) pending.push('Some local barrel exports depend on external export-star modules; those names require full dependency typechecking.');
  const enFile = resolve(src, 'text/en.json');
  const hiFile = resolve(src, 'text/hi.json');
  const budgetFile = resolve(root, 'app/ui/tests/reading-budget-cases.json');
  let budgetCases = [];
  if (existsSync(budgetFile)) {
    try {
      const parsed = JSON.parse(await readFile(budgetFile, 'utf8'));
      budgetCases = Array.isArray(parsed) ? parsed : parsed.cases;
      if (!Array.isArray(budgetCases)) throw new Error('Expected an array or { cases: [...] }.');
      findings.push(...checkReadingBudget(budgetCases));
    } catch (error) { findings.push({ file: 'tests/reading-budget-cases.json', rule: 'reading-fixture-json', message: String(error.message) }); }
  } else pending.push('No complete rendered reading-budget/button fixture JSON exists; those limits are not verified.');
  const catalogFiles = files.filter(file => /\.json$/i.test(file));
  const catalogs = new Map();
  for (const file of catalogFiles) {
    try { catalogs.set(file, JSON.parse(await readFile(file, 'utf8'))); }
    catch (error) { findings.push({ file: portable(relative(src, file)), rule: 'json-syntax', message: String(error.message) }); }
  }
  if (catalogs.has(enFile) && catalogs.has(hiFile)) {
    const bannedFile = resolve(src, 'text/banned.txt');
    const banned = existsSync(bannedFile) ? (await readFile(bannedFile, 'utf8')).split(/\r?\n/).map(value => value.trim()).filter(value => value && !value.startsWith('#')) : [];
    if (!existsSync(bannedFile)) pending.push('The authoritative text/banned.txt list is not present; banned terms are not verified.');
    const buttonMessageIds = [...new Set([...buttonScopes.shared, ...budgetCases.flatMap(item => Array.isArray(item?.buttonMessageIds) ? item.buttonMessageIds : [])])];
    try { findings.push(...checkCatalogs(catalogs.get(enFile), catalogs.get(hiFile), { buttonMessageIds, banned })); }
    catch (error) { findings.push({ file: 'text/en.json or text/hi.json', rule: 'catalogue-shape', message: String(error.message) }); }
    const localFiles = { en: resolve(src, 'screens/first-run/text/en.json'), hi: resolve(src, 'screens/first-run/text/hi.json') };
    if (catalogs.has(localFiles.en) || catalogs.has(localFiles.hi) || buttonScopes.layered.size) {
      try {
        const local = { en: flattenCatalog(catalogs.get(localFiles.en) ?? {}), hi: flattenCatalog(catalogs.get(localFiles.hi) ?? {}) };
        const shared = { en: flattenCatalog(catalogs.get(enFile)), hi: flattenCatalog(catalogs.get(hiFile)) };
        findings.push(...checkCatalogs(local.en, local.hi, { banned }).map(item => ({ ...item, file: `screens/first-run/${item.file}` })));
        const effective = { en: { ...shared.en, ...local.en }, hi: { ...shared.hi, ...local.hi } };
        for (const id of buttonScopes.layered) {
          const labelFindings = checkCatalogs(effective.en, effective.hi, { buttonMessageIds: [id] }).filter(item => item.rule.startsWith('button-'));
          findings.push(...labelFindings.map(item => {
            const language = item.file === 'text/en.json' ? 'en' : 'hi';
            const localMessage = id in local[language] || !(id in shared.en || id in shared.hi);
            return { ...item, file: localMessage ? `screens/first-run/${item.file}` : item.file };
          }));
        }
      } catch (error) { findings.push({ file: 'screens/first-run/text/en.json or screens/first-run/text/hi.json', rule: 'catalogue-shape', message: String(error.message) }); }
    }
    if (!buttonMessageIds.length && !buttonScopes.layered.size) pending.push('No literal action Button message IDs or explicit fixture IDs; 22-character button-label limits are not verified.');
    pending.push('Dynamic button labels and ICU values still require rendered button-label verification.');
  } else pending.push('Both text/en.json and text/hi.json are required before catalogue parity can be checked.');
  if (!renderFiles) pending.push('No rendering TS/TSX files exist yet; only currently present files were inspected.');
  return {
    status: findings.length ? 'static-checks-failed' : 'static-checks-passed',
    scope: 'Syntactic parsing and heuristic static source checks only; not full typechecking or runtime qualification.',
    compilerVersion: ts.version,
    inspected: { syntaxFiles, renderFiles, cssFiles, jsonFiles: catalogFiles.length, readingFixtures: budgetCases.length, staticButtonMessageIds: [...sourceButtonIds].sort(), sourceFiles: files.map(file => portable(relative(src, file))) },
    findings,
    modules: { checkedLocalReferences: modules.references.length, externalDependencies: modules.externalDependencies, unverifiedExports: modules.unverifiedExports },
    pending,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--root' && args[index + 1]) options.root = resolve(args[++index]);
    else if (args[index] === '--typescript' && args[index + 1]) options.compilerPath = resolve(args[++index]);
    else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  const result = await checkUiSource(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.findings.length ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`Source checker blocked: ${error.message}\n`);
    process.exitCode = 2;
  });
}
