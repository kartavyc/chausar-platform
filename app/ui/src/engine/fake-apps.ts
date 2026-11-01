/**
 * The fake engine's mini apps (wave 6 package 6H1, D39), as the engine's apps/apps.ts answers them: the same methods,
 * codes, words (apps/words.ts), checks (apps/frame.ts) and calculator (apps/calc.ts). The fake has no AI, so "make"
 * writes a fixed sample app from the owner's words (a sheet of clients and what each owes, with notes and a reminder
 * card); every other answer follows the engine field for field. The sample business starts with one app, allowed and
 * not pinned, so Today at rest is unchanged.
 */

import {
  APP_PERMISSIONS, APP_TOOLS, appCodeFindings, appDocument, appUri, exportDocument, permissionsOf, type AppPermission,
} from '../../../../platform/runtime/venture/apps/frame';
import { APP_ERRORS, APP_IDEAS, APP_LINES, APP_NEVER_LINE, madeLine, PERMISSION_WORDS } from '../../../../platform/runtime/venture/apps/words';
import { appCalcPlan, appCalcSubject } from '../../../../platform/runtime/venture/apps/calc';
import { formatMinor } from '../../../../platform/runtime/currency';
import { EngineError, type ClientLite, type MiniAppCallResult, type MiniAppCard, type MiniAppMessage, type MiniAppView, type OrderLite, type ReceiptLite } from './types';

export const FAKE_APP_METHODS: ReadonlySet<string> = new Set([
  'venture.apps.list', 'venture.apps.get', 'venture.apps.make', 'venture.apps.grant', 'venture.apps.revoke', 'venture.apps.restore',
  'venture.apps.pin', 'venture.apps.export', 'venture.apps.call', 'venture.apps.remove',
]);
const APP_ONLY = new Set([...FAKE_APP_METHODS].filter((method) => method !== 'venture.apps.list' && method !== 'venture.apps.get'));
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const NOTE_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const SECRET = /\b(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,})\b|\b\d{4}\s?\d{4}\s?\d{4}\b|\b[A-Z]{5}\d{4}[A-Z]\b/;

/** The sample app the fake writes: who owes what, attendance marks kept as notes, and a reminder card on Today. */
export const SAMPLE_APP_HTML = '<h1>Who owes me</h1><p id="status">Loading</p><table><thead><tr><th scope="col">Client</th><th scope="col">Owes</th><th scope="col"><span hidden>Action</span></th></tr></thead><tbody id="rows"></tbody></table>'
  + '<script>(function(){var rows=document.getElementById("rows"),status=document.getElementById("status");'
  + 'function cell(tr,text){var td=document.createElement("td");td.textContent=text;tr.appendChild(td);return td;}'
  + 'Promise.all([chausar.call("clients_list"),chausar.call("invoices_list"),chausar.call("notes_get")]).then(function(r){var names={};r[0].clients.forEach(function(c){names[c.id]=c.name;});'
  + 'status.textContent=r[1].invoices.length?"":"No invoices yet.";r[1].invoices.forEach(function(inv){var tr=document.createElement("tr");cell(tr,names[inv.clientId]||"A client");cell(tr,inv.balance.display);'
  + 'var b=document.createElement("button");b.type="button";b.textContent="Ask to remind";b.onclick=function(){chausar.call("propose",{kind:"draft-reminder",invoiceId:inv.id}).then(function(x){status.textContent=x.line;},function(e){status.textContent=e.message;});};'
  + 'cell(tr,"").appendChild(b);rows.appendChild(tr);});chausar.call("notes_set",{key:"opened",value:"yes"});},function(e){status.textContent=e.message;});})();</script>';

interface Version { version: number; at: string; html: string; summary: string; permissions: AppPermission[]; ask: string }
interface HeldApp { id: string; at: string; name: string; versions: Version[]; current: number; grant: { permissions: AppPermission[]; at: string } | null; pinned: boolean; notes: Record<string, string>; messages: MiniAppMessage[] }

/** What the desk reads from the fake engine. */
export interface AppsHost {
  current(): string;
  now(): string;
  hosted(): boolean;
  digest(value: unknown): string;
  clients(): readonly ClientLite[];
  orders(): readonly OrderLite[];
  currency(): string;
  /** Issued invoices as the app reads them: each balance as the fake money desk shows it, with its receipt. */
  invoices(): { id: string; number: string; clientId: string; status: string; dueDate: string | null; balance: { display: string; receiptId: string } }[];
  /** Puts a card on Today as an app's proposal (chief/store.ts draftProposal, raised at once). Returns its id and title. */
  propose(input: { kind: 'draft-reminder' | 'draft-invoice'; title: string; line: string; target: { invoice?: string; order?: string } }): { id: string; title: string };
  /** The Today rows still waiting, by id. */
  openRows(): readonly string[];
}

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
function exact(p: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw invalid('Send one request object.');
  const record = p as Record<string, unknown>;
  if (!Object.keys(record).every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(record, key))) throw invalid('Send the required fields and nothing else.');
  return record;
}
function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw invalid(`${field} must be a known identifier.`);
  return value;
}
const DASH = new RegExp(`\\s*${String.fromCharCode(0x2014)}\\s*`, 'g');
const tidy = (text: string) => text.replace(DASH, ', ').replace(/\s+/g, ' ').trim();
const ordered = (items: Iterable<AppPermission>): AppPermission[] => { const set = new Set(items); return APP_PERMISSIONS.filter((item) => set.has(item)); };
/** A plain name from the owner's words, for the fake's sample app. */
function nameFrom(ask: string): string {
  const words = ask.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'My app';
}

export class FakeAppsDesk {
  private readonly host: AppsHost;
  private readonly books = new Map<string, HeldApp[]>();
  private readonly receipts = new Map<string, ReceiptLite>();
  private seq = 1;

  constructor(host: AppsHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    if (!options.fresh) this.seed();
  }

  handles(method: string): boolean {
    return FAKE_APP_METHODS.has(method);
  }

  receipt(receiptId: string): ReceiptLite | undefined {
    const found = this.receipts.get(receiptId);
    return found ? structuredClone(found) : undefined;
  }

  request(method: string, p: Record<string, unknown>): unknown {
    if (APP_ONLY.has(method) && this.host.hosted()) throw new EngineError('APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
    switch (method) {
      case 'venture.apps.list': {
        exact(p, []);
        return { apps: this.mine().map((app) => this.card(app)).reverse(), ideas: [...APP_IDEAS], never: APP_NEVER_LINE };
      }
      case 'venture.apps.get': return { app: this.view(this.find(p, ['app'])) };
      case 'venture.apps.make': return this.make(p);
      case 'venture.apps.grant': {
        const body = exact(p, ['app', 'digest']);
        const app = this.find(body, ['app', 'digest']);
        const ask = this.ask(app);
        if (typeof body.digest !== 'string' || !ask || ask.digest !== body.digest) throw new EngineError('APPROVAL_STALE', APP_ERRORS.stale);
        app.grant = { permissions: ordered([...(app.grant?.permissions ?? []), ...this.version(app).permissions]), at: this.host.now() };
        return { app: this.view(app), line: APP_LINES.granted(app.name) };
      }
      case 'venture.apps.revoke': {
        const app = this.find(p, ['app']);
        app.grant = null;
        return { app: this.view(app), line: APP_LINES.revoked(app.name) };
      }
      case 'venture.apps.restore': {
        const body = exact(p, ['app', 'version']);
        if (!Number.isSafeInteger(body.version)) throw invalid(APP_ERRORS.version);
        const app = this.find(body, ['app', 'version']);
        if (!app.versions.some((item) => item.version === body.version)) throw invalid(APP_ERRORS.version);
        const before = app.current;
        app.current = body.version as number;
        return { app: this.view(app), undo: { version: before }, line: APP_LINES.restored(app.current) };
      }
      case 'venture.apps.pin': {
        const body = exact(p, ['app', 'pinned']);
        if (typeof body.pinned !== 'boolean') throw invalid('pinned is true or false.');
        const app = this.find(body, ['app', 'pinned']);
        const before = app.pinned;
        app.pinned = body.pinned;
        return { app: this.view(app), undo: { pinned: before }, line: app.pinned ? APP_LINES.pinned : APP_LINES.unpinned };
      }
      case 'venture.apps.export': {
        const app = this.find(p, ['app']);
        const fileName = `${app.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'app'}.html`;
        return { fileName, document: exportDocument(this.version(app).html, app.name), mediaType: 'text/html' };
      }
      case 'venture.apps.remove': {
        const app = this.find(p, ['app']);
        this.books.set(this.host.current(), this.mine().filter((item) => item.id !== app.id));
        return { removed: true, line: APP_LINES.removed(app.name) };
      }
      case 'venture.apps.call': return this.call(p);
      default: throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
    }
  }

  private seed(): void {
    const at = '2026-10-20T09:00:00.000Z';
    const permissions = permissionsOf(SAMPLE_APP_HTML);
    const ask = 'A sheet of my clients and what each owes me';
    this.books.set('lumen', [{
      id: 'miniapp_sample', at, name: 'Who owes me', current: 1, pinned: false, notes: {},
      versions: [{ version: 1, at, html: SAMPLE_APP_HTML, summary: 'A sheet of clients and what each owes, with a reminder card.', permissions, ask }],
      grant: { permissions, at }, messages: [{ at, from: 'owner', text: ask, version: null }, { at, from: 'chausar', text: madeLine(1, permissions), version: 1 }],
    }]);
  }

  private mine(): HeldApp[] {
    const current = this.host.current();
    let held = this.books.get(current);
    if (!held) { held = []; this.books.set(current, held); }
    return held;
  }

  private find(p: unknown, fields: readonly string[]): HeldApp {
    const body = exact(p, fields);
    const appId = id(body.app, 'App');
    const app = this.mine().find((item) => item.id === appId);
    if (!app) throw new EngineError('APP_NOT_FOUND', APP_ERRORS.notFound);
    return app;
  }

  private version(app: HeldApp): Version { return app.versions.find((item) => item.version === app.current)!; }
  private allowed(app: HeldApp): AppPermission[] { return app.grant ? this.version(app).permissions.filter((item) => app.grant!.permissions.includes(item)) : []; }

  private ask(app: HeldApp): MiniAppView['ask'] {
    const needs = this.version(app).permissions;
    const added = needs.filter((item) => !app.grant?.permissions.includes(item));
    if (!added.length) return null;
    return { digest: this.host.digest({ app: app.id, version: app.current, permissions: needs }), added, first: app.grant === null };
  }

  private card(app: HeldApp): MiniAppCard {
    const version = this.version(app);
    return { id: app.id, name: app.name, version: app.current, summary: version.summary, reads: version.permissions.map((item) => PERMISSION_WORDS[item].chip), pinned: app.pinned, madeAt: app.at, allowed: this.ask(app) === null };
  }

  private view(app: HeldApp): MiniAppView {
    const version = this.version(app);
    const allowed = new Set(this.allowed(app));
    return {
      ...this.card(app), uri: appUri(app.id, app.current), document: appDocument(version.html, app.name),
      versions: app.versions.map((item) => ({ version: item.version, at: item.at, summary: item.summary, current: item.version === app.current })),
      permissions: version.permissions.map((item) => ({ id: item, verb: PERMISSION_WORDS[item].verb, line: PERMISSION_WORDS[item].line })),
      grant: app.grant ? { permissions: [...app.grant.permissions], at: app.grant.at } : null,
      ask: this.ask(app), tools: Object.keys(APP_TOOLS).filter((tool) => allowed.has(APP_TOOLS[tool]!)),
      messages: app.messages.map((item) => ({ ...item })), never: APP_NEVER_LINE,
    };
  }

  private make(p: Record<string, unknown>): { app: MiniAppView; line: string } {
    const body = exact(p, ['ask', 'app'], ['ask']);
    if (typeof body.ask !== 'string') throw invalid(APP_ERRORS.askEmpty);
    const ask = tidy(body.ask);
    if (ask.length < 1 || ask.length > 600) throw invalid(APP_ERRORS.askEmpty);
    if (SECRET.test(ask)) throw invalid(APP_ERRORS.askSecret);
    const existing = body.app === undefined ? null : this.find({ app: body.app }, ['app']);
    // The fake has no AI: it writes the sample app. The engine checks the AI's code the same way.
    const html = SAMPLE_APP_HTML;
    const findings = appCodeFindings(html);
    if (findings.length) throw new EngineError('APP_CODE_REFUSED', APP_ERRORS.refused(findings));
    const permissions = permissionsOf(html);
    const at = this.host.now();
    const said = (number: number): MiniAppMessage[] => [{ at, from: 'owner', text: ask, version: null }, { at, from: 'chausar', text: madeLine(number, permissions), version: number }];
    const summary = 'A sheet of clients and what each owes, with a reminder card.';
    let app: HeldApp;
    if (existing) {
      const number = Math.max(...existing.versions.map((item) => item.version)) + 1;
      existing.versions = [...existing.versions, { version: number, at, html, summary, permissions, ask }].slice(-20);
      existing.current = number;
      existing.messages = [...existing.messages, ...said(number)];
      app = existing;
    } else {
      app = { id: `miniapp_${this.seq++}`, at, name: nameFrom(ask), versions: [{ version: 1, at, html, summary, permissions, ask }], current: 1, grant: null, pinned: false, notes: {}, messages: said(1) };
      this.mine().push(app);
    }
    return { app: this.view(app), line: madeLine(app.current, permissions) };
  }

  private call(p: Record<string, unknown>): MiniAppCallResult {
    const body = exact(p, ['app', 'tool', 'arguments']);
    if (typeof body.tool !== 'string' || !Object.hasOwn(APP_TOOLS, body.tool)) throw new EngineError('APP_TOOL_UNKNOWN', APP_ERRORS.unknownTool);
    const args = exact(body.arguments, Object.keys((body.arguments ?? {}) as object));
    const app = this.find({ app: body.app }, ['app']);
    if (!app.grant) throw new EngineError('APP_NOT_ALLOWED', APP_ERRORS.allowFirst);
    if (!this.allowed(app).includes(APP_TOOLS[body.tool]!)) throw new EngineError('APP_NOT_ALLOWED', APP_ERRORS.notAllowed);
    const none = () => { if (Object.keys(args).length) throw invalid('This tool takes no arguments.'); };
    const result = (structuredContent: unknown): MiniAppCallResult => ({ content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: false });
    switch (body.tool) {
      case 'clients_list': none(); return result({ clients: this.host.clients().filter((client) => !client.self).map((client) => ({ id: client.id, name: client.name })) });
      case 'orders_list': none(); return result({ orders: this.host.orders().map((order) => ({ id: order.id, clientId: order.clientId, status: order.status, request: order.request.length > 160 ? `${order.request.slice(0, 157)}...` : order.request })) });
      case 'invoices_list': none(); return result({ invoices: this.host.invoices() });
      case 'notes_get': none(); return result({ notes: { ...app.notes } });
      case 'notes_set': {
        exact(args, ['key', 'value']);
        if (typeof args.key !== 'string' || !NOTE_KEY.test(args.key)) throw invalid('A note key uses letters, digits, dots, dashes and underscores, up to 64.');
        if (!(args.value === null || (typeof args.value === 'string' && args.value.length <= 20_000))) throw invalid('A note is text of up to 20000 characters, or null to delete it.');
        const notes = { ...app.notes };
        if (args.value === null) delete notes[args.key]; else notes[args.key] = args.value as string;
        const size = Object.entries(notes).reduce((total, [name, text]) => total + name.length + text.length, 0);
        if (Object.keys(notes).length > 500 || size > 100_000) throw new EngineError('APP_NOTES_FULL', APP_ERRORS.notesFull);
        app.notes = notes;
        return result({ notes });
      }
      case 'calculate': {
        let plan;
        try { plan = appCalcPlan(appCalcSubject(app.id, this.host.currency(), args)); } catch (error) { throw new EngineError('INVALID_VENTURE_REQUEST', (error as Error).message); }
        const total = plan.addends.reduce((sum, addend) => sum + BigInt(addend.amount), 0n);
        const receiptId = `R-app-${this.host.digest(plan.subject).slice(0, 12)}`;
        const shown = formatMinor(total, plan.currency);
        if (!this.receipts.has(receiptId)) {
          this.receipts.set(receiptId, {
            id: receiptId, at: this.host.now(), stale: false, totalMinor: String(total),
            explanation: `${plan.addends.length} ${plan.addends.length === 1 ? 'amount' : 'amounts'}: ${plan.addends.map((addend) => `${addend.label} ${addend.display}`).join('; ')}. Added together: ${shown}.`,
            figures: [{ key: 'total', label: 'Worked out for an app', display: shown }],
          });
        }
        return result({ figure: { label: 'Worked out for an app', display: shown, receiptId } });
      }
      default: return result(this.propose(app, args));
    }
  }

  private propose(app: HeldApp, args: Record<string, unknown>): { card: { id: string; title: string }; line: string } {
    const field = args.kind === 'draft-reminder' ? 'invoiceId' : args.kind === 'draft-invoice' ? 'orderId' : null;
    if (!field) throw invalid('An app proposes draft-reminder with invoiceId, or draft-invoice with orderId.');
    exact(args, ['kind', field]);
    const target = id(args[field], field === 'invoiceId' ? 'Invoice' : 'Order');
    const kind = args.kind as 'draft-reminder' | 'draft-invoice';
    let title: string, invoiceNumber = '';
    if (kind === 'draft-reminder') {
      const invoice = this.host.invoices().find((item) => item.id === target);
      if (!invoice) throw new EngineError('APP_PROPOSAL_REFUSED', "This can't go on Today: that invoice was not found.");
      if (invoice.status !== 'issued' && invoice.status !== 'part-paid') throw new EngineError('APP_PROPOSAL_REFUSED', "This can't go on Today: this invoice has nothing left to pay.");
      title = `Draft a payment reminder for invoice ${invoice.number}`;
      invoiceNumber = invoice.number;
    } else {
      const order = this.host.orders().find((item) => item.id === target);
      if (!order) throw new EngineError('APP_PROPOSAL_REFUSED', "This can't go on Today: that order was not found.");
      title = `Draft the invoice for ${this.host.clients().find((client) => client.id === order.clientId)?.name ?? 'a client'}'s order`;
    }
    const open = new Set(this.host.openRows());
    const held = (this.proposals.get(app.id) ?? []).filter((item) => [...open].some((row) => row.startsWith(`proposal:${item.id}:`)));
    const same = held.find((item) => item.key === `${kind}:${target}`);
    if (same) return { card: { id: same.id, title: same.title }, line: APP_LINES.proposedAlready };
    if (held.length >= 10) throw new EngineError('APP_PROPOSALS_FULL', APP_ERRORS.proposalsFull);
    const line = kind === 'draft-reminder' ? 'Chausar drafts a payment reminder. You send it yourself.' : 'Chausar drafts the invoice from your price. You issue it from Today.';
    const made = this.host.propose({ kind, title, line: `From the app "${app.name}". ${line}`, target: kind === 'draft-reminder' ? { invoice: invoiceNumber } : { order: target } });
    this.proposals.set(app.id, [...held, { id: made.id, title: made.title, key: `${kind}:${target}` }]);
    return { card: made, line: APP_LINES.proposed };
  }

  private readonly proposals = new Map<string, { id: string; title: string; key: string }[]>();
}
