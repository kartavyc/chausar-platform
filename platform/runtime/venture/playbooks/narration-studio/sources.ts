// Native manuscript format port; policy and current-source binding are shared with rehearsal.
import {readDocx} from '../kit/ooxml/read.ts';
import type {VentureTx} from '../../records.ts';
import {loadNarrationSource,type NarrationSourceReader} from './source-core.ts';
export const readNarrationSource=(read:NarrationSourceReader|Pick<VentureTx,'find'>,orderId:string,fileId:string,today:string)=>loadNarrationSource({decode:s=>new Uint8Array(Buffer.from(s,'base64')),docx:async bytes=>readDocx(bytes)},read as NarrationSourceReader,orderId,fileId,today);
