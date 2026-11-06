/** Developer sample PDFs stay inspectable text, never opaque bytes exempted from secret checks. */
import { check } from '../../portable.ts';
import { assertCaptureText } from './capture.ts';
import { pdfText } from '../core/pdf-text.ts';
type Operation = { method: string; payload: Record<string, unknown> };
function inspectedPdf(text: unknown): string {
  check(typeof text === 'string', 'CAPTURE_INVALID', 'The sample PDF must contain inspected text.');
  assertCaptureText(text);
  check(text.startsWith('%PDF-') && text.trimEnd().endsWith('%%EOF') && /^[\x09\x0a\x0d\x20-\x7e]+$/.test(text) && !/\/Filter\b/.test(text), 'CAPTURE_INVALID', 'Capture only an uncompressed plain-text sample PDF.');
  assertCaptureText(pdfText(Buffer.from(text, 'ascii'), { maxPages: 6, maxChars: 20_000 }));
  return text;
}
export function encodeOperation(method: string, payload: Record<string, unknown>): Operation {
  const copy = structuredClone(payload), attachment = copy.attachment as Record<string, unknown> | undefined;
  if (method === 'venture.about.read' && attachment?.kind === 'resume-pdf' && typeof attachment.contentBase64 === 'string') {
    const bytes = Buffer.from(attachment.contentBase64, 'base64');
    check(bytes.toString('base64') === attachment.contentBase64, 'CAPTURE_INVALID', 'The sample PDF encoding is invalid.');
    attachment.contentBase64 = { samplePdfText: inspectedPdf(bytes.toString('latin1')) };
  }
  const operation = { method, payload: copy }; assertCaptureText(JSON.stringify(operation)); return operation;
}
export function decodeOperation(operation: Operation): Operation {
  const copy = structuredClone(operation);
  const walk = (value: unknown, path: string[]) => {
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if ('samplePdfText' in row) {
      check(copy.method === 'venture.about.read' && path.join('.') === 'attachment.contentBase64' && (copy.payload.attachment as any)?.kind === 'resume-pdf' && Object.keys(row).length === 1, 'CAPTURE_INVALID', 'A sample PDF marker is only valid for its exact attachment field.');
      (copy.payload.attachment as Record<string, unknown>).contentBase64 = Buffer.from(inspectedPdf(row.samplePdfText), 'ascii').toString('base64'); return;
    }
    for (const [key, item] of Object.entries(row)) walk(item, [...path, key]);
  };
  walk(copy.payload, []); return copy;
}
