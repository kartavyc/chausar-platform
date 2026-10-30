import test from 'node:test';
import assert from 'node:assert/strict';
import {factChange,renderClaims,validateFact} from '../runtime/venture/playbooks/job-search-desk/facts.ts';

const fact={id:'fact-1',statement:'Led a customer research project',qualifiers:['as an intern'],forbiddenUses:['team management']};
test('an agent can only add boundaries to an unchanged client statement',()=>{
 assert.equal(factChange(fact,{...fact,forbiddenUses:[...fact.forbiddenUses,'executive leadership']}).approvalRequired,false);
 assert.equal(factChange(fact,{...fact,qualifiers:[...fact.qualifiers,'for six weeks']}).approvalRequired,true);
 assert.equal(factChange(fact,{...fact,statement:'Managed the research team'}).approvalRequired,true);
 assert.equal(factChange(fact,{...fact,qualifiers:[]}).approvalRequired,true);
 assert.equal(factChange(fact,{...fact,forbiddenUses:[]}).approvalRequired,true);
 assert.equal(factChange(null,fact).approvalRequired,true);
});
test('a claim uses the exact approved statement and all its boundaries',()=>{
 const result=renderClaims([fact],[{factId:'fact-1',use:'research experience'}]);
 assert.deepEqual(result,{ok:true,lines:['Led a customer research project (as an intern)']});
 assert.deepEqual(renderClaims([fact],[{factId:'fact-1',use:'TEAM MANAGEMENT'}]),{ok:false,code:'claim-boundary',factId:'fact-1'});
 assert.deepEqual(renderClaims([fact],[{factId:'invented',use:'research experience'}]),{ok:false,code:'unstated-fact',factId:'invented'});
});
test('claim boundary matching rejects hidden or omitted context and duplicate facts',()=>{
 assert.throws(()=>renderClaims([fact,fact],[]));
 assert.throws(()=>renderClaims([fact],[{factId:'fact-1',use:''}]));
 assert.throws(()=>validateFact({...fact,qualifiers:['']}));
 assert.throws(()=>validateFact({...fact,statement:'x'.repeat(2001)}));
 assert.throws(()=>validateFact({...fact,approved:true} as typeof fact));
 assert.deepEqual(renderClaims([fact],[{factId:'fact-1',use:'Evidence of team management experience'}]),{ok:false,code:'claim-boundary',factId:'fact-1'});
});
