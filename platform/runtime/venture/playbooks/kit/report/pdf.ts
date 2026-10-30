// Chausar playbook kit (Ink v2 wave 5, package 5A5, P11): a report's PDF, printed from its own HTML through a print
// port the host gives the engine. Only the desktop has one: Electron's printToPDF in the main process
// (app/desktop/report-print.cjs), reached over the worker's own channel (processPrintPort). Hosted, and anywhere
// without the port, the report is its HTML file and says why. When the report has Hindi and the computer has no font
// that draws Devanagari, the port says so and no PDF is made: a PDF of empty boxes would be worse than none, so the
// HTML stays the report with the reason. Written for Chausar; nothing is learned from an outside source.
import { randomUUID } from 'node:crypto';
import type { VentureHostKind } from '../../../contracts.ts';
import type { PrintPort, PrintResult } from '../records-report.ts';
import { hasDevanagari } from './render-html.ts';

export type { PrintPort, PrintRequest, PrintResult } from '../records-report.ts';

/** Why a report has no PDF, in the owner's words. */
export const PDF_WORDS = Object.freeze({
  hindi: 'The PDF could not draw Hindi on this computer, so the report is the HTML file.',
  hosted: 'A PDF needs the desktop app.',
  failed: 'The PDF could not be made on this computer, so the report is the HTML file.',
});
/** The largest PDF a report keeps. */
const MAX_PDF_BYTES = 8_000_000;

/**
 * The PDF of a report's HTML, or null with the reason. Hosted (and any host without a print port) makes none; a port
 * that cannot draw Hindi, fails, or answers something that is not a PDF makes none, and says which.
 */
export async function pdfOf(deps: { host: VentureHostKind; print?: PrintPort }, html: string): Promise<{ pdf: Uint8Array | null; note: string | null }> {
  if (deps.host === 'hosted-web' || !deps.print) return { pdf: null, note: PDF_WORDS.hosted };
  let result: PrintResult;
  try {
    result = await deps.print.print({ html, scripts: hasDevanagari(html) ? ['latin', 'devanagari'] : ['latin'] });
  } catch {
    return { pdf: null, note: PDF_WORDS.failed };
  }
  if (!result || result.ok !== true) return { pdf: null, note: result?.ok === false && result.reason === 'font-missing' ? PDF_WORDS.hindi : PDF_WORDS.failed };
  const pdf = typeof result.pdfBase64 === 'string' ? Buffer.from(result.pdfBase64, 'base64') : Buffer.alloc(0);
  if (pdf.length < 8 || pdf.length > MAX_PDF_BYTES || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return { pdf: null, note: PDF_WORDS.failed };
  return { pdf: new Uint8Array(pdf), note: null };
}

/** The worker's side of the desktop's print channel: what it sends, and what comes back. */
type PrintChannel = {
  connected?: boolean;
  send?: (message: unknown, callback?: (error: Error | null) => void) => boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  off?(event: 'message', listener: (message: unknown) => void): unknown;
};

/**
 * A print port over the engine worker's channel to the desktop main process: it sends { kind: 'host-print', printId,
 * html, scripts } and waits for { kind: 'host-print-result', printId, ok, pdfBase64 | reason } (engine-harness.cjs
 * passes it to report-print.cjs). No answer within timeoutMs is a failure; nothing is retried.
 */
export function processPrintPort(channel: PrintChannel, options: { timeoutMs?: number } = {}): PrintPort {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const waiting = new Map<string, (result: PrintResult) => void>();
  const onMessage = (message: unknown) => {
    const reply = message as { kind?: unknown; printId?: unknown; ok?: unknown; pdfBase64?: unknown; reason?: unknown } | null;
    if (!reply || reply.kind !== 'host-print-result' || typeof reply.printId !== 'string') return;
    const settle = waiting.get(reply.printId);
    if (!settle) return;
    waiting.delete(reply.printId);
    settle(reply.ok === true && typeof reply.pdfBase64 === 'string' ? { ok: true, pdfBase64: reply.pdfBase64 } : { ok: false, reason: reply.reason === 'font-missing' ? 'font-missing' : 'failed' });
  };
  // Listening starts at the first print, so a worker that never prints keeps no listener on its channel.
  let listening = false;
  return {
    print(request) {
      return new Promise(resolve => {
        if (!channel.connected || typeof channel.send !== 'function') { resolve({ ok: false, reason: 'failed' }); return; }
        if (!listening) { channel.on('message', onMessage); listening = true; }
        const printId = randomUUID();
        const timer = setTimeout(() => { if (waiting.delete(printId)) resolve({ ok: false, reason: 'failed' }); }, timeoutMs);
        timer.unref?.();
        waiting.set(printId, result => { clearTimeout(timer); resolve(result); });
        try {
          channel.send({ kind: 'host-print', printId, html: request.html, scripts: request.scripts }, error => {
            if (error && waiting.delete(printId)) { clearTimeout(timer); resolve({ ok: false, reason: 'failed' }); }
          });
        } catch {
          if (waiting.delete(printId)) { clearTimeout(timer); resolve({ ok: false, reason: 'failed' }); }
        }
      });
    },
  };
}
