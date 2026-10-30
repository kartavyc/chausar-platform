import test from 'node:test';import assert from 'node:assert/strict';
import {parseDevSource,devCoverage} from '../runtime/venture/playbooks/dev-agency/source-core.ts';
import {npmAuditInput,npmAuditFindings} from '../runtime/venture/playbooks/dev-agency/scanners.ts';
const source={repository:'client/shop',revision:'a'.repeat(40),files:[{path:'src/cart.ts',content:'export const enabled = true;'}]};
test('only bounded current code snapshots enter the review, never path traversal, secrets or executable metadata',()=>{
 assert.equal(parseDevSource(JSON.stringify(source)).files[0]?.path,'src/cart.ts');
 for(const path of ['../escape.ts','C:/private.ts','.env','node_modules/a.js','.git/config'])assert.throws(()=>parseDevSource(JSON.stringify({...source,files:[{path,content:'private'}]})),{code:'DEV_SOURCE_INVALID'});
 assert.throws(()=>parseDevSource(JSON.stringify({...source,files:[{path:'app.ts',content:'const password = "'+'private-secret-123'+'";'}]})),{code:'DEV_SECRET_FOUND'});
 assert.equal(devCoverage(parseDevSource(JSON.stringify(source)),[]).complete,false);assert.equal(devCoverage(parseDevSource(JSON.stringify(source)),[{path:'src/cart.ts',first:1,last:1}]).complete,true);
});
test('npm audit preview has only approved package metadata and a fixed read-only command; malformed results never certify clean',()=>{
 const packageJson=JSON.stringify({name:'client-shop',version:'1.0.0',scripts:{postinstall:'do not execute'},dependencies:{example:'1.0.0'}}),lock=JSON.stringify({name:'client-shop',lockfileVersion:3,packages:{'':{name:'client-shop',dependencies:{example:'1.0.0'}},'node_modules/example':{version:'1.0.0'}}});
 const input=npmAuditInput(packageJson,lock);assert.equal(JSON.parse(input.packageJson).scripts,undefined);assert.deepEqual(input.args.slice(0,2),['audit','--json']);assert.ok(input.args.includes('--ignore-scripts'));assert.ok(!input.args.includes('fix'));assert.equal(input.registry,'https://registry.npmjs.org/');
 assert.throws(()=>npmAuditFindings('{}',0),{code:'DEV_SCAN_INVALID'});assert.throws(()=>npmAuditFindings(JSON.stringify({auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{total:0}}}),1),{code:'DEV_SCAN_INVALID'});
 const result=npmAuditFindings(JSON.stringify({auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{total:0}}}),0);assert.deepEqual(result,{findings:[],complete:true});
});
