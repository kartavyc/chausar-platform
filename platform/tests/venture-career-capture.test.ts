import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../runtime/portable.ts';
import {completeCareerCapture,captureCareerListing} from '../runtime/venture/playbooks/job-search-desk/capture.ts';
import type {PinnedTarget} from '../runtime/venture/core/net-guard.ts';
const resolve=async()=>[{address:'142.250.1.10',family:4 as const}];
test('capture requires one complete, contiguous revision without duplicates or gaps',()=>{
 const text='A public job listing',revision=hash(text),parts=[{start:0,end:7,text:text.slice(0,7),revision},{start:7,end:text.length,text:text.slice(7),revision}];
 assert.equal(completeCareerCapture(text.length,revision,parts).text,text);
 for(const invalid of [parts.slice(1),[parts[0],{...parts[1],revision:hash('changed')}],[parts[0],{...parts[1],start:8}],parts.slice(0,1)])assert.throws(()=>completeCareerCapture(text.length,revision,invalid),{code:'CAREER_CAPTURE_INCOMPLETE',message:'No job was saved.'});
 assert.throws(()=>completeCareerCapture(text.length,hash('wrong'),parts),{code:'CAREER_CAPTURE_INCOMPLETE'});
});
test('client page capture respects robots, reads the whole static response twice and excludes hidden HTML',async()=>{
 const sent:string[]=[];const send=async(target:PinnedTarget)=>{sent.push(target.url.href);return {status:200,headers:{'content-type':target.url.pathname==='/robots.txt'?'text/plain':'text/html'},body:Buffer.from(target.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'<h1>Engineer</h1><script>Invented role</script><div hidden>Secret</div><p>Pune, India</p>')};};
 const result=await captureCareerListing('https://careers.example.org/job',{resolve,send});
 assert.equal(result.text,'Engineer Pune, India');assert.equal(result.complete,true);assert.equal(result.segments.every(p=>p.revision===result.revision),true);
 assert.equal(sent.filter(url=>url.endsWith('/job')).length,2);
});
test('changed revisions, blocked platforms, robots and incomplete content save nothing',async()=>{
 let reads=0;const send=async(target:PinnedTarget)=>({status:200,headers:{'content-type':'text/plain'},body:Buffer.from(target.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'Revision '+(++reads))});
 await assert.rejects(captureCareerListing('https://careers.example.org/job',{resolve,send}),{code:'CAREER_CAPTURE_CHANGED',message:'No job was saved.'});
 for(const url of ['https://www.linkedin.com/jobs/1','https://www.naukri.com/job/1','https://www.instagram.com/company/jobs'])await assert.rejects(captureCareerListing(url,{resolve,send}),{code:'FETCH_POLICY_REFUSED',message:'Paste the job text instead. No job was saved.'});
 await assert.rejects(captureCareerListing('https://careers.example.org/job',{resolve,send:async()=>({status:200,headers:{'content-type':'text/plain'},body:Buffer.from('User-agent: *\nDisallow: /')})}),{code:'ROBOTS_REFUSED'});
 await assert.rejects(captureCareerListing('http://127.0.0.1/job',{resolve,send}));
});
