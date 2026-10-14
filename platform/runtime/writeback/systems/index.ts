import type { SystemAdapters, SystemId } from '../types.ts';
import { zohoBooksAdapters } from './zoho-books.ts';
import { gstPortalAdapters } from './gst-portal.ts';
import { tallyAdapters } from './tally.ts';
import { razorpayAdapters } from './razorpay.ts';
import { shopifyAdapters } from './shopify.ts';
import { googleWorkspaceAdapters } from './google-workspace.ts';
import { mailAdapters } from './mail.ts';
import { createWhatsAppAdapters, noStatusSource, type WhatsAppStatusSource } from './whatsapp.ts';
import type { Transport } from '../types.ts';

export type AdapterOptions = { whatsappStatuses?: WhatsAppStatusSource };
/** Practice fakes register their status callbacks by transport; a production transport never matches. */
export const practiceStatuses = new WeakMap<Transport, WhatsAppStatusSource>();
/** Every installed adapter, by system and catalogue action. */
export function installedAdapters(options: AdapterOptions = {}): Partial<Record<SystemId, SystemAdapters>> {
  return { 'zoho-books': zohoBooksAdapters, 'gst-portal': gstPortalAdapters, tally: tallyAdapters, razorpay: razorpayAdapters, shopify: shopifyAdapters, 'google-workspace': googleWorkspaceAdapters, mail: mailAdapters,
    whatsapp: createWhatsAppAdapters(async (ctx, query) => (practiceStatuses.get(ctx.http) ?? options.whatsappStatuses ?? noStatusSource)(ctx, query)) };
}
