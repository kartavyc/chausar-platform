// Original Chausar social checks at the live flagship dispatcher, with adversarial companion fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFlagshipChecks, type FlagshipCheckInput } from '../runtime/venture/playbooks/draft-checks.ts';
const source = 'text\n"We teach 12 students."\n"We practise breathing."\n"We once rushed and learned to slow down."\n"Our classes use mats."';
const file = (id: string, text: string) => ({ id, name: id + '.csv', format: 'csv' as const, contentBase64: Buffer.from(text).toString('base64'), bytes: Buffer.byteLength(text), digest: id, clientData: true });
const input = (): FlagshipCheckInput => ({ flagship: 'social-agency', offerKey: 'repurpose-pack', servedBy: 'model', request: 'A week of posts. 99 students is unrelated.', intake: { rights: null, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null, fields: { sourceFile: 'upload_source', channels: ['linkedin','x','facebook'] } }, files: [file('upload_source', source), file('upload_other','text\nWe teach 99 students.')], receipts: [], known: [], mode: 'client', today: '2026-10-27', dateOrder: 'day-month-year', deliverable: { title: 'Weekly posts', sections: [{ heading: 'Drafts', parts: [{kind:'text',text:'LinkedIn: We teach 99 students.'}] }], questionsForClient: [] } });
test('repurpose facts use only the bound source, including title and questions', async () => {
 for (const surface of ['body','title','question'] as const) {
  const data=input(); (data.deliverable.sections[0].parts[0] as {kind:'text';text:string}).text='LinkedIn: We practise breathing.';
  if(surface==='body')(data.deliverable.sections[0].parts[0] as {kind:'text';text:string}).text='LinkedIn: We teach 99 students.';
  if(surface==='title')data.deliverable.title='We teach 99 students.';
  if(surface==='question')data.deliverable.questionsForClient=['Do you teach 99 students?'];
  const checks=await runFlagshipChecks(data);
  assert.equal(checks.find(check=>check.check==='source-faithful')?.outcome,'fail',surface);
 }
 const data=input();(data.deliverable.sections[0].parts[0] as {kind:'text';text:string}).text='LinkedIn: We teach 12 students.';
 assert.equal((await runFlagshipChecks(data)).find(check=>check.check==='source-faithful')?.outcome,'pass');
});
test('repurpose delivery covers exactly the selected channels and a nonempty newsletter blurb', async () => {
 const complete=()=>{const data=input();data.deliverable.sections=[{heading:'Drafts',parts:[{kind:'text',text:'LinkedIn: We practise breathing.\nX: We use mats.\nFacebook: We learned to slow down.'}]},{heading:'Newsletter blurb',parts:[{kind:'text',text:'We practise breathing and use mats.'}]}];return data;};
 const verdict=async(data:FlagshipCheckInput)=>(await runFlagshipChecks(data)).find(c=>c.check==='repurpose-coverage')?.outcome;
 assert.equal(await verdict(complete()),'pass');
 for(const variant of ['missing-channel','extra-channel','missing-blurb','empty-blurb']){
  const data=complete();const part=data.deliverable.sections[0]!.parts[0]! as {kind:'text';text:string};
  if(variant==='missing-channel')part.text=part.text.split('\n').slice(0,2).join('\n');
  if(variant==='extra-channel')part.text+='\nInstagram: We use mats.';
  if(variant==='missing-blurb')data.deliverable.sections.pop();
  if(variant==='empty-blurb')data.deliverable.sections[1]!.parts=[];
  assert.equal(await verdict(data),'fail',variant);
 }
 const data=complete();data.deliverable.sections[1]!.parts=[{kind:'text',text:'We teach 99 students.'}];
 assert.equal((await runFlagshipChecks(data)).find(c=>c.check==='source-faithful')?.outcome,'fail');
});
test('community no-link rules also check the actual generated companion text', async () => {
 const data=input();data.offerKey='community-replies';data.intake!.fields={communityRules:'No links.',communityPromotion:false,communityLinks:false};data.deliverable.title='Read https://example.com';
 assert.equal((await runFlagshipChecks(data)).find(check=>check.check==='community-rules')?.outcome,'fail');
});

test('community rules check promotion introduced in every displayed surface',async()=>{
 for(const surface of ['body','title','heading','question']){
  const data=input();data.offerKey='community-replies';data.intake!.fields={communityRules:'No self-promotion.',communityPromotion:false,communityLinks:false};
  const promotion='Buy our bakery cakes. Order from our shop today.';
  (data.deliverable.sections[0].parts[0] as {kind:'text';text:string}).text=surface==='body'?'LinkedIn: '+promotion:'LinkedIn: We practise breathing.';
  if(surface==='title')data.deliverable.title=promotion;
  if(surface==='heading')data.deliverable.sections[0].heading=promotion;
  if(surface==='question')data.deliverable.questionsForClient=[promotion];
  assert.equal((await runFlagshipChecks(data)).find(check=>check.check==='community-rules')?.outcome,'fail',surface);
 }
});
test('canonical youtube-shorts label remains a checked and displayed post',async()=>{
 const {postOfLine}=await import('../runtime/venture/playbooks/social/post-label.ts');
 assert.deepEqual(postOfLine('youtube-shorts: We bake daily.'),{channel:'youtube-shorts',text:'We bake daily.'});
});

test('post plan ordinals are structure, while factual numbers in goals and reader actions remain source checked',async()=>{
 const base='Post 1 | Value | Goal: Teach breathing | Reader action: Practise slowly | Hook: Question';
 for(const [metadata,outcome] of [[base,'pass'],[base.replace('Teach breathing','Teach 99 students'),'fail'],[base.replace('Practise slowly','Bring 99 students'),'fail']] as const){
  const data=input();(data.deliverable.sections[0].parts[0] as {kind:'text';text:string}).text='LinkedIn: We practise breathing.';
  data.deliverable.sections.push({heading:'Post plan',parts:[{kind:'text',text:metadata}]});
  const checks=await runFlagshipChecks(data);
  assert.equal(checks.find(check=>check.check==='source-faithful')?.outcome,outcome,metadata);
  if(outcome==='pass')assert.equal(checks.find(check=>check.check==='selling-share')?.outcome,'pass');
 }
 const data=input();data.deliverable.sections[0].parts=[{kind:'text',text:'Post 99 | We teach students.'}];
 assert.equal((await runFlagshipChecks(data)).find(check=>check.check==='source-faithful')?.outcome,'fail','a number outside Post plan is still factual');
});

test('repurpose writing schema requests the selected channels and newsletter only at the drafts stage',async()=>{
 const {flagshipDraft}=await import('../runtime/venture/delivery/playbook.ts');
 const {SOCIAL_STEPS}=await import('../runtime/venture/playbooks/social/playbook.ts');
 const playbook={flagship:'social-agency',steps:SOCIAL_STEPS} as any;
 const intake={fields:{channels:['linkedin','x','facebook']}} as any;
 const voice=flagshipDraft(playbook,'repurpose-pack',intake,1)!;
 const posts=flagshipDraft(playbook,'repurpose-pack',intake,2)!;
 assert.ok(!voice.sections.includes('Newsletter blurb'));
 assert.ok(posts.sections.includes('Newsletter blurb'));
 assert.match(posts.guidance.join(' '),/Selected channels: linkedin, x, facebook/);
});
