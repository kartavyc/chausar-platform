// Independent bounded P foundation review; no external service calls.
import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileSiteRequirements} from '../runtime/venture/playbooks/website-studio/requirements.ts';
import {parseSitePreview} from '../runtime/venture/playbooks/website-studio/preview.ts';
test('preserved owner locks count toward the total requirement limit',()=>{
 const rows=Array.from({length:100},(_,i)=>({id:'locked-'+i,text:'A visitor requests a quote.',excerpt:'Quote request',origin:'explicit' as const,severity:'major' as const}));
 const previous=reconcileSiteRequirements([],rows,'brief').map(row=>({...row,locked:true}));
 assert.throws(()=>reconcileSiteRequirements(previous,[{...rows[0],id:'new'}],'brief'),{code:'SITE_REQUIREMENT_INVALID'});
});
test('generated preview text respects the twelve pixel readability floor',()=>{
 for(const fontSize of ['0px','1px','11px'])assert.throws(()=>parseSitePreview({root:[{id:'text',type:'text',text:'Client information',style:{fontSize}}]}),{code:'SITE_PREVIEW_INVALID'});
 assert.equal(parseSitePreview({root:[{id:'text',type:'text',text:'Client information',style:{fontSize:'12px'}}]}).root[0].style?.fontSize,'12px');
});
