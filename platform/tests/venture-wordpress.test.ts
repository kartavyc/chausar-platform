// Original tests against WordPress REST contract, official handbook, no third-party code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWordpressDraft, verifyWordpressLive } from '../runtime/venture/build/wordpress.ts';
import {articleHtml} from '../runtime/venture/playbooks/seo-visibility/article-html.ts';
import type { PinnedSender } from '../runtime/venture/core/net-guard.ts';
const resolve = async () => [{address:'93.184.216.34',family:4 as const}];
test('live verification refuses a matching title with an unrelated body and any cross-installation redirect',async()=>{
 const input={url:'https://client.example/blog/article',siteUrl:'https://client.example/blog/',title:'Client article',heading:'Client article',text:'The exact approved care article.'};
 const unrelated:PinnedSender=async request=>({status:200,headers:{},body:Buffer.from(request.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'<title>Client article</title><h1>Client article</h1><p>Unrelated content.</p>')});
 assert.equal((await verifyWordpressLive(input,{resolve,send:unrelated})).pass,false);
 for(const hidden of ['<!--'+articleHtml(input.text)+'-->','<script>'+articleHtml(input.text)+'</script>',articleHtml(input.text).replace('<pre ','<pre hidden ')]){
  const send:PinnedSender=async request=>({status:200,headers:{},body:Buffer.from(request.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'<title>Client article</title><h1>Client article</h1>'+hidden)});assert.equal((await verifyWordpressLive(input,{resolve,send})).pass,false);
 }
 const requests:string[]=[];const redirected:PinnedSender=async request=>{requests.push(request.url.href);return request.url.pathname==='/robots.txt'?{status:200,headers:{} as Record<string,string>,body:Buffer.from('User-agent: *\nAllow: /')}:{status:302,headers:{location:'https://other.example/blog/article'} as Record<string,string>,body:Buffer.from('')};};
 await assert.rejects(verifyWordpressLive(input,{resolve,send:redirected}),{code:'WORDPRESS_SITE_MISMATCH'});
 assert.ok(requests.every(url=>new URL(url).origin==='https://client.example'));
 await assert.rejects(verifyWordpressLive({...input,url:'https://client.example/other/article'},{resolve,send:unrelated}),{code:'WORDPRESS_SITE_MISMATCH'});
});
test('live verification excludes hidden descendants from approved article and heading evidence',async()=>{
 const input={url:'https://client.example/article',siteUrl:'https://client.example/',title:'Client article',heading:'Client article',text:'The exact approved care article.'};
 const verify=async(article:string,heading='<h1>Client article</h1>')=>{
  const send:PinnedSender=async request=>({status:200,headers:{},body:Buffer.from(request.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'<html><head><title>Client article</title></head><body>'+heading+article+'</body></html>')});return verifyWordpressLive(input,{resolve,send});
 };
 for(const wrapper of ['<span hidden>TEXT</span>','<span aria-hidden="true">TEXT</span>','<span style="display:none">TEXT</span>','<span><script>TEXT</script></span>','<span><style>TEXT</style></span>','<template>TEXT</template>','<noscript>TEXT</noscript>']){
  assert.equal((await verify('<pre data-chausar-article="true">'+wrapper.replace('TEXT',input.text)+'</pre>')).pass,false,wrapper);
 }
 assert.equal((await verify(articleHtml(input.text),'<h1><span hidden>Client article</span></h1>')).pass,false);
 assert.equal((await verify('<pre data-chausar-article="true">'+input.text+'<span hidden>Ignored hidden text</span></pre>')).pass,true);
});
test('WordPress sends only draft posts to the client site and credentials never follow redirects', async () => {
 const seen:any[]=[];const send:PinnedSender=async request=>{seen.push(request);return {status:201,headers:{},body:Buffer.from(JSON.stringify({id:7,status:'draft',link:'https://client.example/?p=7'}))};};
 const config={url:'https://client.example/blog/',username:'owner',password:'test'+' application password'};
 const result=await sendWordpressDraft(config,{title:'Useful care',content:'<p>Source checked.</p>',status:'draft'},{resolve,send});
 assert.equal(result.outcome,'applied');assert.equal(seen[0].url.href,'https://client.example/blog/wp-json/wp/v2/posts');assert.equal(JSON.parse(seen[0].body).status,'draft');assert.match(seen[0].headers.authorization,/^Basic /);
 await assert.rejects(sendWordpressDraft(config,{title:'Wrong',content:'Wrong',status:'publish'} as any,{resolve,send}),{code:'WORDPRESS_DRAFT_ONLY'});assert.equal(seen.length,1);
 const redirect:PinnedSender=async request=>{seen.push(request);return {status:302,headers:{location:'https://other.example/'},body:Buffer.from('')};};
 assert.equal((await sendWordpressDraft(config,{title:'Useful care',content:'Source',status:'draft'},{resolve,send:redirect})).outcome,'unknown');assert.equal(seen.length,2);
 await assert.rejects(sendWordpressDraft({...config,url:'https://127.0.0.1/'},{title:'Useful care',content:'Source',status:'draft'},{resolve,send}),{code:'NET_ADDRESS_REFUSED'});
});
test('WordPress refusal is known, timeout or unexpected live status stays unknown without retry', async()=>{
 let attempts=0;const config={url:'https://client.example',username:'owner',password:'example password'};const draft={title:'Draft',content:'Only draft',status:'draft' as const};
 const refused:PinnedSender=async()=>{attempts++;return {status:403,headers:{},body:Buffer.from('{}')};};assert.equal((await sendWordpressDraft(config,draft,{resolve,send:refused})).outcome,'not-sent');
 const timeout:PinnedSender=async()=>{attempts++;throw Error('timeout');};assert.equal((await sendWordpressDraft(config,draft,{resolve,send:timeout})).outcome,'unknown');
 const unexpected:PinnedSender=async()=>{attempts++;return {status:201,headers:{},body:Buffer.from('{"id":7,"status":"publish"}')};};assert.equal((await sendWordpressDraft(config,draft,{resolve,send:unexpected})).outcome,'unknown');assert.equal(attempts,3);
});
test('live structural verification reads public HTML with robots and checks title and heading without credentials',async()=>{
 const seen:any[]=[];const send:PinnedSender=async request=>{seen.push(request);return {status:200,headers:{'content-type':'text/html'},body:Buffer.from(request.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'<html><title>Useful care</title><h1>Useful care</h1>'+articleHtml('Source checked.')+'</html>')};};
 assert.equal((await verifyWordpressLive({url:'https://client.example/article',siteUrl:'https://client.example/',text:'Source checked.',title:'Useful care',heading:'Useful care'},{resolve,send})).pass,true);assert.ok(seen.every(r=>!r.headers.authorization));
 assert.equal((await verifyWordpressLive({url:'https://client.example/article',siteUrl:'https://client.example/',text:'Source checked.',title:'Wrong',heading:'Useful care'},{resolve,send})).pass,false);
});
