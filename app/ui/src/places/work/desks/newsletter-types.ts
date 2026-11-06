import type {NewsletterIssueBody} from '../../../../../../platform/runtime/venture/playbooks/newsletter-studio/records';
import type {NewsletterCheck} from '../../../../../../platform/runtime/venture/playbooks/newsletter-studio/presend';
export type NewsletterView=NewsletterIssueBody&{id:string;stale:boolean;report:ReturnType<typeof import('../../../../../../platform/runtime/venture/playbooks/newsletter-studio/report').newsletterReport>;checks:{pass:boolean;checks:NewsletterCheck[]}|null};
export type NewsletterAct=(id:string,action:string,payload:unknown,digest?:string)=>Promise<{id:string;result:unknown}|null>;
