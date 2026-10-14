/**
 * The frame's own reads: `todayx.shell`, `todayx.status`, `todayx.worthALook`,
 * `todayx.capabilities`, `todayx.help` and `todayx.closing`, read once per authorized context and again on
 * request. Every reply is checked against the contract before it is kept; a reply that
 * fails the check, or a method the engine does not have yet, leaves that read `null`, so the
 * frame keeps its existing words rather than drawing unchecked data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaceRpc } from '../places/types.ts';
import {
  isCapabilitiesReply, isClosingReply, isHelpReply, isShellReply, isStatusReply, isWorthReply,
  type CapabilitiesReply, type ClosingReply, type HelpReply, type ShellReply, type StatusReply, type WorthReply,
} from '../bridge/todayx-contract.ts';

export interface FrameReads {
  readonly shell: ShellReply | null;
  readonly status: StatusReply | null;
  readonly worth: WorthReply | null;
  readonly capabilities: CapabilitiesReply | null;
  readonly help: HelpReply | null;
  /** `todayx.closing`: the daily closing row's reply (TD-01). */
  readonly closing: ClosingReply | null;
}

const EMPTY: FrameReads = { shell: null, status: null, worth: null, capabilities: null, help: null, closing: null };

const READS = [
  ['shell', 'todayx.shell', isShellReply],
  ['status', 'todayx.status', isStatusReply],
  ['worth', 'todayx.worthALook', isWorthReply],
  ['capabilities', 'todayx.capabilities', isCapabilitiesReply],
  ['help', 'todayx.help', isHelpReply],
  ['closing', 'todayx.closing', isClosingReply],
] as const;

/** Reads the frame's facts for `key` (the authorized context). `reread` reads them again. */
export function useFrameReads(rpc: PlaceRpc, key: string): { reads: FrameReads; reread: () => void; setShell: (reply: unknown) => void } {
  const [reads, setReads] = useState<FrameReads>(EMPTY);
  const generation = useRef(0);
  const read = useCallback(() => {
    const mine = ++generation.current;
    for (const [field, method, valid] of READS) {
      rpc.request(method, {}).then(
        reply => { if (generation.current === mine && valid(reply)) setReads(current => ({ ...current, [field]: reply })); },
        () => { if (generation.current === mine) setReads(current => ({ ...current, [field]: null })); },
      );
    }
  }, [rpc]);
  useEffect(() => { setReads(EMPTY); read(); return () => { generation.current++; }; }, [read, key]);
  const setShell = useCallback((reply: unknown) => { if (isShellReply(reply)) setReads(current => ({ ...current, shell: reply })); }, []);
  return { reads, reread: read, setShell };
}
