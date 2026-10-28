import {fakeRecruitPreflight} from './fake-recruiting-preflight';
import {fakeSellerPreflight} from './fake-seller-preflight';
/**
 * Orders, delivery runs and client files for the fake engine (the Work place), kept per business. It keeps
 * the engine's rules the screens rely on: an order needs a known client and a priced service from the plan, an
 * offer that cuts footage needs rights it accepts (RIGHTS_REQUIRED, as playbooks/intake.ts), a file must be CSV,
 * Excel, PDF or a transcript (SRT or VTT) under the upload limit, delivering twice is refused, and starting a run on
 * an order adds a run the run sheet can show and says so with a `run.started` event.
 */

import { FakeSocialChain } from './fake-social-chain';
import { DELIVERIES, ORDERS, UPLOADS } from './fixtures';
import { fakeKitIntake } from './fake-kit-intake';
import { fakeSocialIntake, fakeSocialPreflight } from './fake-social-intake';
import { fakeSocialOfferIntake } from './fake-social-plan';
import { fakeKitOfferIntake } from './fake-kit-plans';
import { withFakeOrderSteps } from './fake-previews';
import { EngineError, type BlueprintViewLite, type ClientLite, type DeliveryLite, type InvoiceLite, type OfferIntakeLite, type OrderLite, type RunDetail, type UploadLite, type VentureRunEvent } from './types';

const clone = <T>(value: T): T => structuredClone(value);
/** The engine's limits (platform/runtime/venture/delivery/harness/files.ts). */
const MAX_UPLOAD_BYTES = 1_450_000;
const MAX_UPLOADS_PER_ORDER = 10;
/** The format each file ending is kept as; SRT and VTT are transcripts. */
const FORMAT_OF: Readonly<Record<string, UploadLite['format']>> = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf', srt: 'transcript', vtt: 'transcript' };
/** The engine's words for each basis (platform/runtime/venture/delivery/rights.ts RIGHTS_LABELS, in a sentence). */
const RIGHTS_WORDS: Readonly<Record<string, string>> = { 'own-footage': "the client's own footage", licence: 'a licence from the rights holder', 'creator-clip-programme': "the creator's clip programme" };

export interface WorkHost {
  recruitDigest?(value:unknown):string;
  rows?(): import('./types').QueueRow[];
  setRows?(rows:import('./types').QueueRow[]):void;
  hosted?(): boolean;
  current(): string;
  now(): string;
  /** The open business's clients and plan. */
  clients(): ClientLite[];
  plan(): BlueprintViewLite | null;
  /** The engine's run list: a started run goes to its front. */
  runs(): RunDetail[];
  agentName(): string;
  emit(event: VentureRunEvent): void;
  /** 4J3: the open business's invoices, which an order's Invoice and Paid steps are read from. */
  invoices?(): InvoiceLite[];
  ask?(method: string, params: Record<string, unknown>): unknown;
  fingerprint?(bytes: string): string;
}

const WORK_METHODS = new Set([
  'venture.order.list', 'venture.order.create', 'venture.order.deliver', 'venture.delivery.list', 'venture.delivery.run',
  'venture.files.list', 'venture.files.add', 'venture.delivery.approve', 'venture.delivery.review',
]);

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** The engine's intake rule: only an offer that asks takes intake, and one that cuts footage needs rights it accepts. */
function checkIntake(raw: unknown, ask: OfferIntakeLite | null, offerName: string): void {
  if (!ask) {
    if (raw !== undefined) throw invalid('This offer takes no intake.');
    return;
  }
  if (ask.rights.length === 0) return;
  const required = (message: string) => new EngineError('RIGHTS_REQUIRED', message);
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rights = body.rights && typeof body.rights === 'object' ? (body.rights as Record<string, unknown>) : null;
  if (!rights) throw required('Record the rights to the footage before clipping.');
  if (!text(rights.holder)) throw required('Say who owns the footage.');
  if (rights.basis !== 'own-footage' && !text(rights.reference)) throw required('Add the licence or clip programme reference.');
  if (!ask.rights.includes(rights.basis as OfferIntakeLite['rights'][number])) {
    throw required(`${offerName} needs ${ask.rights.map((basis) => RIGHTS_WORDS[basis]).join(' or ')}, recorded at intake.`);
  }
}

export class FakeWorkDesk {
  eraseRecruitingCopies(biz:string,orderIds:readonly string[]):string[]{const ids=new Set((this.deliveries[biz]??[]).filter(r=>orderIds.includes(r.orderId)).map(r=>r.id));this.deliveries[biz]=(this.deliveries[biz]??[]).map(r=>ids.has(r.id)?{...r,status:'stopped',deliverable:null,renderedText:null,editedText:null,verdict:null,awaitingYou:false}:r);for(const r of this.host.runs())if(r.businessId===biz&&ids.has(r.runId)){r.state='waiting';r.stop={state:'stopped',line:'Candidate evidence was deleted. Start with new approved sources.'};r.steps=[];this.host.emit({type:'run.stopped',businessId:biz,runId:r.runId,at:this.host.now()});}return [...ids];}
  private readonly host: WorkHost;
  readonly socialChain: FakeSocialChain;
  private orders: Record<string, OrderLite[]>;
  private deliveries: Record<string, DeliveryLite[]>;
  private uploads: Record<string, UploadLite[]>;
  private seq = 0;
  private readonly fileFingerprints = new Map<string, string>();
  private readonly fileContents = new Map<string, string>();

  constructor(host: WorkHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.socialChain=new FakeSocialChain(host,{orders:()=>this.orders[host.current()]??[],deliveries:()=>this.deliveries[host.current()]??[],files:id=>this.orderFiles(host.current(),id),keep:run=>{(this.deliveries[host.current()]??=[]).unshift(run);},eraseFiles:ids=>{const biz=host.current();this.uploads[biz]=(this.uploads[biz]??[]).filter(f=>!ids.has(f.id));for(const id of ids){this.fileContents.delete(biz+':'+id);this.fileFingerprints.delete(biz+':'+id);}},next:orderId=>{this.start(host.current(),{orderId});}});
    this.orders = options.fresh ? {} : clone(ORDERS);
    this.deliveries = options.fresh ? {} : clone(DELIVERIES);
    this.uploads = options.fresh ? {} : clone(UPLOADS);
  }

  /** Internal queue projection, scoped by business and returned without mutable references. */
  ordersFor(biz: string): OrderLite[] { return clone(this.orders[biz] ?? []); }
  /** Seller Forget takes the source bytes and fingerprints as well as their upload rows. */
  /** Exact tender Forget clears order intake after the owner approves erasure. */

  eraseSellerFiles(biz:string,ids:readonly string[]):void {const gone=new Set(ids);this.uploads[biz]=(this.uploads[biz]??[]).filter(file=>!gone.has(file.id));for(const id of gone){this.fileContents.delete(biz+':'+id);this.fileFingerprints.delete(biz+':'+id);}}
  /** Internal byte fingerprint for source-bound fake media; file metadata is never a substitute. */
  uploadFingerprint(biz: string, id: string): string | null {
    return this.uploads[biz]?.some(file => file.id === id) ? this.fileFingerprints.get(biz + ':' + id) ?? null : null;
  }

  /** Internal source bytes scoped to an existing order. Public file views never expose these words. */
  orderFiles(biz: string, orderId: string): { id: string; name: string; format: UploadLite['format']; contentBase64: string; digest: string }[] {
    if (!this.orders[biz]?.some(order => order.id === orderId && this.host.clients().some(client => client.id === order.clientId))) return [];
    return (this.uploads[biz] ?? []).filter(file => (file.scope.kind === 'order' || file.scope.kind === 'media') && file.scope.orderId === orderId).flatMap(file => {
      const contentBase64 = this.fileContents.get(biz + ':' + file.id);
      return contentBase64 === undefined ? [] : [{ id: file.id, name: file.name, format: file.format, contentBase64, digest: this.uploadFingerprint(biz, file.id) ?? contentBase64 }];
    });
  }

  handles(method: string): boolean {
    return WORK_METHODS.has(method);
  }

  /** Another desk changes a delivery run it owns part of (fake-practice.ts: the judge's call and verdict). */
  reviseRun(biz: string, runId: string, revise: (run: DeliveryLite) => DeliveryLite): DeliveryLite {
    const list = this.deliveries[biz] ?? [];
    const index = list.findIndex((run) => run.id === runId);
    if (index < 0) throw new EngineError('DELIVERY_NOT_FOUND', 'That draft reply was not found.');
    list[index] = clone(revise(clone(list[index]!)));
    if((list[index] as DeliveryLite & {chainStage?:number}).chainStage)this.socialChain.refreshRevision(list[index]!);
    return clone(list[index]!);
  }

  /** Another desk keeps a new draft run (fake-4j2.ts: Make a copy); never a public method. */
  keepRun(biz: string, run: DeliveryLite): DeliveryLite {
    (this.deliveries[biz] ??= []).unshift(clone(run));
    return clone(run);
  }

  /** Another desk keeps a transcript made "on this computer" with its origin (fake-wiring.ts); never a public method. */
  keepMade(biz: string, p: Record<string, unknown>): UploadLite {
    return this.addFile(biz, p, 'local-transcription');
  }

  request(method: string, p: Record<string, unknown>): unknown {
    const biz = this.host.current();
    switch (method) {
      // 4J3: each order with its stage steps and what waits on the owner, as the engine reads them (fake-previews.ts).
      case 'venture.order.list': {
        const invoices = this.host.invoices?.() ?? [];
        return clone((this.orders[biz] ?? []).map((order) => withFakeOrderSteps(order, invoices)));
      }
      case 'venture.order.create': return this.create(biz, p);
      case 'venture.order.deliver': return this.deliver(biz, p);
      case 'venture.delivery.list': return clone(this.deliveries[biz] ?? []);
      case 'venture.delivery.run': return this.start(biz, p);
      case 'venture.delivery.approve': case 'venture.delivery.review': return this.socialChain.request(method,p);
      case 'venture.files.list': return clone((this.uploads[biz] ?? []).filter((u) => typeof p.orderId !== 'string' || ((u.scope.kind === 'order' || u.scope.kind === 'media') && u.scope.orderId === p.orderId)));
      case 'venture.files.add': return this.addFile(biz, p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  private order(biz: string, id: unknown): OrderLite {
    const order = (this.orders[biz] ?? []).find((o) => o.id === id);
    if (!order) throw new EngineError('ORDER_NOT_FOUND', 'That order was not found.');
    return order;
  }

  private create(biz: string, p: Record<string, unknown>): OrderLite {

    const plan = this.host.plan();
    if (!plan) throw new EngineError('BLUEPRINT_NOT_FOUND', 'Make your plan first.');
    const offer = plan.blueprint.offers.find((o) => o.id === p.offerId);
    if (!offer) throw invalid('That service is not in your plan.');
    if (offer.pricing.unitPriceMinor === null) throw new EngineError('PRICE_REQUIRED', `Set your price for ${offer.name.value} first.`);
    const internal = plan.playbook?.id === 'online-seller' && offer.playbookOffer === 'own-shop-back-office';
    let client = this.host.clients().find(c => internal ? c.self : c.id === p.clientId);
    if (!internal && !client) throw new EngineError('CLIENT_NOT_FOUND', 'Add this client first.');
    if (!internal && client?.self) throw new EngineError('INTERNAL_ORDER', 'Your own shop is only used for its internal back-office offer.');
    const request = text(p.request);
    if (request.length < 3 || request.length > 4000) throw invalid('The request must be between 3 and 4000 characters.');
    const ask = plan.intake?.[offer.id] ?? (plan.playbook?.id === 'social-agency' ? fakeSocialOfferIntake(offer.playbookOffer) : fakeKitOfferIntake(plan.playbook?.id, offer.playbookOffer));
    checkIntake(p.intake, ask ?? null, offer.name.value);
    const staged: { field: string; id: string; name: string; contentBase64: string }[] = [];
    let rawIntake = p.intake;
    if (p.intakeFiles !== undefined) {
      if (!p.intakeFiles || typeof p.intakeFiles !== 'object' || Array.isArray(p.intakeFiles)) throw invalid('Send the intake files by their question names.');
      const entries = Object.entries(p.intakeFiles as Record<string, unknown>);
      if (entries.length > 10) throw new EngineError('UPLOAD_LIMIT', 'Choose at most ten intake files.');
      if (entries.length && !ask?.kit) throw invalid('Only a kit offer takes named intake files.');
      if (rawIntake !== undefined && (!rawIntake || typeof rawIntake !== 'object' || Array.isArray(rawIntake))) throw invalid('Send the intake as named fields.');
      const body = rawIntake as Record<string, unknown> | undefined;
      const sent = body?.fields ?? {};
      if (!sent || typeof sent !== 'object' || Array.isArray(sent)) throw invalid('Send the intake fields as named fields.');
      const fields = { ...sent as Record<string, unknown> };
      let bytes = 0;
      for (const [field, value] of entries) {
        if (!ask?.kit?.some(item => item.id === field && item.kind === 'file') || Object.hasOwn(fields, field)) throw invalid('Choose each intake file once, for a file question this service asks.');
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'contentBase64,name') throw invalid('Send the required fields and nothing else.');
        const file = value as Record<string, unknown>;
        if (typeof file.name !== 'string' || !file.name.trim() || file.name.trim().length > 120 || /[\r\n\t\u0000-\u001F\u007F]/.test(file.name)) throw invalid('File name must be plain text on one line.');
        if (typeof file.contentBase64 !== 'string' || !file.contentBase64 || file.contentBase64.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.contentBase64)) throw new EngineError('UPLOAD_LIMIT', 'Add a file smaller than one and a half megabytes.');
        bytes += atob(file.contentBase64).length;
        if (bytes > 1_300_000) throw new EngineError('UPLOAD_LIMIT', 'Intake files together must fit within one megabyte and three hundred kilobytes.');
        const id = 'upload_intake_' + (++this.seq);
        fields[field] = id;
        staged.push({ field, id, name: file.name.trim(), contentBase64: file.contentBase64 });
      }
      rawIntake = { ...body, fields };
    }
    const keptIntake = ask?.kit && plan.playbook?.id === 'social-agency' ? fakeSocialIntake(rawIntake, ask, offer.playbookOffer!, { by: 'owner', at: this.host.now(), today: new Date(Date.parse(this.host.now()) + 19800000).toISOString().slice(0, 10), hosted: this.host.hosted?.() }, () => this.host.ask?.('venture.voiceConsent.list', {}) as import('./types').VoiceConsentsView ?? {consents:[],line:''}) : ask?.kit ? fakeKitIntake(rawIntake, ask, () => this.host.ask?.('venture.voiceConsent.list', {}) as import('./types').VoiceConsentsView ?? { consents: [], line: '' }, { by: 'owner', at: this.host.now(), today: new Date(Date.parse(this.host.now()) + 19800000).toISOString().slice(0, 10) }) : rawIntake;
    if (ask?.kit && keptIntake && typeof keptIntake === 'object') {
      const values = (keptIntake as NonNullable<OrderLite['intake']>).fields;
      for (const field of ask.kit.filter(field => field.kind === 'file')) {
        const id = values?.[field.id];
        if (typeof id === 'string' && !staged.some(file => file.field === field.id && file.id === id)) throw new EngineError('UPLOAD_NOT_FOUND', 'Add the file to this order before using it as an intake answer.');
      }
    }
    if (!client && internal) {
      const made = this.host.ask?.('venture.client.add', { name: 'Your own shop', countryCode: 'IN' }) as ClientLite;
      client = this.host.clients().find(c => c.id === made.id)!; client.self = true;
    }
    if (!client) throw new EngineError('CLIENT_NOT_FOUND', 'Add this client first.');
    const order: OrderLite = {
      ...(internal ? { internal: true as const } : {}),
      id: `o-new-${++this.seq}`, at: this.host.now(), clientId: client.id, offerId: offer.id,
      quantity: text(p.quantity) || offer.pricing.defaultQuantity, request, status: 'open',
      priceReceiptId: plan.offerReceipts[offer.id]?.id ?? 'R-0415', deliveredOn: null,
      // The engine keeps the intake on the order (OrderRecord.intake); a transcript made here reads its cutFile.
      ...(keptIntake && typeof keptIntake === 'object' ? { intake: clone(keptIntake) as OrderLite['intake'] } : {}),
    };
    const previousOrders = [...(this.orders[biz] ?? [])];
    const previousUploads = [...(this.uploads[biz] ?? [])];
    (this.orders[biz] ??= []).unshift(order);
    try {
      for (const file of staged) this.addFile(biz, { orderId: order.id, name: file.name, contentBase64: file.contentBase64 }, undefined, file.id);
    } catch (error) {
      this.orders[biz] = previousOrders;
      this.uploads[biz] = previousUploads;
      for (const file of staged) { this.fileContents.delete(biz + ':' + file.id); this.fileFingerprints.delete(biz + ':' + file.id); }
      throw error;
    }
    this.host.emit({ type: 'queue.changed', businessId: biz, at: order.at });
    return clone(order);
  }

  private deliver(biz: string, p: Record<string, unknown>): OrderLite {
    const order = this.order(biz, p.orderId);
    if (order.status === 'cancelled') throw invalid('This order was cancelled.');
    if (order.status === 'delivered' || order.deliveredOn !== null) throw invalid('This order is already marked delivered.');
    if (typeof p.deliveredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.deliveredOn)) throw invalid('Use a date like 2026-10-15.');
    order.deliveredOn = p.deliveredOn;
    order.status = 'delivered';
    this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    return clone(order);
  }

  /** venture.delivery.run: a new run on the order, working (not waiting on the owner), first step current. */
  private start(biz: string, p: Record<string, unknown>): DeliveryLite {
    const order = this.order(biz, p.orderId);
    fakeRecruitPreflight(this.host,order);
    if(this.host.plan()?.playbook?.id==='translation-studio'&&order.intake?.fields?.private!==false)throw new EngineError('PRIVATE_NEEDS_LOCAL','This private job needs a local model. Use the local review sheet meanwhile.');
    if(this.host.plan()?.playbook?.id==='translation-studio')throw new EngineError('RULE_UNCONFIRMED','A lawyer has not confirmed the rule "Translation rights review" yet. It works in practice runs only until they do.');
    const blocked = order.intake?.fields?.blockedCustomers;
    const named = Array.isArray(blocked) && blocked.some(value => typeof value === 'string' && value.trim() && order.request.toLowerCase().includes(value.trim().toLowerCase()));
    const support = this.host.ask?.('venture.desk.list', { playbook: 'support-desk', kind: 'ticket', filter: { queue: 'all' } }) as { rows?: { id: string; paused: boolean; status: string }[] } | undefined;
    const paused = support?.rows?.some(row => row.paused && !['resolved', 'closed'].includes(row.status) && (this.host.ask?.('venture.desk.get', { playbook: 'support-desk', kind: 'ticket', id: row.id }) as { item?: { serviceOrderId?: string } } | undefined)?.item?.serviceOrderId === order.id);
    if (named || paused) throw new EngineError('SUPPORT_PERSON_REQUIRED', 'A person is handling this customer. Automatic drafts are paused. Open the support desk.');
    fakeSocialPreflight(this.host.plan(), order, this.orderFiles(biz, order.id));
    fakeSellerPreflight(this.host.plan(),order,this.orderFiles(biz,order.id),this.host.now());
    const runs = this.host.runs();
    const runId = String(Math.max(0, ...runs.map((r) => Number(r.runId)).filter((n) => Number.isInteger(n))) + 1);
    if(this.host.plan()?.playbook?.id==='social-agency'){if(p.useTemplate===true)throw new EngineError('NOT_BUILT_YET','Social writing stages need an AI draft. Connect your AI and start this stage again.');if(Object.keys(p).some(k=>!['orderId','useTemplate'].includes(k))||p.useTemplate!==undefined&&typeof p.useTemplate!=='boolean')throw invalid('Send the required fields and nothing else.');}
    const social=this.socialChain.start(order,runId);
    if(social){runs.unshift({runId,businessId:biz,agent:this.host.agentName(),purpose:'Demo writing stage',state:'waiting',startedAt:this.host.now(),elapsed:'0s',progress:{done:0,total:1},steps:[{id:'write',purpose:'Demo writing stage',state:'current',elapsed:'now'}]});this.host.emit({type:'run.started',businessId:biz,runId,at:this.host.now()});return social;}
    const client = this.host.clients().find((c) => c.id === order.clientId)?.name ?? 'the client';
    const at = this.host.now();
    runs.unshift({
      runId, businessId: biz, agent: this.host.agentName(), purpose: `Draft a reply for ${client}`, state: 'active', startedAt: at, elapsed: '0s',
      progress: { done: 0, total: 3 },
      steps: [
        { id: 'read', purpose: "Read the order and the client's files", state: 'current', elapsed: 'now' },
        { id: 'write', purpose: 'Write the draft', state: 'pending' },
        { id: 'send', purpose: 'Send the draft to you', state: 'pending' },
      ],
    });
    const run: DeliveryLite = { id: runId, at, orderId: order.id, status: 'brief-waiting', practice: false, deliverable: null, verdict: null, awaitingYou: false };
    (this.deliveries[biz] ??= []).unshift(run);
    this.host.emit({ type: 'run.started', businessId: biz, runId, at });
    return clone(run);
  }

  /** origin: only the fake's own transcript desk passes one, through keepMade. */
  private addFile(biz: string, p: Record<string, unknown>, origin?: UploadLite['origin'], intakeId?: string): UploadLite {
    const order = this.order(biz, p.orderId);
    const name = text(p.name);
    const encoded = typeof p.contentBase64 === 'string' ? p.contentBase64 : '';
    const tooBig = new EngineError('UPLOAD_LIMIT', 'Add a file smaller than one and a half megabytes.');
    if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw tooBig;
    const bytes = Math.floor((encoded.length * 3) / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    if (bytes <= 0 || bytes > MAX_UPLOAD_BYTES) throw tooBig;
    const ext = name.toLowerCase().split('.').pop() ?? '';
    // 5A4 (P9): a photo (kept cleaned of its location data) or a recording sits in the order's media scope, apart.
    const media = !name.includes('.') ? null : ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? 'image' as const : ['wav', 'mp3', 'm4a', 'ogg'].includes(ext) ? 'audio' as const : null;
    const format = media ?? FORMAT_OF[ext];
    if (!name.includes('.') || !format) throw new EngineError('UNSUPPORTED_UPLOAD', 'Add a CSV, Excel or PDF file, or a transcript as SRT or VTT.');
    const list = (this.uploads[biz] ??= []);
    if (media) {
      // The engine reads the first bytes: a file that is not what its name says is refused, never kept as it came.
      const head = Array.from(atob(encoded.slice(0, 24)), (c) => c.charCodeAt(0));
      const word = (at: number) => String.fromCharCode(...head.slice(at, at + 4));
      const real = ext === 'png' ? head[0] === 0x89 && word(1).startsWith('PNG') : ext === 'webp' ? word(0) === 'RIFF' && word(8) === 'WEBP'
        : ext === 'jpg' || ext === 'jpeg' ? head[0] === 0xff && head[1] === 0xd8 : ext === 'wav' ? word(0) === 'RIFF' && word(8) === 'WAVE'
          : ext === 'mp3' ? word(0).startsWith('ID3') || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) : ext === 'm4a' ? word(4) === 'ftyp' : word(0) === 'OggS';
      if (!real) throw new EngineError('UNSUPPORTED_UPLOAD', media === 'image' ? `${name} is not a photo Chausar can read. Export it again as JPEG, PNG or WebP.` : `${name} is not a recording Chausar can keep. Add a WAV, MP3, M4A or Ogg file.`);
      if (list.filter((u) => u.scope.kind === 'media' && u.scope.orderId === order.id).length >= 10) throw new EngineError('UPLOAD_LIMIT', 'An order holds at most 10 photos and recordings.');
      const kept: UploadLite = { id: intakeId ?? `u-new-${++this.seq}`, at: this.host.now(), name, format: media, bytes, scope: { kind: 'media', orderId: order.id }, clientData: true };
      this.fileContents.set(biz + ':' + kept.id, encoded);
      if (this.host.fingerprint) this.fileFingerprints.set(biz + ':' + kept.id, this.host.fingerprint(atob(encoded)));
      list.unshift(kept);
      return clone(kept);
    }
    if (list.filter((u) => u.scope.kind === 'order' && u.scope.orderId === order.id).length >= MAX_UPLOADS_PER_ORDER) throw new EngineError('UPLOAD_LIMIT', 'An order holds at most ten files.');
    const upload: UploadLite = { id: intakeId ?? `u-new-${++this.seq}`, at: this.host.now(), name, format, bytes, scope: { kind: 'order', orderId: order.id }, clientData: true, ...(origin ? { origin } : {}) };
    this.fileContents.set(biz + ':' + upload.id, encoded);
    if (this.host.fingerprint) this.fileFingerprints.set(biz + ':' + upload.id, this.host.fingerprint(atob(encoded)));
    list.unshift(upload);
    return clone(upload);
  }
}
