import test from 'node:test';
import assert from 'node:assert/strict';
import {readCareerBoard} from '../runtime/venture/playbooks/job-search-desk/boards.ts';
const gates={title:['analyst'],location:['Pune'],currency:'INR',minAnnualMinor:null};
test('career research reuses the permitted public board reader and labels index rows as incomplete job evidence',async()=>{
 const sent:string[]=[];const rows=await readCareerBoard('lever','studio',gates,{resolve:async()=>[{address:'142.250.1.10',family:4}],send:async target=>{sent.push(target.url.href);return {status:200,headers:{'content-type':'application/json'},body:Buffer.from(target.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':JSON.stringify([{id:'role-a',text:'Research analyst',categories:{location:'Pune'},hostedUrl:'https://jobs.lever.co/studio/role-a'}]))};}});
 assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].pay.status,'unverified');assert.equal(rows.evidence,'public-board-index');assert.equal(rows.fullJobTextRead,false);assert.ok(sent.some(url=>url.endsWith('/robots.txt')));
});
test('invalid or protected-trait board filters fail before network',async()=>{
 let calls=0;await assert.rejects(readCareerBoard('lever','studio',{...gates,title:['young women']},{resolve:async()=>{calls++;return [];}}));assert.equal(calls,0);
});
