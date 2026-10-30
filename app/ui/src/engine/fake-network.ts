/**
 * The fake engine's answers for the owner's network, the pipeline, drafts and handoffs, the mailbox and inbound mail
 * (Ink v2 wave 4: 4D4 and 4E4 fill it from the engine's 4D1 to 4E3). A method no package filled yet is refused as the
 * fake refuses any it does not know, the way the engine answers NOT_BUILT_YET until a package lands.
 *
 * 4D4: the network, its imports, search and Forget answer from fake-people.ts (with venture.pipeline.add, which the
 * Network tab calls, and workspace.custody.neverContactReset).
 * 4E4: the pipeline board, follow-ups, drafts and handoffs, the mailbox, the calendar address and "after a call"
 * answer from fake-pipeline.ts, on the people desk's own cards; Today's follow-up and reply rows come from there too.
 */

import { EngineError, type NetworkSourcesView, type PersonView, type QueueAction, type QueueRow, type ReceiptLite } from './types';
import type { W4DeskHost } from './fake-w4';
import { FAKE_4D4_METHODS, FakePeopleDesk } from './fake-people';
import { FAKE_4E4_METHODS, FakePipelineDesk, type MeetingDrafts } from './fake-pipeline';

const NETWORK_METHODS = new Set<string>([...FAKE_4D4_METHODS, ...FAKE_4E4_METHODS]);

export class FakeNetworkDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;
  /** 4D4: the people, imports, searches and the cards added from them. */
  protected readonly people: FakePeopleDesk;
  /** 4E4: the board, drafts, handoffs, the mailbox and the calendar, on the people desk's cards. */
  protected readonly pipeline: FakePipelineDesk;

  constructor(host: W4DeskHost, options: { fresh?: boolean; meetings?: MeetingDrafts; due?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
    this.people = new FakePeopleDesk(host, { fresh: this.fresh });
    const meetings: MeetingDrafts = options.meetings ?? { draftFromMeeting: () => { throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); } };
    this.pipeline = new FakePipelineDesk(host, this.people, meetings, { fresh: this.fresh, ...(options.due === undefined ? {} : { due: options.due }) });
  }

  /** Internal minimum identity from an exactly approved website import. */
  captureSiteClient(client:{id:string;name:string;email:string}):void {this.people.captureSiteClient(client);}

  recruitingBlocked(email:string|null,personId:string|null):boolean {return this.pipeline.isBlocked(email)||!!personId&&this.pipeline.personBlocked(personId);}

  handles(method: string): boolean {
    return NETWORK_METHODS.has(method);
  }

  /** The tie and band receipts (4D4) and the board's count receipts (4E4), for venture.receipt.get. */
  receipt(id: string): ReceiptLite | undefined {
    return this.people.receipt(id) ?? this.pipeline.receipt(id);
  }

  /** Internal hook for erasing proposals with their person or import. */
  privacyFacts() {
    return this.people.privacyFacts();
  }
  /** 4E4: Today's follow-up and reply rows and "Add notes" notices, brought up to date before the queue is listed. */
  syncRows(): void {
    this.pipeline.syncRows();
  }

  /** 4J22b: unhandled mail the owner answers themselves, for "Who is waiting on you" (fake-agent-extras.ts). */
  waitingMail(): { id: string; who: string; date: string }[] {
    return this.pipeline.waitingMail();
  }

  /** 4E4: a decision on a follow-up, reply or notes row, in the engine's words; null for any other row. */
  decide(row: QueueRow, action: QueueAction['id']): string | null {
    return this.pipeline.decide(row, action);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    // 4E4: the person sheet lists their drafts, and the sources carry the mailbox and calendar state, as the engine's do.
    if (method === 'venture.network.person') {
      const view = this.people.request(method, p) as PersonView;
      return { ...view, drafts: this.pipeline.draftsOf(view.person.id) };
    }
    // 4E4: no new card for someone on the blocklist, checked before "already in your pipeline" (pipeline-methods.ts add).
    if (method === 'venture.pipeline.add' && typeof p.personId === 'string' && this.pipeline.personBlocked(p.personId)) {
      throw new EngineError('PIPELINE_BLOCKED', 'This person asked not to be contacted, or is on your blocklist.');
    }
    if (method === 'venture.network.sources') return { ...(this.people.request(method, p) as NetworkSourcesView), ...this.pipeline.reads() };
    if (FAKE_4D4_METHODS.includes(method)) return this.people.request(method, p);
    if (FAKE_4E4_METHODS.includes(method)) return this.pipeline.request(method, p);
    throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
  }
}
