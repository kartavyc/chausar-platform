import fs from 'node:fs';
import path from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
const require=createRequire(path.join(process.cwd(),'package.json')), ts=require('typescript');
const root=process.cwd(), contract=path.join(root,'platform/runtime/venture/contracts.ts'), source=fs.readFileSync(contract,'utf8');
const sf=ts.createSourceFile(contract,source,ts.ScriptTarget.Latest,true), values=[];
for(const st of sf.statements){if(st.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&(ts.isVariableStatement(st)||ts.isFunctionDeclaration(st))||ts.isExportDeclaration(st)&&!st.isTypeOnly)values.push(st.getText(sf).split('\n')[0]);}
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&!['node_modules','dist','.git'].includes(e.name)?walk(path.join(d,e.name)):e.isFile()&&/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(e.name)?[path.join(d,e.name)]:[]);
const importers=[];
for(const file of ['platform','app','scripts'].flatMap(d=>walk(path.join(root,d)))){const text=fs.readFileSync(file,'utf8'), parsed=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);for(const st of parsed.statements){if(!ts.isImportDeclaration(st)||!st.moduleSpecifier||!ts.isStringLiteral(st.moduleSpecifier))continue;const spec=st.moduleSpecifier.text;if(!spec.startsWith('.'))continue;const target=path.resolve(path.dirname(file),spec);if(target!==contract&&target+'.ts'!==contract)continue;const c=st.importClause;const type=c?.isTypeOnly||c?.namedBindings&&ts.isNamedImports(c.namedBindings)&&!c.name&&c.namedBindings.elements.every(e=>e.isTypeOnly);if(!type)importers.push(path.relative(root,file));}}
const strip=[];for(let i=0;i<3;i++){const start=performance.now();const output=stripTypeScriptTypes(source);strip.push({ms:performance.now()-start,bytes:Buffer.byteLength(output)});}
fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'d6-contract-before.json'),JSON.stringify({runtimeExports:values.length,valueImporters:[...new Set(importers)].length,values,importers:[...new Set(importers)],sourceBytes:Buffer.byteLength(source),strip},null,2));