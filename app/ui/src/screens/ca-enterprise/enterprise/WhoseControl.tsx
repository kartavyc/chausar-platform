/**
 * Whose (enterprise part 1): Mine, My team, Everyone at the top right of a list, kept per list
 * by the engine (`enterprise.whose.get` / `enterprise.whose.set { list }`).
 *
 * Cross-lane offer: any list in the enterprise shell may draw `<WhoseControl rpc list onChange />`
 * (or use `useWhose`) with its own stable list id, and filter its rows by the choice. "My team"
 * resolves to member ids with `useWhoseMembers` (`enterprise.whose.members`; null = no filter).
 * Without the engine method the choice still works for the visit and is simply not kept.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { WhoseRow } from '../../../patterns/Lens';
import type { PlaceRpc } from '../../../places/types.ts';
import { validateWhose, type WhoseValue } from './validate.ts';

export function useWhose(rpc: PlaceRpc, list: string, initial: WhoseValue = 'everyone'): [WhoseValue, (next: WhoseValue) => void] {
  const [whose, setWhose] = useState<WhoseValue>(initial);
  const touched = useRef(false);
  useEffect(() => {
    let alive = true;
    touched.current = false;
    rpc.request('enterprise.whose.get', { list }).then((reply) => {
      if (!alive || touched.current) return;
      try { const v = validateWhose(reply); if (v.list === list) setWhose(v.whose); } catch { /* keep the default */ }
    }, () => {});
    return () => { alive = false; };
  }, [rpc, list]);
  const choose = useCallback((next: WhoseValue) => {
    touched.current = true;
    setWhose(next);
    rpc.request('enterprise.whose.set', { list, whose: next }).then(() => {}, () => {});
  }, [rpc, list]);
  return [whose, choose];
}

/** The member ids "Mine" or "My team" stands for; null means no filter (Everyone, or not known yet). */
export function useWhoseMembers(rpc: PlaceRpc, whose: WhoseValue, self: string): ReadonlySet<string> | null {
  const [team, setTeam] = useState<{ ids: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (whose !== 'team') return;
    let alive = true;
    setTeam(null);
    rpc.request('enterprise.whose.members', { whose }).then((reply) => {
      if (!alive || reply === null || typeof reply !== 'object') return;
      const ids = (reply as { memberIds?: unknown }).memberIds;
      if (ids === null) setTeam(null);
      else if (Array.isArray(ids) && ids.every((x) => typeof x === 'string')) setTeam({ ids: new Set(ids as string[]) });
    }, () => {});
    return () => { alive = false; };
  }, [rpc, whose]);
  if (whose === 'mine') return new Set([self]);
  if (whose === 'team') return team?.ids ?? null;
  return null;
}

export function WhoseControl({ rpc, list, onChange, className }: { rpc: PlaceRpc; list: string; onChange?: ((whose: WhoseValue) => void) | undefined; className?: string | undefined }) {
  const [whose, choose] = useWhose(rpc, list);
  const reported = useRef<WhoseValue | null>(null);
  useEffect(() => { if (reported.current !== whose) { reported.current = whose; onChange?.(whose); } }, [whose, onChange]);
  return <WhoseRow value={whose} onChange={choose} className={className} />;
}
