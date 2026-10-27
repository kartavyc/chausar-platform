// Chausar playbook kit: venture.desk.list, .get and .act routed to each playbook's desk (Ink v2 wave 5, package 5A1).
// The request names a playbook and a record kind; playbooks/desks.ts deskHandler finds that kind's handler, which gets
// the whole request and checks the rest itself (fields, level, the app channel, the digest). An unknown playbook or
// kind, or an operation the kind does not offer, answers NOT_BUILT_YET, as the fake engine does
// (app/ui/src/engine/fake-playbooks.ts). Written for Chausar; nothing here is learned from an outside source.
import { ChausarError, type Context } from '../../../contracts.ts';
import type { VentureDeps } from '../../contracts.ts';
import type { DeskActPayload, DeskActView, DeskGetPayload, DeskItemView, DeskListPayload, DeskListView } from '../desk-types.ts';
import { deskHandler } from '../desks.ts';

const NOT_BUILT = 'This part of Chausar is not built yet.';
type Ops = { list: [DeskListPayload, DeskListView]; get: [DeskGetPayload, DeskItemView]; act: [DeskActPayload, DeskActView] };

/** One desk operation's handler: finds the playbook's handler for the kind and hands it the request whole. */
export function deskRoute<Op extends keyof Ops>(op: Op): (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<Ops[Op][1]> {
  return async (deps, ctx, payload) => {
    const body = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    const handler = typeof body.playbook === 'string' && typeof body.kind === 'string' ? deskHandler(body.playbook, body.kind) : null;
    const run = handler?.[op] as ((deps: VentureDeps, ctx: Context, payload: Ops[Op][0]) => Promise<Ops[Op][1]>) | undefined;
    if (!run) throw new ChausarError('NOT_BUILT_YET', NOT_BUILT);
    return run.call(handler, deps, ctx, payload as Ops[Op][0]);
  };
}
