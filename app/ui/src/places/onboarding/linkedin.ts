/**
 * About you's file attach (W6 6C2): a resume PDF goes as it is (at most 1 MB); a LinkedIn data export ZIP is opened
 * here and only its Profile.csv is packed into a small ZIP of its own before anything is sent, so the rest of the export
 * (connections, messages, everything else) never leaves the page. The engine then keeps only Profile.csv's headline,
 * summary, industry and location (platform/runtime/venture/core/profile-csv.ts).
 */
import { EngineError } from '../../engine/types';
import { profileEntry } from '../../../../../platform/shared/venture/core/profile-csv.ts';
import { storedZipBytes } from '../../../../../platform/shared/venture/playbooks/kit/ooxml/browser.ts';
import { verifiedEntry } from '../../../../../platform/shared/venture/playbooks/kit/ooxml/zip-core.ts';

export const FILE_MAX_BYTES = 1024 * 1024;
export type AboutFile = { name: string; kind: 'resume-pdf' | 'linkedin-zip'; contentBase64: string };

function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

async function inflate(packed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(packed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function bytesOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** The file as About you sends it, or a plain refusal (the words are the engine's own). */
export async function aboutFile(file: File, words: { tooBig: string; kind: string }): Promise<AboutFile> {
  const name = file.name.replace(/[\r\n\t]+/g, ' ').slice(0, 200) || 'file';
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    if (file.size > FILE_MAX_BYTES) throw new EngineError('INVALID_VENTURE_REQUEST', words.tooBig);
    return { name, kind: 'resume-pdf', contentBase64: base64(await bytesOf(file)) };
  }
  if (!/\.zip$/i.test(file.name) && !/zip/.test(file.type)) throw new EngineError('INVALID_VENTURE_REQUEST', words.kind);
  const entry = profileEntry(await bytesOf(file));
  let plain: Uint8Array;
  try { plain = verifiedEntry(entry, entry.method === 0 ? entry.packed : await inflate(entry.packed)).bytes; }
  catch { throw new EngineError('INVALID_VENTURE_REQUEST', 'Profile.csv in that ZIP could not be read.'); }
  const packed = storedZipBytes([{ name: 'Profile.csv', bytes: plain }]);
  if (packed.length > FILE_MAX_BYTES) throw new EngineError('INVALID_VENTURE_REQUEST', words.tooBig);
  return { name, kind: 'linkedin-zip', contentBase64: base64(packed) };
}
