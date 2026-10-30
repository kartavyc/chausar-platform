import {expect,it} from 'vitest';
import {wordedRow} from '../../src/places/today/OutreachRows';
import {CATALOGUES} from '../../src/text';
import type {QueueRow} from '../../src/engine/types';
it('words the due revision notice in Hindi without changing the order link',()=>{
 const row={id:'notice:social-revision:order_test:2026-10-27',kind:'notice',title:'Social revisions are due',line:'Open this order to review the monthly revisions.',actions:[{id:'open',label:'Open social drafts',primary:true},{id:'later',label:'Later',primary:false}],notice:{probe:'drafts',severity:'medium',link:'#/work?socialOrder=order_test'}} as QueueRow;
 const result=wordedRow(row,key=>typeof CATALOGUES.hi[key]==='string'?CATALOGUES.hi[key] as string:key);
 expect(result.title).toBe('सोशल पोस्ट के संशोधन करने हैं');expect(result.line).toBe('मासिक संशोधन देखने के लिए यह ऑर्डर खोलें।');
 expect(result.actions[0]?.label).toBe('सोशल ड्राफ़्ट खोलें');expect(result.notice?.link).toBe(row.notice?.link);
});
