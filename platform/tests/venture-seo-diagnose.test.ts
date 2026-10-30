// SEO diagnosis public contract. GEOHub (AGPL ideas only), seo-agent (MIT); no copied source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseSite } from '../runtime/venture/playbooks/seo-visibility/diagnose.ts';
import { CHAUSAR_USER_AGENT } from '../runtime/venture/build/fetch-policy.ts';
import type { PinnedSender } from '../runtime/venture/core/net-guard.ts';

const resolve = async () => [{ address: '93.184.216.34', family: 4 as const }];
test('sitemap-first diagnosis is bounded, robots guarded, grouped and null for unread evidence', async () => {
  const paths: string[] = [];
  const send: PinnedSender = async target => {
    assert.equal(target.headers['user-agent'], CHAUSAR_USER_AGENT);
    const path = target.url.pathname; paths.push(path);
    if (path === '/robots.txt') return { status: 200, headers: {} as Record<string,string>, body: Buffer.from('User-agent: Chausar\nDisallow: /private') };
    if (path === '/sitemap.xml') return { status: 200, headers: {} as Record<string,string>, body: Buffer.from('<urlset>'+Array.from({length:13},(_,i)=>`<url><loc>https://clinic.example/p${i}</loc></url>`).join('')+'</urlset>') };
    if (path === '/llms.txt') return { status: 404, headers: {} as Record<string,string>, body: Buffer.from('') };
    if (path === '/p1') return { status: 503, headers: {} as Record<string,string>, body: Buffer.from('not available') };
    return { status: 200, headers: { 'content-type': 'text/html' } as Record<string,string>, body: Buffer.from('<html><head><title>Clinic</title><meta name="description" content="Care"></head><body><h1>Clinic</h1><p>'+ 'Care for local families. '.repeat(15)+'</p><a href="/contact">Contact</a></body></html>') };
  };
  const result = await diagnoseSite('https://clinic.example/', { resolve, send });
  assert.equal(result.pages.length, 10);
  assert.equal(result.pages[0].url, 'https://clinic.example/p0');
  assert.equal(result.gaps.length, 1);
  assert.equal(result.pages[1].dimensions['titles-descriptions'], null);
  assert.equal(result.confidence.planned, 80);
  assert.equal(result.confidence.observed, 72);
  assert.equal(result.rubric.label, 'our rubric');
  assert.equal(result.backlog.find(item=>item.id==='structured-data')?.pages.length, 9);
  assert.ok(!paths.includes('/p10'));
  assert.match(result.headline, /8 dimensions have evidence/);
});


test('homepage fallback never reads robots denied links and private targets are refused before any request',async()=>{
  const sent:string[]=[];
  const send:PinnedSender=async target=>{sent.push(target.url.pathname);const path=target.url.pathname;return {status:path==='/sitemap.xml'?404:200,headers:{'content-type':'text/html'},body:Buffer.from(path==='/robots.txt'?'User-agent: Chausar\nDisallow: /private':path==='/'?'<html><title>Clinic</title><body><h1>Care</h1><a href="/private">Private</a><a href="https://other.example/page">Outside</a></body></html>':'<html><body>Private</body></html>')};};
  const result=await diagnoseSite('https://clinic.example/',{resolve,send});
  assert.equal(result.pages.length,2);
  assert.equal(result.gaps[0].code,'ROBOTS_REFUSED');
  assert.ok(Object.values(result.pages[1].dimensions).every(value=>value===null));
  assert.ok(!sent.includes('/private'));
  const before=sent.length;
  await assert.rejects(diagnoseSite('http://127.0.0.1/',{resolve,send}),(error:any)=>error.code==='NET_ADDRESS_REFUSED');
  assert.equal(sent.length,before);
});
