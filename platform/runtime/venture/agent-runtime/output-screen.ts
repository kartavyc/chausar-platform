import type { Json, ScreenNote } from '../contracts.ts';
import type { AnyReceipt } from '../delivery/deliverable.ts';
import { redactPayload } from '../core/secrets.ts';
import { screenJson, screenNote, type ScreenSetting } from '../policy/untrusted.ts';

/** Screen source text without rewriting authenticated calculator amounts or exposing receipt inputs. */
export function screenJobOutput(tool: string, output: unknown, setting: ScreenSetting): { value: unknown; notes: ScreenNote[] } {
  const notes: ScreenNote[] = [];
  const screen = (value: unknown, keep: ScreenSetting['keep'] = []) => {
    const result = screenJson({ source: 'tool-output', value: JSON.parse(JSON.stringify(value)) as Json }, { ...setting, keep });
    const note = screenNote(result); if (note) notes.push(note);
    return result.value;
  };
  if (tool === 'calculate') {
    const data = output as { result: unknown; receipts: AnyReceipt[]; refs: unknown };
    const text = screen({ result: data.result, refs: data.refs, labels: data.receipts.map(receipt => receipt.figures.map(figure => ({ label: figure.label,
      ...('unit' in figure && figure.unit === 'post' ? { display: figure.display } : {}) }))) }) as { result: unknown; refs: unknown; labels: { label: string; display?: string }[][] } | null;
    if (!text) return { value: null, notes };
    const receipts = data.receipts.map((receipt, index) => ({
      id: receipt.id, kind: receipt.kind, digest: receipt.digest, operation: receipt.operation, currency: receipt.currency,
      ...(receipt.kind === 'venture-work-receipt' ? { runRef: receipt.runRef } : { subject: receipt.subject }),
      figures: receipt.figures.map((figure, field) => ({ ...figure, ...text.labels[index][field] })),
    }));
    return { value: { result: redactPayload(text.result), refs: text.refs, receipts }, notes };
  }
  if (tool === 'read_client' && output && typeof output === 'object' && 'taxId' in output) {
    const { taxId, ...rest } = output;
    const data = screen(rest), tax = screen({ taxId }, ['pan']);
    return { value: data && tax ? { ...(data as object), ...(tax as object) } : null, notes };
  }
  return { value: screen(output), notes };
}
