import { holdReads } from '../engine/reads';
import { currentRoute, navigate } from './navigation';
import { EngineError, type EngineClient, type ParamsOf } from '../engine/types';

/**
 * Leaving the open business, and switching to another, as one safe operation (seen live on Windows, 15 Nov 2026:
 * workspace.lock answered, the window's own reads for the business being left arrived in the gap, and the
 * workspace.open 0.2 s later answered VAULT_BUSY, so the owner sat on Welcome back with nothing opening).
 *
 * The window stops asking first (reads.ts holdReads), then locks. The engine waits for the reads already on their way
 * (engine.ts requestsEnded). Nothing is asked between the lock and the open, and an open the engine still calls busy is
 * tried again a few times, a little later each time. Hosted keeps one session per browser and switches it itself, so
 * there it is the open alone.
 */

/** How long to wait before each new try of an open the engine called busy. */
export const SWITCH_RETRY_MS: readonly number[] = [300, 700, 1500];

const busy = (error: unknown) => error instanceof EngineError && error.code === 'VAULT_BUSY';
const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * `left: false`: the lock was refused and nothing changed; the pages read again. `left: true`: the business is closed
 * and the reads asked for meanwhile were dropped, so the caller shows what comes next (another business, Welcome back,
 * the first run).
 */
export type Left = { left: true } | { left: false; error: unknown };

/** Stops the window's reads, then locks the open business. */
export async function leaveBusiness(client: EngineClient): Promise<Left> {
  const held = holdReads(client);
  try { await client.request('workspace.lock', {}); }
  catch (error) { held.release(); return { left: false, error }; }
  held.drop();
  return { left: true };
}

/**
 * Opens a business, trying again a few times when the engine calls it busy (a request of the window's own may still
 * be on its way). Any other refusal, and a busy one that stays, is thrown as the engine said it.
 */
export async function openBusiness(client: EngineClient, to: ParamsOf<'workspace.open'>, wait: (ms: number) => Promise<void> = pause): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await client.request('workspace.open', to); return; }
    catch (error) {
      const again = SWITCH_RETRY_MS[attempt];
      if (!busy(error) || again === undefined) throw error;
      await wait(again);
    }
  }
}

/**
 * `opened`: the other business is open. `stage: 'lock'`: nothing changed, the business the owner was in is still open.
 * `stage: 'open'`: that business is closed and the other did not open; `error` says why, and Welcome back offers every
 * way in.
 */
export type Switched = { opened: true } | { opened: false; stage: 'lock' | 'open'; error: unknown };

export async function switchBusiness(client: EngineClient, to: ParamsOf<'workspace.open'>, options: { wait?: (ms: number) => Promise<void> } = {}): Promise<Switched> {
  const wait = options.wait ?? pause;
  if (client.transport === 'hosted') {
    // No lock to hold reads across, but the answers about the business just left are forgotten the same way.
    try { await client.request('workspace.open', to); holdReads(client).drop(); dropBusinessFilter(); return { opened: true }; }
    catch (error) { return { opened: false, stage: 'lock', error }; }
  }
  const held = holdReads(client);
  try { await client.request('workspace.lock', {}); }
  catch (error) { held.release(); return { opened: false, stage: 'lock', error }; }
  try { await openBusiness(client, to, wait); dropBusinessFilter(); return { opened: true }; }
  catch (error) { return { opened: false, stage: 'open', error }; }
  finally { held.drop(); }
}

/**
 * Today's filter for one business (`show=business:<id>`) names the business the owner looked at before the switch
 * (seen on Windows, 15 Nov 2026: it stayed in the address, so Today opened on the business just left, which by then
 * showed only its locked row). Another business is open now: the filter leaves the address and Today shows All.
 */
function dropBusinessFilter(): void {
  const route = currentRoute();
  if (!route.query.show?.startsWith('business:')) return;
  const { show: _show, ...rest } = route.query;
  navigate({ ...route, query: rest });
}
