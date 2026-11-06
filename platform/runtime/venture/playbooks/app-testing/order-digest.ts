import {digest} from '../../../portable.ts';
import type {OrderRecord} from '../../contracts.ts';
export const appOrderDigest=(o:Pick<OrderRecord,'id'|'clientId'|'offerId'|'status'|'intake'|'request'>)=>digest({id:o.id,clientId:o.clientId,offerId:o.offerId,status:o.status,intake:o.intake??null,request:o.request});
