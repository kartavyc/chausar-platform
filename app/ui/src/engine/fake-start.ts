/**
 * The fake engine's Start answers (W4 4J8), as the engine gives them: venture.playbooks.list, the ways to earn, with
 * the open sample business on its own way as "You run this" (platform/runtime/venture/core/ways.ts listWays and
 * openWayBusiness); and the setup checklist venture.get carries, each item with its name and link (core/checklist.ts).
 * The data is the engine's own, copied into fixtures-start.json (platform/tests/venture-ways.test.ts pins it equal).
 */

import { EngineError, type ChecklistItemLite, type WaysView } from './types';
import START from './fixtures-start.json';

const FAKE_WAYS = START.ways as unknown as WaysView;
const FAKE_CHECKLIST: readonly { id: string; label: string; link: string }[] = START.checklist;

/** The business open in the fake, as a way sees it: its id, name and the playbook its idea picks. */
export interface FakeOpenBusiness { businessId: string; name: string; playbook: string | null }

/** venture.playbooks.list {}: answered with no vault too; only the payload {} is taken. */
export function fakeWays(p: Record<string, unknown>, open: FakeOpenBusiness | null): WaysView {
  if (Object.keys(p).length) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  const view = structuredClone(FAKE_WAYS);
  if (open) for (const way of view.ways) if (way.playbook === open.playbook) way.yours = [{ businessId: open.businessId, name: open.name }];
  return view;
}

/** The checklist venture.get carries: the engine's items, the first `done` of them done (the fake keeps a count only). */
export function fakeChecklist(done: number): ChecklistItemLite[] {
  return FAKE_CHECKLIST.map((item, index) => ({ ...item, done: index < done }));
}
