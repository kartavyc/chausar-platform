import {playbookForRun} from '../../delivery/workflow.ts';
// Current source authority for Work, tools and final acceptance. No model can replace reviewed recorded evidence.
import {check,type State} from '../../../contracts.ts';
import {digest,listRecords,findRecord} from '../../records.ts';
import type {DeliveryRunRecord} from '../../contracts.ts';
import {appOrderDigest} from './runtime.ts';
import {requireAppTestingClientRule} from './rules.ts';
import {assertClientApk} from './apk-source.ts';
import {requireTestPlan} from './test-plan.ts';
import {appTestReport} from './report-core.ts';
import {demoMediaSource,currentDemoRender,expectedDemoReview} from './demo-source.ts';
import {testingDeliverable,type TestingDeliveryEvidence} from './delivery-core.ts';
import {renderDeliverable} from '../../delivery/deliverable.ts';
export function testingRunSource(state:State,ventureId:string,orderId:string,now:string):TestingDeliveryEvidence{
 requireAppTestingClientRule();const venture=findRecord(state,'venture-record',ventureId),order=listRecords(state,'venture-order',ventureId).find(r=>r.id===orderId),offer=venture?.acceptedBlueprintId?findRecord(state,'venture-blueprint',venture.acceptedBlueprintId)?.offers.find(o=>o.id===order?.offerId):null;
 check(order&&['open','invoiced'].includes(order.status)&&offer&&['app-test-round','demo-video'].includes(offer.playbookOffer??''),'ORDER_NOT_FOUND','Choose a current app testing order.');
 if(offer.playbookOffer==='app-test-round'){
  const row=listRecords(state,'venture-test-finding',ventureId).find(r=>r.orderId===orderId&&r.clientId===order.clientId);check(row,'APP_TEST_NOT_FOUND','Import the current client build.');check(row.orderDigest===appOrderDigest(order),'APPROVAL_STALE','The current client order changed.');assertClientApk(row.apk);check(row.plan&&row.logDigest&&row.reportDigest,'FINDING_REVIEW_REQUIRED','Review the current recorded findings first.');requireTestPlan(row.plan,row.approvedPlan);
  const report=appTestReport({packageName:row.apk.packageName,apkSha256:row.apk.sha256,planDigest:row.plan.digest,steps:row.plan.steps,attempts:row.attempts,findings:row.findings,decisions:row.decisions,reproductions:row.reproductions});check(report.digest===row.reportDigest,'APPROVAL_STALE','Review the current recorded findings.');return{kind:'test',files:[],binding:digest({order:row.orderDigest,report:report.digest}),text:report.text+'\nDownload the current DOCX and PDF or HTML report in the testing desk. No client was contacted.'};
 }
 const row=listRecords(state,'venture-demo-project',ventureId).find(r=>r.orderId===orderId&&r.clientId===order.clientId);check(row,'DEMO_NOT_FOUND','Prepare and review the actual demo video first.');check(row.orderDigest===appOrderDigest(order),'APPROVAL_STALE','The current client order changed.');const source=demoMediaSource(state,ventureId,order,row,now),rendered=currentDemoRender(row,source.sourceDigest);check(row.reviewDigest===expectedDemoReview(row),'APPROVAL_REQUIRED','Watch, listen and review every shot of the current rendered video.');
 return{kind:'demo',files:[{id:row.id+':video',name:'demo.mp4',digest:rendered.video.digest}],binding:digest({source:source.sourceDigest,render:rendered.digest,review:row.reviewDigest}),text:['Reviewed demo.mp4',row.plan.title,row.plan.description,'Video receipt: '+rendered.video.digest,'Owner watched and listened to the complete file and confirmed every planned shot.','Caption timing: '+rendered.timing,'Automatic word-level pause checks were not run.','Download demo.mp4 and its captions in the testing desk. No client was contacted.'].join('\n')};
}
export function testingRunCurrent(state:State,ventureId:string,run:DeliveryRunRecord,now:string){if(playbookForRun(state,run)?.flagship!=='app-testing')return;const source=testingRunSource(state,ventureId,run.orderId,now);check(run.appTestingBinding===source.binding&&digest(run.deliverable)===digest(testingDeliverable(source)),'APPROVAL_STALE','The source report or video changed. Start Work again from the current reviewed files.');const venture=findRecord(state,'venture-record',ventureId)!;check(run.renderedText===renderDeliverable(testingDeliverable(source),[],venture.country),'APPROVAL_STALE','Use the exact source-bound delivery text.');return source;}

/** No generic judge may send private or undeclared client evidence to a remote model. Local review stays available. */
export function testingJudgeCurrent(state:State,ventureId:string,run:DeliveryRunRecord,now:string){const source=testingRunCurrent(state,ventureId,run,now);if(source){const order=findRecord(state,'venture-order',run.orderId);check(order?.intake?.fields?.private===false,'PRIVATE_NEEDS_LOCAL','Private client sources need a qualified local model.');}return source;}
