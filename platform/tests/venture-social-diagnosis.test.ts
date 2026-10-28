import test from 'node:test';import assert from 'node:assert/strict';
import { diagnosePost, diagnosisCsv } from '../runtime/venture/playbooks/social/diagnosis.ts';
import { accountHealth, healthCsv } from '../runtime/venture/playbooks/social/health.ts';
test('diagnosis checks source figures before model prose, distinguishes typed values and rejects malformed exports',()=>{
 const result=diagnosePost({durationMs:20000,hookMs:5000,averageWatchMs:4000,retention:[{atMs:0,viewers:100},{atMs:5000,viewers:40}],source:'typed-by-you'});
 assert.equal(result.source,'typed-by-you');assert.equal(result.dropOffMs,5000);assert.deepEqual(result.findings,['hook-too-long','length-above-watch']);assert.equal(result.modelLabel,'model estimate');
 assert.equal(diagnosisCsv('durationMs,hookMs,averageWatchMs\n20000,1000,12000').source,'export');
 assert.throws(()=>diagnosisCsv('durationMs,hookMs,averageWatchMs\n20000,?,12000'),{code:'SOCIAL_INPUT_INVALID'});
 assert.throws(()=>diagnosePost({...result,durationMs:1000,hookMs:2000,averageWatchMs:0,retention:[],source:'export'} as any),{code:'SOCIAL_INPUT_INVALID'});
});
test('health tags every fact, keeps missing unknown and counts only the thirty day window',()=>{
 const h=accountHealth({now:'2026-10-28',openedOn:'2026-10-01',followers:null,posts:[{on:'2026-10-28',failed:false},{on:'2026-09-01',failed:true}],source:'export'});
 assert.equal(h.followers.value,null);assert.equal(h.followers.source,'check-in-app');assert.equal(h.accountAgeDays.value,27);assert.equal(h.posts30.value,1);assert.equal(h.failures.value,0);
});

test('health CSV keeps exported account facts and derives its thirty-day counts',()=>{const value=healthCsv('followers,openedOn,postDate,failed\n25,2026-10-01,2026-10-20,false','2026-10-28');assert.equal(value.followers.value,25);assert.equal(value.followers.source,'export');assert.equal(value.posts30.value,1);assert.throws(()=>healthCsv('followers,openedOn,postDate,failed\n?,2026-10-01,2026-10-20,false','2026-10-28'),{code:'SOCIAL_INPUT_INVALID'});});
