// Original J2 caption reducer boundary, independent of microphone transport.
import test from 'node:test';import assert from 'node:assert/strict';
import {newCaptionSession,captionEvent,captionSaving,captionExport} from '../runtime/venture/playbooks/translation-studio/live-captions-core.ts';
test('host permission is mandatory and saving starts off',()=>{assert.throws(()=>newCaptionSession('s','order',false),{code:'CAPTION_PERMISSION_REQUIRED'});const session=newCaptionSession('s','order',true);assert.equal(session.saving,false);assert.deepEqual(session.saved,[]);assert.equal(captionExport(session),null);});
test('draft stays separate; final and refinement share exact identity and speaker; stale events cannot rewrite later lines',()=>{
 let s=newCaptionSession('s','order',true);s=captionEvent(s,{id:'one',sequence:1,tier:'draft',speaker:'Speaker 1',text:'Hello'});assert.equal(s.confirmed.length,0);assert.equal(s.inProgress!.text,'Hello');
 s=captionEvent(s,{id:'one',sequence:2,tier:'final',speaker:'Speaker 1',text:'Hello world'});assert.equal(s.inProgress,null);assert.equal(s.confirmed[0]!.text,'Hello world');
 s=captionEvent(s,{id:'two',sequence:3,tier:'draft',speaker:'Speaker 2',text:'Next'});s=captionEvent(s,{id:'one',sequence:4,tier:'refined',speaker:'Speaker 1',text:'Hello, world.'});assert.equal(s.inProgress!.id,'two');assert.equal(s.confirmed[0]!.tier,'refined');
 assert.throws(()=>captionEvent(s,{id:'one',sequence:3,tier:'final',speaker:'Speaker 1',text:'stale'}),{code:'CAPTION_EVENT_STALE'});
 assert.throws(()=>captionEvent(s,{id:'missing',sequence:5,tier:'refined',speaker:'Speaker 1',text:'invented'}),{code:'CAPTION_EVENT_STALE'});
 assert.throws(()=>captionEvent(s,{id:'one',sequence:5,tier:'refined',speaker:'Speaker 2',text:'wrong speaker'}),{code:'VOICE_MISMATCH'});
});
test('saving only records future confirmed lines, switching it off retains saved history and bounds session memory',()=>{
 let s=newCaptionSession('s','order',true);s=captionEvent(s,{id:'old',sequence:1,tier:'final',speaker:'Speaker 1',text:'Unsaved'});s=captionSaving(s,true);s=captionEvent(s,{id:'saved',sequence:2,tier:'final',speaker:'Speaker 1',text:'Kept'});s=captionSaving(s,false);s=captionEvent(s,{id:'later',sequence:3,tier:'final',speaker:'Speaker 1',text:'Not kept'});assert.equal(s.saved.length,1);assert.equal(captionExport(s),'Speaker 1: Kept');
 for(let n=4;n<210;n++)s=captionEvent(s,{id:String(n),sequence:n,tier:'final',speaker:'Speaker 1',text:'Words'});assert.equal(s.confirmed.length,200);assert.equal(s.saved.length,1);
});
