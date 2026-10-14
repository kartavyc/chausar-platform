/** A stateful WhatsApp Business Cloud API account in memory: message templates, sent messages and the status callbacks a webhook would deliver. */
import { readFileSync } from 'node:fs';
import { HttpFake, body, reply, type Route } from '../http-fake.ts';
import type { WhatsAppStatus, WhatsAppStatusSource } from '../../runtime/writeback/systems/whatsapp.ts';
import type { WireObject, WireRequest } from '../../runtime/writeback/types.ts';

type Rec = Record<string, any>;
export type WhatsAppSeed = { phoneNumberId: string; wabaId: string; token: string; templates: Rec[] };
export const whatsappSeed: WhatsAppSeed = JSON.parse(readFileSync(new URL('../../../fixtures/writeback/whatsapp.json', import.meta.url), 'utf8'));

const placeholders = (template: Rec) => new Set([...String((template.components ?? []).find((c: Rec) => c.type === 'BODY')?.text ?? '').matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1])).size;
const graphError = (status: number, code: number, message: string) => reply(status, { error: { message, type: 'OAuthException', code, fbtrace_id: 'practice' } });

export class WhatsAppFake extends HttpFake {
  readonly system = 'whatsapp' as const;
  readonly phoneNumberId: string; readonly wabaId: string; readonly token: string;
  templates: Rec[]; messages: (Rec & { statuses: WhatsAppStatus[] })[] = [];
  #next = 1; #silent = false; #clock: () => string;
  constructor(seed: WhatsAppSeed = whatsappSeed, clock: () => string = () => new Date().toISOString()) {
    super(); this.phoneNumberId = seed.phoneNumberId; this.wabaId = seed.wabaId; this.token = seed.token; this.#clock = clock;
    this.templates = structuredClone(seed.templates);
  }
  /** Stops status callbacks: messages sent from now on get no status, as when the webhook is down. */
  silence() { this.#silent = true; }
  protected authorized(request: WireRequest) { return request.headers.authorization === `Bearer ${this.token}`; }
  protected routes(): Route[] {
    return [
      { method: 'GET', path: /^\/v21\.0\/(\d+)\/message_templates$/, write: false, handle: (_r, m, url) => {
        if (m[1] !== this.wabaId) return graphError(400, 100, 'Unsupported get request.');
        const name = url.searchParams.get('name');
        return reply(200, { data: this.templates.filter(t => !name || t.name.includes(name)), paging: { cursors: { before: 'B', after: 'A' } } });
      } },
      { method: 'POST', path: /^\/v21\.0\/(\d+)\/messages$/, write: true, handle: (request, m) => {
        if (m[1] !== this.phoneNumberId) return graphError(400, 100, 'Unsupported post request.');
        const b = body(request);
        if (b.messaging_product !== 'whatsapp' || b.type !== 'template' || !/^\d{8,15}$/.test(String(b.to))) return graphError(400, 100, 'Invalid parameter.');
        const template = this.templates.find(t => t.name === b.template?.name && t.language === b.template?.language?.code && t.status === 'APPROVED');
        if (!template) return graphError(404, 132001, 'Template name does not exist in the translation.');
        const parameters = (b.template.components ?? []).find((c: Rec) => c.type === 'body')?.parameters ?? [];
        if (parameters.length !== placeholders(template)) return graphError(400, 132000, 'Number of parameters does not match the expected number of params.');
        const id = `wamid.PRACTICE${String(this.#next++).padStart(8, '0')}`, at = this.#clock(), reference = String(b.biz_opaque_callback_data ?? '');
        this.messages.push({ id, to: b.to, template: template.name, language: template.language, parameters: parameters.map((p: Rec) => p.text), reference, at,
          statuses: this.#silent ? [] : [{ messageId: id, status: 'sent', at, reference }, { messageId: id, status: 'delivered', at, reference }] });
        return reply(200, { messaging_product: 'whatsapp', contacts: [{ input: b.to, wa_id: b.to }], messages: [{ id, message_status: 'accepted' }] });
      } },
    ];
  }
  /** What the status webhook would have delivered for a reference or a message id. */
  readonly statuses: WhatsAppStatusSource = async (_ctx, query) =>
    structuredClone(this.messages.filter(m => m.reference === query.reference || m.id === query.messageId).flatMap(m => m.statuses));
  /** Makes the template of a prepared send exist and be approved. */
  prime(payload: WireObject) {
    const p = payload as Rec;
    if (typeof p.template === 'string' && !this.templates.some(t => t.name === p.template && t.language === p.language && t.status === 'APPROVED')) {
      const count = Array.isArray(p.parameters) ? p.parameters.length : 0;
      this.templates.push({ id: `3000000000${String(this.templates.length + 1).padStart(5, '0')}`, name: p.template, language: p.language, status: 'APPROVED', category: 'UTILITY', parameter_format: 'POSITIONAL',
        components: [{ type: 'BODY', text: `Practice template ${Array.from({ length: count }, (_, i) => `{{${i + 1}}}`).join(' ')}`.trim() }] });
    }
  }
  snapshot(): WireObject { return structuredClone({ templates: this.templates, messages: this.messages }) as unknown as WireObject; }
}
