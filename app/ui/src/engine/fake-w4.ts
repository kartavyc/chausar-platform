/**
 * The fake engine's answers for the smaller Ink v2 wave 4 pieces: departments and Keeper (4A2), run controls and Away
 * (4F3), the CLI status (4H2), goals and the next step (4I2), and the approvals, money, Start and quality screens
 * (4J19 to 4J22b). Package 4-0 registered it empty: it answers no method yet, so the fake refuses each one as it
 * refuses any it does not know, the way the engine answers NOT_BUILT_YET until a package lands. Each U package adds its
 * methods to W4_METHODS and answers them here with the engine's rules and words.
 *
 * W4DeskHost is what fake.ts gives every wave 4 desk (fake-agents.ts, fake-chief.ts, fake-network.ts, fake-notify.ts).
 */

import { EngineError, type AgentView, type DeliveryLite, type JournalEntry, type QueueAction, type QueueRow, type ReceiptLite, type RunDetail, type RunSummary, type TeamListView, type VentureRunEvent } from './types';
// 4J3: previews on Today's rows, order stage steps and the poster method (fake-previews.ts).
import { FAKE_4J3_METHODS, fakePoster, withFakePreviews } from './fake-previews';
// 4J8: "Add this to {business}", the plan suggestion (fake-plan-suggest.ts).
import { FAKE_4J8_METHODS, fakePlanSuggest } from './fake-plan-suggest';
// 4H2: the CLI status on this computer and the AI serving each role (fake-cli.ts).
import { FAKE_4H2_METHODS, fakeCliStatus, fakeRoles } from './fake-cli';
// 4J6: money and runs across the businesses on this computer (fake-across.ts).
import { FAKE_4J6_METHODS, FakeAcross } from './fake-across';
// 4A2: departments, Keeper and health on Team (fake-team.ts).
import { FAKE_4A2_METHODS, FakeTeamDesk } from './fake-team';
// 4I2: goals, today's pace and the next best step (fake-goals.ts).
import { FAKE_4I2_METHODS, FakeGoals } from './fake-goals';
// 4F3: Stop, Force stop, Resume, the round gate, notes for the next step, Pause all and Away (fake-run-controls.ts).
import { FAKE_4F3_METHODS, FakeRunControls } from './fake-run-controls';
// 4J21: the owner's name, connection checks, the client's file request link and settings drafts (fake-setup.ts).
import { FAKE_4J21_METHODS, FakeSetupDesk } from './fake-setup';
// 4J22b: the voice, personas and skills, the agent file, what the AI knows, ideas and the capability page (fake-agent-extras.ts).
import { FAKE_4J22B_METHODS, FakeAgentExtras, type AgentExtrasHooks } from './fake-agent-extras';
// 4J22a: the journal chain and signed receipts, order contracts, routines, drills, readiness, shadow and guidance (fake-4j22a.ts).
import { FAKE_4J22A_METHODS, FakeQualityDesk } from './fake-4j22a';
// 4J2: a set's server-made quote, and Make a copy of a draft that went out (fake-4j2.ts).
import { FAKE_4J2_METHODS, FakeSets, fakeDeliveryCopy } from './fake-4j2';
// 4J19: send back, edit and undo, a fix, paragraph changes, the triage rule, the decision record and row meta (fake-4j19.ts).
import { FAKE_4J19_METHODS, FakeApprovalsDesk, withFakeMeta } from './fake-4j19';

export type SupportImportedMail={messageId:string;references:string[];from:string;to?:string[];subject:string;date:string;text:string|null;held:boolean};
export interface W4DeskHost {
  acceptedOffers?():readonly {id:string;playbookOffer?:string|null}[];
  eraseFormsCopies?(orderIds:readonly string[]):void;
  eraseDevCopies?(orderIds:readonly string[]):void;
  keepVaReport?(routineId:string,title:string,text:string):void;
  eraseVaReports?():void;
  eraseVaCopies?(orderIds:readonly string[]):void;
  roomPrice?(orderId:string):import('../../../../platform/runtime/venture/playbooks/kit/client-room-core').RoomPrice|undefined;
  keepTranslationFile?(orderId:string,file:{id:string;name:string;contentBase64:string;digest:string}):void;
  keepNarrationFetched?(orderId:string,file:{id:string;name:string;contentBase64:string;digest:string},source:{fileId:string;url:string;finalUrl:string;digest:string}):void;
  narrationPrice?(orderId:string):{id:string;currency:string;hourlyMinor:string;ownerSet:boolean;stale:boolean}|undefined;
  eraseTenderIntake?(orderIds:readonly string[]):void;
  workReceipt?(id:string):import('./types').WorkReceiptLite|undefined;
  socialClientAnswer?(runId:string):{answer:import('./types').ShareAnswer;packDigest:string}|null;
  socialChain?(orderId:string):import('./types').OrderChainView|null;
  scheduledPost?(id:string):import('../../../../platform/runtime/venture/playbooks/social/scheduled-core').ScheduledPostSnapshot|null;
  moveScheduledPost?(id:string,binding:import('../../../../platform/runtime/venture/playbooks/social/scheduled-core').ScheduledPostBinding):import('../../../../platform/runtime/venture/playbooks/social/scheduled-core').ScheduledPostSnapshot;
  decideScheduledPost?(id:string,state:'approved'|'rejected'|'applied'):void;
  scheduledSession?():number;
  scheduledBusy?(exceptId:string):boolean;
  eraseScheduledPost?(id:string):void;
  uploadFingerprint?(id: string): string | null;
  keepSellerAsset?(asset:Omit<import('./types').AssetView,'stale'|'blocked'|'sourceLine'|'costLine'>):void;
  eraseSellerAssets?(ids:readonly string[]):void;
  eraseSellerFiles?(ids:readonly string[]):void;
  eraseRecruitingCopies?(orderIds:readonly string[]):void;
  eraseCareerCopies?(orderIds:readonly string[]):void;
  eraseAppTestingCopies?(orderIds:readonly string[]):void;
  eraseTranslationCopies?(orderIds:readonly string[]):void;
  recruitingBlocked?(email:string|null,personId:string|null):boolean;
  influencerOutreach?(input:{name:string;email:string;sourceUrl:string;creatorId:string;subject:string;body:string;postalAddress:string}):{leadId:string;draftId:string};
  eraseInfluencerCopies?(orderIds:readonly string[]):void;
  eraseInfluencerLeads?(ids:readonly string[]):void;
  recruitingReports?(orderId:string):{reports:unknown[];shares:unknown[]};
  recruitingMail?(threadIds:readonly string[]):unknown[];
  eraseRecruitingMail?(threadIds:readonly string[]):void;
  siteCaptureClient?(name:string,email:string):{id:string;name:string;email:string|null};
  orderFiles?(orderId: string): { id: string; name: string; format: string; contentBase64: string; digest: string }[];
  supportImported?(mail:SupportImportedMail):void;
  supportThread?(id: string): { held: boolean; messages: { messageId: string; references: string[]; from: string; subject: string; date: string; text: string | null; source: 'mailbox' | 'file-import' }[] } | null;
  current(): string;
  now(): string;
  emit(event: VentureRunEvent): void;
  /** Whether this answers as the hosted web server. */
  hosted(): boolean;
  /** Today's rows, shared with the other desks, and the fake's digest for a row it adds or changes. */
  rows(): QueueRow[];
  setRows(rows: QueueRow[]): void;
  digest(value: unknown): string;
  /** Another desk's answer, for the records this desk reads. */
  ask(method: string, params: Record<string, unknown>): unknown;
  eraseYoutubeIdeaSources?(sources:readonly string[]):void;
  /** The businesses on this computer and how each opens (4J6). */
  businesses?(): { id: string; name: string; opens: string }[];
  /** The fake's runs, which the run controls change as the engine's do (4F3). */
  runs?(): RunDetail[];
  /** 4J2: keeps a new draft beside the fake's others (Make a copy). */
  keepDelivery?(run: DeliveryLite): DeliveryLite;
  /** 4J21: whether the open business is a temporary one on the hosted app (4J23). */
  trial?(): boolean;
  /** 4J22a: the journal's entries (the chain counts them) and a stored receipt by id (verify reads it). */
  journal?(): JournalEntry[];
  receipt?(id: string): ReceiptLite | undefined;
}

const W4_METHODS = new Set<string>([...FAKE_4J3_METHODS, ...FAKE_4J8_METHODS, ...FAKE_4J6_METHODS, ...FAKE_4A2_METHODS, ...FAKE_4I2_METHODS, ...FAKE_4H2_METHODS, ...FAKE_4F3_METHODS, ...FAKE_4J2_METHODS, ...FAKE_4J19_METHODS, ...FAKE_4J21_METHODS, ...FAKE_4J22B_METHODS, ...FAKE_4J22A_METHODS]);

export class FakeW4Desk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;
  private readonly across: FakeAcross;
  private readonly team: FakeTeamDesk;
  private readonly goals: FakeGoals;
  private readonly runControls: FakeRunControls;
  private readonly sets: FakeSets;
  private readonly approvals: FakeApprovalsDesk;
  private readonly setup: FakeSetupDesk;
  private readonly extras: FakeAgentExtras;
  /** 4J22a's desk; public so tests can break the chain or put a contract on an order. */
  readonly quality: FakeQualityDesk;

  constructor(host: W4DeskHost, options: { fresh?: boolean; extras?: AgentExtrasHooks } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
    this.across = new FakeAcross(host);
    this.team = new FakeTeamDesk(host);
    this.goals = new FakeGoals(host, { fresh: this.fresh });
    this.runControls = new FakeRunControls(host, { fresh: this.fresh });
    this.sets = new FakeSets(host);
    this.approvals = new FakeApprovalsDesk(host, { fresh: this.fresh });
    this.setup = new FakeSetupDesk(host, { trial: () => host.trial?.() ?? false });
    this.extras = new FakeAgentExtras(host, { fresh: this.fresh, hooks: options.extras ?? {} });
    this.quality = new FakeQualityDesk(host, { fresh: this.fresh });
    // 4J3: the engine adds previews after each row's digest; the fake adds its own rows' the same way.
    if (!this.fresh) host.setRows(withFakeMeta(withFakePreviews(host.rows())));
    // 4J22a: the question run 29 waits on ends in a few hours, so the run sheet shows its expiry.
    if (!this.fresh) host.setRows(this.quality.withQuestionExpiry(host.rows()));
  }

  /** A receipt a wave 4 desk made (4J6's figures across businesses), for venture.receipt.get. */
  receipt(id: string): ReceiptLite | undefined {
    return this.across.receipt(id) ?? this.team.receipt(id) ?? this.goals.receipt(id) ?? this.runControls.receipt(id);
  }

  /** 4A2: venture.team.list, the fake's agents as the engine lists them (fake.ts answers the method with this). */
  teamList(agents: AgentView[], runs: readonly RunSummary[]): TeamListView {
    return this.team.list(agents, runs);
  }

  /** 4F3: a run as venture.runs.get sends it, its scope's cap in rupees when the owner set a rate. */
  runView(run: RunDetail): RunDetail {
    // 4J22a: coverage, the report, the outcome and an interruption on the sample runs (fake-4j22a.ts).
    return this.quality.decorateRun(this.runControls.view(run));
  }

  /** 4F3: venture.get's paused field while the open business is paused (Pause all), else nothing. */
  pausedField(): { paused?: { since: string; line: string } } {
    return this.runControls.pausedField();
  }

  /** 4F3: a decision on a run-control row of Today (Resume, Run again, Continue, Stop), or null for any other row. */
  decideRunControl(row: QueueRow, action: QueueAction['id'], answer?: string): string | null {
    return this.runControls.decide(row, action, answer);
  }

  /** 4J2: venture.queue.view opened a row (fake.ts calls this): its present version counts as read for a set. */
  markViewed(opened: { id: unknown; kind?: unknown }): void {
    this.sets.markViewed(opened);
  }

  handles(method: string): boolean {
    return W4_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    if (method === 'venture.files.poster') return fakePoster(this.host, p);
    if (method === 'venture.blueprint.suggest') return fakePlanSuggest(this.host, p);
    if (method === 'venture.models.cli.status') return fakeCliStatus(this.host, p);
    if (method === 'venture.models.roles') return fakeRoles(this.host, p);
    if (method === 'venture.queue.setPreview') return this.sets.preview(p);
    if (method === 'venture.queue.set') return this.sets.set(p);
    if (method === 'venture.delivery.copy') return fakeDeliveryCopy(this.host, p);
    if (FAKE_4J19_METHODS.includes(method)) return this.approvals.request(method, p);
    if (FAKE_4J6_METHODS.includes(method)) return this.across.request(method, p);
    if (FAKE_4A2_METHODS.includes(method)) return this.team.request(method, p);
    if (FAKE_4I2_METHODS.includes(method)) return this.goals.request(method, p);
    if (FAKE_4F3_METHODS.includes(method)) return this.runControls.request(method, p);
    if (FAKE_4J21_METHODS.includes(method)) return this.setup.request(method, p);
    if (FAKE_4J22B_METHODS.includes(method)) return this.extras.request(method, p);
    if (FAKE_4J22A_METHODS.includes(method)) return this.quality.request(method, p);
    throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
  }
}
