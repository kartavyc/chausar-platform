/**
 * "Download the file and the checklist" for a prepare-only item (WK-02): a tax filing from the
 * write-back catalogue (`gst-portal return.file`) or a core action whose catalogue row is prepare
 * only (the Tally voucher preview). Two files are written into `<app directory>/exports/`: the
 * exact prepared payload as JSON, and a plain-text checklist. File names are generated here from
 * the time and the item's digest, never from outside text, and an existing file is never replaced.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { check } from '../contracts.ts';
import type { PreparedAction } from '../actions.ts';
import { audit } from '../contracts.ts';
import type { ApprovalDetail, Env } from './work-queue.ts';
import { parseId, visibleActions } from './work-queue.ts';
import { systemTitle } from './work-writeback.ts';

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A safe name: letters, digits and dashes only, from the clock and the digest. */
export function exportName(now: number, digest: string, part: 'prepared' | 'checklist', copy = 0) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
  const short = digest.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'item';
  return `chausar-prepared-${stamp}-${short}${copy ? `-${copy + 1}` : ''}-${part}.${part === 'prepared' ? 'json' : 'txt'}`;
}

function checklist(item: ApprovalDetail, lines: string[]): string {
  const head = [
    `Chausar prepared this. Nothing was sent or filed.`,
    ``,
    `What: ${item.title}`,
    ...(item.touches ? [`Touches: ${item.touches}`] : []),
    `Prepared on: ${item.createdAt}`,
    `Digest of the exact prepared change: ${item.digest}`,
    ``,
    `Checklist`,
  ];
  return [...head, ...lines.map((line, i) => `${i + 1}. ${line}`), ``, `You or your accountant completes this. Chausar never files or enters it for you.`, ``].join('\n');
}

/** The prepared payload and the checklist lines for one prepare-only item the caller may see. */
function prepared(e: Env, item: ApprovalDetail): { payload: unknown; lines: string[] } {
  const { source, raw } = parseId(item.id);
  if (source === 'writeback') {
    const action = (e.state.actions as PreparedAction[]).find(a => a.id === raw && a.connector?.startsWith('wb-'));
    const env = record(action?.payload) ? action!.payload as Record<string, any> : {};
    const payload = record(env.payload) ? env.payload : {};
    if (env.system === 'gst-portal' && env.action === 'return.file') {
      return {
        payload: { form: payload.form, gstin: payload.gstin, period: payload.period, prepared: record(env.preparation) ? env.preparation.command ?? null : null },
        lines: [
          `Check the GSTIN ${String(payload.gstin)} and the period ${String(payload.period)} against your registration.`,
          `Open the GST portal yourself and choose ${String(payload.form)} for ${String(payload.period)}.`,
          `Compare every figure in the prepared file with your books before you enter or upload it.`,
          `File it with your own signature or OTP. Chausar never files a return.`,
          `Keep the acknowledgement (ARN) the portal gives you with this file.`,
        ],
      };
    }
    return { payload, lines: [`Open ${systemTitle(String(env.system ?? ''))} yourself.`, `Enter exactly what the prepared file holds.`, `Check it against the prepared file before you save it.`] };
  }
  const action = visibleActions(e).find(a => a.id === raw);
  check(action, 'NOT_FOUND', 'Approval not found.');
  const voucher = record(action.payload.voucher) ? action.payload.voucher : null;
  return {
    payload: action.payload,
    lines: voucher
      ? [`Open Tally with the right company loaded.`, `Enter a ${String(voucher.type)} voucher dated ${String(voucher.date)}.`, `Enter each ledger line with the debit or credit exactly as in the prepared file.`, `Check that debits and credits balance before you save it.`]
      : [`Open the system this belongs to yourself.`, `Enter exactly what the prepared file holds.`, `Check it against the prepared file before you save it.`],
  };
}

export async function exportPrepared(e: Env, item: ApprovalDetail) {
  check(item.prepareOnly && item.tier === 'prepare-only', 'NOT_PREPARE_ONLY', 'Only a prepare-only item has a file and a checklist.');
  check(item.state === 'prepared', 'INVALID_APPROVAL_STATE', 'Only a waiting item can be downloaded.');
  const { payload, lines } = prepared(e, item);
  const folder = resolve(e.host.directory, 'exports');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const files: { name: string; path: string; bytes: number }[] = [];
  const write = async (part: 'prepared' | 'checklist', body: string) => {
    for (let copy = 0; copy < 50; copy += 1) {
      const name = exportName(e.now, item.digest, part, copy); const path = join(folder, name);
      check(relative(folder, path) === name, 'INVALID_EXPORT_PATH', 'The file must stay in the exports folder.');
      try { await writeFile(path, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as { code?: string })?.code === 'EEXIST') continue; throw error; }
      files.push({ name, path, bytes: Buffer.byteLength(body, 'utf8') }); return;
    }
    check(false, 'EXPORT_FAILED', 'The file could not be saved.');
  };
  await write('prepared', `${JSON.stringify(payload, null, 2)}\n`);
  await write('checklist', checklist(item, lines));
  await e.host.store.update(state => { audit(state, 'approvals.exported', { id: item.id, files: files.map(f => f.name) }); });
  return { files };
}
