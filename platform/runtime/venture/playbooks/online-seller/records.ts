// Seller desk records, Chausar original code; research ideas from sealeap and listing-doctor (MIT).
import type { SellerMode } from './source.ts';
/** One source-backed audit result; raw source bytes remain in the standard order upload. */
export type SellerSkuBody = { orderId: string; mode: SellerMode; sourceId: string; sourceName: string; result: unknown; figures: { key: string; display: string; receiptId: string }[]; receipt: { inputs: unknown; steps: unknown; explanation: string } };
/** An owner's source and checked day for a fee card. Never a default provider rate. */
export type SellerFeecardBody = { orderId: string; sourceId: string; checkedOn: string; source: string };
/** Later package 5F2 owns staged writes, movements and case tracking. */
export type SellerStageBody = { orderId:string;clientId:string;sourceId:string;sourceDigest:string;readId:string;status:'staged'|'confirmed'|'handoff';approvedBy:string|null;approvedAt:string|null;handoff:{name:string;text:string}|null } & ({stageKind:'change';receiptId:string;figures:{key:string;label:string;minor:string;display:string;currency:string;unit:string;receiptId:string}[];receipt:{inputs:unknown;steps:unknown;explanation:string};proposal:import('./staging.ts').SellerStaged}|{stageKind:'photo';receiptId:string;figures:{key:string;label:string;minor:string;display:string;currency:string;unit:string;receiptId:string}[];receipt:{inputs:unknown;steps:unknown;explanation:string};proposal:ReturnType<typeof import('./photos.ts').sellerPhotoBrief>;imported:{variant:number;assetId:string}[]});
export type SellerMovementBody = {orderId:string;clientId:string;movement:import('./stock.ts').SellerMovement};
export type SellerCaseBody = {orderId:string;clientId:string;data:ReturnType<typeof import('./cases.ts').sellerCase>};
