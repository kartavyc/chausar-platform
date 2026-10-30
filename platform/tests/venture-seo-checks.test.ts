// SEO promise policy and baseline sensitivity. seo-agent MIT and GEOHub AGPL ideas only; original tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promisesRanking } from '../runtime/venture/playbooks/seo-visibility/checks.ts';
test('no ranking promises: explicit disclaimers pass while positive English and Hindi promises fail',()=>{
 for(const words of ['No ranking or citation is promised.','We do not guarantee rankings.','We cannot promise traffic.'])assert.equal(promisesRanking(words),false,words);
 for(const words of ['We guarantee first-page rankings.','Rankings are guaranteed.','We do not guarantee traffic, but we guarantee rankings.','रैंकिंग की गारंटी है।'])assert.equal(promisesRanking(words),true,words);
});
