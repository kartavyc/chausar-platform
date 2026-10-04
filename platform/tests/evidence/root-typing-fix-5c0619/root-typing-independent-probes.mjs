import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
const checkout = resolve(process.argv[2] ?? 'first-run-root-typing-fix');
const parent = '5c0619dbce581f4329eab11521205e7fcfdcefbf';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['platform/runtime/ontology.ts','platform/tests/ontology-data-validation.test.ts','platform/runtime/contracts.ts','platform/runtime/compiled-calculation.ts','tsconfig.json'];
const pins = () => Object.fromEntries(paths.map(p=>[p,sha(readFileSync(resolve(checkout,p)))]));
const before = pins();
const git = spawnSync('git',['-c','safe.directory='+checkout.replaceAll('\\','/'),'show',parent+':platform/runtime/ontology.ts'],{cwd:checkout,maxBuffer:4*1024*1024});
assert.equal(git.status,0,git.stderr.toString());
const baselineText=git.stdout.toString('utf8'),fixedText=readFileSync(resolve(checkout,paths[0]),'utf8');
function runtimeModule(text) {
 let source=stripTypeScriptTypes(text,{mode:'strip'});
 for(const file of ['contracts.ts','compiled-calculation.ts']) source=source.replace("'./"+file+"'",JSON.stringify(pathToFileURL(resolve(checkout,'platform/runtime',file)).href));
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const [baseline,fixed]=await Promise.all([runtimeModule(baselineText),runtimeModule(fixedText)]);
const {initialState,hash}=await import(pathToFileURL(resolve(checkout,'platform/runtime/contracts.ts')).href);
const originalDate=globalThis.Date,fixedTime='2026-10-04T00:00:00.000Z';
class ProbeDate extends originalDate { constructor(...args){super(...(args.length?args:[fixedTime]));} static now(){return originalDate.parse(fixedTime);} }
globalThis.Date=ProbeDate;
const actor={memberId:'owner',role:'owner',epoch:1,channel:'desktop'};
class Store {
 constructor(state){this.state=structuredClone(state);this.writes=0;}
 read(){return structuredClone(this.state);}
 async update(work){const next=this.read();const result=await work(next);next.revision++;this.state=next;this.writes++;return result;}
}
const cases=[],results=[];
const add=(name,work,code=null,writes=code?0:1)=>cases.push({name,work,code,writes});
function initial(){const s=initialState('Synthetic independent typing comparison');s.workspace.id='workspace_typing_independent';s.workspace.createdAt=fixedTime;s.answers.push({id:'synthetic_answer',stale:false});s.receipts.push({id:'synthetic_receipt',stale:false});return s;}
const fresh=api=>structuredClone(api.starterPacks[0]);
add('dense frozen definitions',async c=>{Object.freeze(c.draft.definitions);return c.service.publish(actor,c.draft,{expectedCurrentHash:null,attemptId:'probe_dense'});});
add('direct reordered draft',async c=>c.service.publishPayload(actor,Object.fromEntries(Object.entries(c.draft).reverse())));
add('legacy draft wrapper',async c=>c.service.publishPayload(actor,{draft:c.draft}));
add('legacy pack wrapper',async c=>c.service.publishPayload(actor,{pack:'retail'}));
add('CAS draft wrapper',async c=>c.service.publishPayload(actor,{draft:c.draft,expectedCurrentHash:null,attemptId:'probe_cas_draft'}));
add('CAS pack wrapper',async c=>c.service.publishPayload(actor,{pack:'services',expectedCurrentHash:null,attemptId:'probe_cas_pack'}));
add('null prototype CAS wrapper',async c=>c.service.publishPayload(actor,Object.assign(Object.create(null),{pack:'services',expectedCurrentHash:null,attemptId:'probe_null_proto'})));
for(const [name,mutate]of [
 ['sparse index',c=>{delete c.draft.definitions[1];}],
 ['accessor index',c=>{const original=c.draft.definitions[1];Object.defineProperty(c.draft.definitions,'1',{enumerable:true,get(){c.getters++;return original;}});}],
 ['hidden index',c=>Object.defineProperty(c.draft.definitions,'1',{enumerable:false})],
 ['extra string index',c=>Object.defineProperty(c.draft.definitions,'extra',{value:true})],
 ['extra symbol index',c=>Object.defineProperty(c.draft.definitions,Symbol('extra'),{value:true})],
 ['custom array prototype',c=>Object.setPrototypeOf(c.draft.definitions,[])]
])add(name,async c=>{mutate(c);return c.service.publish(actor,c.draft,{expectedCurrentHash:null,attemptId:'probe_invalid_array'});},'INVALID_DICTIONARY');
for(const [name,payload,code]of [
 ['unknown wrapper field',c=>({pack:'retail',actor}), 'INVALID_DICTIONARY_OPTIONS'],
 ['both draft and pack',c=>({draft:c.draft,pack:'retail'}),'INVALID_DICTIONARY_OPTIONS'],
 ['nonstring pack',c=>({pack:7}),'INVALID_DICTIONARY_OPTIONS'],
 ['accessor wrapper',c=>Object.defineProperty({},'pack',{enumerable:true,get(){c.getters++;return 'retail';}}),'INVALID_DICTIONARY_OPTIONS'],
 ['inherited wrapper',c=>Object.assign(Object.create({inherited:true}),{pack:'retail'}),'INVALID_DICTIONARY_OPTIONS'],
 ['undefined draft preserves existing code',c=>({draft:undefined}),'UNKNOWN_PACK'],
 ['undefined reviewed baseline',c=>({draft:c.draft,expectedCurrentHash:undefined,attemptId:'probe_bad_baseline'}),'INVALID_DICTIONARY_OPTIONS']
])add(name,async c=>c.service.publishPayload(actor,payload(c)),code);
function withHistory(c,versions=[1,2],reverse=false){
 const history=versions.map((v,i)=>c.api.compileDictionary(c.api.starterPacks[i],v,'owner',fixedTime));if(reverse)history.reverse();
 c.store.state.ontology={current:structuredClone(history.at(-1)),history,publicationAttempts:[]};
 c.before=c.store.read();return history;
}
add('ordered history and next CAS',async c=>{const h=withHistory(c);const lookup=c.service.get(actor,{attemptId:'probe_absent'});assert.equal(lookup.attempt,null);return c.service.publish(actor,'services',{expectedCurrentHash:h.at(-1).hash,attemptId:'probe_ordered_next'});});
add('reversed self-hashed history',async c=>{withHistory(c,[1,2],true);return c.service.publish(actor,'services');},'INVALID_DICTIONARY_RECEIPT');
add('equal-version self-hashed history',async c=>{withHistory(c,[1,1]);return c.service.get(actor,{attemptId:'probe_equal_history'});},'INVALID_DICTIONARY_RECEIPT');
add('current differs from last history',async c=>{const h=withHistory(c);c.store.state.ontology.current=structuredClone(h[0]);c.before=c.store.read();return c.service.get(actor,{attemptId:'probe_wrong_current'});},'INVALID_DICTIONARY_RECEIPT');
add('tampered dictionary self-hash',async c=>{withHistory(c);c.store.state.ontology.history[0].label='Synthetic tampered content';c.before=c.store.read();return c.service.publish(actor,'retail');},'INVALID_DICTIONARY_RECEIPT');
add('deferred first explicit CAS',async c=>{c.store.state.ontology={current:null,history:[],firstRunReviewRequired:true};c.before=c.store.read();assert.equal(c.service.get(actor,{attemptId:'probe_deferred'}).attempt,null);return c.service.publishPayload(actor,{draft:c.draft,expectedCurrentHash:null,attemptId:'probe_deferred'});});
add('invalid deferred nonempty history',async c=>{const h=withHistory(c);c.store.state.ontology={current:null,history:[h[0]],firstRunReviewRequired:true};c.before=c.store.read();return c.service.get(actor,{attemptId:'probe_invalid_deferred'});},'INVALID_DICTIONARY_OPTIONS');
add('stale CAS preserves all state',async c=>{withHistory(c);return c.service.publishPayload(actor,{draft:c.draft,expectedCurrentHash:'0'.repeat(64),attemptId:'probe_stale_cas'});},'DICTIONARY_CONFLICT');
add('same retained attempt after supersession does not write',async c=>{
 const opts={expectedCurrentHash:null,attemptId:'probe_original'};const first=await c.service.publish(actor,c.draft,opts);
 await c.service.publish(actor,'services',{expectedCurrentHash:first.hash,attemptId:'probe_later'});
 c.before=c.store.read();const original=await c.service.publish(actor,c.draft,opts);assert.deepEqual(original,first);assert.deepEqual(c.store.read(),c.before);
 assert.equal(c.service.get(actor,{attemptId:opts.attemptId}).attempt.dictionaryHash,first.hash);return original;
},null,2);
add('changed retained attempt refuses without write',async c=>{
 const opts={expectedCurrentHash:null,attemptId:'probe_immutable'};await c.service.publish(actor,c.draft,opts);c.before=c.store.read();
 const altered=structuredClone(c.draft);altered.label='Synthetic changed review';return c.service.publish(actor,altered,opts);
},'DICTIONARY_ATTEMPT_REUSED',1);
function comparableState(state){const copy=structuredClone(state);copy.activity=copy.activity.map(({id,...rest})=>rest);return copy;}
async function run(api,test){
 const store=new Store(initial()),c={api,store,service:new api.OntologyService(store),draft:fresh(api),getters:0,before:store.read()};
 let value=null,code=null;
 try{value=await test.work(c);}catch(error){code=error.code??error.name;}
 assert.equal(code,test.code,test.name);assert.equal(store.writes,test.writes,test.name);
 assert.equal(c.getters,0,test.name+' getters');
 if(code)assert.deepEqual(store.read(),c.before,test.name+' changed state on refusal');
 if(value?.hash){assert.equal(value.hash,hash(Object.fromEntries(Object.entries(value).filter(([k])=>k!=='hash'))));}
 const outcome={code,value,state:comparableState(store.read()),writes:store.writes,getters:c.getters};
 return {outcome,summary:{code,writes:store.writes,version:value?.version??null,getters:c.getters,semanticDigest:hash(outcome)}};
}
try {
 for(const test of cases){
  try{const a=await run(baseline,test),b=await run(fixed,test);assert.deepEqual(b.outcome,a.outcome,test.name+' baseline/fixed delta');
   results.push({name:test.name,baseline:a.summary,fixed:b.summary,status:'passed'});
  }catch(error){results.push({name:test.name,status:'failed',error:error.stack??String(error)});}
 }
}finally{globalThis.Date=originalDate;}
const dependencies=JSON.parse(readFileSync(resolve('verification/root-typing-dependencies.json'),'utf8'));
let declarations=0;
for(const[p,expected]of Object.entries(dependencies.declarationSha256)){assert.equal(sha(readFileSync(resolve(dependencies.resolvedReadOnlyDependencyTree,p))),expected,p);declarations++;}
for(const[p,expected]of Object.entries(dependencies.compilerSha256))assert.equal(sha(readFileSync(resolve(checkout,'node_modules/typescript',p))),expected,p);
for(const[p,info]of Object.entries(dependencies.packages)){const raw=readFileSync(resolve(checkout,'node_modules',p,'package.json'));assert.equal(sha(raw),info.manifestSha256,p);assert.equal(JSON.parse(raw).version,info.version,p);}
const after=pins(),stable=JSON.stringify(before)===JSON.stringify(after),passed=results.filter(r=>r.status==='passed').length;
console.log(JSON.stringify({parent,checkout,before,after,sourceStable:stable,baselineGitBlobSourceSha256:sha(git.stdout),fixedRawSourceSha256:sha(Buffer.from(fixedText)),fixedLfSourceSha256:sha(Buffer.from(fixedText.replaceAll('\r\n','\n'))),dependencyDeclarationHashesVerified:declarations,dependencyCompilerBytesVerified:true,cases:results,passed,total:cases.length,result:stable&&passed===cases.length?'pass':'fail'},null,2));
process.exitCode=stable&&passed===cases.length?0:1;
