// D1 executable held-back cases and dated platform/house rules. Original tests, no outside requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSocialBaseline,runSocialBaseline,scoreSocialCase} from '../runtime/venture/playbooks/social/judge.ts';
import {SOCIAL_RULES_REGISTER,validateRulesRegister} from '../runtime/venture/playbooks/social/register.ts';
import {SOCIAL_CONNECTORS} from '../runtime/venture/playbooks/social/playbook.ts';
test('D1 adds executable thin-source, five-structure and selling-share baseline cases while preserving the old seven',async()=>{
 const {file,social}=await loadSocialBaseline();const ids=['repurpose-thin-source','ghostwriting-structure','selling-share-cap'];for(const id of ids)assert.ok(file.cases.some(row=>row.id===id),id);
 const result=await runSocialBaseline();assert.equal(result.passed,14,result.cases.filter(row=>!row.passed).map(row=>row.failures).join('\n'));assert.equal(result.of,14);assert.equal(result.ok,true);
 const thin=file.cases.find(row=>row.id===ids[0])!;assert.equal(scoreSocialCase(thin,social[thin.id],JSON.stringify({outcome:'drafted',message:'Send a longer piece or a voice note.'})).passed,false);
 const enough={...thin,sources:[{id:'source',text:'Claim: We roast coffee.\nStory: We learnt from our neighbours.\nMistake: The first batch was burnt.\nQuote: Keep trying.'}]};assert.equal(scoreSocialCase(enough,social[thin.id],thin.reference).passed,false,'the source inventory decides whether a refusal is appropriate');
 const ghost=file.cases.find(row=>row.id===ids[1])!;const pack=JSON.parse(ghost.reference);pack.posts.forEach((post:{heading:string})=>{post.heading='Post | Story';});assert.equal(scoreSocialCase(ghost,social[ghost.id],JSON.stringify(pack)).passed,false);
 const selling=file.cases.find(row=>row.id===ids[2])!;const slots=JSON.parse(selling.reference);slots.slots[1].kind='sell';assert.equal(scoreSocialCase(selling,social[selling.id],JSON.stringify(slots)).passed,false);slots.slots[1].kind='value';slots.slots[1].goals=['teach','sell'];assert.equal(scoreSocialCase(selling,social[selling.id],JSON.stringify(slots)).passed,false);
});
test('D1 dates LinkedIn restrictions and distinct house rules without presenting the house caps as platform facts',()=>{
 validateRulesRegister();const linked=SOCIAL_RULES_REGISTER.find(rule=>rule.id==='linkedin-manual-only');assert.ok(linked);assert.equal(linked.read,'official');assert.equal(linked.checkedOn,'2026-10-27');assert.ok(linked.sources.some(source=>source.url==='https://www.linkedin.com/legal/user-agreement'));assert.match(linked.rule,/copy-and-open/i);
 for(const id of ['selling-share-house','revision-rounds-house']){const rule=SOCIAL_RULES_REGISTER.find(rule=>rule.id===id);assert.ok(rule,id);assert.equal(rule.read,'house');assert.equal(rule.checkedOn,'2026-10-27');assert.match(rule.limitations.join(' '),/not a platform/i);}
 const note=SOCIAL_CONNECTORS.find(row=>row.id==='posting')!.note;assert.match(note,/LinkedIn is copy-and-open only/);assert.doesNotMatch(note,/LinkedIn and X can go from your own browser/);
});
