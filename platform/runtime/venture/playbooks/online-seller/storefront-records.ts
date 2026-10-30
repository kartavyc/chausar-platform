import type {StorefrontCatalogue} from '../../build/storefront-assistant-core.ts';
export type SellerStorefrontBody={domain:string;modelConnectionId:string;maxPages:number;language:'en'|'hi';notice:string;publicTokenDigest:string;catalogue:StorefrontCatalogue;readAt:string;active:boolean;link:{tokenHash:string;expiresAt:string}|null};
/** Only returned to the current owner while the in-memory buyer request exists. Never stored. */
export type StorefrontOwnerPending={id:string;token:string;digest:string;question:string;expiresAt:number;quote:{model:string};cost:{display:string;receipt:{maxMicros:string;rateDigest:string;requestDigest:string;rule:string}}};

import {digest} from '../../../portable.ts';
export const storefrontBinding=(order:{id:string;clientId:string;status:string;intake?:unknown;sellerStorefront?:unknown})=>digest({id:order.id,clientId:order.clientId,status:order.status,intake:order.intake??null,storefront:order.sellerStorefront??null});
