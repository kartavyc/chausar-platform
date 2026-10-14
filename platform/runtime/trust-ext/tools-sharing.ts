/** TR-11 sharing, TR-14 hosted promises, TR-15 agreements. */
import { check, ChausarError, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { canonicalJson, fields, memberName, newestFirst, tools } from './tools-common.ts';

const PATTERNS: [string, RegExp][] = [
  ['gstin', /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g],
  ['upi', /\b[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}\b(?!\.)/g],
  ['ifsc', /\b[A-Z]{4}0[A-Z0-9]{6}\b/g],
  ['pan', /\b[A-Z]{5}\d{4}[A-Z]\b/g],
  ['phone', /(?<![\d+])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g],
];
const STAND_IN: Record<string, string> = { gstin: '[GSTIN]', email: '[EMAIL]', upi: '[UPI]', ifsc: '[IFSC]', pan: '[PAN]', phone: '[PHONE]' };

/** The local cleaner: nothing is uploaded; each hit is reported by line and kind only. */
export function cleanSample(_ctx: Context, payload: Record<string, any>) {
  const { text } = fields(payload, ['text']);
  check(typeof text === 'string' && text.length <= 100_000, 'INVALID_SAMPLE', 'Paste up to 100,000 characters of text.');
  const hits: { line: number; kind: string }[] = [];
  const cleaned = text.split('\n').map((line, index) => PATTERNS.reduce((current, [kind, pattern]) => current.replace(pattern, () => { hits.push({ line: index + 1, kind }); return STAND_IN[kind]; }), line)).join('\n');
  return { cleaned, hits, uploaded: false as const };
}

export function sharingView(state: State) {
  const previews = state.learning.filter(item => item.type === 'preview').sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const exports = state.learning.filter(item => item.type === 'export');
  const preview = previews[0] ? { digest: previews[0].digest, bytes: Buffer.byteLength(canonicalJson(previews[0].payload)), events: previews[0].payload?.events?.length ?? 0 } : null;
  const batches = newestFirst(exports.map(item => ({ id: item.id, at: item.at, bytes: Buffer.byteLength(canonicalJson(item.payload)), events: item.payload?.events?.length ?? 0, outcome: item.outcome })));
  return {
    on: state.policy.sharing === true, intake: { open: false as const, words: 'Sharing is not open yet. Nothing is sent.' }, preview,
    batches: batches.map(({ outcome: _, ...batch }) => batch),
    totals: { events: batches.filter(batch => batch.outcome === 'sent').reduce((sum, batch) => sum + batch.events, 0), names: 0 as const, amounts: 0 as const },
    withdrawnAt: tools(state).sharing?.withdrawnAt ?? null,
  };
}
export async function withdrawSharing(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, []);
  await host.call('learning.sharing', { enabled: false });
  await host.store.update(state => { (tools(state).sharing ??= {}).withdrawnAt = now(); });
  return sharingView(host.store.read());
}

export function hostedView() {
  return {
    blind: 'Hosted backup and sync are blind: the server holds only locked files and no key.',
    notBlind: 'Hosted jobs are not blind: the server holds a key for that one job while it works.',
    jobs: [{ id: 'hosted-brief', name: 'Morning brief while this computer is off', on: false as const }, { id: 'hosted-reminders', name: 'Payment reminders while this computer is off', on: false as const }],
    plan: 'planned-not-available' as const,
    keeps: 'The paid plan keeps a record of your account, payments and the times jobs ran for one year. It keeps no business content.',
  };
}

const NOTICE = {
  version: '2026-10-14',
  en: 'Chausar keeps your business records on this computer, locked with your passphrase. Nothing leaves this computer unless a rule you set allows it, and every call that leaves is listed under Network. If you turn sharing on, only the shape of your work is shared: never names, amounts or files. You can withdraw an agreement at any time; what was already shared cannot be called back. You are responsible for your customers\' data; this app helps you see it, delete it and get a report.',
  hi: 'चौसर आपके व्यापार के रिकॉर्ड इसी कंप्यूटर पर रखता है, आपके पासफ़्रेज़ से बंद करके। आपके बनाए नियम के बिना कुछ भी इस कंप्यूटर से बाहर नहीं जाता, और बाहर जाने वाली हर कॉल नेटवर्क में दिखती है। अगर आप साझा करना चालू करते हैं, तो सिर्फ़ आपके काम का ढाँचा साझा होता है: कभी नाम, रकम या फ़ाइलें नहीं। आप कोई भी सहमति कभी भी वापस ले सकते हैं; जो पहले साझा हो चुका है, वह वापस नहीं बुलाया जा सकता। अपने ग्राहकों के डेटा की ज़िम्मेदारी आपकी है; यह ऐप उसे देखने, मिटाने और उसकी रिपोर्ट पाने में मदद करता है।',
};

type Agreement = { id: string; person: string; purpose: string; at: string; withdrawnAt: string | null; kind: 'learning' | 'invoice' };
function agreementItems(state: State): Agreement[] {
  const withdrawn: Record<string, string> = tools(state).withdrawals ?? {};
  const items: Agreement[] = [];
  for (const record of state.learning) if (record.type === 'consent')
    items.push({ id: record.id, person: memberName(state, record.memberId), purpose: 'Share the shape of some work, without names or amounts', at: record.at, withdrawnAt: withdrawn[record.id] ?? null, kind: 'learning' });
  for (const answer of state.answers) if (answer?.kind === 'invoice-opt-in-v1' && answer.status === 'yes')
    items.push({ id: answer.id, person: `Customer ${String(answer.customerId)}`, purpose: 'Receive payment reminders', at: answer.at, withdrawnAt: null, kind: 'invoice' });
  return newestFirst(items);
}
export function agreementsView(state: State) { return { notice: NOTICE, items: agreementItems(state).map(({ kind: _, ...item }) => item) }; }

export async function withdraw(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { id } = fields(payload, ['id']);
  check(typeof id === 'string' && id.length > 0 && id.length <= 200, 'INVALID_REQUEST', 'Choose an agreement.');
  const item = agreementItems(host.store.read()).find(agreement => agreement.id === id);
  check(item, 'NOT_FOUND', 'That agreement was not found.');
  if (item.kind !== 'learning') throw new ChausarError('WITHDRAW_NOT_AVAILABLE', 'A customer withdraws reminder consent themselves by replying STOP; record that in the reminder screen.');
  if (!item.withdrawnAt) {
    await host.call('learning.sharing', { enabled: false });
    await host.store.update(state => { (tools(state).withdrawals ??= {})[id] = now(); });
  }
  return agreementsView(host.store.read());
}
