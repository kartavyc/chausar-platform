// Chausar seller tools, sealeap and listing-doctor ideas (MIT), independently implemented.
import type { ToolName } from '../../contracts.ts';
import {sellerOperationTool,SELLER_STAGE_TOOL} from './tools-seller-operations.ts';
import { fileOf, text, receiptOut, type Spec } from './tools.ts';
import { tablesOfFile } from './files.ts';
import { analyseSellerRows, type SellerMode } from '../../playbooks/online-seller/source.ts';
import { sellerTaxSources, sellerIndiaRule } from '../../playbooks/online-seller/rules.ts';
import { sellerWorkReceipt } from '../../playbooks/online-seller/receipt.ts';
import { imageDimensions } from '../../playbooks/online-seller/listing.ts';
import { sellerCall } from '../../playbooks/online-seller/economics.ts';
type Name = Extract<ToolName, 'seller.unitEconomics' | 'seller.ads' | 'seller.settlement' | 'seller.listing' | 'seller.stage' | 'seller.alerts' | 'seller.stock' | 'seller.shortlist' | 'seller.catalogueSheet' | 'seller.multiStore'>;
/** Tools select source files only. Rates and amounts cannot be supplied as model arguments. */
function sellerTool(name: Name, mode: SellerMode, summary: string): Spec {
  return { name, effect: 'compute', tier: 'code', endsTurn: false, summary, input: { file: text('The seller export file, such as f1.', 12), ...(mode === 'ads' ? { economicsFile: text('Optional evidenced unit economics source file.', 12, false) } : {}) }, async run(env, input) {
    const file = fileOf(env, input.file), table = tablesOfFile(file)[0];
    const economics = mode === 'ads' && input.economicsFile ? fileOf(env, input.economicsFile) : null;
    const images = mode === 'listing' ? env.files.filter(f => f.format === 'image').map(image => ({ name: image.name, ...imageDimensions(Buffer.from(image.contentBase64, 'base64')), source: image.id })) : [];
    const result = sellerCall(() => analyseSellerRows(mode, table?.rows.map(row => row.cells) ?? [], { rehearsal: env.runRef.kind !== 'delivery', ...sellerIndiaRule() }, sellerTaxSources(), images, economics ? tablesOfFile(economics)[0]?.rows.map(row => row.cells) ?? [] : undefined));
    const out = receiptOut(env, sellerWorkReceipt({ result, runRef: env.runRef, sourceId: file.id, sourceName: file.name, sourceDigest: file.digest, additionalSources: economics ? [{ id: economics.id, name: economics.name, digest: economics.digest }] : [] }));
    return { result: { ...result, receipt: out.alias, figures: out.figures }, receipts: [out.record] };
  } };
}
export const ONLINE_SELLER_TOOLS: Readonly<Record<Name, Spec>> = Object.freeze({
  'seller.unitEconomics': sellerTool('seller.unitEconomics', 'economics', 'Works out unit economics from evidenced seller inputs; unknowns hold the sheet.'),
  'seller.ads': sellerTool('seller.ads', 'ads', 'Recomputes ACOS from the seller export and checks reconciliation.'),
  'seller.settlement': sellerTool('seller.settlement', 'settlement', 'Splits payout differences into named review estimates; submits nothing.'),
  'seller.listing': sellerTool('seller.listing', 'listing', 'Checks data coverage, listing text, image headers and recorded India declarations.'),
  'seller.stage': SELLER_STAGE_TOOL,
  'seller.alerts': sellerOperationTool('seller.alerts', 'alerts', 'Attention rows from seller exports.'),
  'seller.stock': sellerOperationTool('seller.stock', 'stock', 'Stock counters from movements.'),
  'seller.shortlist': sellerOperationTool('seller.shortlist', 'research', 'Products shortlisted for research.'),
  'seller.catalogueSheet': sellerOperationTool('seller.catalogueSheet', 'catalogue', 'Bulk upload sheets for the seller.'),
  'seller.multiStore': sellerOperationTool('seller.multiStore', 'multi-store', 'Stores compared from exports.'),
});
