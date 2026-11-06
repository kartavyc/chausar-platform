// Native tender source format ports. Shared policy binds current source bytes and live client order.
import {check} from '../../../contracts.ts';
import type {VentureDeps,UploadRecord} from '../../contracts.ts';
import type {VentureTx} from '../../records.ts';
import {pdfPages} from '../../delivery/harness/files.ts';
import {readXlsx} from '../kit/ooxml/read.ts';
import {readIssuerTender} from './export.ts';
import {loadTenderSourcesCore,type TenderSourceReader} from './sources-core.ts';
export type {TenderSourceSelection} from './records.ts';
export type TenderSourceRead=Pick<VentureTx,'find'>;
/** Read the same source formats with native Office and trusted desktop PDF ports. */
export async function loadTenderSources(deps:VentureDeps,read:TenderSourceRead,orderId:string,raw:unknown){return loadTenderSourcesCore({decode:value=>new Uint8Array(Buffer.from(value,'base64')),pdfText:async upload=>(await pdfPages(deps,upload as UploadRecord)).pages.map(p=>p.text).join('\n'),readXlsx:async bytes=>readXlsx(bytes),readIssuer:async(bytes,map)=>readIssuerTender(bytes,map)},read as TenderSourceReader,orderId,raw);}
/** Reject any source, intake or client change since the question import. */
export async function requireTenderSources(deps:VentureDeps,read:TenderSourceRead,orderId:string,selected:unknown,expected:string){const source=await loadTenderSources(deps,read,orderId,selected);check(source.digest===expected,'DERIVED_STALE','The tender source, client or intake changed. Import the questions again before using these answers.');return source;}
