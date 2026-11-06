// SEO panel state contract. GEOHub (AGPL, ideas only), rebuilt independently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePanel, approvePanel, editPanel, observePanel, panelMetrics } from '../runtime/venture/playbooks/seo-visibility/panel.ts';

const spec = () => ({ questions: Array.from({length:15},(_,i)=>({id:`q${i}`,text:`Buyer question ${i}`})), engines:['chatgpt','claude'], timepoints:[{id:'before',from:'2026-10-27T00:00:00.000Z',to:'2026-10-28T00:00:00.000Z'}], repeats:2, minimumFilled:4 });
const code=(wanted:string)=>(error:any)=>error.code===wanted;
test('approval freezes the question-engine-window-repeat panel and gaps remain in the denominator', () => {
  const panel=approvePanel(makePanel(spec()));
  assert.equal(panel.state,'approved');
  assert.match(panel.approvedDigest!,/^[a-f0-9]{64}$/);
  assert.throws(()=>editPanel(panel,{...spec(),repeats:3}),code('PANEL_FROZEN'));
  const observation=observePanel(panel,{questionId:'q0',engine:'chatgpt',timepointId:'before',repeat:1,capturedAt:'2026-10-27T12:00:00.000Z',method:'owner-capture',screenshotFileId:'upload_capture',answer:'Clinic named here.',mentioned:true,fixture:true});
  const metrics=panelMetrics(panel,[observation]);
  assert.deepEqual(metrics.mentions,{numerator:1,denominator:60,missing:59});
  assert.equal(metrics.status,'not-enough-data');
  assert.equal(metrics.live,false);
  assert.equal(metrics.line,'Not enough data. Recorded fixtures are not live visibility evidence.');
});

test('observations reject wrong slots, missing screenshots, duplicate slots and off-window captures',()=> {
  const panel=approvePanel(makePanel(spec()));
  const input={questionId:'q0',engine:'chatgpt',timepointId:'before',repeat:1,capturedAt:'2026-10-27T12:00:00.000Z',method:'owner-capture',screenshotFileId:'upload_capture',answer:'A captured answer.',mentioned:true,fixture:false};
  for(const change of [{engine:'unplanned'},{repeat:3},{capturedAt:'2026-11-01T12:00:00.000Z'},{screenshotFileId:null},{fixture:'false'},{extra:true}]) assert.throws(()=>observePanel(panel,{...input,...change}),code('PANEL_INVALID'));
  const observation=observePanel(panel,input);
  assert.throws(()=>panelMetrics(panel,[observation,observation]),code('PANEL_SLOT_FILLED'));
  assert.throws(()=>observePanel(makePanel(spec()),input),code('PANEL_APPROVAL_REQUIRED'));
});
