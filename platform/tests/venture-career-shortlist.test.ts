import test from 'node:test';
import assert from 'node:assert/strict';
import {careerShortlist} from '../runtime/venture/playbooks/job-search-desk/shortlist.ts';
test('coverage is first and the fixed threshold retains fair and strong listings',()=>{
 const result=careerShortlist(5,[{id:'a',verdict:'strong',reason:'Matches the approved role'},{id:'b',verdict:'fair',reason:'Location needs confirmation'},{id:'c',verdict:'weak',reason:'Required skill is missing'},{id:'d',verdict:'no',reason:'Outside approved location'}],'fair');
 assert.equal(result.coverage,'Read 4 of 5 listings');
 assert.deepEqual(result.kept.map(r=>r.id),['a','b']);
 assert.deepEqual(result.dropped.map(r=>r.reason),['Required skill is missing','Outside approved location']);
});
test('unread coverage, invalid verdicts and unexplained drops cannot be hidden',()=>{
 assert.throws(()=>careerShortlist(0,[{id:'a',verdict:'strong',reason:'Match'}],'fair'));
 assert.throws(()=>careerShortlist(1,[{id:'a',verdict:'great' as 'strong',reason:'Match'}],'fair'));
 assert.throws(()=>careerShortlist(1,[{id:'a',verdict:'no',reason:''}],'fair'));
 assert.throws(()=>careerShortlist(2,[{id:'a',verdict:'fair',reason:'Match'},{id:'a',verdict:'fair',reason:'Match'}],'fair'));
});
