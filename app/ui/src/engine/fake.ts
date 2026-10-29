import {withSellerCards} from './fake-seller-cards';
import { fakeSocialForIdea, fakeSocialPlan } from './fake-social-plan';
import { fakeSocialRevisionDueRows } from './fake-social-revision-due';
import {fakeYoutubeForIdea,fakeYoutubePlan} from './fake-youtube-plan';
import { fakeCaPlan, fakeCaForIdea } from './fake-ca-plan';
/**
 * The fake engine for `npm run dev:ui` and for tests. It answers the same methods with the same shapes and keeps the
 * same rules the real engine keeps: decide once, refuse a stale digest and hand back the new version, refuse an
 * approval before the draft was viewed (VIEW_FIRST), refuse loosening an always-ask step (GATE_FLOOR), refuse
 * opening a passphrase business without it. Figures are fixed sample text; nothing is computed for display.
 */

import { AGENTS, BOOKS, BUSINESSES, CLIENTS, CONNECTORS, EVIDENCE, JOURNAL, QUEUE, RECEIPTS, RUNS, SPEND, SPEND_MICROS } from './fixtures';
import { COUNTRIES, CUSTODY_ERROR_WORDS, NEW_BUSINESS_ROWS, SAMPLE_MOVE_CODE, SAMPLE_PASSPHRASE, SAMPLE_RECOVERY_CODE, SERVICE_KEYWORDS, SERVICE_LABELS, type FakeBusiness } from './fixtures';
import type { BackupLite, BlueprintViewLite, InterviewAnswer, InterviewQuestionLite, ServiceType, WorkspaceCreated } from './types';
import { createStatusStore } from './client';
import { QUEUE_VIEWS } from './fixtures';
import { FakeBusinessDesk, SAMPLE_MOVE_FORMAT } from './fake-business';
import { FakeWorkDesk } from './fake-work';
import { FakeMoney } from './fake-money';
import { FakeExtrasDesk } from './fake-extras';
// 4Z3: which currency leads spend, as the engine's money/spend.ts.
import { rupeesAt, rupeesLead, spendLead, spendSettings } from './fake-lead';
import { FakePostingDesk } from './fake-posting';
import { FakePracticeDesk } from './fake-practice';
import { FakeBankDesk } from './fake-bank';
import { FakeWiringDesk } from './fake-wiring';
import { FakeAgentsDesk } from './fake-agents';
import { FakeChiefDesk } from './fake-chief';
import { FakeNetworkDesk } from './fake-network';
import { FakeNotifyDesk } from './fake-notify';
import { FakeW4Desk } from './fake-w4';
// Ink v2 wave 5 (package 5-0): every playbook's desk, and the kit's methods (5A1 to 5A6).
import { FakePlaybooksDesk } from './fake-playbooks';
import { FakeKitChainDesk } from './fake-kit-chain';
import { FakeKitSalesDesk } from './fake-kit-sales';
import { FakeKitRulesDesk } from './fake-kit-rules';
import { FakeKitMediaDesk } from './fake-kit-media';
import { FakeKitReportDesk } from './fake-kit-report';
import { FakeKitConnectDesk } from './fake-kit-connect';
import { AUTO_LOCKED_WORDS } from './fake-4j22a';
import { fakeChecklist, fakeWays } from './fake-start';
import { fakeKitForIdea, fakeKitPlan } from './fake-kit-plans';
import { withTruth } from './fake-setup';
import type { DeliveryLite, InvoiceLite, OrderLite, ReceiptLite } from './types';
import { EngineError, type HostedMeLite, type AgentView, type ClientLite, type EngineClient, type EvidenceItem, type MethodName, type ParamsOf, type Posture, type QueueAction, type QueueDecision, type QueueRow, type ResultOf, type RunDetail, type VentureRunEvent } from './types';

const clone = <T>(value: T): T => structuredClone(value);

/** FNV-1a over canonical JSON: enough for a fake digest. The real engine uses sha256. */
export function digestOf(value: unknown): string {
  const text = JSON.stringify(value, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

const DONE_LINES: Partial<Record<QueueAction['id'], string>> = {
  approve: 'Approved', deny: 'Denied', later: 'Moved to later', answer: 'Answered', 'send-to-ca': 'Sent to your CA',
  issue: 'Issued', connect: 'Opened Connections', 'set-prices': 'Opened prices', keep: 'Kept on this computer', 'run-again': 'Started again',
};
const RECEIPTED = new Set(['price', 'quote', 'invoice']);

export interface FakeOptions {
  latencyMs?: number; now?: () => string;
  /** A computer with no business yet and no vault open: the first run. */
  fresh?: boolean;
  /** false: this computer has no protected storage, so a new vault needs a passphrase (DEVICE_KEYS_UNAVAILABLE). */
  deviceKeys?: boolean;
  /** Answer as the hosted web server does: server custody, no folder, the recovery code always shown once. */
  hosted?: boolean;
  /** The queue to start with, in place of the sample QUEUE (for example [] for "Nothing needs you."). */
  queue?: Omit<QueueRow, 'digest'>[];
  /** The businesses on this computer start closed: none is open (Welcome back). `?closed` in the dev page's address. */
  closed?: boolean;
  /** Keep only these sample businesses on this computer, by id (for example ['lumen']). */
  only?: string[];
  /** These sample businesses have lost this computer's key: only the recovery code opens them (for example ['ledgerline']). */
  keyMissing?: string[];
  /**
   * W4 4E4: the pipeline's sample is dated so a follow-up is late, two replies wait and a call just ended (the mailbox
   * and the calendar set): Today shows its follow-up, reply and notes cards. `?due` in the dev page's address.
   */
  pipelineDue?: boolean;
  /**
   * W4 4J21: the open business is a temporary one on the hosted app (4J23), started without an account: 'temporary', or
   * 'ending' in its last day. It answers as the hosted server does. `?trial` or `?trial-ending` in the dev page's address.
   */
  trial?: 'temporary' | 'ending';
}

/** A business on this computer, as the fake keeps it. `passphrase` only for one locked with a passphrase (sample only). */
interface HeldBusiness extends FakeBusiness { recovery: 'made' | 'not-made'; passphrase?: string | undefined }
interface HeldVenture { workingName: string; serviceType: ServiceType | null; idea: string; countryCode: string; done: number }
/** Answered with no vault open, as the engine answers them before its vault check (CUSTODY_PRE_VAULT_METHODS too). */
const BEFORE_VAULT = new Set([
  'workspace.status', 'workspace.list', 'workspace.open', 'workspace.create', 'workspace.lock', 'venture.countries', 'venture.preview',
  'workspace.recover', 'workspace.restore', 'workspace.transfer.import', 'workspace.backups.list',
  // Ink v2 wave 4 (4J8): the Start gallery's ways to earn, a pre-vault method on the engine too.
  'venture.playbooks.list',
]);
/** The recovery codes the sample opens with: the one made at creation and the one Keep this business makes. */
const SAMPLE_CODES = new Set([SAMPLE_RECOVERY_CODE, 'R4KD9QXM2HTW7PLB3NCF6YJV']);
/** TRANSFER.maxTextChars in workspace-custody-contracts.ts. */
const MOVE_MAX_CHARS = 1_900_000;
const UNLOCK_FAILED = 'Unable to unlock vault. Check your credential or restore a valid backup.';
const NO_KEYRING = 'This computer has no keyring Chausar can use, so Chausar asks for a passphrase.';
const NOT_ONBOARDING = Symbol('not onboarding');
/** A flag in the dev page's address, such as ?fresh. Never true in tests, which have no query. */
function devAsks(flag: string): boolean {
  try { return typeof location !== 'undefined' && new URLSearchParams(location.search).has(flag); } catch { return false; }
}

function classify(idea: string): ServiceType {
  const text = idea.toLowerCase();
  let best: ServiceType = 'other';
  let hits = 0;
  for (const [type, words] of Object.entries(SERVICE_KEYWORDS) as [Exclude<ServiceType, 'other'>, readonly string[]][]) {
    const found = words.filter((word) => text.includes(word)).length;
    if (found > hits) { best = type; hits = found; }
  }
  return best;
}

/**
 * The queue in the engine's order (views/queue.ts): the plan, price and setup rows lead, plan first, whatever their
 * times; then every other row oldest first; locked businesses last.
 */
const LEAD_RANK: Partial<Record<QueueRow['kind'], number>> = { plan: 0, price: 0, setup: 1 };
const queueGroup = (row: QueueRow) => (row.kind === 'locked' ? 2 : row.kind in LEAD_RANK ? 0 : 1);
export const queueOrder = (a: QueueRow, b: QueueRow) => queueGroup(a) - queueGroup(b)
  || (queueGroup(a) === 0 ? (LEAD_RANK[a.kind] ?? 0) - (LEAD_RANK[b.kind] ?? 0) : 0)
  || (a.kind === 'locked' ? 0 : a.createdAt.localeCompare(b.createdAt));

export class FakeEngine {
  private rows: QueueRow[];
  private decided = new Set<string>();
  private runs: RunDetail[];
  private agents: Record<string, AgentView[]>;
  private clients: Record<string, ClientLite[]>;
  private evidence: EvidenceItem[];
  /** The action journal; Resolve settles an unknown outcome in it, in the engine's words. */
  private journal = clone(JOURNAL);
  private clientSeq = 1;
  private current = 'lumen';
  private scheduledSession = 0;
  private receiptSeq = 421;
  private seq = 40;
  private listeners = new Set<(event: VentureRunEvent) => void>();
  private readonly latencyMs: number;
  private readonly now: () => string;
  // Onboarding: the businesses on this computer, whether a vault is open, and each new business's interview.
  private businesses: HeldBusiness[];
  private ventures = new Map<string, HeldVenture>();
  private interviews = new Map<string, InterviewQuestionLite[]>();
  private open = true;
  private closedByOwner = false;
  private readonly deviceKeys: boolean;
  private readonly hosted: boolean;
  private readonly trial: 'temporary' | 'ending' | null;
  /** Your AI, plan and prices, website build: fake-business.ts. */
  private readonly desk: FakeBusinessDesk;
  /** Orders, delivery runs, invoices and client files: fake-work.ts. */
  private readonly work: FakeWorkDesk;
  /** Invoices and payments, the books' open invoices: fake-money.ts. Public so a test can change a draft (money.touch). */
  readonly money: FakeMoney;
  /** Money at a glance, tax working, spend settings, the CA page, leads, bank imports, site edits, links: fake-extras.ts. */
  private readonly extras: FakeExtrasDesk;
  /**
   * Ink v2 wave 2: posting and the client's answer (fake-posting.ts), practice and the judge (fake-practice.ts), bank
   * statements in the books (fake-bank.ts), and transcripts, the calendar file and platform rules (fake-wiring.ts).
   */
  private readonly posting: FakePostingDesk;
  private readonly practice: FakePracticeDesk;
  private readonly bank: FakeBankDesk;
  private readonly wiring: FakeWiringDesk;
  /**
   * Ink v2 wave 4 (registered empty by package 4-0; each U package fills its own): agent chat and notes
   * (fake-agents.ts), Chats (fake-chief.ts), the network and the pipeline (fake-network.ts), notifications
   * (fake-notify.ts), and the rest (fake-w4.ts).
   */
  private readonly agentsDesk: FakeAgentsDesk;
  private readonly chief: FakeChiefDesk;
  private readonly network: FakeNetworkDesk;
  private readonly notify: FakeNotifyDesk;
  private readonly w4: FakeW4Desk;
  /**
   * Ink v2 wave 5 (registered by package 5-0; each package fills its own file): every playbook's desk
   * (fake-playbooks.ts, one fake-<id>.ts each), and the kit's methods: the chain (fake-kit-chain.ts, 5A1), sales
   * (fake-kit-sales.ts, 5A2), ideas (fake-kit-rules.ts, 5A3), media (fake-kit-media.ts, 5A4), reports
   * (fake-kit-report.ts, 5A5) and the shared connectors (fake-kit-connect.ts, 5A6).
   */
  private readonly w5: readonly { handles(method: string): boolean; request(method: string, p: Record<string, unknown>): unknown }[];

  constructor(options: FakeOptions = {}) {
    // `npm run dev:ui` can show the first run: add ?fresh to the address (and ?no-keys for a computer without
    // protected storage). Tests pass the options instead.
    const fresh = options.fresh ?? devAsks('fresh');
    this.rows = (options.queue ?? QUEUE).map((seed) => ({ ...clone(seed), digest: digestOf(seed) }));
    this.runs = clone(RUNS);
    this.agents = clone(AGENTS);
    this.clients = clone(CLIENTS);
    this.evidence = clone(EVIDENCE);
    this.latencyMs = options.latencyMs ?? 0;
    this.now = options.now ?? (() => new Date().toISOString());
    this.businesses = BUSINESSES.filter((b) => !options.only || options.only.includes(b.id)).map((b): HeldBusiness => ({
      ...clone(b), recovery: 'made',
      ...(options.keyMissing?.includes(b.id) ? { opens: 'key-missing' as const } : {}),
      ...(b.opens === 'needs-passphrase' ? { passphrase: SAMPLE_PASSPHRASE } : {}),
    }));
    for (const b of BUSINESSES) this.ventures.set(b.id, { workingName: b.name, serviceType: b.serviceType, idea: '', countryCode: 'IN', done: 6 });
    this.deviceKeys = options.deviceKeys ?? !devAsks('no-keys');
    this.trial = options.trial ?? (devAsks('trial-ending') ? 'ending' : devAsks('trial') ? 'temporary' : null);
    this.hosted = (options.hosted ?? false) || this.trial !== null;
    this.desk = new FakeBusinessDesk({
      orders:()=>this.work.request('venture.order.list',{}) as OrderLite[],
      current: () => this.current, now: () => this.now(), receiptId: () => `R-0${this.receiptSeq++}`,
      businessName: (id) => this.businesses.find((b) => b.id === id)?.name ?? id,
      rows: () => this.rows, setRows: (rows) => { this.rows = rows; }, digest: digestOf,
      settle: (id) => { this.decided.add(id); }, emit: (event) => this.emit(event),
      business: (id) => this.businesses.find((b) => b.id === id) ?? null, deviceKeys: () => this.deviceKeys && !this.hosted,
      // 4H2: the hosted app lists the command-line presets as unavailable (models/presets.ts availabilityOf).
      hosted: () => this.hosted,
    }, { fresh });
    this.work = new FakeWorkDesk({
      careerSource:id=>{const desk=this.w5?.find((desk):desk is FakePlaybooksDesk=>desk instanceof FakePlaybooksDesk);if(!desk)throw new EngineError('CAREER_APPROVAL_REQUIRED','Create and approve this order exact rendered pack in the career desk.');return desk.careerSource(id);},
      rows:()=>this.rows,setRows:rows=>{this.rows=rows;}, hosted:()=>this.hosted,
      fingerprint: digestOf, recruitDigest: digestOf,
      current: () => this.current, now: () => this.now(), clients: () => this.clients[this.current] ?? [],
      plan: () => this.desk.request('venture.blueprint.get', {}) as BlueprintViewLite | null,
      runs: () => this.runs, agentName: () => this.agents[this.current]?.[0]?.name ?? 'Agent', emit: (event) => this.emit(event),
      // 4J3: the invoices an order's stage steps read (read only when the order list is asked for, after money exists).
      invoices: () => this.money.request('venture.invoice.list', {}) as InvoiceLite[],
      ask: (method, params) => this.answerNow(method, params),
    }, { fresh });
    this.money = new FakeMoney({
      now: () => this.now(), business: () => this.current, clients: () => this.clients[this.current] ?? [],
      orders: () => this.work.request('venture.order.list', {}) as OrderLite[],
      changed: () => this.emit({ type: 'queue.changed', businessId: this.current, at: this.now() }),
      // 4J5: the credit note cards it puts on Today.
      rows: () => this.rows, setRows: (rows: QueueRow[]) => { this.rows = rows; }, digest: digestOf,
      // 4J20: the money views read the owner's rupee rate from the spend settings.
      ask: (method, p) => this.answerNow(method, p),
    });
    this.extras = new FakeExtrasDesk({
      draftText: id=>{const run=(this.work.request('venture.delivery.list',{}) as DeliveryLite[]).find(item=>item.id===id);return run?.editedText??run?.renderedText??null;},
      digest: digestOf,
      current: () => this.current, now: () => this.now(), businessName: (id) => this.businesses.find((b) => b.id === id)?.name ?? id,
      playbook: (id) => this.desk.playbook(id), owed: () => this.money.owed(), hosted: () => this.hosted, emit: (event) => this.emit(event),
    }, { fresh });
    // The wave 2 desks share one host: Today's rows, and other desks' answers for the records they read.
    const waveHost = {
      draftText: (id:string)=>{const run=(this.work.request('venture.delivery.list',{}) as DeliveryLite[]).find(item=>item.id===id);return run?.editedText??run?.renderedText??null;},
      sharedDraftDigest:(id:string)=>this.extras.sharedDraftDigest(this.current,id),
      socialClientAnswer:(id:string)=>this.posting.socialClientAnswer(id),
      scheduledPost: (id:string) => this.posting.scheduledSnapshot(id),
      moveScheduledPost: (id:string,binding:import('../../../../platform/runtime/venture/playbooks/social/scheduled-core').ScheduledPostBinding) => this.posting.moveScheduled(id,binding),
      scheduledSession:()=>this.scheduledSession,
      scheduledBusy:(id:string)=>this.posting.scheduledBusy(id),
      eraseScheduledPost:(id:string)=>this.posting.eraseScheduled(id),
      decideScheduledPost: (id:string,state:'approved'|'rejected'|'applied') => this.posting.decideScheduled(id,state),
      socialChain:(orderId:string)=>this.work.narrationChain.view(orderId)??this.work.articleChain.view(orderId)??this.work.socialChain.view(orderId),
      workReceipt:(id:string)=>this.w5?.find((desk):desk is FakePlaybooksDesk=>desk instanceof FakePlaybooksDesk)?.workReceipt(id),
      supportImported: (mail: import('./fake-w4').SupportImportedMail) => this.w5?.find((desk): desk is FakePlaybooksDesk => desk instanceof FakePlaybooksDesk)?.importSupportMail(mail),
      supportThread: (id: string) => this.w5?.find((desk): desk is FakeKitConnectDesk => desk instanceof FakeKitConnectDesk)?.supportThread(id) ?? null,
      uploadFingerprint: (id: string) => this.work.uploadFingerprint(this.current, id),
      siteCaptureClient:(name:string,email:string)=>{let client=(this.clients[this.current]??[]).find(c=>c.email?.toLowerCase()===email);if(!client){client={id:`c-site-${this.clientSeq++}`,at:this.now(),name,email,countryCode:null,taxId:null,stateCode:null,note:null};this.clients[this.current]=[client,...(this.clients[this.current]??[])];}this.network.captureSiteClient({id:client.id,name:client.name,email});return client;},
      keepTranslationFile:(orderId:string,file:{id:string;name:string;contentBase64:string;digest:string})=>this.work.keepTranslationFile(this.current,orderId,file),
      keepNarrationFetched:(orderId:string,file:{id:string;name:string;contentBase64:string;digest:string},source:{fileId:string;url:string;finalUrl:string;digest:string})=>this.work.keepNarrationFetched(this.current,orderId,file,source),
      narrationPrice: (orderId:string) => this.work.narrationPrice(this.current,orderId),
      keepSellerAsset: (asset:Omit<import('./types').AssetView,'stale'|'blocked'|'sourceLine'|'costLine'>) => this.w5?.find((desk): desk is FakeKitMediaDesk => desk instanceof FakeKitMediaDesk)?.recordSellerAsset(asset),
      eraseSellerAssets: (ids:readonly string[]) => this.w5?.find((desk): desk is FakeKitMediaDesk => desk instanceof FakeKitMediaDesk)?.eraseSellerAssets(ids),
      eraseSellerFiles: (ids:readonly string[]) => this.work.eraseSellerFiles(this.current,ids),
      recruitingReports:(orderId:string)=>this.w5?.find((desk):desk is FakeKitReportDesk=>desk instanceof FakeKitReportDesk)?.recruitingReports(this.current,orderId)??{reports:[],shares:[]},
      recruitingMail:(threadIds:readonly string[])=>this.w5?.find((desk):desk is FakeKitConnectDesk=>desk instanceof FakeKitConnectDesk)?.recruitingMail(threadIds)??[],
      eraseRecruitingMail:(threadIds:readonly string[])=>this.w5?.find((desk):desk is FakeKitConnectDesk=>desk instanceof FakeKitConnectDesk)?.eraseRecruitingMail(threadIds),
      recruitingBlocked:(email:string|null,personId:string|null)=>this.extras.isBlocked(this.current,email)||this.network.recruitingBlocked(email,personId),
      eraseYoutubeIdeaSources:(sources:readonly string[])=>this.kitRules()?.eraseSources(this.current,sources),
      eraseCareerCopies:(orderIds:readonly string[])=>{this.work.eraseCareerOrders(this.current,orderIds);const ids=this.work.eraseRecruitingCopies(this.current,orderIds,'Client data deleted.');this.extras.eraseRecruitingCopies(this.current,ids);this.w5?.find((desk):desk is FakeKitReportDesk=>desk instanceof FakeKitReportDesk)?.eraseRecruitingCopies(this.current,ids);this.posting.eraseRunCopies(ids);},
      influencerOutreach:(input:Parameters<FakeExtrasDesk['influencerOutreach']>[1])=>{if(this.network.recruitingBlocked(input.email,null))throw new EngineError('LEADS_BLOCKED','This creator asked not to be contacted.');return this.extras.influencerOutreach(this.current,input);},
      eraseInfluencerCopies:(orderIds:readonly string[])=>{const files=orderIds.flatMap(id=>this.work.orderFiles(this.current,id).map(f=>f.id));this.work.eraseSellerFiles(this.current,files);this.work.eraseInfluencerOrders(this.current,orderIds);const ids=this.work.eraseRecruitingCopies(this.current,orderIds,'Campaign evidence was deleted. Start with new approved sources.');this.extras.eraseRecruitingCopies(this.current,ids);this.w5?.find((desk):desk is FakeKitReportDesk=>desk instanceof FakeKitReportDesk)?.eraseRecruitingCopies(this.current,ids);this.posting.eraseRunCopies(ids);},
      eraseInfluencerLeads:(ids:readonly string[])=>this.extras.eraseInfluencerLeads(this.current,ids),
      eraseTranslationCopies:(orderIds:readonly string[])=>{this.work.eraseInfluencerOrders(this.current,orderIds);const ids=this.work.eraseRecruitingCopies(this.current,orderIds,'Translation source was deleted. Start with new approved sources.');this.extras.eraseRecruitingCopies(this.current,ids);this.w5?.find((desk):desk is FakeKitReportDesk=>desk instanceof FakeKitReportDesk)?.eraseRecruitingCopies(this.current,ids);this.posting.eraseRunCopies(ids);},
      eraseRecruitingCopies:(orderIds:readonly string[])=>{const ids=this.work.eraseRecruitingCopies(this.current,orderIds);this.extras.eraseRecruitingCopies(this.current,ids);this.w5?.find((desk):desk is FakeKitReportDesk=>desk instanceof FakeKitReportDesk)?.eraseRecruitingCopies(this.current,ids);},
      eraseTenderIntake:(orderIds:readonly string[])=>this.work.eraseTenderIntake(this.current,orderIds),
      orderFiles: (orderId: string) => this.work.orderFiles(this.current, orderId),
      current: () => this.current, now: () => this.now(), emit: (event: VentureRunEvent) => this.emit(event), hosted: () => this.hosted,
      rows: () => this.rows, setRows: (rows: QueueRow[]) => { this.rows = rows; }, digest: digestOf,
      ask: (method: string, p: Record<string, unknown>) => this.answerNow(method, p),
      // 4J6: the businesses on this computer, as workspace.list lists them (fake-across.ts).
      businesses: () => this.businesses.map((b) => ({ id: b.id, name: b.name, opens: b.opens })),
      // 4F3: the runs, which Stop, Resume and the round gate change (fake-run-controls.ts).
      runs: () => this.runs,
      // 4J21: a temporary business refuses links (TRIAL_LIMIT), as the hosted app does.
      trial: () => this.trial !== null,
      reviseDelivery: (runId: string, revise: (run: DeliveryLite) => DeliveryLite) => this.work.reviseRun(this.current, runId, revise),
      keepMadeTranscript: (p: Record<string, unknown>) => this.work.keepMade(this.current, p),
      // 4J2: Make a copy keeps the owner's new draft with the others (fake-4j2.ts).
      keepDelivery: (run: DeliveryLite) => this.work.keepRun(this.current, run),
      // 4J22a: the chain counts the journal's entries, and verify reads a stored receipt (fake-4j22a.ts).
      journal: () => this.journal, receipt: (id: string) => this.findReceipt(id),
    };
    // Ink v2 wave 5: made first, so a desk below that asks another desk during its own setup finds them.
    this.w5 = [
      new FakePlaybooksDesk(waveHost), new FakeKitChainDesk(waveHost, { fresh }), new FakeKitSalesDesk(waveHost, { fresh }),
      new FakeKitRulesDesk(waveHost, { fresh }), new FakeKitMediaDesk(waveHost, { fresh }), new FakeKitReportDesk(waveHost, { fresh }),
      new FakeKitConnectDesk(waveHost, { fresh }),
    ];
    this.posting = new FakePostingDesk(waveHost, { fresh });
    this.practice = new FakePracticeDesk(waveHost, { fresh });
    this.bank = new FakeBankDesk(waveHost, { fresh });
    this.wiring = new FakeWiringDesk(waveHost, { fresh });
    // 4B3: a request on the floor in an agent's chat is a proposal the Chats desk raises to Today.
    this.agentsDesk = new FakeAgentsDesk(waveHost, { fresh, floor: (input) => this.chief.draftFromAgent(input) });
    // 4C2: the Chats desk reads the one chat consent the agents' desk keeps (it needs no agent).
    this.chief = new FakeChiefDesk(waveHost, { fresh, consent: () => this.agentsDesk.chatConsent() });
    this.network = new FakeNetworkDesk(waveHost, { fresh, meetings: this.chief, ...(options.pipelineDue === undefined ? {} : { due: options.pipelineDue }) });
    this.notify = new FakeNotifyDesk(waveHost, { fresh });
    // 4J22b: an idea's Start drafts through the Chats desk; an imported agent file and a persona version speak in the agent's chat.
    this.w4 = new FakeW4Desk(waveHost, {
      fresh,
      extras: {
        draftIdea: (input) => this.chief.draftFromIdea(input), draftImport: (input) => this.agentsDesk.draftImport(input), say: (agent, text) => this.agentsDesk.say(agent, text),
        waitingMail: () => this.network.waitingMail(),
        // 5A3: venture.ideas.list adds the idea pipeline the kit rules desk keeps.
        pipelineIdeas: () => this.kitRules()?.pipeline() ?? [],
      },
    });
    if (fresh) {
      this.rows = []; this.runs = []; this.agents = {}; this.clients = {}; this.evidence = [];
      this.businesses = []; this.ventures.clear(); this.open = false; this.current = '';
    } else if (options.closed ?? devAsks('closed')) {
      this.open = false; this.current = '';
    }
  }

  subscribe(listener: (event: VentureRunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(event: VentureRunEvent): void {
    this.seq += 1;
    for (const listener of [...this.listeners]) listener(event);
  }

  /** Test and demo helper: the row changes after the owner opened it, so its digest changes too. */
  touch(id: string): QueueRow {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new EngineError('NOT_FOUND', 'No such row.');
    const { digest: _old, ...rest } = row;
    const seed = { ...rest, line: `${rest.line ?? ''} Updated after the client replied.`.trim(), change: rest.change ? { ...rest.change, after: `${rest.change.after} (revised)` } : undefined };
    if (!seed.change) delete seed.change;
    const next = { ...seed, digest: digestOf(seed) } as QueueRow;
    this.rows = this.rows.map((r) => (r.id === id ? next : r));
    this.emit({ type: 'queue.changed', businessId: row.businessId, at: this.now() });
    return clone(next);
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    const p = (params ?? {}) as Record<string, unknown>;
    if (!this.open && !BEFORE_VAULT.has(method) && !method.startsWith('venture.ai.') && !method.startsWith('venture.compose.')) throw new EngineError('VAULT_LOCKED', 'Open your workspace first.');
    this.guardInternalShare(method, p);
    const started = this.onboarding(method, p);
    if (started !== NOT_ONBOARDING) return started;
    // Invoices and payments answer from one desk.
    if (FakeMoney.answers(method)) return this.money.request(method, p);
    switch (method) {
      case 'venture.queue.list': return this.queueList(p.scope === 'current' ? 'current' : 'all');
      case 'venture.queue.decide': return this.decide(p as ParamsOf<'venture.queue.decide'>);
      case 'venture.queue.view': {
        // 5A2: a sales proposal's row reads its five sections from the kit sales desk (fake-kit-sales.ts).
        const view = QUEUE_VIEWS.find((v) => v.kind === p.kind && v.id === p.id) ?? this.kitSales()?.view(p.kind, p.id) ?? this.posting.queueView(p.kind,p.id) ?? this.work.careerDelivery.queueView(p.kind,p.id) ?? this.work.narrationChain.queueView(p.kind,p.id) ?? this.work.youtubeServices.queueView(p.kind,p.id) ?? this.work.articleChain.queueView(p.kind,p.id) ?? this.work.socialChain.queueView(p.kind,p.id);
        if (!view) throw new EngineError('VIEW_NOT_FOUND', 'This is not on this computer any more.');
        // 4J2: as on the engine, the rows that open this were read in their present versions (fake-4j2.ts), only when
        // the owner opened it (4J19: opened: true; a card drawing its preview leaves no mark).
        if (p.opened !== undefined && p.opened !== true) throw new EngineError('INVALID_VENTURE_REQUEST', 'opened is true when the owner opened it, or left out.');
        if (p.opened === true) this.w4.markViewed({ id: p.id, kind: p.kind });
        return clone(view);
      }
      case 'venture.runs.list': {
        const state = p.state ?? 'all';
        const runs = this.runs.filter((r) => state === 'all' || (state === 'active' ? r.state === 'active' || r.state === 'waiting' : r.state === 'done' || r.state === 'failed'));
        // 4F3: the scope, notes, gate and calls in flight are the run sheet's (venture.runs.get), as on the engine.
        return { runs: runs.map(({ steps: _s, question: _q, error: _e, scope: _c, steer: _n, gate: _g, live: _l, ...summary }) => clone(summary)) };
      }
      case 'venture.runs.get': {
        const run = this.runs.find((r) => r.runId === p.runId);
        if (!run) throw new EngineError('RUN_NOT_FOUND', 'This run is not on this computer.');
        // 4F3: the scope's cap in rupees at the owner's rate, read when asked, as the engine's views/runs.ts does.
        return clone(this.w4.runView(run));
      }
      case 'venture.team.list': return this.w4.teamList(clone(this.agents[this.current] ?? []), this.runs);
      case 'venture.team.gate': return this.gate(p as ParamsOf<'venture.team.gate'>);
      case 'venture.team.posture': return this.posture(p as ParamsOf<'venture.team.posture'>);
      case 'venture.spend.list': return { rows: this.spendRows(), ...this.spendTotal() };
      // 4J22a: a break the owner accepted in the record shows as an entry first, as the engine's journal list has it.
      case 'venture.journal.list': return { entries: clone([...this.w4.quality.breakEntries(), ...this.journal]).slice(0, typeof p.limit === 'number' ? p.limit : undefined) };
      case 'venture.journal.resolve': return this.resolveJournal(p as ParamsOf<'venture.journal.resolve'>);
      case 'venture.evidence.list': return { items: clone(this.evidence).filter((e) => typeof p.subject !== 'string' || e.subject === p.subject) };
      case 'venture.evidence.apply': return this.applyEvidence(String(p.id ?? ''));
      case 'venture.evidence.dismiss': return this.dismissEvidence(String(p.id ?? ''));
      case 'venture.client.list': return clone(this.clients[this.current] ?? []);
      case 'venture.client.add': return this.addClient(p);
      case 'venture.events': return { events: [], lastSeq: this.seq, firstSeq: 0, frames: [] };
      case 'venture.get': return this.ventureView();
      case 'venture.playbooks.list': {
        // 4J8: the ways to earn; the open business is "You run this" on its own way.
        const venture = this.open ? this.ventures.get(this.current) : undefined;
        return fakeWays(p, venture ? { businessId: this.current, name: venture.workingName, playbook: this.desk.playbook(this.current)?.id ?? null } : null);
      }
      case 'venture.receipt.get': {
        const receipt = this.findReceipt(String(p.id));
        if (!receipt) throw new EngineError('RECEIPT_NOT_FOUND', 'This receipt is not on this computer.');
        // 4J10 (via 4J22a): a stored receipt comes with the business's signature on it, as the engine's getReceipt sends it.
        const signature = this.w4.quality.signature(receipt);
        return clone(signature ? { ...receipt, signature } : receipt);
      }
      case 'venture.books.summary': return this.money.books(clone(BOOKS[this.current] ?? BOOKS.lumen!), p.period);
      case 'venture.connectors.list': return withTruth(this.posting.connectorCards(withSellerCards(clone(CONNECTORS))), this.hosted);
      case 'workspace.list': return {
        complete: true,
        businesses: this.businesses.map((b) => ({ folder: b.id, name: b.name, demo: true, unlock: b.opens === 'needs-passphrase' ? 'passphrase' : 'this-computer', opens: b.opens, recovery: b.recovery, openedAt: b.id === this.current ? this.now() : null, listedFrom: 'card' })),
      };
      case 'workspace.open': {
        // On this computer a business opens by its folder; the hosted server opens one by its id on the account.
        const business = this.businesses.find((b) => b.id === (this.hosted ? p.businessId : p.folder));
        if (!business) throw new EngineError('WORKSPACE_NOT_FOUND', 'No business in that folder.');
        const typed = typeof p.passphrase === 'string';
        if (business.opens === 'needs-passphrase' && !typed) throw new EngineError('PASSPHRASE_REQUIRED', CUSTODY_ERROR_WORDS.PASSPHRASE_REQUIRED);
        // A typed passphrase opens only a business locked with that passphrase, as Vault.open checks it.
        if (typed && (business.opens !== 'needs-passphrase' || (business.passphrase !== undefined && p.passphrase !== business.passphrase))) throw new EngineError('UNLOCK_FAILED', UNLOCK_FAILED);
        if (business.opens === 'key-missing') throw new EngineError('DEVICE_KEY_FAILED', CUSTODY_ERROR_WORDS.DEVICE_KEY_FAILED);
        this.endPlaybookSession(); this.scheduledSession++; this.current = business.id;
        this.open = true;
        this.closedByOwner = false;
        this.emit({ type: 'queue.changed', businessId: business.id, at: this.now() });
        return { workspace: { id: business.id, name: business.name } };
      }
      default:
        if (this.desk.handles(method)) return this.desk.request(method, p);
        if (this.work.handles(method)) return this.work.request(method, p);
        if(method==='venture.share.list')return this.shareView(p);
        if(method==='venture.share.revoke'&&typeof p.id==='string'){const extra=this.w5?.find((desk):desk is FakePlaybooksDesk=>desk instanceof FakePlaybooksDesk)?.revokeShare(p.id);if(extra)return extra;}
        if (this.extras.handles(method)) return this.extras.request(method, p);
        if (this.posting.handles(method)) return this.posting.request(method, p);
        if (this.practice.handles(method)) return this.practice.request(method, p);
        if (this.bank.handles(method)) return this.bank.request(method, p);
        if (this.wiring.handles(method)) return this.wiring.request(method, p);
        if (this.network.handles(method)) return this.networkAnswer(method, p);
        for (const desk of [this.agentsDesk, this.chief, this.network, this.notify, this.w4, ...(this.w5 ?? [])]) if (desk.handles(method)) return desk.request(method, p);
        throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /** Another desk's answer at once, with no latency: what the wave 2 desks read (orders, runs, files, invoices). */
  /** A stored receipt by id, from whichever desk made it (venture.receipt.get, and 4J22a's verify). */
  private findReceipt(id: string): ReceiptLite | undefined {
    return this.w5?.find((desk):desk is FakePlaybooksDesk=>desk instanceof FakePlaybooksDesk)?.receipt(id) ?? RECEIPTS.find((r) => r.id === id) ?? this.desk.receipt(id) ?? this.money.receipt(id) ?? this.w4.receipt(id) ?? this.network.receipt(id)
      ?? this.kitSales()?.receipt(id); // 5A2: a GO card's maximum loss
  }

  /**
   * The sample month's spend total as money/spend.ts listSpend sends it: the sample spend (USD 0.7198, the total Team
   * and Money send) with its words, in rupees too at the owner's rate when one is set, and 4Z3: as the owner's currency
   * leads it.
   */
  /**
   * The sample's calls as money/spend.ts spendRow sends them: each figure in rupees too at the owner's rate when one is
   * set, and 4Z3: each as the owner's currency leads it.
   */
  private spendRows() {
    const { rate, choice } = spendSettings(() => this.answerNow('venture.spend.policy.get', {}));
    return clone(SPEND).map((row) => {
      const micros = SPEND_MICROS[row.id];
      if (!micros) return row;
      const settled = micros.settled;
      return {
        ...row,
        ...(rate ? { reservedRupees: rupeesAt(micros.reserved, rate), ...(settled !== undefined ? { settledRupees: rupeesAt(settled, rate) } : {}) } : {}),
        reservedLead: spendLead(micros.reserved, rate?.perUsd ?? null, rupeesLead(choice)),
        ...(settled !== undefined ? { settledLead: spendLead(settled, rate?.perUsd ?? null, rupeesLead(choice)) } : {}),
      };
    });
  }

  private spendTotal() {
    const { rate, choice } = spendSettings(() => this.answerNow('venture.spend.policy.get', {}));
    const words = ' this month (includes estimates)';
    return {
      total: `USD 0.7198${words}`, ...(rate ? { totalRupees: rupeesAt(719_800, rate) } : {}),
      totalLead: spendLead(719_800, rate?.perUsd ?? null, rupeesLead(choice), words),
    };
  }

  private guardInternalShare(method: string, p: Record<string, unknown>): void {
    if (method === 'venture.share.create') {
      const orders = this.work.request('venture.order.list', {}) as OrderLite[];
      const run = (this.work.request('venture.delivery.list', {}) as DeliveryLite[]).find(item => item.id === p.deliveryId);
      if (orders.some(order => order.internal && (order.id === p.orderId || order.id === run?.orderId)) || (this.clients[this.current] ?? []).some(client => client.self && client.id === p.clientId)) throw new EngineError('INTERNAL_ORDER', 'Your own shop work has no client share link.');
    }
  }


  private ventureView() {
        const venture = this.ventures.get(this.current);
        const playbook = this.desk.playbook(this.current);
        // 4J8: the checklist item by item, with names and links, as the engine's venture.get carries it.
        // 4J20: the business's country (its code and currency), as the engine's venture record carries it.
        return venture ? { venture: { id: `venture_${this.current}`, workingName: venture.workingName, serviceType: venture.serviceType, launchStage:'rehearsal' as const, country: venture.countryCode ? { code: venture.countryCode, currency: COUNTRIES.find(country=>country.code===venture.countryCode)?.currency??'INR' } : null }, done: venture.done, total: 12, checklist: fakeChecklist(venture.done), ...(playbook ? { playbook } : {}), ...this.w4.pausedField() } : null;
        }

  private shareView(p:Record<string,unknown>){const method='venture.share.list';const base=this.extras.request(method,p) as {links:import('./types').ShareLink[];shares:import('./types').ShareLink[]};const extra=this.w5?.find((desk):desk is FakePlaybooksDesk=>desk instanceof FakePlaybooksDesk)?.sharedLinks(typeof p.deliveryId==='string'?p.deliveryId:undefined)??[];const openPosts=typeof p.deliveryId==='string'?this.posting.openPosts(p.deliveryId):[];const answer=typeof p.deliveryId==='string'?this.posting.socialClientAnswer(p.deliveryId)?.answer:null;return {...base,links:[...base.links,...extra],shares:[...base.shares,...extra],...(openPosts.length?{posts:openPosts,clientApproval:true,answer:answer??null}: {})};}
  private answerNow(method: string, p: Record<string, unknown>): unknown {
    if (method === 'venture.get') return this.ventureView();
    this.guardInternalShare(method,p);
    if (FakeMoney.answers(method)) return this.money.request(method, p);
    if(method==='venture.share.list')return this.shareView(p);
    if (method === 'venture.connectors.list') return withTruth(this.posting.connectorCards(withSellerCards(clone(CONNECTORS))), this.hosted);
    // 4B3: agent chat reads the team (whose steps an agent owns) and the clients (whom a note is about).
    if (method === 'venture.team.list') return this.w4.teamList(clone(this.agents[this.current] ?? []), this.runs);
    if (method === 'venture.client.list') return clone(this.clients[this.current] ?? []);
    // 4E4: a pipeline card moved to Won makes its client, as the engine's move does through addClient.
    if (method === 'venture.client.add') return this.addClient(p);
    // 4J2: a set approval decides each item as Today does (fake-4j2.ts).
    if (method === 'venture.queue.decide') return this.decide(p as ParamsOf<'venture.queue.decide'>);
    if (this.network.handles(method)) return this.networkAnswer(method, p);
    for (const desk of [this.desk, this.work, this.extras, this.posting, this.practice, this.bank, this.wiring, this.agentsDesk, this.chief, this.network, this.notify, this.w4, ...(this.w5 ?? [])]) {
      if (desk.handles(method)) return desk.request(method, p);
    }
    throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
  }

  /** 5A2: drafts follow the engine's Forget and import Undo, only after the network change succeeds. */
  private networkAnswer(method: string, p: Record<string, unknown>): unknown {
    if (method !== 'venture.network.forget' && method !== 'venture.network.importUndo') return this.network.request(method, p);
    const before = this.network.privacyFacts();
    const answer = this.network.request(method, p);
    const kept = new Set(this.network.privacyFacts().map(person => person.id));
    const gone = before.filter(person => !kept.has(person.id));
    if (gone.length) {
      this.posting.forgetPeople(gone);
      this.work.socialChain.forgetPeople(gone, method === 'venture.network.forget');
      this.kitSales()?.forgetPeople(gone, method === 'venture.network.forget');
      for (const desk of this.w5 ?? []) if (desk instanceof FakePlaybooksDesk || desk instanceof FakeKitConnectDesk) desk.forgetPeople(gone, method === 'venture.network.forget');
    }
    if (method === 'venture.network.forget') this.emit({ type: 'privacy.forgotten', businessId: this.current, at: this.now() });
    return answer;
  }
  /** 5A2: the desk that keeps sales proposals and GO cards. */
  private kitSales(): FakeKitSalesDesk | undefined {
    return this.w5?.find((desk): desk is FakeKitSalesDesk => desk instanceof FakeKitSalesDesk);
  }

  /** 5A3: the desk that keeps the idea pipeline. */
  private kitRules(): FakeKitRulesDesk | undefined {
    return this.w5?.find((desk): desk is FakeKitRulesDesk => desk instanceof FakeKitRulesDesk);
  }

  private async queueList(scope: 'current' | 'all') {
    this.network.syncRows(); // 4E4: follow-ups come due as the clock moves; replies and calls wait as the engine lists them
    this.chief.syncRows(); // 4C2: a proposal's card is made again from what it acts on now (only Dismiss once its gate fails)
    if (this.open && this.current) this.kitRules()?.syncRows(); // 5A3: a published idea's grade row comes due as the clock moves
    this.rows = this.rows.filter(row => !row.id.startsWith('social-revision:')&&!row.id.startsWith('tender-gap:'));
    for (const business of this.businesses) {
      if (business.opens !== 'with-this-computer' && !(this.open && business.id === this.current)) continue;
      const plan = this.desk.blueprintFor(business.id);
      this.rows.push(...fakeSocialRevisionDueRows({countryCode:this.ventures.get(business.id)?.countryCode??'IN',businessId: business.id, businessName: business.name, now: this.now(), orders: this.work.ordersFor(business.id), offers: plan?.blueprint.offers ?? [], digest: digestOf}));
      for(const desk of this.w5??[])if(desk instanceof FakePlaybooksDesk)for(const notice of await desk.tenderNotices({businessId:business.id,orders:this.work.ordersFor(business.id),files:orderId=>this.work.orderFiles(business.id,orderId)})){
        const row={id:notice.subject+':'+notice.version,businessId:business.id,businessName:business.name,kind:'notice' as const,createdAt:notice.createdAt,title:notice.title,line:notice.line,actions:[{id:'open' as const,label:'Open tender desk',primary:true},{id:'later' as const,label:'Later',primary:false}],notice:{probe:'drafts' as const,severity:'medium' as const,link:notice.link}};
        this.rows.push({...row,digest:digestOf(row)});
      }
    }
    // A vault may be locked while its source files are read asynchronously.
    this.rows=this.rows.filter(row=>!row.id.startsWith('tender-gap:')||this.businesses.some(b=>b.id===row.businessId&&(b.opens==='with-this-computer'||this.open&&b.id===this.current)));
    const rows =this.rows.filter((r) => !this.decided.has(r.id) && (scope === 'all' || r.businessId === this.current)).sort(queueOrder);
    const businesses = new Set(rows.map((r) => r.businessId)).size;
    const count = String(rows.length);
    const summary = rows.length === 0 ? 'Nothing needs you.' : `${count} ${rows.length === 1 ? 'needs' : 'need'} you, across ${businesses} ${businesses === 1 ? 'business' : 'businesses'}`;
    return { rows: clone(rows), summary, needsYou: rows.length, businesses };
  }

  private decide(p: ParamsOf<'venture.queue.decide'>): QueueDecision|Promise<QueueDecision> {
    const row = this.rows.find((r) => r.id === p.id);
    if (!row) return { outcome: 'refused', line: 'This is no longer here.', reason: 'RESOLVED_ELSEWHERE' };
    if (this.decided.has(row.id)) return { outcome: 'refused', line: 'You decided this already.', reason: 'ALREADY_DECIDED' };
    if (p.digest !== row.digest) return { outcome: 'stale', line: 'This click did not run anything. Here is the new version.', latest: clone(row) };
    const action = row.actions.find((a) => a.id === p.action);
    if (!action) return { outcome: 'refused', line: 'That is not a choice for this row.', reason: 'INVALID_ACTION' };
    if (action.requiresView && p.viewed !== true) return { outcome: 'refused', line: 'Open it and read it first.', reason: 'VIEW_FIRST' };
    if (row.kind === 'locked') return { outcome: 'refused', line: 'This business opens with its passphrase.', reason: 'PASSPHRASE_REQUIRED' };
    if (action.id === 'answer' && !(p.answer ?? '').trim()) return { outcome: 'refused', line: 'Write an answer first.', reason: 'ANSWER_REQUIRED' };
    // 4E4: a next step from meeting notes with no day takes the day as Approve's answer (chief/proposals.ts).
    if (row.needs?.answer === 'day' && action.id === 'approve' && !/^\d{4}-\d{2}-\d{2}$/.test(p.answer?.trim() ?? '')) return { outcome: 'refused', line: 'Pick the day for this step first.', reason: 'INVALID_VENTURE_REQUEST' };
    if (row.id.startsWith('social-revision:') && action.id === 'open') return {outcome: 'refused', reason: 'NOT_A_DECISION', line: 'Open Work to review the social revisions.'};
    if (row.id.startsWith('tender-gap:') && action.id === 'open') return {outcome: 'refused', reason: 'NOT_A_DECISION', line: 'Open Work to review the tender sources.'};
    if(row.id.startsWith('narration-stage:')&&action.id==='approve')return this.work.narrationChain.decide(row,action.id).then(line=>{this.decided.add(row.id);return {outcome:'done' as const,line:line??'Done'};});
    const openPost=this.posting.decideOpen(row.id,action.id);if(openPost){if(openPost.outcome==='done')this.decided.add(row.id);return openPost;}
    const social=this.work.careerDelivery.decide(row,action.id)??this.work.youtubeServices.decide(row,action.id)??this.work.articleChain.decide(row,action.id)??this.work.socialChain.decide(row,action.id);
    if(social){this.decided.add(row.id);this.emit({type:'queue.changed',businessId:row.businessId,at:this.now()});return {outcome:'done',line:social};}
    this.decided.add(row.id);
    // 4J5: Issue or Cancel on a credit note's card does what the engine does, and says it in the engine's words.
    const credited = row.id.startsWith('credit:') ? this.money.decideCredit(row.id, action.id) : null;
    if (credited) {
      this.emit({ type: 'queue.changed', businessId: row.businessId, at: this.now() });
      return { outcome: 'done', line: credited };
    }
    // 4C2: Approve or Not now on a proposal's card from Chats (fake-chief.ts), in the engine's words.
    const proposed = this.chief.decide(row, action.id);
    if (proposed) {
      this.emit({ type: 'queue.changed', businessId: row.businessId, at: this.now() });
      return { outcome: 'done', line: proposed };
    }
    // 4F3: Resume, Run again and the round gate's Continue and Stop on a run-control row, in the engine's words.
    const controlled = this.w4.decideRunControl(row, action.id, p.answer);
    if (controlled) {
      this.emit({ type: 'queue.changed', businessId: row.businessId, at: this.now() });
      return { outcome: 'done', line: controlled };
    }
    // 4E4: I sent it on a follow-up, a reply's answer, or No notes after a call, in the engine's words.
    const networked = this.network.decide(row, action.id);
    if (networked) {
      this.emit({ type: 'queue.changed', businessId: row.businessId, at: this.now() });
      return { outcome: 'done', line: networked };
    }
    // 5A2: Approve on a sales proposal's row (fake-kit-sales.ts), in the engine's words.
    const sold = this.kitSales()?.decide(row, action.id);
    if (sold) {
      this.emit({ type: 'queue.changed', businessId: row.businessId, at: this.now() });
      return { outcome: 'done', line: sold };
    }
    if (action.id === 'approve' && row.viewRef?.kind === 'plan') this.desk.accept(row.businessId, row.viewRef.id);
    const receiptId = RECEIPTED.has(row.kind) && (action.id === 'approve' || action.id === 'issue') ? `R-0${this.receiptSeq++}` : undefined;
    if (action.id === 'run-again' && row.viewRef?.kind === 'run') this.restart(row.viewRef.id);
    if (action.id === 'send-to-ca' && row.viewRef?.kind === 'file') this.extras.sentToCa(row.viewRef.id);
    this.emit({ type: 'queue.changed', businessId: row.businessId, at: this.now() });
    const said = DONE_LINES[action.id] ?? 'Done';
    return receiptId ? { outcome: 'done', line: `${said} · ${receiptId}`, receiptId } : { outcome: 'done', line: said };
  }

  private restart(runId: string) {
    const run = this.runs.find((r) => r.runId === runId);
    if (!run) return;
    run.state = 'active';
    delete run.error;
    run.steps = run.steps.map((s) => (s.state === 'failed' ? { id: s.id, purpose: s.purpose, state: 'current', elapsed: 'now' } : s));
    this.emit({ type: 'run.started', businessId: run.businessId, runId, at: this.now() });
  }

  private gate(p: ParamsOf<'venture.team.gate'>) {
    const agent = (this.agents[this.current] ?? []).find((a) => a.id === p.agentId);
    if (!agent) throw new EngineError('AGENT_NOT_FOUND', 'No such agent in this business.');
    const step = agent.steps.find((s) => s.id === p.stepId);
    if (!step) throw new EngineError('STEP_NOT_FOUND', 'No such step for this agent.');
    if (step.floor && p.gate === 'auto') throw new EngineError('GATE_FLOOR', 'This step always asks you.');
    step.gate = p.gate;
    return { agent: clone(agent) };
  }

  /**
   * venture.team.posture with the engine's ladder: rehearsal, shadow, approve each, auto with spot checks. The top step
   * is built but locked (4J15): it is refused AUTO_LOCKED whatever the readiness says, as the engine refuses it.
   */
  private posture(p: ParamsOf<'venture.team.posture'>) {
    const agent = (this.agents[this.current] ?? []).find((a) => a.id === p.agentId);
    if (!agent) throw new EngineError('AGENT_NOT_FOUND', 'That agent was not found.');
    const ladder: readonly Posture[] = ['rehearsal', 'shadow', 'approve-each', 'auto-spot-check'];
    if (!ladder.includes(p.posture)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose rehearsal, shadow, approve each or auto with spot checks.');
    if (p.posture === 'auto-spot-check') throw new EngineError('AUTO_LOCKED', AUTO_LOCKED_WORDS);
    agent.posture = p.posture;
    this.emit({ type: 'queue.changed', businessId: this.current, at: this.now() });
    return { agent: clone(agent) };
  }

  /** venture.client.add with the engine's checks; each field the owner typed becomes verified, applied evidence. */
  private addClient(p: Record<string, unknown>): ClientLite {
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    const name = text(p.name);
    if (!name || name.length < 2 || name.length > 120 || /[\n\r\t]/.test(name)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Client name must be between 2 and 120 characters.');
    const email = text(p.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Use an email address like name@example.com.');
    const taxId = text(p.taxId)?.toUpperCase().replace(/\s+/g, '') ?? null;
    if (taxId && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(taxId)) throw new EngineError('INVALID_TAX_ID', "Check the client's GSTIN.");
    const note = text(p.note);
    if (note && note.length > 500) throw new EngineError('INVALID_VENTURE_REQUEST', 'Note must be between 1 and 500 characters.');
    const client: ClientLite = {
      id: `c-new-${this.clientSeq++}`, at: this.now(), name, email, countryCode: text(p.countryCode), taxId,
      stateCode: taxId ? taxId.slice(0, 2) : text(p.stateCode), note,
    };
    this.clients[this.current] = [client, ...(this.clients[this.current] ?? [])];
    const fields = { name: client.name, email: client.email, countryCode: client.countryCode, taxId: client.taxId, stateCode: client.stateCode, note: client.note };
    for (const [field, value] of Object.entries(fields)) {
      if (value === null) continue;
      this.evidence.unshift({ id: `ev-${client.id}-${field}`, subject: `client:${client.id}`, field, value, type: 'owner-entered', strength: 'verified', claim: 'observed', source: 'You entered this.', applied: true });
    }
    return clone(client);
  }

  /**
   * venture.evidence.apply with the engine's rules: a needs-your-data item has no value to apply, and weaker
   * evidence never replaces a verified stored value (EVIDENCE_WEAK). Applying settles the field's other items and
   * writes name, email and note through to the client.
   */
  private applyEvidence(id: string) {
    const item = this.evidence.find((e) => e.id === id);
    if (!item) throw new EngineError('EVIDENCE_NOT_FOUND', 'This evidence is not in this business.');
    if (item.applied) return { item: clone(item) };
    if (item.claim === 'needs-your-data') throw new EngineError('INVALID_VENTURE_REQUEST', "There's no value to apply: this asks for your data.");
    const peers = this.evidence.filter((e) => e.subject === item.subject && e.field === item.field);
    const stored = peers.find((e) => e.applied);
    if (stored && stored.strength === 'verified' && item.strength !== 'verified') throw new EngineError('EVIDENCE_WEAK', "A checked value is stored for this. Weaker evidence can't replace it.");
    for (const peer of peers) peer.applied = peer.id === item.id;
    if (item.subject.startsWith('client:') && (item.field === 'name' || item.field === 'email' || item.field === 'note')) {
      const clientId = item.subject.slice('client:'.length);
      for (const list of Object.values(this.clients)) {
        const client = list.find((c) => c.id === clientId);
        if (client) client[item.field] = item.value;
      }
    }
    return { item: clone(item) };
  }
  /** venture.journal.resolve: the owner says what they found on an unknown outcome. Nothing is sent again. */
  private resolveJournal(p: ParamsOf<'venture.journal.resolve'>) {
    const entry = this.journal.find((e) => e.id === p.entryId);
    if (!entry) throw new EngineError('JOURNAL_NOT_FOUND', 'This action is not in the journal.');
    if (p.outcome !== 'sent' && p.outcome !== 'not-sent') throw new EngineError('INVALID_VENTURE_REQUEST', 'Say whether it went out: sent or not-sent.');
    if (entry.state !== 'outcome_unknown') throw new EngineError('JOURNAL_NOT_UNKNOWN', 'Only an action whose outcome is unknown can be settled. This one already has an outcome.');
    const sent = p.outcome === 'sent';
    entry.state = sent ? 'applied' : 'rejected';
    entry.line = sent ? 'You checked: it happened.' : 'You checked: it did not happen. Propose it again to do it.';
    if (p.note) entry.line = `${entry.line} Your note: ${p.note}`;
    entry.at = this.now();
    return { entry: clone(entry) };
  }
  /** venture.evidence.dismiss: the owner said no to a suggestion. A value in use stays; apply another one instead. */
  private dismissEvidence(id: string) {
    const item = this.evidence.find((e) => e.id === id);
    if (!item) throw new EngineError('EVIDENCE_NOT_FOUND', 'This evidence is not in this business.');
    if (item.applied) throw new EngineError('EVIDENCE_APPLIED', 'This value is in use. Apply a different one to replace it.');
    item.dismissed = true;
    return { item: clone(item) };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Onboarding, in the engine's order: countries and the template preview before any vault; workspace.create makes
  // the vault (it refuses while one is open); then venture.create, the template interview and the plan inside it.
  // A new business gets the queue view's rows: the plan first, then Connect your AI, Set your prices and, when this
  // computer keeps the key and no recovery code exists yet, Keep this business.
  // -------------------------------------------------------------------------------------------------------------

  /** W4 4J21: the hosted session's `me` as the hosted server sends it (trials on in the sample), or null off hosted. */
  hostedMe(): HostedMeLite | null {
    return this.hosted ? { trials: true, trial: this.trial ? this.trialView() : null } : null;
  }

  /** The hosted session view of a temporary business (hosted/trial.ts trialView), in the hosted server's words. */
  private trialView() {
    const ending = this.trial === 'ending';
    const expiresAt = new Date(Date.parse(this.now()) + (ending ? 20 : 6 * 24 + 20) * 3_600_000).toISOString();
    return {
      temporary: true as const, line: 'This business is temporary until you add your email.', expiresAt, endsSoon: ending,
      warning: ending ? 'This business will be deleted within a day unless you add your email.' : null,
    };
  }

  private onboarding(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'workspace.status': {
        const business = this.open ? this.businesses.find((b) => b.id === this.current) : undefined;
        return {
          open: this.open, workspace: business ? { name: business.name } : undefined,
          unlock: business ? (business.opens === 'needs-passphrase' ? 'typed' : 'this-computer') : undefined,
          closedByOwner: this.closedByOwner, experimental: true,
          ...(this.hosted ? { hosted: { businesses: this.businesses.map((b) => ({ id: b.id, name: b.name })), ...(this.trial ? { trial: this.trialView() } : {}) } } : {}),
        };
      }
      case 'workspace.lock': {
        this.endPlaybookSession();
        this.open = false;
        this.closedByOwner = true;
        return { locked: true };
      }
      case 'workspace.create': return this.createWorkspace(p);
      case 'workspace.backups.list': {
        if (this.open) return NOT_ONBOARDING;
        // No business open (Welcome back): every backup on this computer, newest first.
        const all: BackupLite[] = this.businesses.flatMap((b) => this.desk.backupsOf(b.id));
        return { backups: clone(all.sort((a, b) => b.at.localeCompare(a.at))), more: false };
      }
      case 'workspace.recover': return this.recover(p);
      case 'workspace.restore': return this.restoreAsNew(p);
      case 'workspace.transfer.import': return this.moveHere(p);
      case 'workspace.delete': return this.deleteBusiness(p);
      case 'venture.countries': return clone(COUNTRIES);
      case 'venture.preview': {
        const idea = this.idea(p.idea);
        const type = classify(idea);
        const label = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
        return {
          idea, country: clone(this.country(p.countryCode)), serviceType: label(type), serviceLabel: SERVICE_LABELS[type],
          oneLiner: label(`A built-in ${SERVICE_LABELS[type].toLowerCase()} plan, not fitted to what you wrote.`), by: 'template', saved: false,
        };
      }
      case 'venture.create': {
        if (this.ventures.has(this.current)) throw new EngineError('VENTURE_EXISTS', 'This workspace already has a business. Chausar keeps one business per workspace.');
        const idea = this.idea(p.idea);
        const country = this.country(p.countryCode);
        const named = typeof p.workingName === 'string' ? p.workingName.trim() : null;
        if (p.workingName !== undefined && (named === null || named.length < 2 || named.length > 80)) throw new EngineError('INVALID_VENTURE_REQUEST', 'The working name must be between 2 and 80 characters.');
        const venture: HeldVenture = { workingName: named ?? 'My service business', serviceType: null, idea, countryCode: country.code, done: 1 };
        this.ventures.set(this.current, venture);
        this.interviews.set(this.current, this.templateInterview(country.code));
        return { venture: { id: `venture_${this.current}`, workingName: venture.workingName, serviceType: null }, done: venture.done, total: 12 };
      }
      case 'venture.interview.next': {
        const questions = this.interviews.get(this.current);
        if (!questions) return NOT_ONBOARDING;
        return { interview: { questions: clone(questions) }, done: questions.every((q) => q.answer !== null) };
      }
      case 'venture.interview.answer': {
        const questions = this.interviews.get(this.current);
        if (!questions) return NOT_ONBOARDING;
        return this.answer(questions, p);
      }
      case 'venture.blueprint.draft': {
        const questions = this.interviews.get(this.current);
        if (!questions) return NOT_ONBOARDING;
        return this.draftPlan(questions);
      }
      default: return NOT_ONBOARDING;
    }
  }

  private idea(value: unknown): string {
    const idea = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
    if (idea.length < 10 || idea.length > 2000) throw new EngineError('INVALID_VENTURE_REQUEST', 'Your idea must be between 10 and 2000 characters.');
    return idea;
  }

  private country(code: unknown) {
    const country = COUNTRIES.find((c) => c.code === code);
    if (!country) throw new EngineError('UNKNOWN_COUNTRY', 'Choose a country from the list.');
    return country;
  }

  private createWorkspace(p: Record<string, unknown>): WorkspaceCreated {
    if (this.open) throw new EngineError('VAULT_OPEN', 'Lock the current workspace before creating another.');
    if (this.hosted && Object.keys(p).some((key) => key !== 'name' && key !== 'pack')) throw new EngineError('INVALID_REQUEST', 'Send only the name and the pack.');
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (name.length < 2 || name.length > 100) throw new EngineError('INVALID_NAME', 'Give your business a name.');
    if (p.pack !== undefined && p.pack !== 'services') throw new EngineError('UNKNOWN_PACK', 'Choose an available business starter pack.');
    const typed = typeof p.passphrase === 'string';
    if (!this.hosted && !typed && !this.deviceKeys) throw new EngineError('DEVICE_KEYS_UNAVAILABLE', 'This computer has no keyring Chausar can use, so Chausar asks for a passphrase.');
    if (typed && ((p.passphrase as string).length < 12 || (p.passphrase as string).length > 1024)) throw new EngineError('WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
    const id = this.freeId(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'business');
    const shown = typed || this.hosted;
    this.businesses.push({ id, name, serviceType: 'other', opens: typed ? 'needs-passphrase' : 'with-this-computer', recovery: shown ? 'made' : 'not-made', ...(typed ? { passphrase: p.passphrase as string } : {}) });
    this.endPlaybookSession(); this.scheduledSession++; this.current = id;
    this.open = true;
    this.closedByOwner = false;
    const code = shown ? SAMPLE_RECOVERY_CODE : null;
    return { workspace: { name }, folder: id, unlock: typed ? 'passphrase' : 'this-computer', recoveryKit: code, recoveryCode: code, experimental: true };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Custody with no business open: the recovery code, a backup opened as a new business, a business moved here. And
  // deleting the open business. The engine's rules: one business open at a time; a new passphrase only when this
  // computer can't keep the key (DEVICE_KEYS_UNAVAILABLE); the engine's own words for each refusal.
  // -------------------------------------------------------------------------------------------------------------

  /** A folder name not taken yet: slug, slug-2, slug-3. */
  private freeId(slug: string): string {
    let id = slug;
    for (let n = 2; this.businesses.some((b) => b.id === id); n++) id = `${slug}-${n}`;
    return id;
  }

  private notWhileOpen(): void {
    if (this.open) throw new EngineError('VAULT_OPEN', 'Lock the current workspace first.');
  }

  /** How a business opens after a new key: this computer's, or the new passphrase when it can't keep one. */
  private newKey(p: Record<string, unknown>): { opens: HeldBusiness['opens']; passphrase?: string } {
    if (typeof p.passphrase === 'string') {
      if (p.passphrase.length < 12 || p.passphrase.length > 1024) throw new EngineError('WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
      return { opens: 'needs-passphrase', passphrase: p.passphrase };
    }
    if (!this.deviceKeys) throw new EngineError('DEVICE_KEYS_UNAVAILABLE', NO_KEYRING);
    return { opens: 'with-this-computer' };
  }

  private endPlaybookSession(): void {
    this.w5?.find((desk):desk is FakePlaybooksDesk=>desk instanceof FakePlaybooksDesk)?.endSession();
  }

  private openHere(business: HeldBusiness): { workspace: { id: string; name: string } } {
    this.endPlaybookSession(); this.scheduledSession++; this.current = business.id;
    this.open = true;
    this.closedByOwner = false;
    this.emit({ type: 'queue.changed', businessId: business.id, at: this.now() });
    return { workspace: { id: business.id, name: business.name } };
  }

  /** workspace.recover: the recovery code opens the business, and this computer keeps the key again. */
  private recover(p: Record<string, unknown>) {
    this.notWhileOpen();
    const business = this.businesses.find((b) => b.id === p.folder);
    if (!business) throw new EngineError('WORKSPACE_NOT_FOUND', 'No business in that folder.');
    if (typeof p.recoveryCode !== 'string' || !SAMPLE_CODES.has(p.recoveryCode) || business.recovery !== 'made') throw new EngineError('UNLOCK_FAILED', UNLOCK_FAILED);
    const key = this.newKey(p);
    business.opens = key.opens;
    business.passphrase = key.passphrase;
    business.recovery = 'made';
    return this.openHere(business);
  }

  /**
   * workspace.restore: a backup by its name, opened as a new business beside the original. It opens the way the
   * backup does: with the passphrase it was locked with, with this computer's key, or with the recovery code.
   */
  private restoreAsNew(p: Record<string, unknown>) {
    this.notWhileOpen();
    const source = this.businesses.find((b) => this.desk.backupsOf(b.id).some((backup) => backup.file === p.backupFile));
    if (!source) throw new EngineError('BACKUP_NOT_FOUND', CUSTODY_ERROR_WORDS.BACKUP_NOT_FOUND);
    const coded = typeof p.recoveryCode === 'string';
    let key: { opens: HeldBusiness['opens']; passphrase?: string };
    if (coded) {
      if (!SAMPLE_CODES.has(p.recoveryCode as string)) throw new EngineError('UNLOCK_FAILED', 'Unable to unlock backup. Check your credential or use a valid backup.');
      key = this.newKey(p);
    } else if (source.opens === 'needs-passphrase') {
      if (typeof p.passphrase !== 'string') throw new EngineError('PASSPHRASE_REQUIRED', CUSTODY_ERROR_WORDS.PASSPHRASE_REQUIRED);
      if (p.passphrase !== source.passphrase) throw new EngineError('UNLOCK_FAILED', 'Unable to unlock backup. Check your credential or use a valid backup.');
      key = { opens: 'needs-passphrase', passphrase: p.passphrase };
    } else if (source.opens === 'key-missing') {
      throw new EngineError('DEVICE_KEY_FAILED', CUSTODY_ERROR_WORDS.DEVICE_KEY_FAILED);
    } else {
      key = { opens: 'with-this-computer' };
    }
    const id = this.freeId(typeof p.folder === 'string' && p.folder ? p.folder : `${source.id}-restored`);
    const restored: HeldBusiness = { id, name: source.name, serviceType: source.serviceType, recovery: 'made', ...key };
    this.businesses.push(restored);
    const venture = this.ventures.get(source.id);
    if (venture) this.ventures.set(id, clone(venture));
    return { ...this.openHere(restored), folder: id };
  }

  /** workspace.transfer.import: the move file and its code. A business already here is opened from the list instead. */
  private moveHere(p: Record<string, unknown>) {
    this.notWhileOpen();
    const text = typeof p.fileText === 'string' ? p.fileText : '';
    if (text.length > MOVE_MAX_CHARS) throw new EngineError('TRANSFER_TOO_LARGE', CUSTODY_ERROR_WORDS.TRANSFER_TOO_LARGE);
    let file: { backupFormat?: unknown; business?: unknown; name?: unknown };
    try { file = JSON.parse(text) as typeof file; } catch { file = {}; }
    if (file.backupFormat !== SAMPLE_MOVE_FORMAT || typeof file.business !== 'string' || typeof file.name !== 'string') throw new EngineError('TRANSFER_INVALID', CUSTODY_ERROR_WORDS.TRANSFER_INVALID);
    if (p.transferCode !== SAMPLE_MOVE_CODE) throw new EngineError('TRANSFER_CODE_WRONG', CUSTODY_ERROR_WORDS.TRANSFER_CODE_WRONG);
    if (this.businesses.some((b) => b.id === file.business)) throw new EngineError('TRANSFER_SAME_BUSINESS', CUSTODY_ERROR_WORDS.TRANSFER_SAME_BUSINESS);
    const key = this.newKey(p);
    const moved: HeldBusiness = { id: file.business, name: file.name, serviceType: 'other', recovery: 'made', ...key };
    this.businesses.push(moved);
    this.ventures.set(moved.id, { workingName: moved.name, serviceType: null, idea: '', countryCode: 'IN', done: 1 });
    return { ...this.openHere(moved), folder: moved.id, unlock: key.opens === 'needs-passphrase' ? 'passphrase' : 'this-computer' };
  }

  /** workspace.delete: the business name exactly as the vault holds it; the business and its backups go. */
  private deleteBusiness(p: Record<string, unknown>) {
    const business = this.businesses.find((b) => b.id === this.current);
    if (!business) throw new EngineError('VAULT_LOCKED', 'Open your workspace first.');
    if (p.confirmation !== business.name) throw new EngineError('CONFIRMATION_REQUIRED', 'Type the business name to delete the vault.');
    this.endPlaybookSession();
    this.businesses = this.businesses.filter((b) => b.id !== business.id);
    this.ventures.delete(business.id);
    this.desk.dropBackups(business.id);
    this.rows = this.rows.filter((r) => r.businessId !== business.id);
    this.open = false;
    this.current = '';
    return { deleted: true, copiesRemoved: [], externalCopies: 'Copies made outside this app must be removed by their owner.' };
  }

  private templateInterview(countryCode: string): InterviewQuestionLite[] {
    const india = countryCode === 'IN';
    return [
      { id: 'q_1', kind: 'choice', text: 'Who will your first clients be?', choices: [{ id: 'c_1', label: 'Small shops' }, { id: 'c_2', label: 'Cafes and restaurants' }], required: false, prefill: null, answer: null },
      { id: 'q_pricing_model', kind: 'choice', text: 'How will you charge?', choices: [{ id: 'monthly', label: 'Per month' }, { id: 'project', label: 'Per project' }, { id: 'hourly', label: 'Per hour' }], required: true, prefill: null, answer: null },
      { id: 'q_price', kind: 'money', text: 'What will you charge per month?', choices: [], required: false, prefill: null, answer: null },
      { id: 'q_tax', kind: 'yesno', text: india ? 'Are you registered for GST, so you charge it on your invoices?' : 'Do you charge any tax on your invoices?', choices: [], required: true, prefill: null, answer: null },
    ];
  }

  private answer(questions: InterviewQuestionLite[], p: Record<string, unknown>) {
    const question = questions.find((q) => q.id === p.questionId);
    if (!question) throw new EngineError('INVALID_VENTURE_REQUEST', 'There is no such question.');
    const answer = (p.answer ?? {}) as InterviewAnswer;
    if (answer.skipped === true) {
      if (question.required) throw new EngineError('INVALID_VENTURE_REQUEST', 'This question needs an answer.');
    } else if (question.kind === 'choice' && !question.choices.some((c) => c.id === answer.choiceId)) {
      throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose one of the choices.');
    } else if (question.kind === 'yesno' && typeof answer.yes !== 'boolean') {
      throw new EngineError('INVALID_VENTURE_REQUEST', 'Answer yes or no.');
    }
    question.answer = clone(answer);
    if (question.id === 'q_tax') {
      const at = questions.findIndex((q) => q.id === 'q_tax_rate');
      if (answer.yes === true && at < 0) questions.push({ id: 'q_tax_rate', kind: 'rate', text: 'What GST rate do you charge, in percent?', choices: [], required: true, prefill: '18', answer: null });
      if (answer.yes !== true && at >= 0) questions.splice(at, 1);
    }
    return { interview: { questions: clone(questions) }, done: questions.every((q) => q.answer !== null) };
  }

  /**
   * The prices row in the engine's words (views/queue.ts): both offers start with no price, and tax counts as set only
   * when the owner answered it; left unanswered, Chausar assumed it and asks the owner to confirm.
   */
  private pricesRow(questions: InterviewQuestionLite[]): Pick<QueueRow, 'title' | 'line' | 'actions'> {
    const assumed = questions.find((q) => q.id === 'q_tax')?.answer?.assumed === true;
    const taxLabel = this.ventures.get(this.current)?.countryCode === 'IN' ? 'GST' : 'Tax';
    const noPrice = 'Monthly plan and One-off project have no price yet';
    const words = assumed ? NEW_BUSINESS_ROWS.prices.both : NEW_BUSINESS_ROWS.prices.set;
    const line = assumed ? `${noPrice}, and Chausar assumed you do not charge ${taxLabel}.` : `${noPrice}.`;
    return { title: words.title, line, actions: [{ id: 'set-prices', label: words.action, primary: true }] };
  }

  private draftPlan(questions: InterviewQuestionLite[]): BlueprintViewLite {
    if (!questions.every((q) => q.answer !== null)) throw new EngineError('INTERVIEW_INCOMPLETE', 'Answer the questions about your price and tax first.');
    const venture = this.ventures.get(this.current)!;
    const business = this.businesses.find((b) => b.id === this.current)!;
    const kit = fakeKitForIdea(venture.idea);
    const type = kit?.registration.serviceType ?? classify(venture.idea);
    venture.serviceType = type;
    venture.done = 2;
    const at = this.now();
    const planId = `plan-${business.id}-1`;
    const label = <T,>(value: T) => ({ value, label: 'assumption' as const, by: 'template' as const });
    const oneLiner = `A built-in ${SERVICE_LABELS[type].toLowerCase()} plan, not fitted to what you wrote.`;
    if (!this.rows.some((r) => r.id === `q-plan-${business.id}`)) {
      const base = { businessId: business.id, businessName: business.name, createdAt: at };
      const seeds: Omit<QueueRow, 'digest'>[] = [
        { ...base, id: `q-plan-${business.id}`, kind: 'plan', title: NEW_BUSINESS_ROWS.plan.title, line: oneLiner, viewRef: { kind: 'plan', id: planId },
          actions: [{ id: 'read', label: NEW_BUSINESS_ROWS.plan.read, primary: false }, { id: 'approve', label: NEW_BUSINESS_ROWS.plan.accept, primary: true, requiresView: true }] },
        { ...base, id: `q-setup-ai-${business.id}`, kind: 'setup', title: NEW_BUSINESS_ROWS.ai.title, line: NEW_BUSINESS_ROWS.ai.line, actions: [{ id: 'connect', label: NEW_BUSINESS_ROWS.ai.action, primary: true }] },
        { ...base, id: `q-setup-prices-${business.id}`, kind: 'setup', ...this.pricesRow(questions), },
      ];
      if (business.recovery === 'not-made') {
        seeds.push({ ...base, id: `q-setup-keep-${business.id}`, kind: 'setup', title: NEW_BUSINESS_ROWS.keep.title, line: NEW_BUSINESS_ROWS.keep.line, actions: [{ id: 'keep', label: NEW_BUSINESS_ROWS.keep.action, primary: true }] });
      }
      this.rows.push(...seeds.map((seed) => ({ ...seed, digest: digestOf(seed) })));
      this.emit({ type: 'queue.changed', businessId: business.id, at });
    }
    const country = this.country(venture.countryCode);
    const india = country.code === 'IN';
    const offer = (id: string, name: string, model: 'monthly' | 'project', unit: 'month' | 'project') => ({
      id, name: label(name), description: label(`${name}, written from the built-in template.`),
      pricing: { model, quantityUnit: unit, unitPriceMinor: null, unitPriceLabel: 'not-set' as const, defaultQuantity: '1' },
    });
    const blueprint = {
      id: planId, at, version: 1, status: 'draft' as const, source: 'template' as const, digest: digestOf({ planId, at }), serviceType: type,
      name: label(venture.workingName), oneLiner: label(oneLiner), customer: label('Small businesses that want this done for them.'),
      offers: [offer('offer_1', 'Monthly plan', 'monthly', 'month'), offer('offer_2', 'One-off project', 'project', 'project')],
      deliverySteps: [
        { id: 'step_1', title: label('Collect what the client sends'), doneBy: 'you' as const, capability: 'planned' as const, note: 'You collect what the client sends and add the files to the order.' },
        { id: 'step_2', title: label('Do the work'), doneBy: 'you' as const, capability: 'planned' as const, note: 'You do the hands-on work.' },
        { id: 'step_3', title: label('Draft the reply'), doneBy: 'agent-then-you' as const, capability: 'drafts-now' as const, note: "An agent drafts a reply from the client's message. You check it." },
        { id: 'step_4', title: label('Send it'), doneBy: 'you' as const, capability: 'planned' as const, note: 'You send it to the client. Sending for you is planned.' },
      ],
      approvals: [label('Each draft before it goes to a client'), label('Prices and invoices')],
      backOffice: {
        currency: country.currency, taxLabel: india ? 'GST' : 'Tax',
        taxRegistered: questions.find((q) => q.id === 'q_tax')?.answer?.assumed === true
          ? { value: false, label: 'assumption' as const, by: 'template' as const }
          : { value: false, label: 'told-by-you' as const, by: 'owner' as const },
        invoiceKind: india ? 'tax-invoice' as const : 'invoice' as const, taxInvoiceReady: false, taxInvoiceMissing: [], paymentRail: india ? 'razorpay' : 'paypal',
      },
      starterConnectorIds: [],
    };
    const templateView = { blueprint, offerReceipts: { offer_1: null, offer_2: null } };
    const view = kit ? fakeKitPlan(kit, templateView) : fakeSocialForIdea(venture.idea) ? fakeSocialPlan(templateView) : fakeCaForIdea(venture.idea) ? fakeCaPlan(templateView) : fakeYoutubeForIdea(venture.idea)?fakeYoutubePlan(templateView,this.hosted):templateView;
    this.desk.putBlueprint(business.id, view);
    return view;
  }
}

/** An EngineClient over the fake engine. Its status line says the data is a sample. */
export function createFakeClient(engine: FakeEngine = new FakeEngine()): EngineClient & { engine: FakeEngine } {
  const status = createStatusStore({ state: 'ok' });
  return {
    engine,
    transport: 'fake',
    request<M extends MethodName>(method: M, params?: ParamsOf<M>) { return engine.request(method, params) as Promise<ResultOf<M>>; },
    subscribe: (listener) => engine.subscribe(listener),
    status: () => status.get(),
    onStatus: (listener) => status.subscribe(listener),
    // W4 4J21: as the hosted page's client reads `me` from the session (client.ts hostedMe).
    ...(engine.hostedMe() ? { hostedMe: async () => structuredClone(engine.hostedMe()) } : {}),
  };
}
