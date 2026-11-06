// Chausar Office reader: shared bounded XML parser, native ZIP transport.
import {unzip} from './zip.ts';
import {readDocxParts,readXlsxParts} from './read-parts.ts';
/** Read document paragraphs without following links or running content. */
export function readDocx(bytes:Uint8Array){return readDocxParts(unzip(bytes));}
/** Read every bounded worksheet as text, retaining row and column positions. */
export function readXlsx(bytes:Uint8Array){return readXlsxParts(unzip(bytes));}
