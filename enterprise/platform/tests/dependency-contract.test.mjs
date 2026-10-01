import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

async function sources(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sources(file));
    else if (entry.isFile() && file.endsWith('.ts')) files.push(file);
  }
  return files;
}

function packageImports(source) {
  const imports = new Set();
  const add = value => {
    if (value.startsWith('.') || value.startsWith('/') || builtins.has(value)) return;
    imports.add(value.startsWith('@') ? value.split('/').slice(0, 2).join('/') : value.split('/')[0]);
  };
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
        && ts.isStringLiteral(node.argument.literal)) add(node.argument.literal.text);
    if (ts.isCallExpression(node) && node.arguments.length > 0
        && ts.isStringLiteral(node.arguments[0])
        && ((ts.isIdentifier(node.expression) && node.expression.text === 'require')
          || node.expression.kind === ts.SyntaxKind.ImportKeyword)) add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

test('production and script imports declare their packages directly', async () => {
  const missing = [];
  for (const directory of ['src', 'scripts']) {
    const declared = directory === 'src' ? manifest.dependencies
      : { ...manifest.dependencies, ...manifest.devDependencies };
    for (const file of await sources(path.join(root, directory))) {
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const name of packageImports(source)) {
        if (!Object.hasOwn(declared, name)) missing.push(`${path.relative(root, file)}: ${name}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'Imports must not rely on transitive dependency hoisting');
});

test('package-local lock agrees with every direct exact dependency pin', () => {
  for (const category of ['dependencies', 'devDependencies']) {
    assert.deepEqual(lock.packages[''][category], manifest[category], `Lock root ${category}`);
    for (const [name, version] of Object.entries(manifest[category])) {
      assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `${name} must have an exact pin`);
      assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} locked version`);
    }
  }
});
