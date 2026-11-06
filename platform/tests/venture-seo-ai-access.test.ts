// SEO access acceptance. Vendor bot docs checked on build day; seo-agent MIT ideas, no source copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAiAccess } from '../runtime/venture/playbooks/seo-visibility/ai-access.ts';

test('training-only blocks do not reduce search access; script shells and HTML llms files are honest findings', () => {
  const result = assessAiAccess({ robots: 'User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /\nUser-agent: Google-Extended\nDisallow: /', path: '/', html: '<html><body><div id="root"></div><script src="/app.js"></script></body></html>', llms: { status: 200, contentType: 'text/html', text: '<!doctype html><h1>Not found</h1>' } });
  assert.deepEqual(result.search, { allowed: 4, of: 4, unknown: 0 });
  assert.equal(result.agents.find(agent => agent.token === 'GPTBot')?.allowed, false);
  assert.equal(result.agents.filter(agent => agent.kind === 'training').length, 3);
  assert.ok(result.findings.includes('empty-without-javascript'));
  assert.ok(result.findings.includes('llms-html-response'));
  assert.equal(result.cdn.state, 'manual-check');
  assert.match(result.cdn.line, /Cloudflare/);
});

test('unknown robots stays unknown, and exact named rules override the wildcard without impersonation',()=>{
  const unknown=assessAiAccess({robots:null,path:'/',html:null});assert.equal(unknown.search.unknown,4);assert.equal(unknown.agents.find(agent=>agent.token==='Googlebot')?.allowed,null);
  const named=assessAiAccess({robots:'User-agent: *\nDisallow: /\nUser-agent: OAI-SearchBot\nAllow: /help\nDisallow: /help/private',path:'/help',html:'<p>Readable</p>'});
  assert.equal(named.agents.find(agent=>agent.token==='OAI-SearchBot')?.allowed,true);assert.equal(named.agents.find(agent=>agent.token==='GPTBot')?.allowed,false);
});
