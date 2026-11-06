import ts from 'typescript';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram(parsed.fileNames, parsed.options), checker = program.getTypeChecker();
const source = program.getSourceFile(resolve('platform/runtime/engine.ts'));
const engine = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'Engine');
const shapes = {};
for (const member of engine.members) {
  if (!member.name) continue;
  const name = member.name.getText(source);
  if (ts.isMethodDeclaration(member)) {
    const signature = checker.getSignatureFromDeclaration(member);
    shapes[name] = { kind: 'method', signature: checker.signatureToString(signature, member, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType), result: checker.typeToString(signature.getReturnType(), member, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType) };
  } else if (ts.isPropertyDeclaration(member)) shapes[name] = { kind: 'property', type: checker.typeToString(checker.getTypeAtLocation(member), member, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType) };
}
writeFileSync(process.argv[2], JSON.stringify(shapes,null,2)+'\n');
console.log(JSON.stringify({methods:Object.values(shapes).filter(x=>x.kind==='method').length,properties:Object.values(shapes).filter(x=>x.kind==='property').length}));
