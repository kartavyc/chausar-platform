/**
 * The fake engine's Start answers (W4 4J8), as the engine gives them: venture.playbooks.list, the ways to earn, with
 * the open sample business on its own way as "You run this" (platform/runtime/venture/core/ways.ts listWays and
 * openWayBusiness). The data is the engine's own, copied into fixtures-start.json (platform/tests/venture-ways.test.ts
 * pins it equal).
 */

import { EngineError, type WaysView } from './types';
import START from './fixtures-start.json';

const FAKE_WAYS = START.ways as unknown as WaysView;

/** The business open in the fake, as a way sees it: its id, name and the playbook its idea picks. */
export interface FakeOpenBusiness { businessId: string; name: string; playbook: string | null }

/** venture.playbooks.list {}: answered with no vault too; only the payload {} is taken. */
export function fakeWays(p: Record<string, unknown>, open: FakeOpenBusiness | null): WaysView {
  if (Object.keys(p).length) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  const view = structuredClone(FAKE_WAYS);
  if (open) for (const way of view.ways) if (way.playbook === open.playbook) way.yours = [{ businessId: open.businessId, name: open.name }];
  return view;
}
