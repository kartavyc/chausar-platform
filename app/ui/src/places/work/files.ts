/**
 * Client files for a new order. The engine takes CSV, Excel (.xlsx) and PDF, each under its upload limit
 * (MAX_UPLOAD_BYTES in platform/runtime/venture/delivery/harness/files.ts), sent as base64. Checking the same two
 * things here first means an order is never created with half its files refused.
 */

export const MAX_FILE_BYTES = 1_450_000;
const FORMATS = ['csv', 'xlsx', 'pdf'];

export type FileProblem = 'type' | 'size';

export function fileProblem(file: { name: string; size: number }): FileProblem | null {
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (!file.name.includes('.') || !FORMATS.includes(extension)) return 'type';
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return 'size';
  return null;
}

function bytesOf(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}

/** The file's bytes as base64, the way `venture.files.add` takes them. */
export async function readBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await bytesOf(file));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
