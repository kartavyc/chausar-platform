// Generate browser-only rule data from landed native definitions. Run after a kit register changes.
import {writeFileSync} from 'node:fs';
import {PLAYBOOK_DEFINITIONS} from '../platform/runtime/venture/playbooks/definitions.ts';
import {rulesListOf} from '../platform/runtime/venture/playbooks/rules-view.ts';
const dedicated=new Set(['data-entry-desk','dev-agency','monitored-data','it-triage','phone-receptionist']);
const rows=PLAYBOOK_DEFINITIONS.filter(d=>!dedicated.has(d.registration.id)).map(d=>{
 const view=rulesListOf(d.registration,'2026-10-29');
 const metadata=Object.fromEntries(d.rules.map(r=>[r.id,{topic:r.topic,how:r.how,read:r.read,window:r.recheckAfterDays??90,needs:r.needs,confirmed:!!r.confirmedBy}]));
 return [d.registration.id,{view,metadata}];
});
writeFileSync(new URL('../app/ui/src/engine/landed-kit-rules-data.json',import.meta.url),'{\n'+rows.map(([id,row])=>'  '+JSON.stringify(id)+': '+JSON.stringify(row)).join(',\n')+'\n}\n');
console.log('Generated native rule data for '+rows.length+' landed kits.');
