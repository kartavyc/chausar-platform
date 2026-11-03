import test from 'node:test';
import assert from 'node:assert/strict';
import {capabilityList} from '../runtime/venture/delivery/capabilities.ts';
test('native AI runtime replaces turn limits and separate heavy-work capability rows',()=>{
 const rows=capabilityList('win32');assert.equal(rows.some(row=>row.id.startsWith('tier-owner-')),false);
 const runtime=rows.find(row=>row.id==='agent-runtime');assert.ok(runtime);assert.match(runtime.reason,/Codex|Claude Code/);
 assert.doesNotMatch(rows.map(row=>row.reason).join(' '),/each turn waits|limits on turns|approve its brief/);
 assert.equal(capabilityList('linux',undefined,'postgres',undefined,undefined,'hosted-web').find(row=>row.id==='agent-runtime')!.state,'unavailable');
});
