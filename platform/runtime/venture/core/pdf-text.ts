// One-shot A4 (hands-on row 9): the engine's PDF text reader: pdf-text-core.ts with Node's zlib for FlateDecode streams.
// A stream cut short still gives what it holds (Z_SYNC_FLUSH), as many writers leave a stray byte at the end.
import { constants, inflateSync } from 'node:zlib';
import { pdfText as readText, type PdfTextOptions } from './pdf-text-core.ts';

export type { PdfTextOptions } from './pdf-text-core.ts';

const inflate = (bytes: Uint8Array): Uint8Array | null => {
  try { return new Uint8Array(inflateSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: 32 * 1024 * 1024 })); } catch { return null; }
};

/** The text of a PDF's first pages (pdf-text-core.ts), compressed streams read too. */
export function pdfText(bytes: Uint8Array, options: Omit<PdfTextOptions, 'inflate'> = {}): string {
  return readText(bytes, { ...options, inflate });
}
