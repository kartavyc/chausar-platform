// Native/browser parity covers full registers, sources, professional holds, recipes and recheck windows.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {PLAYBOOK_DEFINITIONS} from '../runtime/venture/playbooks/definitions.ts';
import {rulesListOf} from '../runtime/venture/playbooks/rules-view.ts';
const data=JSON.parse(readFileSync(new URL('../../app/ui/src/engine/landed-kit-rules-data.json',import.meta.url),'utf8'));
for(const id of Object.keys(data))test(id+' browser rules equal the native view across recheck dates',async()=>{
 const {landedKitRules}=await import(new URL('../../app/ui/src/engine/landed-kit-rules.ts',import.meta.url).href);
 const definition=PLAYBOOK_DEFINITIONS.find(d=>d.registration.id===id);assert.ok(definition,id);
 const dates=new Set(['2026-10-29','2027-01-27','2028-10-29']);
 for(const rule of definition.rules)for(const extra of [0,1])dates.add(new Date(Date.parse(rule.checkedOn+'T00:00:00Z')+((rule.recheckAfterDays??90)+extra)*86400000).toISOString().slice(0,10));
 for(const today of dates)assert.deepEqual(landedKitRules(id,today),rulesListOf(definition.registration,today),id+' on '+today);
});
