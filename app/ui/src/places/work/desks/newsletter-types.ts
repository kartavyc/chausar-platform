import type {NewsletterIssueBody} from '../../../../../../platform/runtime/venture/playbooks/newsletter-studio/records';
import type { NewsletterCheck } from '../../../../../../platform/runtime/venture/playbooks/newsletter-studio/presend.ts';
export type NewsletterView=NewsletterIssueBody&{id:string;stale:boolean;report:ReturnType<typeof import('../../../../../../platform/shared/venture/playbooks/newsletter-studio/report.ts').newsletterReport>;checks:{pass:boolean;checks:NewsletterCheck[]}|null};
export type NewsletterAct=(id:string,action:string,payload:unknown,digest?:string)=>Promise<{id:string;result:unknown}|null>;
