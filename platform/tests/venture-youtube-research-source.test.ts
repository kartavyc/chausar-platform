import assert from 'node:assert/strict';
import {test} from 'node:test';
import {researchSource,ownerHoursMinutes} from '../runtime/venture/playbooks/youtube/research-source.ts';
test('mapped source columns preserve missing figures and reject duplicated headers or rows',()=>{
 const mapping={id:'Video',channelId:'Channel',views:'Views',publishedOn:'Published'};
 assert.deepEqual(researchSource('videos','Video,Channel,Views,Published\nv1,c1,,2026-10-01',mapping),[{id:'v1',channelId:'c1',views:null,publishedOn:'2026-10-01'}]);
 assert.throws(()=>researchSource('videos','Video,Channel,Views,Views\nv1,c1,4,5',mapping),{code:'YOUTUBE_RESEARCH_INVALID'});
 assert.throws(()=>researchSource('comments','id,text\na,Hi\na,Again',{id:'id',text:'text'}),{code:'YOUTUBE_RESEARCH_INVALID'});
});
test('Studio percentages and owner fractional hours are converted exactly by code',()=>{
 const mapping={videoId:'Video',ctrBasisPoints:'CTR',retentionBasisPoints:'Retention',views:'Views',searchViews:'Search',browseViews:'Browse'};
 const rows=researchSource('studio','Video,CTR,Retention,Views,Search,Browse\nv1,4.25,60.5,100,20,70',mapping);assert.equal((rows[0] as any).ctrBasisPoints,425);assert.equal((rows[0] as any).retentionBasisPoints,6050);assert.equal(ownerHoursMinutes('4.5'),270);assert.throws(()=>ownerHoursMinutes('0.001'),{code:'YOUTUBE_RESEARCH_INVALID'});
});

test('owned archive search uses exact uploaded word times without inventing timing or reading other channels',async()=>{const {computeResearch}=await import('../runtime/venture/playbooks/youtube/research-state.ts');const csv='source,start,end,text\npast-video,100,500,stock\npast-video,600,900,count\npast-video,5100,5600,other';const mapping={sourceId:'source',startMs:'start',endMs:'end',text:'text'};const result=computeResearch('archive',csv,mapping,{query:'stock count'}) as any;assert.equal(result.coverage,'speech only');assert.deepEqual(result.hits,[{sourceId:'past-video',startMs:0,endMs:5000,text:'stock count',channels:['speech']}]);assert.throws(()=>computeResearch('archive',csv.replace('100,500','unknown,500'),mapping,{query:'stock'}));});
