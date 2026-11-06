// Original tender Office export transport. Shared pure parts keep rehearsal and native validation identical.
import {check} from '../../../portable.ts';
import {unzip,zip} from '../kit/ooxml/zip.ts';
import {scanZip} from '../kit/ooxml/zip-core.ts';
import {readIssuerTenderParts,fillIssuerTenderParts,tenderExportParts,tenderColumnMap} from './export-core.ts';
export type {TenderExportRow,IssuerTenderMap,IssuerTenderRow} from './export-core.ts';
function source(bytes:Uint8Array){check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=8000000,'TENDER_EXPORT_INVALID','Use an issuer workbook below eight megabytes.');const limits={maxEntries:1000,maxBytes:32000000};return {entries:unzip(bytes,limits),count:scanZip(bytes,limits).count};}
/** Read issuer rows only after an explicit bounded column map. */
export function readIssuerTender(bytes:Uint8Array,map:unknown){tenderColumnMap(map);const s=source(bytes);return readIssuerTenderParts(s.entries,s.count,map);}
/** Preserve untargeted issuer entries while filling only reviewed answer cells. */
export function fillIssuerTender(bytes:Uint8Array,map:unknown,answers:readonly {row:number;answer:string}[]):Uint8Array{tenderColumnMap(map);const s=source(bytes);return zip(fillIssuerTenderParts(s.entries,s.count,map,answers));}
/** Write code-owned response and compliance files for owner download. */
export function tenderExportPack(input:Parameters<typeof tenderExportParts>[0]){const p=tenderExportParts(input);return {docx:zip(p.docx),xlsx:zip(p.xlsx),csv:p.csv};}
