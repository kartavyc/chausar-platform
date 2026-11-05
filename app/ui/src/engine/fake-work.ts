import {FakeR5Delivery} from './fake-r5-delivery';
import {FakePhoneDelivery} from './fake-phone-delivery';
import {FakeDevDelivery} from './fake-dev-delivery';
import {FakeCareerDelivery} from './fake-career-delivery';
import {FakeVaDelivery} from './fake-va-delivery';
import {taxDecision} from '../../../../platform/runtime/venture/money/tax-decision';
import {computeInclusivePrice,splitsInclusive} from '../../../../platform/runtime/venture/money/price-inclusive';
import {computePrice} from '../../../../platform/runtime/venture/money/price';
import {currencyMinorDigits,decimalMinor,formatMinor} from '../../../../platform/runtime/currency';
import {formatMoney} from '../../../../platform/runtime/owner-format';
import {countryProfile} from '../../../../platform/runtime/venture/core/countries';
import {digest as priceDigest} from '../../../../platform/runtime/portable';
import type {RoomPrice} from '../../../../platform/runtime/venture/playbooks/kit/client-room-core';
import type {ReceiptLite} from './types';
import {FakeYoutubeServiceRun} from './fake-youtube-service-run';
import {fakeYoutubeMediaIntake} from './fake-youtube-intake';
import {isYoutubeService,validateYoutubeServiceIntake} from '../../../../platform/runtime/venture/playbooks/youtube/service-fields';
import {hasDocx,checkFakeDocx} from './fake-manuscript-upload';
import {SITE_FORM_RULE} from '../../../../platform/runtime/venture/playbooks/website-studio/legal-core';
import {NEWSLETTER_PRIVACY_RULE} from '../../../../platform/runtime/venture/playbooks/newsletter-studio/legal-core';
import {fakeSellerPreflight} from './fake-seller-preflight';
import {fakeRecruitPreflight} from './fake-recruiting-preflight';
import {templateOutline,TEMPLATE_OUTLINE_LINE} from '../../../../platform/runtime/venture/delivery/template-outline';
import {reviewTemplate} from './fake-template-review';
/**
 * Orders, delivery runs and client files for the fake engine (the Work place), kept per business. It keeps
 * the engine's rules the screens rely on: an order needs a known client and a priced service from the plan, an
 * offer that cuts footage needs rights it accepts (RIGHTS_REQUIRED, as playbooks/intake.ts), a file must be CSV,
 * Excel, PDF or a transcript (SRT or VTT) under the upload limit, delivering twice is refused, and starting a run on
 * an order adds a run the run sheet can show and says so with a `run.started` event.
 */

import { FakeSocialChain } from './fake-social-chain';
import {FakeNarrationChain} from './fake-narration-chain';
import { FakeArticleChain } from './fake-article-chain';
import { DELIVERIES, ORDERS, UPLOADS } from './fixtures';
import { fakeKitIntake } from './fake-kit-intake';
import { fakeSocialIntake, fakeSocialPreflight } from './fake-social-intake';
import { fakeSocialOfferIntake } from './fake-social-plan';
import { fakeKitOfferIntake } from './fake-kit-plans';
import { withFakeOrderSteps } from './fake-previews';
import { isLiveStage } from '../../../../platform/runtime/venture/core/launch-stage';
import { ruleCleared } from '../../../../platform/runtime/venture/playbooks/kit/attestation';
import { FORMS_ACCESS_RULE } from '../../../../platform/runtime/venture/playbooks/data-entry-desk/rules';
import { fakeAttested } from './fake-rules-attest';
import { EngineError, type BlueprintViewLite, type ClientLite, type DeliveryLite, type InvoiceLite, type OfferIntakeLite, type OrderLite, type RunDetail, type UploadLite, type VentureRunEvent } from './types';

const clone = <T>(value: T): T => structuredClone(value);
/** The engine's limits (platform/runtime/venture/delivery/harness/files.ts). */
const MAX_UPLOAD_BYTES = 1_450_000;
const MAX_UPLOADS_PER_ORDER = 10;
/** The format each file ending is kept as; SRT and VTT are transcripts. */
const FORMAT_OF: Readonly<Record<string, UploadLite['format']>> = { csv: 'csv', txt: 'csv', md: 'csv', markdown: 'csv', docx: 'docx', xlsx: 'xlsx', pdf: 'pdf', srt: 'transcript', vtt: 'transcript' };
/** The engine's words for each basis (platform/runtime/venture/delivery/rights.ts RIGHTS_LABELS, in a sentence). */
const RIGHTS_WORDS: Readonly<Record<string, string>> = { 'own-footage': "the client's own footage", licence: 'a licence from the rights holder', 'creator-clip-programme': "the creator's clip programme" };

export interface WorkHost {
  r5Report?(orderId:string):import('../../../../platform/runtime/venture/playbooks/monitored-data/report').WatchReport|import('../../../../platform/runtime/venture/playbooks/it-triage/report').TriageReport;
  phoneReport?(orderId:string):import('../../../../platform/runtime/venture/playbooks/phone-receptionist/report').PhoneReport;
  formsSource?(orderId:string):void;
  testingSource?(orderId:string):void;
  careerSource?(orderId:string):import('./fake-career-source').CareerDeliverySource;
  devReport?(orderId:string):import('../../../../platform/runtime/venture/playbooks/dev-agency/report').DevReport;
  vaBrief?(orderId:string,expected?:string):import('../../../../platform/runtime/venture/playbooks/kit/client-room-core').RoomBrief;
  /** W6 6E5: the sign-off gate on Accept (the engine's kit/signoff-gate.ts). */
  signoffBlock?(run:DeliveryLite):string|null;
  recruitDigest?(value:unknown):string;
  rows?(): import('./types').QueueRow[];
  setRows?(rows:import('./types').QueueRow[]):void;
  hosted?(): boolean;
  current(): string;
  now(): string;
  /** The open business's clients and accepted plan, including its intake and price receipts. */
  clients(): ClientLite[];
  country(): {code:string;currency:string};
  plan(): BlueprintViewLite | null;
  /** The engine's run list: a started run goes to its front. */
  runs(): RunDetail[];
  agentName(): string;
  emit(event: VentureRunEvent): void;
  /** 4J3: the open business's invoices, which an order's Invoice and Paid steps are read from. */
  invoices?(): InvoiceLite[];
  ask?(method: string, params: Record<string, unknown>): unknown;
  /** One-shot A1 (row 10): a new client's checks and the client as it would be, with nothing stored and nothing announced. */
  checkClient?(p: Record<string, unknown>): ClientLite;
  fingerprint?(bytes: string): string;
  receipt?(id:string):ReceiptLite|undefined;
}

const WORK_METHODS = new Set([
  'venture.order.list', 'venture.order.create', 'venture.order.deliver', 'venture.delivery.list', 'venture.delivery.run',
  'venture.files.list', 'venture.files.add', 'venture.delivery.review',
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
  private readonly host: WorkHost;
  readonly careerDelivery:FakeCareerDelivery;
  readonly r5Delivery:FakeR5Delivery;
  readonly phoneDelivery:FakePhoneDelivery;
  readonly devDelivery:FakeDevDelivery;
  readonly vaDelivery:FakeVaDelivery;
  readonly socialChain: FakeSocialChain;
  readonly narrationChain: FakeNarrationChain;
  readonly articleChain: FakeArticleChain;
  readonly youtubeServices: FakeYoutubeServiceRun;
  private orders: Record<string, OrderLite[]>;
  private orderPrices=new Map<string,{price:RoomPrice;receipt:ReceiptLite}>();
  private invoiceSnapshots = new Map<string, { countryCode: string; currency: string; subtotal: string; taxes: { key: string; label: string; minor: string }[]; treatment?: string; rateBps?: string }>();
  invoiceSnapshot(biz: string, id: string) { return clone(this.invoiceSnapshots.get(biz + ':' + id)); }
  roomPrice(biz:string,id:string){const kept=this.orderPrices.get(biz+':'+id);return kept?clone(kept.price):undefined;}
  orderReceipt(biz:string,id:string){return clone([...this.orderPrices.entries()].find(([key,value])=>key.startsWith(biz+':')&&value.receipt.id===id)?.[1].receipt);}
  private narrationPrices=new Map<string,{id:string;currency:string;hourlyMinor:string;ownerSet:boolean;stale:boolean}>();
  narrationPrice(biz:string,orderId:string){const value=this.narrationPrices.get(biz+':'+orderId);return value?clone(value):undefined;}
  private deliveries: Record<string, DeliveryLite[]>;
  private templateRuns = new Set<string>();
  private nativeSources = new Map<string,{digest:string;fileIds:string[]}>();
  private nativeSource(biz:string,order:OrderLite,fileIds?:readonly string[]):string {
    const client=this.host.clients().find(client=>client.id===order.clientId);
    const files=this.orderFiles(biz,order.id).filter(file=>!fileIds||fileIds.includes(file.id));
    return priceDigest({order,client:client?{id:client.id,name:client.name,email:client.email,taxId:client.taxId}:null,files,plan:this.host.plan()});
  }
  nativeCanResume(run:RunDetail):boolean {
    const delivery=(this.deliveries[run.businessId]??[]).find(item=>item.id===run.runId);
    if(!delivery || delivery.status!=='stopped' || delivery.verdict || !run.steer?.length)return false;
    const source=this.nativeSources.get(run.businessId+':'+run.runId);
    try{const order=this.order(run.businessId,delivery.orderId);return order.status!=='cancelled'&&!!source&&source.digest===this.nativeSource(run.businessId,order,source.fileIds);}catch{return false;}
  }
  nativeStop(run:RunDetail):void {
    const delivery=(this.deliveries[run.businessId]??[]).find(item=>item.id===run.runId);
    if(delivery){delivery.status='stopped';delivery.awaitingYou=false;}
  }
  async nativeRestart(run:RunDetail,resume:boolean):Promise<RunDetail> {
    const biz=this.host.current(),delivery=(this.deliveries[biz]??[]).find(item=>item.id===run.runId);
    if(!delivery)throw new EngineError('RUN_RESTART_REQUIRED','There is no current saved work to continue. Choose Run again to start a fresh AI job.');
    if(resume && (this.deliveries[biz]??[]).find(item=>item.orderId===delivery.orderId)?.id!==run.runId)throw new EngineError('RUN_SUPERSEDED','A newer run of this order replaced this one, so it cannot be resumed. Open the newer run instead.');
    if(this.order(biz,delivery.orderId).status==='cancelled')throw new EngineError('ORDER_NOT_ACTIVE','This order was cancelled, so its run cannot go on.');
    if(resume&&!this.nativeCanResume(run))throw new EngineError('RUN_RESTART_REQUIRED','There is no current saved work to continue. Choose Run again to start a fresh AI job.');
    const next=await this.start(biz,{orderId:delivery.orderId},resume?run:undefined);
    const view=this.host.runs().find(item=>item.businessId===biz&&item.runId===next.id)!;
    if(resume && view.agentProgress && run.steer)view.steer=clone(run.steer);
    return view;
  }
  private uploads: Record<string, UploadLite[]>;
  private seq = 0;
  private readonly fileFingerprints = new Map<string, string>();
  private readonly fileContents = new Map<string, string>();

  constructor(host: WorkHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.careerDelivery=new FakeCareerDelivery(host,{deliveries:()=>this.deliveries[host.current()]??[],keep:run=>{(this.deliveries[host.current()]??=[]).unshift(run);}});
    this.r5Delivery=new FakeR5Delivery(host,{deliveries:()=>this.deliveries[host.current()]??[],keep:run=>{(this.deliveries[host.current()]??=[]).unshift(run);}});
    this.phoneDelivery=new FakePhoneDelivery(host,{deliveries:()=>this.deliveries[host.current()]??[],keep:run=>{(this.deliveries[host.current()]??=[]).unshift(run);}});
    this.devDelivery=new FakeDevDelivery(host,{deliveries:()=>this.deliveries[host.current()]??[],keep:run=>{(this.deliveries[host.current()]??=[]).unshift(run);}});
    this.vaDelivery=new FakeVaDelivery(host,{deliveries:()=>this.deliveries[host.current()]??[],keep:run=>{(this.deliveries[host.current()]??=[]).unshift(run);}});
    this.youtubeServices=new FakeYoutubeServiceRun(host,{orders:()=>this.orders[host.current()]??[],deliveries:()=>this.deliveries[host.current()]??[],files:id=>this.orderFiles(host.current(),id),keep:run=>{(this.deliveries[host.current()]??=[]).unshift(run);}});
    this.narrationChain=new FakeNarrationChain(host,{orders:()=>this.orders[host.current()]??[],deliveries:()=>this.deliveries[host.current()]??[],keep:run=>{(this.deliveries[host.current()]??=[]).unshift(run);}});
    this.articleChain=new FakeArticleChain(host,{orders:()=>this.orders[host.current()]??[],deliveries:()=>this.deliveries[host.current()]??[],keep:run=>{(this.deliveries[host.current()]??=[]).unshift(run);},next:orderId=>{this.start(host.current(),{orderId});}});
    this.socialChain=new FakeSocialChain(host,{orders:()=>this.orders[host.current()]??[],deliveries:()=>this.deliveries[host.current()]??[],files:id=>this.orderFiles(host.current(),id),keep:run=>{(this.deliveries[host.current()]??=[]).unshift(run);},eraseFiles:ids=>{const biz=host.current();this.uploads[biz]=(this.uploads[biz]??[]).filter(f=>!ids.has(f.id));for(const id of ids){this.fileContents.delete(biz+':'+id);this.fileFingerprints.delete(biz+':'+id);}},next:orderId=>{this.start(host.current(),{orderId});}});
    this.orders = options.fresh ? {} : clone(ORDERS);
    this.deliveries = options.fresh ? {} : clone(DELIVERIES);
    this.uploads = options.fresh ? {} : clone(UPLOADS);
  }

  /** Internal queue projection, scoped by business and returned without mutable references. */
  keepTranslationFile(biz:string,orderId:string,file:{id:string;name:string;contentBase64:string;digest:string}){const order=this.orders[biz]?.find(o=>o.id===orderId&&o.status!=='cancelled');if(!order)throw new EngineError('ORDER_NOT_FOUND','Choose a current caption order.');const uploads=this.uploads[biz]??=[],old=uploads.find(f=>f.id===file.id);const body={id:file.id,at:this.host.now(),name:file.name,format:'transcript' as const,bytes:atob(file.contentBase64).length,scope:{kind:'order' as const,orderId},clientData:true};if(old)Object.assign(old,body);else uploads.push(body);this.fileContents.set(biz+':'+file.id,file.contentBase64);this.fileFingerprints.set(biz+':'+file.id,file.digest);}
  keepNarrationFetched(biz:string,orderId:string,file:{id:string;name:string;contentBase64:string;digest:string},source:{fileId:string;url:string;finalUrl:string;digest:string}){const order=this.orders[biz]?.find(o=>o.id===orderId);if(!order)throw new EngineError('ORDER_NOT_FOUND','Choose a current narration order.');(this.uploads[biz]??=[]).push({id:file.id,at:this.host.now(),name:file.name,format:'transcript',bytes:atob(file.contentBase64).length,scope:{kind:'order',orderId},clientData:true});this.fileContents.set(biz+':'+file.id,file.contentBase64);this.fileFingerprints.set(biz+':'+file.id,file.digest);order.narrationFetched=clone(source);}
  ordersFor(biz: string): OrderLite[] { return clone(this.orders[biz] ?? []); }
  /** Seller Forget takes the source bytes and fingerprints as well as their upload rows. */
  eraseSellerFiles(biz:string,ids:readonly string[]):void {const gone=new Set(ids);this.uploads[biz]=(this.uploads[biz]??[]).filter(file=>!gone.has(file.id));for(const id of gone){this.fileContents.delete(biz+':'+id);this.fileFingerprints.delete(biz+':'+id);}}
  /** Exact tender Forget clears order intake after the owner approves erasure. */
  eraseInfluencerOrders(biz:string,orderIds:readonly string[]):void{this.orders[biz]=(this.orders[biz]??[]).map(order=>{if(!orderIds.includes(order.id))return order;const {intake:_intake,...rest}=order;return {...rest,request:'',status:'cancelled'};});}
  eraseCareerOrders(biz:string,orderIds:readonly string[]):void{this.orders[biz]=(this.orders[biz]??[]).map(order=>{if(!orderIds.includes(order.id))return order;const {intake:_intake,...rest}=order;return {...rest,request:'Client data deleted.',status:'cancelled'};});}
  eraseTenderIntake(biz:string,orderIds:readonly string[]):void{this.orders[biz]=(this.orders[biz]??[]).map(order=>{if(!orderIds.includes(order.id))return order;const {intake:_intake,narrationFetched:_narrationFetched,...rest}=order;return rest;});}
  eraseRecruitingCopies(biz:string,orderIds:readonly string[],line='Candidate evidence was deleted. Start with new approved sources.'):string[]{this.careerDelivery.eraseOrders(biz,orderIds);this.devDelivery.eraseOrders(biz,orderIds);this.r5Delivery.eraseOrders(biz,orderIds);this.phoneDelivery.eraseOrders(biz,orderIds);this.vaDelivery.eraseOrders(biz,orderIds);this.narrationChain.eraseOrders(biz,orderIds);this.youtubeServices.eraseOrders(biz,orderIds);this.articleChain.eraseOrders(biz,orderIds);const ids=new Set((this.deliveries[biz]??[]).filter(r=>orderIds.includes(r.orderId)).map(r=>r.id));this.deliveries[biz]=(this.deliveries[biz]??[]).map(r=>ids.has(r.id)?{...r,status:'stopped',deliverable:null,renderedText:null,editedText:null,verdict:null,awaitingYou:false}:r);for(const r of this.host.runs())if(r.businessId===biz&&ids.has(r.runId)){r.state='waiting';r.stop={state:'stopped',line};r.steps=[];delete r.steer;delete r.question;delete r.live;this.nativeSources.delete(biz+':'+r.runId);if(r.agentProgress)r.agentProgress={messages:[],tools:[],canResume:false,...(r.agentProgress.cost?{cost:r.agentProgress.cost}:{})};this.host.emit({type:'run.stopped',businessId:biz,runId:r.runId,at:this.host.now()});}return [...ids];}

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

  /** Revoking a grant stops only this business's synthetic in-flight jobs. */
  recheckAiConsent():void {
    const biz=this.host.current();
    for(const run of this.deliveries[biz]??[]) {
      const view=this.host.runs().find(view=>view.runId===run.id&&view.businessId===biz);
      if(!view?.agentProgress || view.state!=='active')continue;
      const order=(this.orders[biz]??[]).find(order=>order.id===run.orderId),client=this.host.clients().find(client=>client.id===order?.clientId);
      if(client?.aiConsent&&!client.aiConsent.withdrawnAt)continue;
      run.status='failed';view.state='failed';view.error='Allow this client’s data to reach your AI before starting their work.';
      this.host.emit({type:'run.failed',businessId:biz,runId:run.id,at:this.host.now()});
    }
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
      case 'venture.order.create': return this.withNewClient(p, (p, fresh) => {const docs=p.intakeFiles&&typeof p.intakeFiles==='object'&&!Array.isArray(p.intakeFiles)?Object.values(p.intakeFiles).filter(hasDocx):[];if(!docs.length)return this.create(biz,p,fresh);const plan=JSON.stringify(this.host.plan());return Promise.all(docs.map(file=>{if(Object.keys(file).sort().join(',')!=='contentBase64,name')throw invalid('Send the required fields and nothing else.');return checkFakeDocx(file);})).then(()=>{if(this.host.current()!==biz||JSON.stringify(this.host.plan())!==plan)throw new EngineError('APPROVAL_STALE','The business or plan changed. Review the file again.');return this.create(biz,p,fresh);});});
      case 'venture.order.deliver': return this.deliver(biz, p);
      case 'venture.delivery.list': return clone(this.deliveries[biz] ?? []);
      case 'venture.delivery.run': return this.start(biz, p);
      case 'venture.delivery.review': {
        // W6 6E5: a sign-off desk draft is accepted only once its professional of record signed these exact papers.
        const held = p.verdict === 'accepted' ? (this.deliveries[biz] ?? []).find(run => run.id === p.runId) : undefined;
        const unsigned = held ? this.host.signoffBlock?.(held) ?? null : null;
        if (unsigned) throw new EngineError('SIGNOFF_REQUIRED', unsigned);
      }
      if (this.templateRuns.has(biz+':'+p.runId)) {
        const run = this.reviseRun(biz, String(p.runId), current => reviewTemplate(current, p, this.host.now()));
        const view = this.host.runs().find(view => view.businessId === biz && view.runId === run.id);
        if (view) { view.state = 'done'; view.steps = view.steps.map(step => ({ ...step, state: 'done' })); view.progress = { done: view.steps.length, total: view.steps.length }; }
        this.host.emit({ type: 'run.done', businessId: biz, runId: run.id, at: this.host.now() });
        return clone(run);
      }
      return this.r5Delivery.handles(p.runId)?this.r5Delivery.request(method,p):this.phoneDelivery.handles(p.runId)?this.phoneDelivery.request(method,p):this.devDelivery.handles(p.runId)?this.devDelivery.request(method,p):this.careerDelivery.handles(p.runId)?this.careerDelivery.request(method,p):this.vaDelivery.handles(p.runId)?this.vaDelivery.request(method,p):this.youtubeServices.handles(p.runId)?this.youtubeServices.request(method,p):this.narrationChain.handles(p.runId)?this.narrationChain.request(method,p):this.articleChain.handles(p.runId)?this.articleChain.request(method,p):this.socialChain.request(method,p);
      case 'venture.files.list': return clone((this.uploads[biz] ?? []).filter((u) => typeof p.orderId !== 'string' || ((u.scope.kind === 'order' || u.scope.kind === 'media') && u.scope.orderId === p.orderId)));
      case 'venture.files.add': {if(Object.keys(p).sort().join(',')!=='contentBase64,name,orderId')throw invalid('Send the required fields and nothing else.');if(!hasDocx(p))return this.addFile(biz,p);if(Object.keys(p).sort().join(',')!=='contentBase64,name,orderId')throw invalid('Send the required fields and nothing else.');return checkFakeDocx(p).then(()=>{if(this.host.current()!==biz)throw new EngineError('APPROVAL_STALE','The business changed. Review the file again.');return this.addFile(biz,p);});}
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  private order(biz: string, id: unknown): OrderLite {
    const order = (this.orders[biz] ?? []).find((o) => o.id === id);
    if (!order) throw new EngineError('ORDER_NOT_FOUND', 'That order was not found.');
    return order;
  }

  /**
   * One-shot A1 (row 10), as money/orders.ts: a client typed with the order (newClient) is added with it or not at all,
   * and never beside a chosen clientId. The order's checks read the client as it would be (checked, not stored); the
   * client is added only once every check passed, so a refused order writes nothing and announces nothing.
   */
  private withNewClient<T>(p: Record<string, unknown>, make: (p: Record<string, unknown>, fresh: { typed: Record<string, unknown>; client: ClientLite } | null) => T): T {
    if (p.newClient === undefined) return make(p, null);
    if (p.clientId !== undefined) throw invalid('Choose a client or add a new one, not both.');
    const typed = (p.newClient ?? {}) as Record<string, unknown>;
    const client = this.host.checkClient!(typed);
    const { newClient: _typed, ...rest } = p;
    return make(rest, { typed, client });
  }

  private create(biz: string, p: Record<string, unknown>, fresh: { typed: Record<string, unknown>; client: ClientLite } | null = null): OrderLite {

    const plan = this.host.plan();
    if (!plan) throw new EngineError('BLUEPRINT_NOT_ACCEPTED', 'Accept your plan first.');
    const offer = plan.blueprint.offers.find((o) => o.id === p.offerId);
    if (!offer) throw invalid('That service is not in your plan.');
    // 6D1, 6D4 (money/orders.ts): the order's own due date, and a price in a client's own currency, as the engine reads them.
    const foreignAsk = fakeForeignAsk(p);
    if (offer.pricing.unitPriceMinor === null && !foreignAsk) throw new EngineError('PRICE_REQUIRED', `Set your price for ${offer.name.value} first.`);
    const internal = plan.playbook?.id === 'online-seller' && offer.playbookOffer === 'own-shop-back-office';
    // Review of A1 (row 10), as money/orders.ts: the own shop's back office takes no new client.
    if (internal && fresh) throw new EngineError('INTERNAL_ORDER', 'This offer is for your own shop, so it takes no new client.');
    let client = fresh ? fresh.client : this.host.clients().find(c => internal ? c.self : c.id === p.clientId);
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
    const keptIntake = ask?.kit && plan.playbook?.id==='youtube' && offer.playbookOffer==='screencast-tutorial' ? fakeYoutubeMediaIntake(rawIntake,ask,{currency:this.host.country().currency,by:'owner',at:this.host.now(),today:new Date(Date.parse(this.host.now())+19800000).toISOString().slice(0,10),hosted:this.host.hosted?.()},()=>this.host.ask?.('venture.voiceConsent.list',{}) as import('./types').VoiceConsentsView??{consents:[],line:''}) : ask?.kit && plan.playbook?.id === 'social-agency' ? fakeSocialIntake(rawIntake, ask, offer.playbookOffer!, { currency: this.host.country().currency, by: 'owner', at: this.host.now(), today: new Date(Date.parse(this.host.now()) + 19800000).toISOString().slice(0, 10), hosted: this.host.hosted?.() }, () => this.host.ask?.('venture.voiceConsent.list', {}) as import('./types').VoiceConsentsView ?? {consents:[],line:''}) : ask?.kit ? fakeKitIntake(rawIntake, ask, () => this.host.ask?.('venture.voiceConsent.list', {}) as import('./types').VoiceConsentsView ?? { consents: [], line: '' }, { currency: this.host.country().currency, by: 'owner', at: this.host.now(), today: new Date(Date.parse(this.host.now()) + 19800000).toISOString().slice(0, 10) }) : rawIntake;
    if(plan.playbook?.id==='youtube'&&isYoutubeService(offer.playbookOffer))validateYoutubeServiceIntake((keptIntake as OrderLite['intake'])?.fields,offer.playbookOffer!);
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
    const foreignPrice = foreignAsk ? fakeForeignPrice(foreignAsk, client, this.host.country()) : null;
    const orderId = `o-new-${++this.seq}`;
    const order: OrderLite = {
      ...(internal ? { internal: true as const } : {}),
      id: orderId, at: this.host.now(), clientId: client.id, offerId: offer.id,
      quantity: text(p.quantity) || offer.pricing.defaultQuantity, request, status: 'open',
      priceReceiptId: 'order-price-'+biz+'-'+orderId, deliveredOn: null,
      // The engine keeps the intake on the order (OrderRecord.intake); a transcript made here reads its cutFile.
      ...(keptIntake && typeof keptIntake === 'object' ? { intake: clone(keptIntake) as OrderLite['intake'] } : {}),
      ...(foreignAsk?.dueDate ? { dueDate: foreignAsk.dueDate } : {}), ...(foreignPrice ? { foreignPrice } : {}),
    };
    let roomPrice:{price:RoomPrice;receipt:ReceiptLite};
    let invoiceSnapshot: { countryCode: string; currency: string; subtotal: string; taxes: { key: string; label: string; minor: string }[]; treatment?: string; rateBps?: string };
    {
      const office=plan.blueprint.backOffice,country=this.host.country(),currency=foreignPrice?.currency??office.currency;
      if(office.currency!==country.currency)throw new EngineError('CURRENCY_CONFLICT',`This business keeps its books in ${country.currency}.`);
      const decision=taxDecision({taxRegistered:office.taxRegistered,taxRateBps:office.taxRateBps??'0',taxState:office.taxState??null,lutConfirmed:office.lutConfirmed??false},{countryCode:client.countryCode??null,stateCode:client.stateCode??null},country.code);
      if(foreignPrice&&decision.treatment==='igst')throw new EngineError('FOREIGN_NEEDS_LUT',`Confirm your Letter of Undertaking (LUT) in your plan to bill this client in their currency, or bill them in ${country.currency}.`);
      if(foreignPrice&&decision.treatment!=='zero-rated-lut'&&decision.rateBps!=='0')throw new EngineError('FOREIGN_NEEDS_LUT',`Tax on this sale is worked out in ${country.currency}, so bill this client in ${country.currency}.`);
      const input={unitPriceMinor:foreignPrice?.unitPriceMinor??offer.pricing.unitPriceMinor!,quantity:order.quantity,discountBps:'0',taxRateBps:decision.rateBps,currency,taxTreatment:decision.treatment},computed=p.taxInclusive===true&&splitsInclusive(decision.treatment)?computeInclusivePrice(input):computePrice(input),id=order.priceReceiptId;
      const display=formatMinor(computed.amounts.total,currency),receipt:ReceiptLite={id,at:order.at,stale:false,totalMinor:computed.amounts.total,figures:[{key:'unit',label:'Price per '+offer.pricing.quantityUnit,display:formatMoney(computed.amounts.unit,currency)},{key:'subtotal',label:'Subtotal',display:formatMoney(computed.amounts.subtotal,currency)},...(['taxable','tax','cgst','sgst','igst'] as const).flatMap(key=>computed.amounts[key]===null?[]:[{key,label:key.toUpperCase(),display:formatMoney(computed.amounts[key]!,currency)}]),{key:'total',label:'Total',display:formatMoney(computed.amounts.total,currency)}],explanation:computed.steps.map(step=>step.rule+'; inputs: '+step.inputs.join(', ')+'; result: '+step.resultMinor+' minor units').join('. ')};
      roomPrice={price:{offerId:offer.id,minor:computed.amounts.total,currency,receiptId:id,priceDigest:priceDigest({orderId:order.id,input,computed}),display},receipt};order.priceReceiptId=id;
      const split = computed.amounts.cgst !== null || computed.amounts.sgst !== null || computed.amounts.igst !== null;
      invoiceSnapshot = { countryCode: country.code, currency, subtotal: computed.amounts.subtotal, treatment: decision.treatment, rateBps: decision.rateBps,
        taxes: (split ? ['cgst', 'sgst', 'igst'] as const : ['tax'] as const).flatMap(key => computed.amounts[key] === null || computed.amounts[key] === '0' ? [] : [{ key, label: key.toUpperCase(), minor: computed.amounts[key]! }]),
      };
    }
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
    // Every check passed: only now is the new client stored, and the order points at it.
    if (fresh) order.clientId = (this.host.ask!('venture.client.add', fresh.typed) as ClientLite).id;
    this.orderPrices.set(biz+':'+order.id,roomPrice);
    this.invoiceSnapshots.set(biz + ':' + order.id, invoiceSnapshot);
    if(plan.playbook?.id==='narration-studio')this.narrationPrices.set(biz+':'+order.id,{id:order.priceReceiptId,currency:plan.blueprint.backOffice.currency,hourlyMinor:(foreignPrice?.unitPriceMinor??offer.pricing.unitPriceMinor)!,ownerSet:offer.pricing.unitPriceLabel==='told-by-you',stale:false});
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
  private async start(biz: string, p: Record<string, unknown>,resume?:RunDetail): Promise<DeliveryLite> {
    if(Object.keys(p).some(k=>!['orderId','useTemplate'].includes(k)) || !Object.hasOwn(p,'orderId') || p.useTemplate!==undefined&&typeof p.useTemplate!=='boolean')throw invalid('Send the required fields and nothing else.');
    const order = this.order(biz, p.orderId);
    fakeRecruitPreflight(this.host,order);
    if(this.host.plan()?.playbook?.id==='app-testing')this.host.testingSource!(order.id);
    if(this.host.plan()?.playbook?.id==='data-entry-desk'){this.host.formsSource!(order.id);if(!ruleCleared(FORMS_ACCESS_RULE as never,fakeAttested(this.host.ask?.bind(this.host))))throw new EngineError('RULE_UNCONFIRMED','A lawyer has not confirmed the rule "Client system permission" yet. It works in practice runs only until they do.');}
    if(this.host.plan()?.playbook?.id==='website-studio'&&order.intake?.fields?.private===true)throw new EngineError('PRIVATE_NEEDS_LOCAL','Private website source needs a qualified local model. Review it manually meanwhile.');
    if(this.host.plan()?.playbook?.id==='website-studio'&&!SITE_FORM_RULE.confirmedBy)throw new EngineError('RULE_UNCONFIRMED','A lawyer has not confirmed the rule "Website form notice and permission" yet. It works in practice runs only until they do.');
    if(this.host.plan()?.playbook?.id==='newsletter-studio'&&order.intake?.fields?.private===true)throw new EngineError('PRIVATE_NEEDS_LOCAL','Private source notes need a qualified local model. Write the issue manually meanwhile.');
    if(this.host.plan()?.playbook?.id==='newsletter-studio'&&!ruleCleared(NEWSLETTER_PRIVACY_RULE as never,fakeAttested(this.host.ask?.bind(this.host))))throw new EngineError('RULE_UNCONFIRMED','A lawyer has not confirmed the rule "Subscriber permission" yet. It works in practice runs only until they do.');
    if(this.host.plan()?.playbook?.id==='translation-studio'&&order.intake?.fields?.private!==false)throw new EngineError('PRIVATE_NEEDS_LOCAL','This private job needs a local model. Use the local review sheet meanwhile.');
    if(this.host.plan()?.playbook?.id==='translation-studio')throw new EngineError('RULE_UNCONFIRMED','A lawyer has not confirmed the rule "Translation rights review" yet. It works in practice runs only until they do.');
    const blocked = order.intake?.fields?.blockedCustomers;
    const named = Array.isArray(blocked) && blocked.some(value => typeof value === 'string' && value.trim() && order.request.toLowerCase().includes(value.trim().toLowerCase()));
    const support = this.host.ask?.('venture.desk.list', { playbook: 'support-desk', kind: 'ticket', filter: { queue: 'all' } }) as { rows?: { id: string; paused: boolean; status: string }[] } | undefined;
    const paused = support?.rows?.some(row => row.paused && !['resolved', 'closed'].includes(row.status) && (this.host.ask?.('venture.desk.get', { playbook: 'support-desk', kind: 'ticket', id: row.id }) as { item?: { serviceOrderId?: string } } | undefined)?.item?.serviceOrderId === order.id);
    if (named || paused) throw new EngineError('SUPPORT_PERSON_REQUIRED', 'A person is handling this customer. Automatic drafts are paused. Open the support desk.');
    fakeSocialPreflight(this.host.plan(), order, this.orderFiles(biz, order.id));
    fakeSellerPreflight(this.host.plan(),order,this.orderFiles(biz,order.id),this.host.now());
    this.articleChain.preflight(order);this.socialChain.preflight(order);this.youtubeServices.preflight(order);
    if(this.host.plan()?.playbook?.id==='virtual-assistant')this.host.vaBrief!(order.id);
    if(this.host.plan()?.playbook?.id==='narration-studio')await this.narrationChain.preflight(order.id);
    if(this.host.current()!==biz)throw new EngineError('APPROVAL_STALE','The business changed. Read the current draft.');
    const runs = this.host.runs();
    const runId = String(Math.max(0, ...runs.map((r) => Number(r.runId)).filter((n) => Number.isInteger(n))) + 1);
    const status=this.host.ask?.('venture.models.status',{}) as import('./types').ModelStatusLite|undefined;
    const template=p.useTemplate===true || status?.tiers.main.presetId==='built-in-templates' || ['dev-agency','job-search-desk','phone-receptionist','app-testing','monitored-data','it-triage'].includes(this.host.plan()?.playbook?.id??'');
    if(!template) {
      const client=this.host.clients().find(client=>client.id===order.clientId);
      if(!client)throw new EngineError('CLIENT_NOT_FOUND','Choose a client from this business.');
      if(!client.aiConsent || client.aiConsent.withdrawnAt)throw new EngineError('CLIENT_AI_CONSENT_REQUIRED','Allow this client’s data to reach your AI before starting their work.');
      if(resume && (!this.nativeCanResume(resume)||this.nativeSources.get(biz+':'+resume.runId)?.digest!==this.nativeSource(biz,order)))throw new EngineError('RUN_RESTART_REQUIRED','The saved work no longer matches this order. Start a new job.');
      const at=this.host.now();
      this.nativeSources.set(biz+':'+runId,{digest:this.nativeSource(biz,order),fileIds:this.orderFiles(biz,order.id).map(file=>file.id)});
      runs.unshift({runId,businessId:biz,agent:this.host.agentName(),purpose:`Draft a reply for ${client.name}`,state:'active',startedAt:at,elapsed:'',progress:'indeterminate',steps:[{id:'read',purpose:"Read the order and the client's files",state:'pending'},{id:'write',purpose:'Write the draft',state:'pending'},{id:'review',purpose:'Review the draft',state:'pending'}],agentProgress:{messages:[],tools:[]}});
      // No installed AI runs in this fake. It starts honestly with no fabricated tool results or answer.
      const stage=(this.host.ask?.('venture.get',{}) as {venture?:{launchStage?:string}}|null|undefined)?.venture?.launchStage;
      // W6 6C4: in Practice an AI draft for a real order is a practice draft, as the engine marks it.
      const run:DeliveryLite&{preview:null}={id:runId,at,orderId:order.id,status:'waiting-for-you',practice:!isLiveStage(stage),servedBy:'model',preview:null,deliverable:null,verdict:null,awaitingYou:false};
      (this.deliveries[biz]??=[]).unshift(run);this.host.emit({type:'run.started',businessId:biz,runId,at});return clone(run);
    }
    if(this.host.plan()?.playbook?.id==='social-agency')throw new EngineError('NOT_BUILT_YET','Social writing stages need an AI draft. Connect your AI and start this stage again.');
    const social=this.r5Delivery.start(order,runId,p)??this.phoneDelivery.start(order,runId,p)??this.devDelivery.start(order,runId,p)??this.careerDelivery.start(order,runId,p)??this.vaDelivery.start(order,runId,p);
    if(social){runs.unshift({runId,businessId:biz,agent:this.host.agentName(),purpose:'Demo writing stage',state:'waiting',startedAt:this.host.now(),elapsed:'',progress:{done:0,total:1},steps:[{id:'write',purpose:'Demo writing stage',state:'current',elapsed:'now'}]});this.host.emit({type:'run.started',businessId:biz,runId,at:this.host.now()});return social;}
    const client = this.host.clients().find((c) => c.id === order.clientId)?.name ?? 'the client';
    const at = this.host.now();
    runs.unshift({
      runId, businessId: biz, agent: this.host.agentName(), purpose: `Draft a reply for ${client}`, state: 'waiting', startedAt: at, elapsed: '',
      progress: { done: 1, total: 2 },
      steps: [
        { id: 'write', purpose: 'Prepare the template outline', state: 'done' },
        { id: 'review', purpose: 'Review the draft', state: 'waiting' },
      ],
    });
    const receipt=this.host.receipt?.(order.priceReceiptId)??this.orderPrices.get(biz+':'+order.id)?.receipt;
    const total=receipt?.figures.find(figure=>figure.key==='total');
    const deliverable=templateOutline(this.host.plan()?.blueprint.serviceType??'other',total?{receiptId:order.priceReceiptId,figureKey:'total'}:null);
    const blocks=['# '+deliverable.title,...deliverable.sections.map(section=>'## '+section.heading+'\n'+section.parts.map(part=>part.kind==='text'?part.text:total!.label+': '+total!.display).join(' '))];
    if(deliverable.questionsForClient.length)blocks.push(['Questions for you:',...deliverable.questionsForClient.map(question=>'- '+question)].join('\n'));
    const renderedText=TEMPLATE_OUTLINE_LINE+'\n\n'+blocks.join('\n\n');
    const run: DeliveryLite&{preview:null} = { id: runId, at, orderId: order.id, status: 'ready-for-review', servedBy:'template', practice: false, deliverable, renderedText, preview:null, verdict: null, awaitingYou: true };
    (this.deliveries[biz] ??= []).unshift(run);
    this.templateRuns.add(biz+':'+runId);
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
    if(['txt','md','markdown'].includes(ext)){try{new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));}catch{throw new EngineError('UNSUPPORTED_UPLOAD','This CSV is not UTF-8 text. Save it as CSV UTF-8 and add it again.');}}
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

/** 6D1, 6D4: the due date and a foreign price a request asks for, read as money/orders.ts reads them. */
function fakeForeignAsk(p: Record<string, unknown>): { dueDate: string | null; currency: string; typed: string } | { dueDate: string | null; currency: null; typed: null } | null {
  if (p.dueDate !== undefined && (typeof p.dueDate !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p.dueDate) || Number.isNaN(Date.parse(`${p.dueDate}T00:00:00Z`)) || new Date(`${p.dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== p.dueDate)) {
    throw new EngineError('INVALID_VENTURE_REQUEST', 'Due date must be a date like 2026-10-15.');
  }
  const dueDate = (p.dueDate as string | undefined) ?? null;
  if ((p.currency === undefined) !== (p.unitPrice === undefined)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Give the currency and your price in it together.');
  if (p.currency === undefined) return dueDate ? { dueDate, currency: null, typed: null } : null;
  const typed = typeof p.unitPrice === 'string' && p.unitPrice.length <= 40 ? p.unitPrice.replace(/[\s,]/g, '') : '';
  if (!/^\d+(?:\.\d+)?$/.test(typed)) throw new EngineError('INVALID_AMOUNT', 'Your price must be a positive amount like 2499 or 2499.50.');
  if (typeof p.currency !== 'string' || !/^[A-Z]{3}$/.test(p.currency)) throw new EngineError('INVALID_CURRENCY', 'Use a three-letter currency code like USD.');
  return { dueDate, currency: p.currency, typed };
}

function fakeForeignPrice(ask: NonNullable<ReturnType<typeof fakeForeignAsk>>, client: ClientLite, country: { code: string; currency: string }): { currency: string; unitPriceMinor: string } | null {
  if (ask.currency === null || ask.typed === null) return null;
  currencyMinorDigits(ask.currency);
  if (ask.currency === country.currency) throw new EngineError('INVALID_VENTURE_REQUEST', `Your prices are in ${country.currency} already; leave the currency out.`);
  if (!client.countryCode || client.countryCode === country.code) throw new EngineError('INVALID_VENTURE_REQUEST', `Bill a client in their own currency only when they are outside ${countryProfile(country.code).name}. Add their country first.`);
  const unitPriceMinor = decimalMinor(ask.typed, ask.currency);
  if (BigInt(unitPriceMinor) <= 0n) throw new EngineError('INVALID_AMOUNT', 'Your price must be above zero.');
  return { currency: ask.currency, unitPriceMinor };
}
