/** Declaration-only projection of the engine contract using the installed TypeScript compiler. */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
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
    const lines = [];
    const namespaceOf = spec => target(spec, module.source);
    for (const statement of tree.statements) {
      if (ts.isImportDeclaration(statement)) {
        const name = namespaceOf(statement.moduleSpecifier.text), clause = statement.importClause;
        if (!clause) continue;
        if (clause.name) lines.push(`import ${clause.name.text} = ${name}.${name.startsWith('External') ? 'default' : '__default'};`);
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) lines.push(`import ${clause.namedBindings.name.text} = ${name};`);
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const row of clause.namedBindings.elements) lines.push(`import ${row.name.text} = ${member(name, row.propertyName?.text ?? row.name.text)};`);
        continue;
      }
      if (ts.isExportDeclaration(statement)) {
        const space = statement.moduleSpecifier ? namespaceOf(statement.moduleSpecifier.text) : null;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const row of statement.exportClause.elements) lines.push(`export import ${row.name.text === 'default' ? '__default' : row.name.text} = ${space ? member(space, row.propertyName?.text ?? row.name.text) : (row.propertyName?.text ?? row.name.text)};`);
        } else if (space) {
          const symbol = checker.getSymbolAtLocation(module.source.statements.find(row => ts.isExportDeclaration(row) && row.moduleSpecifier?.text === statement.moduleSpecifier.text)?.moduleSpecifier);
          if (!symbol) throw new Error(`Cannot resolve declaration exports: ${statement.moduleSpecifier.text}`);
          for (const row of checker.getExportsOfModule(symbol)) if (row.name !== 'default') lines.push(`export import ${row.name} = ${member(space, row.name)};`);
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
        const visit = node => {
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
