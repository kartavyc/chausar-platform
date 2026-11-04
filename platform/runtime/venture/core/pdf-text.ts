// One-shot A4 (hands-on row 9): the engine's PDF text reader: pdf-text-core.ts with Node's zlib for FlateDecode streams.
// A stream cut short still gives what it holds (Z_SYNC_FLUSH), as many writers leave a stray byte at the end. A4 review
// (M3): each stream inflates to at most what is left of the read's budget; past it, zlib stops and the file is refused.
import { constants, inflateSync } from 'node:zlib';
import { pdfText as readText, type InflateResult, type PdfTextOptions } from './pdf-text-core.ts';

export type { PdfTextOptions } from './pdf-text-core.ts';

const inflate = (bytes: Uint8Array, limit: number): InflateResult => {
  if (limit <= 0) return 'too-large';
  try { return new Uint8Array(inflateSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: limit })); }
  // zlib stops at the limit with a RangeError (buffer too large); any other failure is a stream it cannot read.
  catch (error) { return error instanceof RangeError ? 'too-large' : null; }
};

/** The text of a PDF's first pages (pdf-text-core.ts), compressed streams read too. */
export function pdfText(bytes: Uint8Array, options: Omit<PdfTextOptions, 'inflate'> = {}): string {
  return readText(bytes, { ...options, inflate });
}
