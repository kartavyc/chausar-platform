// Chausar ECMA-376 workbook writer. Shared XML parts keep browser demo and native exports identical.
import {zip} from './zip.ts';
import {xlsxParts,type XlsxSheet} from './xlsx-parts.ts';
export {columnName,minorText} from './xlsx-parts.ts';
export type {XlsxCell,XlsxSheet} from './xlsx-parts.ts';
export function writeXlsx(input:{sheets:readonly XlsxSheet[]}):Uint8Array{return zip(xlsxParts(input).map(part=>({name:part.name,bytes:new TextEncoder().encode(part.text)})));}
