// Chausar finishing freshness through the real owner desk, original regression.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {business,owner} from './venture-judge-helpers.ts';import {YOUTUBE_DESK} from '../runtime/venture/playbooks/youtube/desk.ts';
test('finished media measurements cannot authorize changed delivery bytes at export',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'youtube-finish-binding-'));
 try{
  const source=join(folder,'source.mp4'),output=join(folder,'output.mp4');await writeFile(source,'original source');await writeFile(output,'finished output');
  const f=await business('A YouTube channel for small makers in India'),offer=f.offers.find(x=>x.playbookOffer==='episode-package')!;
  f.deps.ffmpeg={locate:()=>'/ffmpeg',run:async(_bin,args)=>({code:0,timedOut:false,startError:null,stdout:'',stderr:args.includes('-af')?'First {"input_i":"-14","input_tp":"-1"}':'Duration: 00:01:00.000\nStream #0:0: Video: h264, yuv420p, 1920x1080, 25 fps\ncrop=1920:1080:0:0'})};
  const order=await f.call('venture.order.create',{clientId:f.client.id,offerId:offer.id,request:'Edit my video.',intake:{rights:{basis:'own-footage',holder:'Asha'},format:'long',cutFile:source}});
  await f.call('venture.files.add',{orderId:order.id,name:'source.srt',contentBase64:Buffer.from('1\n00:00:00,000 --> 00:01:00,000\nA complete sentence.').toString('base64')});
  const made=await YOUTUBE_DESK.edit.act!(f.deps,owner,{playbook:'youtube',kind:'edit',id:'new',action:'create',payload:{orderId:order.id,source:{label:'Words',durationMs:60000,words:[{id:'w1',text:'A complete sentence.',startMs:0,endMs:60000}]},sourceRef:{kind:'transcript',orderId:order.id}}});
  const get=()=>YOUTUBE_DESK.board.get!(f.deps,owner,{playbook:'youtube',kind:'board',id:made.id});
  const act=async(action:string,payload:any)=>{const row=await get();return YOUTUBE_DESK.board.act!(f.deps,owner,{playbook:'youtube',kind:'board',id:made.id,action,payload,digest:row.digest});};
  await act('prepare',{rate:25,publishing:[{platform:'youtube',text:'Video'}]});
  for(const row of ((await get()).item as any).board.outputs)await act('decide',{outputId:row.id,decision:'approved'});
  await act('finishing',{file:output,platform:'youtube',boxes:[]});await act('export',{});
  await writeFile(output,'replaced delivery after measurement');
  await assert.rejects(act('export',{}),{code:'DERIVED_STALE'});
 }finally{await rm(folder,{recursive:true,force:true});}
});
