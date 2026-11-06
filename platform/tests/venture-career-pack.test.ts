import test from 'node:test';
import assert from 'node:assert/strict';
import {careerPack,careerPackDeliverable,careerPackBinding} from '../runtime/venture/playbooks/job-search-desk/pack.ts';
import {careerDraftCheck} from '../runtime/venture/playbooks/job-search-desk/checks.ts';
const fact={id:'research',statement:'Interviewed customers',qualifiers:['as an intern'],forbiddenUses:['team manager']};
const source={id:'listing1',url:'https://jobs.example/analyst',text:'We need customer research experience.',revision:'source1'};
test('career packs contain exact approved facts with every qualifier and source-backed role quotes',()=>{
 const p=careerPack([fact],[source],{kind:'resume',claims:[{factId:'research',use:'research analyst'}],sources:[{listingId:'listing1',quote:'customer research experience'}]});
 assert.match(p.text,/Interviewed customers \(as an intern\)/);assert.match(p.text,/customer research experience/);
 assert.throws(()=>careerPack([fact],[source],{kind:'resume',claims:[{factId:'research',use:'team manager'}],sources:[]}),{code:'CAREER_CLAIM_BOUNDARY'});
 assert.throws(()=>careerPack([],[],{kind:'resume',claims:[{factId:'invented',use:'manager'}],sources:[]}),{code:'CAREER_UNSTATED_FACT'});
 assert.throws(()=>careerPack([fact],[source],{kind:'cover-letter',claims:[{factId:'research',use:'research'}],sources:[{listingId:'listing1',quote:'Leading a department'}]}),{code:'CAREER_SOURCE_CHANGED'});
});
test('career delivery cannot smuggle unsupported claims through its title, heading or non-text part',()=>{
 const p=careerPack([fact],[],{kind:'resume',claims:[{factId:'research',use:'research'}],sources:[]}),binding=careerPackBinding(p.text,'facts1');
 const input={deliverable:careerPackDeliverable(p.text),careerPack:{text:p.text,factsDigest:'facts1',currentFactsDigest:'facts1',ownerApproval:binding,binding}} as any;
 assert.ok(careerDraftCheck(input).every(c=>c.outcome==='pass'));
 for(const change of [(d:any)=>{d.title='I managed fifty people';},(d:any)=>{d.sections[0].heading='Department manager';},(d:any)=>{d.sections[0].parts.push({kind:'text',text:'Invented experience'});},(d:any)=>{d.attachments=[{name:'invented-resume.docx',path:'/tmp/invented'}];}]){
  const changed=structuredClone(input);change(changed.deliverable);assert.equal(careerDraftCheck(changed)[0].outcome,'fail');
 }
 input.careerPack.currentFactsDigest='facts2';assert.equal(careerDraftCheck(input)[0].outcome,'fail');
});
