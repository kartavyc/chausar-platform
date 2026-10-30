import {expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {CATALOGUES,format} from '../src/text';
import {playbookLabel} from '../src/text/playbook-label';
import labels from '../src/text/en/playbook-labels.json';
const t=(language:'en'|'hi')=>(key:string)=>format(CATALOGUES[language],language,key);
it('matches every current native registration and its existing Hindi label without importing the server into the browser',()=>{
 const base=pathToFileURL(resolve(process.cwd(),'platform/runtime/venture/playbooks')+'/').href;
 const script=`import {readFileSync} from 'node:fs';import {currentRegistry} from ${JSON.stringify(base+'registry.ts')};import {WAYS} from ${JSON.stringify(base+'ways.ts')};const flagship=new Set(['youtube','ca-firm','social-agency']);console.log(JSON.stringify(currentRegistry().map(({id,label})=>({id,label,hi:flagship.has(id)?WAYS.find(row=>row.playbook===id).hi.label:JSON.parse(readFileSync(new URL(id+'/hi.json',${JSON.stringify(base)}),'utf8'))[label]}))));`;
 const rows=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10000})) as {id:string;label:string;hi:string}[];
 expect(rows).toHaveLength(23);
 expect(Object.keys(labels).sort()).toEqual(rows.map(row=>'playbook-labels.'+row.id).sort());
 for(const row of rows){expect(row.hi).toBeTruthy();expect(playbookLabel(t('en'),row)).toBe(row.label);expect(playbookLabel(t('hi'),row)).toBe(row.hi);}
});
it('preserves custom, unknown, already-localized and absent engine labels',()=>{
 for(const row of [{id:'lead-generation',label:'Custom owner name'},{id:'unknown',label:'Lead generation and appointment setting'},{id:'lead-generation',label:'मालिक के शब्द'}])expect(playbookLabel(t('hi'),row)).toBe(row.label);
 expect(playbookLabel(t('hi'),undefined)).toBeUndefined();expect(playbookLabel(t('hi'),null)).toBeUndefined();
});
