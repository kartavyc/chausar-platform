import type {NarrationSegmentBody} from '../narration-studio/records.ts';
import type {TestingAiState} from './ai-records.ts';
// Original durable demo state. Tokens and owner-entered test-account credentials are never persisted here.
import type {DemoPlan} from './demo.ts';import type {DemoInput} from './demo-types.ts';
export type DemoSession={runId:string;imageId:string;containerId:string};
export type DemoOperation='start'|'input'|'record'|'finish'|'close';
export type DemoPending={id:string;operation:DemoOperation;imageId:string|null;input:DemoInput|null;seconds:number|null;sessionSeconds:number|null;cleanup:'automatic-on-exit-or-expiry'|null;expiresAt:string;digest:string};
export type DemoAttempt={id:string;operation:DemoOperation;phase:'running'|'applied'|'not-run'|'unknown';at:string;journalId:string;line:string};
export type DemoVideo={name:string;contentBase64:string;bytes:number;digest:string;durationMs:number;width:number;height:number};
export type DemoRendered={sourceDigest:string;digest:string;video:DemoVideo;captions:string;captionChecksNotRun:{check:'pause-breaks';why:string}[];timing:string;disclosure:string|null};
export type DemoProjectBody=TestingAiState&{orderId:string;clientId:string;orderDigest:string;plan:DemoPlan;approvedPlan:string|null;session:DemoSession|null;pending:DemoPending|null;attempts:DemoAttempt[];video:DemoVideo|null;rendered:DemoRendered|null;reviewDigest:string|null;voiceRows:NarrationSegmentBody[]};
