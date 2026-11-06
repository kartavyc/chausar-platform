import { createHash, type BinaryLike } from 'node:crypto';

/** SHA-256 of one complete value. Streaming and multi-part hashes keep their own update sequence. */
export function sha256Hex(value: BinaryLike): string {
  return createHash('sha256').update(value).digest('hex');
}
