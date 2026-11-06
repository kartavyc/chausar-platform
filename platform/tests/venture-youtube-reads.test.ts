import assert from 'node:assert/strict';
import {test} from 'node:test';
import {youtubeOutliers} from '../runtime/venture/playbooks/youtube/outliers.ts';
import {youtubeNiche} from '../runtime/venture/playbooks/youtube/niche.ts';
const rows=['10','20','30','100'].map((views,i)=>({id:'v'+i,channelId:'channel-a',views,publishedOn:'2026-10-01'}));
test('outliers compare exact whole hundredths with own median, not other channel views',()=>{
 const result=youtubeOutliers([...rows,{...rows[0]!,id:'other',channelId:'channel-b',views:'99999'}]);
 assert.equal(result.videos.find(v=>v.id==='v3')?.multipleHundredths,'400');assert.equal(result.skipped[0]?.reason,'fewer-than-four-measured-videos');
 const zero=youtubeOutliers(rows.map(r=>({...r,views:'0'})));assert.equal(zero.videos[0]?.multipleHundredths,null);assert.equal(zero.videos[0]?.reason,'zero-median');
 assert.throws(()=>youtubeOutliers([...rows,rows[0]!]),{code:'YOUTUBE_RESEARCH_INVALID'});
});
test('niche figures state coverage, date basis and caveats; unavailable views never become zero',()=>{
 const result=youtubeNiche([...rows,{...rows[0]!,id:'missing',views:null}], '2026-10-29',6);
 assert.equal(result.coverage.requested,6);assert.equal(result.coverage.returned,5);assert.equal(result.coverage.measuredViews,4);
 assert.equal(result.figures.medianViews.value,'25');assert.equal(result.figures.medianAgeDays.value,'28');
 assert.ok(Object.values(result.figures).every(f=>f.caveat&&f.evidence==='observed'));
 assert.throws(()=>youtubeNiche([{...rows[0]!,publishedOn:'2026-02-30'}],'2026-10-29',1),{code:'YOUTUBE_RESEARCH_INVALID'});
});
