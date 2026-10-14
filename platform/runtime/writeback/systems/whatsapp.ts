/**
 * WhatsApp Business Cloud API write adapter (Graph v21.0). Bearer token from the credential broker;
 * the connection names the sending phone number id and the WhatsApp Business Account id.
 * WhatsApp has no read API for messages and no idempotency key: the adapter reads delivery
 * statuses through an injected status source fed by the status webhooks.
 */
import { check } from '../../contracts.ts';
import { json, wire } from '../http.ts';
import { account, effectReference, secret } from '../reference.ts';
import type { ActionAdapter, AdapterContext, SystemAdapters, WireObject } from '../types.ts';
import { phone, record, str, text } from '../validate.ts';

const GRAPH = 'https://graph.facebook.com/v21.0', DIGITS = /^[0-9]{1,30}$/;
export type WhatsAppStatus = { messageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; at: string; reference: string };
export type WhatsAppStatusSource = (ctx: AdapterContext, query: { reference: string; messageId: string | null }) => Promise<WhatsAppStatus[]>;
/** Used when no status webhook is wired: every read-back stays not sure. */
export const noStatusSource: WhatsAppStatusSource = async () => [];

async function call(ctx: AdapterContext, method: 'GET' | 'POST', url: string, body?: WireObject) {
  return json(await ctx.http(wire(method, url, { authorization: `Bearer ${await secret(ctx, 'accessToken')}` }, body)));
}
/** Meta's own rule for body parameters: no new lines or tabs and no more than four spaces in a row. */
function parameter(value: unknown): string {
  const v = text(value, 1000); check(!/[\r\n\t]| {5,}/.test(v), 'INVALID_WRITE_PAYLOAD', 'A template parameter has a line break, a tab or too many spaces.'); return v;
}
/** Distinct {{n}} placeholders in the BODY component; named placeholders count as unusable. */
function bodyCount(template: any): number {
  const body = (Array.isArray(template?.components) ? template.components : []).find((c: any) => str(c?.type).toUpperCase() === 'BODY');
  const names = [...str(body?.text).matchAll(/\{\{\s*([^{}\s]*)\s*\}\}/g)].map(m => m[1]);
  return names.every(n => /^[1-9]\d?$/.test(n)) ? new Set(names).size : -1;
}
const RANK = { sent: 0, delivered: 1, read: 2, failed: 3 } as const;

type Send = { to: string; template: string; language: string; parameters: string[] };
function templateSend(statuses: WhatsAppStatusSource): ActionAdapter<any> {
  const lookup = async (ctx: AdapterContext, reference: string, messageId: string | null) =>
    (await statuses(ctx, { reference, messageId })).filter(s => (s.reference === reference || (messageId !== null && s.messageId === messageId)) && Object.hasOwn(RANK, s.status) && typeof s.messageId === 'string');
  return {
    validate(payload) {
      const p = record(payload, ['to', 'template', 'language', 'parameters']);
      check(Array.isArray(p.parameters) && p.parameters.length <= 10, 'INVALID_WRITE_PAYLOAD', 'A template takes at most ten parameters.');
      return { to: phone(p.to), template: text(p.template, 512, /^[a-z0-9_]{1,512}$/), language: text(p.language, 10, /^[a-z]{2,3}(_[A-Z]{2})?$/), parameters: (p.parameters as unknown[]).map(parameter) } as Send;
    },
    async prepare(ctx, p: Send, key) {
      const reference = effectReference(key), waba = account(ctx, 'wabaId', DIGITS);
      const url = new URL(`${GRAPH}/${waba}/message_templates`); url.searchParams.set('name', p.template);
      const found = ((await call(ctx, 'GET', url.toString())).data ?? []).filter((t: any) => t?.name === p.template && t?.language === p.language);
      const approved = found.find((t: any) => t.status === 'APPROVED');
      check(approved, 'WRITE_PRECONDITION_FAILED', 'This template is not approved by Meta in this language.');
      check(bodyCount(approved) === p.parameters.length, 'WRITE_PRECONDITION_FAILED', 'The template expects a different number of parameters.');
      const prior = await lookup(ctx, reference, null);
      const command = { messaging_product: 'whatsapp', recipient_type: 'individual', to: p.to, type: 'template',
        template: { name: p.template, language: { code: p.language }, ...(p.parameters.length ? { components: [{ type: 'body', parameters: p.parameters.map(t => ({ type: 'text', text: t })) }] } : {}) }, biz_opaque_callback_data: reference };
      return { before: null, command, postconditions: { reference },
        preview: { asWritten: `To: +${p.to}\nTemplate ${p.template} (${p.language}) with: ${p.parameters.length ? p.parameters.map((t, i) => `{{${i + 1}}} ${t}`).join('; ') : 'no parameters'}` },
        target: { label: `WhatsApp message to +${p.to}`, ref: null }, sourceVersion: str(approved.id) || null, alreadyApplied: prior.length ? { externalId: prior[0].messageId } : null };
    },
    async do(ctx, _p, preparation) {
      const sent = await call(ctx, 'POST', `${GRAPH}/${account(ctx, 'phoneNumberId', DIGITS)}/messages`, preparation.command);
      const id = sent?.messages?.[0]?.id;
      check(typeof id === 'string' && /^wamid\.[A-Za-z0-9+/=_.-]{1,400}$/.test(id), 'WRITE_REPLY_INVALID', 'WhatsApp did not return a message id.');
      return { outcome: 'accepted', externalId: id, data: null };
    },
    async readBack(ctx, _p, preparation, _key, receipt) {
      const messageId = receipt?.externalId ?? preparation.alreadyApplied?.externalId ?? null;
      const found = await lookup(ctx, str(preparation.postconditions.reference), messageId);
      if (!found.length) return { outcome: 'inconclusive', reason: 'WhatsApp has not reported this message yet.' };
      const ids = new Set(found.map(s => s.messageId));
      if (ids.size > 1 || (messageId !== null && !ids.has(messageId))) return { outcome: 'conflicting', reason: 'More than one WhatsApp message carries this reference.' };
      const latest = [...found].sort((a, b) => a.at === b.at ? RANK[a.status] - RANK[b.status] : a.at < b.at ? -1 : 1).at(-1)!;
      return { outcome: 'confirmed-applied', observed: { messageId: latest.messageId, status: latest.status, at: latest.at, reference: latest.reference }, externalId: latest.messageId, businessSuccess: latest.status === 'delivered' || latest.status === 'read' };
    },
  };
}

export function createWhatsAppAdapters(statuses: WhatsAppStatusSource): SystemAdapters {
  return Object.freeze({ 'template.send': templateSend(statuses) });
}
