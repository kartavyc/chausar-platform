// Chausar delivery harness: the online-seller playbook's own tools (Online seller and seller services; Ink v2 wave 5,
// packages 5F1, 5F2, 5F3). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package
// replaces each stub with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's
// tools). Written for Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type OnlineSellerToolName = Extract<ToolName, 'seller.unitEconomics' | 'seller.ads' | 'seller.settlement' | 'seller.listing' | 'seller.stage' | 'seller.alerts' | 'seller.stock' | 'seller.shortlist' | 'seller.catalogueSheet' | 'seller.multiStore'>;

export const ONLINE_SELLER_TOOLS: Readonly<Record<OnlineSellerToolName, Spec>> = Object.freeze({
  'seller.unitEconomics': notBuiltTool('seller.unitEconomics', 'compute', 'The profit on each item after fees, shipping and returns, worked out by code.'), // 5F1
  'seller.ads': notBuiltTool('seller.ads', 'compute', 'The ads report read into spend and sales by product.'), // 5F1
  'seller.settlement': notBuiltTool('seller.settlement', 'compute', 'Marketplace payouts checked against the orders and the fee card.'), // 5F1
  'seller.listing': notBuiltTool('seller.listing', 'compute', 'Listings checked against the marketplace rules and the India checks.'), // 5F1
  'seller.stage': notBuiltTool('seller.stage', 'compute', 'A listing or price change staged for you to approve. Nothing goes live.'), // 5F2
  'seller.alerts': notBuiltTool('seller.alerts', 'compute', 'What needs attention today, from the latest exports.'), // 5F2
  'seller.stock': notBuiltTool('seller.stock', 'compute', 'Stock counted from the movements, by code.'), // 5F2
  'seller.shortlist': notBuiltTool('seller.shortlist', 'compute', 'Products to research, shortlisted from the data you added.'), // 5F2
  'seller.catalogueSheet': notBuiltTool('seller.catalogueSheet', 'compute', 'A marketplace\'s bulk upload sheet, filled for you to check and upload.'), // 5F2
  'seller.multiStore': notBuiltTool('seller.multiStore', 'compute', 'Your stores compared side by side from their exports.'), // 5F2
});
