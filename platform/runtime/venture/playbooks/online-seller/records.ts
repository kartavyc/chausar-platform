// Seller desk records, Chausar original code; research ideas from sealeap and listing-doctor (MIT).
import type { SellerMode } from './source.ts';
/** One source-backed audit result; raw source bytes remain in the standard order upload. */
export type SellerSkuBody = { orderId: string; mode: SellerMode; sourceId: string; sourceName: string; result: unknown; figures: { key: string; display: string; receiptId: string }[]; receipt: { inputs: unknown; steps: unknown; explanation: string } };
/** An owner's source and checked day for a fee card. Never a default provider rate. */
export type SellerFeecardBody = { orderId: string; sourceId: string; checkedOn: string; source: string };
/** Later seller operations remain placeholders until 5F2. */
export type SellerStageBody = { placeholder: true };
export type SellerMovementBody = { placeholder: true };
export type SellerCaseBody = { placeholder: true };
