// The screenshot harness waits for the actual page; a slow module graph is not a successful empty shot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const walk=readFileSync(new URL('../../scripts/ui-shots/walk.mjs',import.meta.url),'utf8');
const expression=walk.match(/const SETTLED = `([\s\S]*?)`;/)?.[1];
assert.ok(expression);
async function simulate(readyAt:number,blocked:'boot'|'loading'|'sheet'|null=null){
 let elapsed=0;
 const document={
  querySelector(selector:string){
   if(selector==='[data-boot]')return blocked==='boot'?{}:null;
   if(selector==='#root h1, #root [data-specimens]')return elapsed>=readyAt?{}:null;
   if(selector==='aside h2')return blocked==='sheet'?null:{};
   throw Error(`Unrecognised selector ${selector}`);
  },
  querySelectorAll(){return blocked==='loading'?[{textContent:'Loading'}]:[];},
  fonts:{ready:Promise.resolve()},getAnimations(){return [];},
 };
 const ready=await runInNewContext(expression!,{document,location:{hash:blocked==='sheet'?'#/team?sheet=agent:editor':''},setTimeout:(callback:()=>void,ms:number)=>{elapsed+=ms;callback();}});
 return {ready,elapsed};
}
test('walk permits a 44-second module load while keeping its readiness bound at 120 seconds',async()=>{
 assert.deepEqual(await simulate(44000),{ready:true,elapsed:44000});
 assert.deepEqual(await simulate(Infinity),{ready:false,elapsed:120000});
 assert.match(walk,/the page did not show its place within 120 s/);
});
test('walk never treats a boot screen, loading text or missing requested sheet as ready',async()=>{
 for(const blocked of ['boot','loading','sheet'] as const)assert.deepEqual(await simulate(0,blocked),{ready:false,elapsed:120000},blocked);
});
