/**
 * App: the composition root. It owns the address (the hash), sets the root attributes
 * for view, language and the picture-only theme override, and places the Today screen
 * inside the frame. Everything it shows arrives as props from the integration adapter;
 * nothing here reads the bridge, a file, a key or local storage.
 *
 * Every address is passed through the shell's gate before anything is drawn or stored:
 * an incoming hash, a press in the rail and a key all resolve the same way, so a place
 * or sub-place outside the shell or the role's grant list is never shown.
 *
 * While locked, the lock screen is the whole app. The frame, the page, the sheet and
 * everything else from the workspace are not rendered at all, so nothing sits beneath it.
 *
 * Places whose screens are not in this slice render the "not built yet" state with the
 * capability the adapter supplied, or whatever `renderPlace` returns for a legacy journey
 * the adapter keeps alive. No old screen is removed by this file.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import type { Address, BannerItem, Capability, Count, Language, PlaceId, ScreenState, StatusLineData, View } from './presentation.ts';
import { TextProvider, useT } from './text';
import { parseAddress, formatAddress, sameAddress } from './routes.ts';
import { resolveAddress, type ShellKind, type ShellConfig } from './places.ts';
import { sheetAtAddress, workspaceLocked, type AddressBoundSheet } from './composition.ts';
import { Frame } from './Frame';
import { useIdleLock } from './useIdleLock.ts';
import { LockScreen, type LockScreenProps } from './LockScreen';
import type { AskLineProps } from './AskLine';
import type { WorkspaceMenuProps } from './WorkspaceMenu';
import { State } from '../patterns/States';
import { TodayScreen, type TodayScreenProps } from '../screens/today/Today';
import lockStyle from './LockScreen.module.css';

export interface AppProps {
  shellKind: ShellKind;
  administers?: boolean | undefined;
  allowed?: ReadonlySet<string> | undefined;
  view: View;
  language: Language;
  /** Pictures only. The app follows the computer's setting. */
  themeOverride?: 'light' | 'dark' | undefined;
  /** When set, the lock screen is shown and nothing from the workspace is rendered. */
  lock?: LockScreenProps | null | undefined;
  menu: Omit<WorkspaceMenuProps, 'view' | 'language'>;
  counts?: Partial<Record<PlaceId, Count>> | undefined;
  banners?: ReadonlyArray<BannerItem> | undefined;
  ask: AskLineProps;
  status: StatusLineData;
  statusSimple?: readonly [string, string] | undefined;
  capabilities: Partial<Record<PlaceId, Capability>>;
  today: Omit<TodayScreenProps, 'view' | 'sheetId' | 'onNavigate'>;
  /** A host reply bound to the exact authorized address it was read for. */
  sheet?: AddressBoundSheet<ReactNode> | undefined;
  /** Legacy journeys and screens outside this slice, by address. */
  renderPlace?: ((address: Address) => ReactNode) | undefined;
  /** A replaced consent sheet supplies its true opener and a stable fallback. */
  onHelp?: ((origin?: HTMLElement | null, fallback?: HTMLElement | null) => void) | undefined;
  /** Called for initial, keyboard and history addresses. Null means no private surface. */
  onAddress?: ((address: Address | null) => void) | undefined;
  /** Idle auto-lock (SH-02): `todayx.shell` autoLockMinutes and the host's lock. Off while locked. */
  idleLock?: { readonly minutes: number; readonly onIdle: () => void } | undefined;
}

function readHash(): Address {
  return parseAddress(typeof window !== 'undefined' ? window.location.hash : '');
}

/** Public fallback; it deliberately has no workspace identity, counts or cached data. */
function WorkspaceUnavailable({ locked }: { locked: boolean }) {
  const t = useT();
  return (
    <main className={lockStyle.lock}>
      <div className={lockStyle.form}>
        <h1 className={lockStyle.title}>{t(locked ? 'ST.locked' : 'ST.noAccess')}</h1>
      </div>
    </main>
  );
}

export function App(p: AppProps) {
  const { shellKind, view, administers, allowed, onAddress } = p;
  const shell = useMemo<ShellConfig>(() => ({ kind: shellKind, view, administers, allowed }), [shellKind, view, administers, allowed]);
  const [address, setAddress] = useState<Address>(readHash);
  /* Recheck on every render, including a host refreshing the same grant-set object. */
  const safeAddress = resolveAddress(shell, address);
  const locked = p.lock != null || workspaceLocked(p.today.data.state);
  const activeAddressKey = locked || safeAddress === null ? null : formatAddress(safeAddress);
  const activeAddress = useMemo(() => activeAddressKey === null ? null : parseAddress(activeAddressKey), [activeAddressKey]);
  const idleOnIdle = p.idleLock?.onIdle;
  useIdleLock({ minutes: p.idleLock?.minutes ?? 0, onIdle: () => idleOnIdle?.(), enabled: p.idleLock !== undefined && !locked });

  useEffect(() => {
    const onHash = () => {
      const next = readHash();
      setAddress((current) => sameAddress(current, next) ? current : next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = p.language;
    if (p.view === 'guided') root.removeAttribute('data-view');
    else root.setAttribute('data-view', p.view);
    if (p.themeOverride) root.setAttribute('data-theme', p.themeOverride);
    else root.removeAttribute('data-theme');
  }, [p.language, p.view, p.themeOverride]);

  useLayoutEffect(() => {
    onAddress?.(activeAddress);
  }, [activeAddress, onAddress]);

  const navigate = useCallback(
    (a: Address) => {
      const target = resolveAddress(shell, a);
      if (target === null) return;
      if (!sameAddress(target, address)) {
        window.location.hash = formatAddress(target);
        setAddress(target);
      }
    },
    [address, shell],
  );

  if (locked) {
    return (
      <TextProvider language={p.language}>
        {p.lock ? <LockScreen {...p.lock} /> : <WorkspaceUnavailable locked />}
      </TextProvider>
    );
  }

  if (safeAddress === null) {
    return <TextProvider language={p.language}><WorkspaceUnavailable locked={false} /></TextProvider>;
  }

  /* What the hash says and which host reply arrived are both checked before display. */
  const sheet = sheetAtAddress(safeAddress, p.sheet);
  let page: ReactNode;
  let wide = false;

  if (safeAddress.place === 'today' && p.shellKind !== 'ca-firm' && (safeAddress.sub === undefined || safeAddress.sub === 'today')) {
    page = <TodayScreen {...p.today} view={p.view} sheetId={safeAddress.sheet} onNavigate={navigate} />;
    wide = p.view === 'books' || p.shellKind === 'enterprise';
  } else {
    const legacy = p.renderPlace?.(safeAddress);
    const capability = p.capabilities[safeAddress.place];
    const notBuilt: ScreenState = capability !== undefined ? { kind: 'not-built', capability } : { kind: 'not-built' };
    page = legacy ?? <State state={notBuilt} />;
  }

  return (
    <TextProvider language={p.language}>
      <Frame
        shell={shell}
        address={safeAddress}
        onNavigate={navigate}
        counts={p.counts}
        menu={{ ...p.menu, view: p.view, language: p.language }}
        banners={p.banners}
        ask={p.ask}
        status={p.status}
        statusSimple={p.statusSimple}
        wide={wide}
        sheet={sheet}
        onHelp={p.onHelp}
      >
        {page}
      </Frame>
    </TextProvider>
  );
}
