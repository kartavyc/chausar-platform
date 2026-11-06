import assert from 'node:assert/strict';
import {test} from 'node:test';
import {searchYoutubeArchive} from '../runtime/venture/playbooks/youtube/archive.ts';
test('archive searches owned speech in five-second windows and truthfully names unavailable channels',()=>{
 const source=[{id:'archive-a',ownerConfirmed:true,words:[{startMs:1000,endMs:2000,text:'shop'},{startMs:5000,endMs:6000,text:'sales'}]}];
 const result=searchYoutubeArchive(source,'sales');assert.equal(result.hits[0]?.startMs,5000);assert.equal(result.hits[0]?.endMs,10000);assert.deepEqual(result.hits[0]?.channels,['speech']);assert.equal(result.coverage,'speech only');assert.equal(result.planned.length,2);
 assert.throws(()=>searchYoutubeArchive([{...source[0]!,ownerConfirmed:false}],'sales'),{code:'RIGHTS_REQUIRED'});
});
