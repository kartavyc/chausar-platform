import type {TestingAiState} from './ai-records.ts';
// Original exact client test state. Types only; native APK bytes never enter browser replies.
import type {FindingReproduction} from './report-core.ts';
import type {AppTestPlan} from './test-plan.ts';import type {AppFinding,FindingDecision} from './logcat.ts';
export type AppTestOperation='install'|'launch'|'tap'|'stop'|'remove';
export type AppTestPending={id:string;operation:AppTestOperation;stepId:string|null;serial:string;screenDigest:string;point:{x:number;y:number}|null;expiresAt:string;digest:string};
export type AppTestAttempt={id:string;operation:AppTestOperation;stepId:string|null;phase:'running'|'applied'|'not-run'|'unknown';at:string;journalId:string;line:string};
/** One complete client test job owns its source and reviewed findings; exact revisions invalidate every pending effect. */
export type TestFindingBody=TestingAiState&{orderId:string;clientId:string;orderDigest:string;apk:{path:string;name:string;sha256:string;bytes:number;packageName:string;component:string;versionCode:string;permissions:string[]};serial:string|null;plan:AppTestPlan|null;approvedPlan:string|null;pending:AppTestPending|null;attempts:AppTestAttempt[];findings:AppFinding[];decisions:FindingDecision[];reproductions:FindingReproduction[];logDigest:string|null;reportDigest:string|null};

/** Opaque authority retained only until the exact client app is absent from its emulator. */
export type AppTestErasure={serial:string;packageName:string;apkSha256:string};
