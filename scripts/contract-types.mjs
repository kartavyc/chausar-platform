/** Declaration-only projection of the engine contract using the installed TypeScript compiler. */
import ts from 'typescript';
import { writeFileSync } from 'node:fs';
import { dirname, resolve, relative, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'platform/runtime/venture/contracts.ts');
const inside = file => { const part = relative(root, file); return part && !part.startsWith('..') && !isAbsolute(part) && !part.split(/[\\/]/).includes('node_modules'); };
const canonical = file => resolve(file).replace(/\\/g, '/');
let cached;
export function contractDeclarations() { return cached ??= build(); }
function build() {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const options = { ...parsed.options, noEmit: false, declaration: true, emitDeclarationOnly: true, declarationMap: false, removeComments: true, noEmitOnError: false, outDir: join(tmpdir(), 'chausar-contract-virtual'), rootDir: root };
  const program = ts.createProgram([entry], options), checker = program.getTypeChecker();
  const modules = new Map();
  const result = program.emit(undefined, (_output, text, _bom, _onError, files) => {
    const source = files?.[0];
    if (source && inside(source.fileName)) modules.set(canonical(source.fileName), { source, text });
  }, undefined, true);
  const errors = result.diagnostics.filter(row => row.category === ts.DiagnosticCategory.Error);
  if (result.emitSkipped || errors.length) throw new Error(ts.formatDiagnostics(errors, { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n' }));
  for (const source of program.getSourceFiles()) if (source.isDeclarationFile && inside(source.fileName)) modules.set(canonical(source.fileName), { source, text: source.text });
  const ordered = [...modules].sort(([a], [b]) => a.localeCompare(b));
  for (const [index, [, module]] of ordered.entries()) module.name = `ContractModule${index}`;
  const external = new Map(), printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });
  function target(specifier, source) {
    const found = ts.resolveModuleName(specifier, source.fileName, options, ts.sys).resolvedModule;
    if (found && modules.has(canonical(found.resolvedFileName))) return modules.get(canonical(found.resolvedFileName)).name;
    if (specifier.startsWith('.')) throw new Error(`Unprojected local declaration: ${relative(root, source.fileName)} -> ${specifier}`);
    if (!external.has(specifier)) external.set(specifier, `ExternalContract${external.size}`);
    return external.get(specifier);
  }
  const member = (space, name) => `${space}.${name === 'default' ? '__default' : name}`;
  const print = (node, tree) => printer.printNode(ts.EmitHint.Unspecified, node, tree);
  const chunks = [];
  for (const [, module] of ordered) {
    const tree = ts.createSourceFile(module.source.fileName, module.text, ts.ScriptTarget.Latest, true);
    const lines = [], externalNames = new Map(), declaredExports = new Set();
    const localExports = new Set(tree.statements.filter(ts.isExportDeclaration).filter(row => !row.moduleSpecifier && row.exportClause && ts.isNamedExports(row.exportClause)).flatMap(row => row.exportClause.elements.map(item => item.propertyName?.text ?? item.name.text)));
    const namespaceOf = spec => target(spec, module.source);
    for (const statement of tree.statements) {
      if (ts.isImportDeclaration(statement)) {
        const name = namespaceOf(statement.moduleSpecifier.text), clause = statement.importClause;
        if (!clause) continue;
        if (name.startsWith('External')) {
          if (clause.name) externalNames.set(clause.name.text, `${name}.default`);
          if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) externalNames.set(clause.namedBindings.name.text, name);
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const row of clause.namedBindings.elements) externalNames.set(row.name.text, `${name}.${row.propertyName?.text ?? row.name.text}`);
          continue;
        }
        if (clause.name) lines.push(`import ${clause.name.text} = ${name}.${name.startsWith('External') ? 'default' : '__default'};`);
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) lines.push(`import ${clause.namedBindings.name.text} = ${name};`);
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const row of clause.namedBindings.elements) lines.push(`${localExports.has(row.name.text) ? 'export ' : ''}import ${row.name.text} = ${member(name, row.propertyName?.text ?? row.name.text)};`);
        continue;
      }
      if (ts.isExportDeclaration(statement)) {
        const space = statement.moduleSpecifier ? namespaceOf(statement.moduleSpecifier.text) : null;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const row of statement.exportClause.elements) {
            const original = row.propertyName?.text ?? row.name.text, exported = row.name.text === 'default' ? '__default' : row.name.text;
            if (declaredExports.has(exported)) continue;
            declaredExports.add(exported);
            if (!space && exported === original) continue;
            if (space) lines.push(`export import ${exported} = ${member(space, original)};`);
            else {
              const declaration = module.source.statements.find(item => ts.isExportDeclaration(item) && !item.moduleSpecifier && item.exportClause && ts.isNamedExports(item.exportClause) && item.exportClause.elements.some(value => value.name.text === row.name.text));
              const element = declaration?.exportClause.elements.find(value => value.name.text === row.name.text);
              let symbol = element && checker.getSymbolAtLocation(element.propertyName ?? element.name);
              if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
              if (symbol?.flags & ts.SymbolFlags.Value) lines.push(`export const ${exported}: typeof ${original};`);
              if (symbol?.flags & ts.SymbolFlags.Type) {
                const decl = symbol.declarations?.find(item => item.typeParameters?.length), params = decl?.typeParameters ?? [];
                const declarationParams = params.length ? `<${params.map(item => print(item, module.source)).join(', ')}>` : '';
                const argumentsParams = params.length ? `<${params.map(item => item.name.text).join(', ')}>` : '';
                lines.push(`export type ${exported}${declarationParams} = ${original}${argumentsParams};`);
              }
            }
          }
        } else if (space) {
          const symbol = checker.getSymbolAtLocation(module.source.statements.find(row => ts.isExportDeclaration(row) && row.moduleSpecifier?.text === statement.moduleSpecifier.text)?.moduleSpecifier);
          if (!symbol) throw new Error(`Cannot resolve declaration exports: ${statement.moduleSpecifier.text}`);
          for (const row of checker.getExportsOfModule(symbol)) if (row.name !== 'default' && !declaredExports.has(row.name)) { declaredExports.add(row.name); lines.push(`export import ${row.name} = ${member(space, row.name)};`); }
        }
        continue;
      }
      if (ts.isImportEqualsDeclaration(statement)) {
        if (ts.isExternalModuleReference(statement.moduleReference)) lines.push(`import ${statement.name.text} = ${namespaceOf(statement.moduleReference.expression.text)};`);
        else lines.push(print(statement, tree));
        continue;
      }
      if (ts.isExportAssignment(statement)) { lines.push(`export import __default = ${print(statement.expression, tree)};`); continue; }
      const transformed = ts.transform(statement, [context => {
        const entityName = name => {
          if (ts.isIdentifier(name)) {
            const mapped = externalNames.get(name.text);
            return mapped ? mapped.split('.').map(part => ts.factory.createIdentifier(part)).reduce((left, right) => ts.factory.createQualifiedName(left, right)) : name;
          }
          return ts.isQualifiedName(name) ? ts.factory.updateQualifiedName(name, entityName(name.left), name.right) : name;
        };
        const visit = node => {
          if (ts.isTypeReferenceNode(node)) return ts.factory.updateTypeReferenceNode(node, entityName(node.typeName), node.typeArguments?.map(arg => ts.visitNode(arg, visit)));
          if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression) && externalNames.has(node.expression.text)) { const parts = externalNames.get(node.expression.text).split('.'); const expression = parts.map(part => ts.factory.createIdentifier(part)).reduce((left, right) => ts.factory.createPropertyAccessExpression(left, right)); return ts.factory.updateExpressionWithTypeArguments(node, expression, node.typeArguments?.map(arg => ts.visitNode(arg, visit))); }
          if (ts.isTypeQueryNode(node)) return ts.factory.updateTypeQueryNode(node, entityName(node.exprName), node.typeArguments?.map(arg => ts.visitNode(arg, visit)));
          if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            const space = namespaceOf(node.argument.literal.text);
            const entity = node.qualifier ? ts.factory.createQualifiedName(ts.factory.createIdentifier(space), node.qualifier) : ts.factory.createIdentifier(space);
            return node.isTypeOf ? ts.factory.createTypeQueryNode(entity, node.typeArguments) : ts.factory.createTypeReferenceNode(entity, node.typeArguments?.map(arg => ts.visitNode(arg, visit)));
          }
          return ts.visitEachChild(node, visit, context);
        };
        return node => ts.visitNode(node, visit);
      }]);
      let text = print(transformed.transformed[0], tree).replace(/^export declare /, 'export ').replace(/^declare /, '');
      if (/^export default (?:class|function)/.test(text)) {
        text = text.replace(/^export default /, 'export ');
        const original = statement.name?.text;
        if (original) { lines.push(text, `export import __default = ${original};`); transformed.dispose(); continue; }
        text = text.replace(/^export (class|function)\b/, 'export $1 __default');
      }
      if (statement.name && localExports.has(statement.name.text) && !text.startsWith('export ')) text = `export ${text}`;
      lines.push(text); transformed.dispose();
    }
    chunks.push(`declare namespace ${module.name} {\n${lines.join('\n')}\n}`);
  }
  const rootModule = modules.get(canonical(entry));
  if (!rootModule) throw new Error('No declarations were emitted for venture contracts.');
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(rootModule.source));
  const aliases = [];
  for (const symbol of exports) {
    const actual = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    if (!(actual.flags & ts.SymbolFlags.Type)) continue;
    const declaration = actual.declarations?.find(row => ts.isTypeAliasDeclaration(row) || ts.isInterfaceDeclaration(row));
    if (declaration?.typeParameters?.length) continue;
    aliases.push(`export type ${symbol.name} = ${rootModule.name}.${symbol.name};`);
  }
  const imports = [...external].map(([specifier, name]) => `import type * as ${name} from ${JSON.stringify(specifier)};`);
  return `// Generated by scripts/gen-contract.mjs from engine declarations. Do not edit.\n${imports.join('\n')}\n${chunks.join('\n\n')}\n\n${aliases.sort().join('\n')}\n`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Use node scripts/contract-types.mjs.');
  const text = contractDeclarations();
  writeFileSync(join(root, 'app/ui/src/engine/contract.gen.ts'), text);
  process.stdout.write(`Generated ${Buffer.byteLength(text)} declaration bytes.\n`);
}
