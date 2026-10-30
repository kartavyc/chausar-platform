// Original browser-safe identity of the qualified Tally accounting-only material fields.
import {digest,check} from '../../portable.ts';
import {booksDate} from '../../venture/playbooks/bookkeeping-cfo/books-input.ts';
export type TallyMaterial={companyGuid:string;recipientId:string;date:string;reference:string;lines:{ledgerGuid:string;amountMinor:string}[]};
export function tallyMaterialDigest(value:TallyMaterial):string{booksDate(value.date);for(const id of [value.companyGuid,value.recipientId,...value.lines.map(line=>line.ledgerGuid)])check(/^[a-zA-Z0-9-]{8,100}$/.test(id),'BOOKS_READ_FAILED','Read the exact Tally ledger and company identities.');check(/^chausar-[a-f0-9]{32}$/.test(value.reference)&&value.lines.length>0&&value.lines.length<=50&&value.lines.every(line=>/^[1-9]\d{0,15}$/.test(line.amountMinor)),'BOOKS_READ_FAILED','Read the supported accounting voucher fields.');return digest({profile:'tally-sales-accounting-inr-no-tax-v1',...value});}
