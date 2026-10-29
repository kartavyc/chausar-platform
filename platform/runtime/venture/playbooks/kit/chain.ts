import {articleOnReview} from '../podcast-to-article/chain.ts';
// Chausar playbook kit: the chain that carries a kit offer's stages across runs on one order (Ink v2 wave 5, package
// 5A1; spec 5.8 "outcome edges, retry caps and timeouts across a chain of runs", on 4J12's step fields). An offer whose
// stages name more than one step is a chain: the order starts at stage 1, and each run drafts its stage's step
// (playbooks/steps.ts kitDelivery draftStep). Only the owner's Accept (or their own edited version) moves the order to
// the next stage, and the next stage's run starts then, through the same order path, so gates, posture and the floor
// hold; it never starts before (a chain stopped past its cap resumes the same way, once the owner accepts that stage's
// draft). A rejection follows the stage step's failed edge (back to the same stage, or to the one
// it names) until the step's maxLoops; past it the chain stops (onExceeded) with one Today row: "The voice sheet was
// sent back 3 times. Talk to your client before trying again." A stage whose run hands a question to the client waits;
// the client's answer resumes the chain at the stage the step's blocked edge names (or the same one). A stage waiting
// on the client longer than its step's waitDays, by the business's local day, makes one Today row per stage: "Waiting
// on your client for 7 days". The order keeps chainStage, chainState and chainSince. Written for Chausar; nothing here
// is learned from an outside source.
import { check, type Context, type State } from '../../../contracts.ts';
import type { DeliveryRunRecord, OrderRecord, VentureDeps, VentureRecord } from '../../contracts.ts';
import { exactPayload, findRecord, identifier, listRecords, type VentureTx } from '../../records.ts';
import { acceptedBlueprintOrNull, readAs } from '../../delivery/shared.ts';
import { localDayAt } from '../../local-day.ts';
import type { W4RowItem } from '../../views/queue-w4.ts';
import { pickPlaybook } from '../registry.ts';
import type { KitOffer, KitStep, PlaybookDefinition } from './define.ts';
import { kitDefinition } from './installed.ts';
import {socialChainDefinition,keepSocialVoice} from '../social/chain.ts';

import { manualPathFor } from './manual-path.ts';
import type { ChainStageState, OrderChainView } from './records-chain.ts';

/** How many times a stage may be sent back when its step names no cap (4J12's default). */
export const DEFAULT_MAX_LOOPS = 2;
const DAY_MS = 86_400_000;

/** A kit order's chain: its definition, offer and stage steps, in order. */
export type ChainDefinition=Pick<PlaybookDefinition,'registration'|'offers'|'steps'|'rules'|'checkIds'|'connectors'|'clientRoom'>;
export type KitChain = { definition: ChainDefinition; offer: KitOffer; steps: KitStep[] };

/** The chain a kit offer is, or null when the playbook has no such offer. A one-stage offer is a chain of one. */
export function kitChainOf(definition: ChainDefinition | null, offerKey: string | null | undefined): KitChain | null {
  const offer = definition?.offers.find(item => item.id === offerKey);
  if (!definition || !offer) return null;
  const stages = offer.stages;
  return { definition, offer: { ...offer, stages }, steps: stages.map(id => definition.steps.find(step => step.id === id)!) };
}

/** The chain of one order of this business, from the playbook its idea picks and the plan offer the order is. */
export function orderChain(state: State, venture: VentureRecord, order: Pick<OrderRecord, 'offerId'|'socialChain'>): KitChain | null {
  const id=pickPlaybook(venture.idea)?.id;
  const definition = id==='social-agency'?socialChainDefinition(order.socialChain):kitDefinition(id ?? null);
  const offerKey = acceptedBlueprintOrNull(state, venture)?.offers.find(offer => offer.id === order.offerId)?.playbookOffer ?? null;
  return kitChainOf(definition, offerKey);
}

/** The stage an order is at, counted from 1 (absent: the first). */
export const stageOf = (order: Pick<OrderRecord, 'chainStage'>): number => order.chainStage ?? 1;
/** The stage a run drafted (absent: the first). */
export const runStageOf = (run: Pick<DeliveryRunRecord, 'chainStage'>): number => run.chainStage ?? 1;

/** What a stage makes, as it reads inside a sentence: "voice sheet". */
const madeWords = (step: KitStep): string => step.produces.charAt(0).toLowerCase() + step.produces.slice(1);
/** The Today line for a chain stopped past its cap. */
export function stoppedLine(step: KitStep, times: number): string {
  return `The ${madeWords(step)} was sent back ${times} times. Talk to your client before trying again.`;
}
/** The Today line for a stage waiting on the client. */
export function waitingLine(days: number): string {
  return `Waiting on your client for ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The stage an edge on this outcome leads to, when it names one of the offer's stages; else the same stage. */
function stageByEdge(chain: KitChain, stage: number, on: 'failed' | 'blocked'): number {
  const to = chain.steps[stage - 1]?.next?.find(edge => edge.on === on)?.to;
  const index = to ? chain.offer.stages.indexOf(to) : -1;
  return index >= 0 ? index + 1 : stage;
}

/**
 * Where a chain goes after the owner's decision on a stage's draft. Accept (or the owner's own edit) moves on, or ends
 * the chain after the last stage. A rejection follows the failed edge while the stage was sent back no more than its
 * step's maxLoops; past it the chain stops with the line for Today. rejections: this stage's rejected drafts so far,
 * this one included.
 */
export function chainAfterDecision(chain: KitChain, stage: number, verdict: 'accepted' | 'edited' | 'rejected', rejections: number): { stage: number; state: 'running' | 'stopped' | 'done'; line: string | null } {
  if (verdict !== 'rejected') return stage < chain.steps.length ? { stage: stage + 1, state: 'running', line: null } : { stage, state: 'done', line: null };
  const step = chain.steps[stage - 1];
  const cap = step.maxLoops ?? DEFAULT_MAX_LOOPS;
  if (rejections > cap) return { stage, state: 'stopped', line: stoppedLine(step, rejections) };
  return { stage: stageByEdge(chain, stage, 'failed'), state: 'running', line: null };
}

/** The stage a chain resumes at once the client answered: the blocked edge's stage, else the same one. */
export function chainAfterAnswer(chain: KitChain, stage: number): number {
  return stageByEdge(chain, stage, 'blocked');
}

function replaceOrder(tx: VentureTx, order: OrderRecord, patch: Pick<OrderRecord, 'chainStage' | 'chainState'>, runId: string): void {
  tx.replace({ ...order, ...patch, chainSince: tx.now });
  tx.emit('chain.changed', { runId });
}

/**
 * The review hook (delivery/runs.ts, inside the review's commit): moves a kit chain order on after Accept, back or to a
 * stop after a rejection. Returns the order id when the next stage's run should start now (after the commit); else null.
 */
export function chainOnReview(tx: VentureTx, run: DeliveryRunRecord, verdict: 'accepted' | 'edited' | 'rejected'): string | null {
  articleOnReview(tx,run,verdict);
  keepSocialVoice(tx,run,verdict);
  const order = tx.find('venture-order', run.orderId);
  if (!order || !tx.venture || run.practice) return null;
  const chain = orderChain(tx.state, tx.venture, order);
  if (!chain || order.chainState === 'done' || chain.steps.length < 2 && !order.socialChain) return null;
  const stage = runStageOf(run);
  if (stage !== stageOf(order)) return null;
  // A stopped chain stays stopped until the owner accepts that stage's draft (after talking to the client): then it
  // moves on as an accepted stage does, and its Today row goes. Another rejection leaves it stopped.
  if (order.chainState === 'stopped' && verdict === 'rejected') return null;
  const rejections = listRecords(tx.state, 'venture-delivery-run', tx.venture.id).filter(item => item.orderId === order.id && runStageOf(item) === stage && item.status === 'rejected').length;
  const next = chainAfterDecision(chain, stage, verdict, rejections);
  replaceOrder(tx, order, { chainStage: next.stage, chainState: next.state }, run.id);
  return verdict !== 'rejected' && next.state === 'running' ? order.id : null;
}

/** The hook when a run hands a question to the client (delivery/runs.ts): the chain waits on the client from now. */
export function chainOnQuestion(tx: VentureTx, run: DeliveryRunRecord): void {
  const order = tx.find('venture-order', run.orderId);
  if (!order || !tx.venture || run.practice || runStageOf(run) !== stageOf(order)) return;
  const asked = run.harness?.handoffs.findLast(handoff => handoff.answer === null);
  if (asked?.to !== 'client' || !orderChain(tx.state, tx.venture, order)) return;
  replaceOrder(tx, order, { chainStage: stageOf(order), chainState: 'waiting' }, run.id);
}

/** The hook when the client's answer comes in (delivery/runs.ts venture.delivery.answer): resume at the stage the step names. */
export function chainOnAnswer(tx: VentureTx, run: DeliveryRunRecord): void {
  const order = tx.find('venture-order', run.orderId);
  // Only the answer to this stage's own run, never a practice run's, moves the chain.
  if (!order || !tx.venture || order.chainState !== 'waiting' || run.practice || runStageOf(run) !== stageOf(order)) return;
  const chain = orderChain(tx.state, tx.venture, order);
  if (!chain) return;
  replaceOrder(tx, order, { chainStage: chainAfterAnswer(chain, stageOf(order)), chainState: 'running' }, run.id);
}

/** Whole local days from one instant to another, by the business's own calendar (localDayAt). */
function localDaysBetween(from: string, to: string, venture: VentureRecord): number {
  return Math.round((Date.parse(`${localDayAt(to, venture.country)}T00:00:00.000Z`) - Date.parse(`${localDayAt(from, venture.country)}T00:00:00.000Z`)) / DAY_MS);
}

/** One order's chain as venture.order.chain shows it; now: the business's clock, for how long a stage has waited. */
export function chainView(state: State, venture: VentureRecord, order: OrderRecord, chain: KitChain, now: string): OrderChainView {
  const stage = Math.min(stageOf(order), chain.steps.length);
  const state_ = order.chainState ?? 'running';
  const current: ChainStageState = state_ === 'stopped' ? 'stopped' : state_ === 'waiting' ? 'waiting' : state_ === 'done' ? 'done' : 'now';
  const stopped = state_ === 'stopped'
    ? listRecords(state, 'venture-delivery-run', venture.id).filter(item => item.orderId === order.id && runStageOf(item) === stage && item.status === 'rejected').length : 0;
  return {
    ...(chain.definition.registration.id==='social-agency'&&chain.offer.id==='monthly-report'?{prerequisites:[{stepId:'collect-exports',title:'Client exports',state:listRecords(state,'venture-upload',venture.id).some(f=>f.scope.kind==='order'&&f.scope.orderId===order.id)?'done' as const:'waiting' as const},{stepId:'figures',title:'Figures from code receipts',state:listRecords(state,'venture-work-receipt',venture.id).some(r=>r.operation==='social.report'&&r.runRef.kind==='delivery'&&listRecords(state,'venture-delivery-run',venture.id).filter(run=>run.orderId===order.id).map(run=>run.id).includes(r.runRef.runId))?'done' as const:'waiting' as const}],approval:{stepId:'approve-report',title:'Owner approval',state:state_==='done'?'done' as const:'waiting' as const}}:{}),
    orderId: order.id, playbook: chain.definition.registration.id, offerKey: chain.offer.id, stage, of: chain.steps.length,
    line: `Stage ${stage} of ${chain.steps.length}`, state: state_, since: order.chainSince ?? null,
    stages: chain.steps.map((step, index) => ({
      n: index + 1, stepId: step.id, title: step.title, produces: step.produces,
      state: index + 1 < stage ? 'done' : index + 1 === stage ? current : 'not-started',
      // 5A3: what a person does by hand while the stage's connector is only planned.
      manualPath: manualPathFor(chain.definition, step.id),
    })),
    note: state_ === 'stopped' ? stoppedLine(chain.steps[stage - 1], stopped)
      : state_ === 'waiting' && order.chainSince ? waitingLine(localDaysBetween(order.chainSince, now, venture)) : null,
  };
}

/** venture.order.chain {orderId} (read): the order's stages, each with its state, and "Stage 2 of 4". */
export async function orderChainHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OrderChainView> {
  const body = exactPayload(payload, ['orderId'], ['orderId']);
  const orderId = identifier(body.orderId, 'Order');
  const { state, venture } = readAs(deps, ctx, 'read');
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  const chain = orderChain(state, venture, order);
  check(chain, 'INVALID_VENTURE_REQUEST', "This order's offer runs no stages of a playbook.");
  return chainView(state, venture, order, chain, deps.clock().toISOString());
}

/**
 * Today's chain rows (views/queue.ts, a wave 4 row source): one notice per stopped chain, and one per stage waiting on
 * the client for at least its step's waitDays, by the business's local day. Open goes to Work; Later is Today's own.
 */
export function chainRows(deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  const now = deps.clock().toISOString();
  const rows: W4RowItem[] = [];
  for (const order of listRecords(state, 'venture-order', venture.id)) {
    if (order.chainState !== 'stopped' && order.chainState !== 'waiting') continue;
    const chain = orderChain(state, venture, order);
    if (!chain) continue;
    const view = chainView(state, venture, order, chain, now);
    const step = chain.steps[view.stage - 1];
    const base = {
      kind: 'notice' as const, createdAt: order.chainSince ?? order.at, line: `${chain.offer.name}: ${step.title}`,
      actions: [{ id: 'open' as const, label: 'Open', primary: true }, { id: 'later' as const, label: 'Later', primary: false }],
      notice: { probe: 'stalled' as const, severity: 'medium' as const, link: '#/work' },
    };
    if (order.chainState === 'stopped') {
      rows.push({ ...base, subject: `chain-stopped:${order.id}`, version: `${view.stage}:${order.chainSince ?? ''}`, title: view.note! });
      continue;
    }
    const days = order.chainSince ? localDaysBetween(order.chainSince, now, venture) : 0;
    if (days < (step.waitDays ?? Number.POSITIVE_INFINITY)) continue;
    rows.push({ ...base, subject: `chain-wait:${order.id}:${view.stage}`, version: order.chainSince ?? '', title: waitingLine(days) });
  }
  return rows;
}
