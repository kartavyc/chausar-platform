// Chausar Office writer: shared XML parts with native compression.
import {zip} from './zip.ts';
import {docxParts,type DocxInput} from './docx-parts.ts';
export type {DocxInput} from './docx-parts.ts';
/** Write a code-owned cover and sections as genuine DOCX bytes. */
export function writeDocx(input:DocxInput):Uint8Array{return zip(docxParts(input));}
