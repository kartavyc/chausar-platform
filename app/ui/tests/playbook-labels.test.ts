import {expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {CATALOGUES,format} from '../src/text';
import {playbookLabel} from '../src/text/playbook-label';
import labels from '../src/text/en/playbook-labels.json';
const t=(language:'en')=>(key:string)=>format(CATALOGUES[language],language,key);
it('matches every current native registration without importing the server into the browser',()=>{
 const base=pathToFileURL(resolve(process.cwd(),'platform/runtime/venture/playbooks')+'/').href;
 const script=`import {currentRegistry} from ${JSON.stringify(base+'registry.ts')};console.log(JSON.stringify(currentRegistry().map(({id,label})=>({id,label}))));`;
 const rows=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10000})) as {id:string;label:string}[];
 expect(rows).toHaveLength(28); // W6 6E2, 6E3: +2 (lesson desk, booking desk); 6E4, 6E5: +2 (document desk, sign-off desk); 6E7: +1 (trading journal)
 expect(Object.keys(labels).sort()).toEqual(rows.map(row=>'playbook-labels.'+row.id).sort());
 for(const row of rows){expect(playbookLabel(t('en'),row)).toBe(row.label);}
});
it('preserves custom, unknown, already-localized and absent engine labels',()=>{
 for(const row of [{id:'lead-generation',label:'Custom owner name'},{id:'unknown',label:'Lead generation and appointment setting'},{id:'lead-generation',label:'मालिक के शब्द'}])expect(playbookLabel(t('en'),row)).toBe(row.label);
 expect(playbookLabel(t('en'),undefined)).toBeUndefined();expect(playbookLabel(t('en'),null)).toBeUndefined();
});
