import assert from 'node:assert/strict';
import {test} from 'node:test';
import {afterPublish,AFTER_PUBLISH_DEFAULTS} from '../runtime/venture/playbooks/youtube/after-publish.ts';
test('after-publish gives one deterministic directive with exact measured evidence and editable thresholds',()=>{
 const source={videoId:'video-one',ctrBasisPoints:200,retentionBasisPoints:7000,searchViews:'100',browseViews:'700',views:'1000'};
 const result=afterPublish(source);assert.equal(result.directive,'fix-packaging');assert.equal(result.thresholds.source,'house');assert.equal(result.figures.searchShareBasisPoints,1000);
 assert.equal(afterPublish({...source,ctrBasisPoints:800,retentionBasisPoints:2000}).directive,'fix-opening');
 assert.equal(afterPublish({...source,ctrBasisPoints:800,searchViews:'700',browseViews:'100'}).directive,'more-intent-clips');
 assert.equal(afterPublish({...source,ctrBasisPoints:800}).directive,'repeat-packaging');
 assert.equal(afterPublish(source,{...AFTER_PUBLISH_DEFAULTS,lowCtrBasisPoints:100,source:'owner'}).thresholds.source,'owner');
});
test('missing Studio evidence is named and impossible or imprecise source counts refuse',()=>{
 const source={videoId:'v',ctrBasisPoints:null,retentionBasisPoints:null,searchViews:null,browseViews:null,views:'0'};
 assert.equal(afterPublish(source).directive,'collect-evidence');assert.equal(afterPublish(source).figures.searchShareBasisPoints,null);
 assert.throws(()=>afterPublish({...source,views:'1',searchViews:'2'}),{code:'YOUTUBE_RESEARCH_INVALID'});
 assert.throws(()=>afterPublish({...source,views:'1e6'}),{code:'YOUTUBE_RESEARCH_INVALID'});
});
