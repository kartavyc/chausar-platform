// Original Chausar due-date projection, shared by the live and rehearsal queues.
export const SOCIAL_MONTHLY_OFFERS=['content-calendar','community-replies','monthly-report','repurpose-pack','linkedin-ghostwriting'] as const;
export function socialRevisionDue(order:{status:string;offerKey:string;revisionDue?:unknown},today:string):boolean{
 return !['delivered','cancelled'].includes(order.status)&&SOCIAL_MONTHLY_OFFERS.includes(order.offerKey as typeof SOCIAL_MONTHLY_OFFERS[number])&&typeof order.revisionDue==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(order.revisionDue)&&Number.isFinite(Date.parse(order.revisionDue))&&order.revisionDue<=today;
}
