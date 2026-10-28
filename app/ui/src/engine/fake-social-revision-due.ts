import {COUNTRY_TIME_ZONES} from '../../../../platform/runtime/venture/local-day-data';
// Monthly social reminders are derived from the same due rule as the live queue.
import { socialRevisionDue } from '../../../../platform/runtime/venture/playbooks/social/revision-due-core';
import type { OfferLite, OrderLite, QueueRow } from './types';

export function fakeSocialRevisionDueRows(input: {
  businessId: string; businessName: string; now: string; countryCode?:string;
  orders: readonly OrderLite[]; offers: readonly OfferLite[];
  digest: (seed: unknown) => string;
}): QueueRow[] {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:COUNTRY_TIME_ZONES[input.countryCode??'IN']??'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(input.now));
  return input.orders.flatMap(order => {
    const offer = input.offers.find(item => item.id === order.offerId);
    const due = order.intake?.fields?.revisionDue;
    if (!socialRevisionDue({ status: order.status, offerKey: offer?.playbookOffer ?? '', revisionDue: due }, today)) return [];
    const id = 'social-revision:' + order.id + ':' + String(due);
    return [{
      id, businessId: input.businessId, businessName: input.businessName,
      kind: 'notice' as const, createdAt: order.at,
      title: 'Social revisions are due', line: 'Open this order to review the monthly revisions.',
      digest: input.digest({ id, due, status: order.status }),
      actions: [{ id: 'open' as const, label: 'Open social drafts', primary: true }, { id: 'later' as const, label: 'Later', primary: false }],
      notice: { probe: 'drafts' as const, severity: 'medium' as const, link: '#/work?socialOrder=' + order.id },
    }];
  });
}
