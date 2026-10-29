import type {DemoProjectBody} from '../../../../../../platform/runtime/venture/playbooks/app-testing/demo-records';
import type {TestFindingBody} from '../../../../../../platform/runtime/venture/playbooks/app-testing/records';
import type {Json} from '../../../../../../platform/runtime/portable';
export type DemoJob=DemoProjectBody&{id:string};
export type TestJob=Omit<TestFindingBody,'apk'>&{id:string;apk:Omit<TestFindingBody['apk'],'path'>};
export type TestingFile={name:string;mime:string;contentBase64:string;bytes:number;sha256:string};
export type TestingAct=(action:string,payload:Json)=>Promise<Record<string,unknown>|null>;
