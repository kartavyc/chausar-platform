/**
 * Handing the build brief to a builder, as the engine plans it (venture.build.handoff): Lovable and Replit get a link
 * that carries the brief, Bolt and v0 get it copied. The owner's click opens it; only after the browser took the link
 * or the copy worked does Chausar tell the engine it was opened (venture.build.handoffOpened). Nothing is sent from
 * here: the owner presses send in the builder.
 */

import { openExternal, reserveTab } from '../connections/external';
import { EngineError, type BuilderId, type EngineClient, type HandoffPlanLite } from '../../engine/types';

export const BUILDER_NAMES: Readonly<Record<BuilderId, string>> = { lovable: 'Lovable', replit: 'Replit', bolt: 'Bolt', v0: 'v0' };
export const BUILDERS = Object.keys(BUILDER_NAMES) as BuilderId[];

export interface HandOffResult { plan: HandoffPlanLite; done: 'opened' | 'copied' | 'planned' }

/** Call straight from the click, before anything else awaits: the web tab is opened inside it. */
export async function handOff(client: EngineClient, builder: BuilderId): Promise<HandOffResult> {
  const linked = builder === 'lovable' || builder === 'replit';
  const tab = linked ? reserveTab() : null;
  let plan: HandoffPlanLite;
  try {
    plan = await client.request('venture.build.handoff', { builder });
  } catch (error) {
    tab?.close();
    throw error;
  }
  if (plan.status === 'planned') {
    tab?.close();
    return { plan, done: 'planned' };
  }
  if (plan.mode === 'link') {
    await openExternal(plan.url, tab);
  } else {
    tab?.close();
    if (!navigator.clipboard?.writeText) throw new EngineError('COPY_FAILED', 'Copying is not open to this page.');
    await navigator.clipboard.writeText(plan.clipboardText ?? '');
  }
  await client.request('venture.build.handoffOpened', { handoffId: plan.handoffId });
  return { plan, done: plan.mode === 'link' ? 'opened' : 'copied' };
}
