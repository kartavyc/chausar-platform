/** Tax filings are prepared only, for good: the preview is the checklist; nothing is ever sent. */
import { check } from '../../contracts.ts';
import type { ActionAdapter, SystemAdapters } from '../types.ts';
import { oneOf, record, text } from '../validate.ts';

const returnFile: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['gstin', 'period', 'form']);
    return { gstin: text(p.gstin, 15, /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/), period: text(p.period, 7, /^\d{4}-(0[1-9]|1[0-2])$/), form: oneOf(p.form, ['GSTR-1', 'GSTR-3B'] as const) };
  },
  async prepare(_ctx, p) {
    return { before: null, command: { gstin: p.gstin, period: p.period, form: p.form }, postconditions: {},
      preview: { asWritten: `${p.form} for ${p.period}, GSTIN ${p.gstin}.\nDownload the file and the checklist. You or your CA files it.` },
      target: { label: `${p.form} ${p.period}`, ref: null }, sourceVersion: null, alreadyApplied: null };
  },
  async do() { check(false, 'PREPARE_ONLY', 'Tax filings are prepared only. You or your CA files them.'); },
  async readBack() { return { outcome: 'inconclusive', reason: 'Chausar never files a return.' }; },
};
export const gstPortalAdapters: SystemAdapters = Object.freeze({ 'return.file': returnFile });
