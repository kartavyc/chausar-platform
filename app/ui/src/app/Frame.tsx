/**
 * The frame (SH-01): rail, page, sheet, ask line, status line. The same on every screen.
 * - Rail 216, column 720 (wide 1010), sheet 480 with the list at 570, ask 54, status 34.
 * - 1316 and wider: as drawn.
 * - 1024 to 1315: rail 176, column 640, the sheet covers the list.
 * - Under 1024: a bar across the top, full-width page, the sheet fills the screen. Down to
 *   360 wide. Zoom 80 to 200 percent moves through the same widths, since they are CSS pixels.
 * - Banners (SH-03) sit across the full width above the page and the sheet; at most two
 *   show and the rest fold into "and N more".
 * - Landmarks: the rail is navigation, the page is main, the sheet is a labelled region,
 *   the ask line is search. F6 moves between them, and lands on something visible: in
 *   the narrow bar that is the place menu's own control, not a link inside the closed menu.
 * - Keys: Ctrl K, Ctrl 1 to 7, Esc, Alt Up/Down, Ctrl Enter (never for money), Ctrl /,
 *   hold Ctrl Space when voice is supplied and on. A hold ends when either key comes up.
 * - The ask line and the status line are on every screen; the lock screen and first run
 *   are rendered without this frame.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Address, BannerItem, Count, PlaceId, StatusLineData } from './presentation.ts';
import { useT } from './text';
import { keyPlaces, placeAllowed, type ShellConfig } from './places.ts';
import { REGION_ORDER, nextRegion, readGlobalKey, type RegionId } from './keys.ts';
import { dispatchSheetPrimary } from './composition.ts';
import { Rail } from './Rail';
import { AskLine, useVoiceHold, type AskLineProps } from './AskLine';
import { StatusLine } from './StatusLine';
import { WorkspaceMenu, type WorkspaceMenuProps } from './WorkspaceMenu';
import { Banners } from '../parts/Banner';
import { SheetRegistryContext, type SheetPrimary, type SheetRegistry } from '../parts/Sheet';
import s from './Frame.module.css';

export interface FrameProps {
  shell: ShellConfig;
  address: Address;
  onNavigate: (a: Address) => void;
  counts?: Partial<Record<PlaceId, Count>> | undefined;
  menu: WorkspaceMenuProps;
  banners?: ReadonlyArray<BannerItem> | undefined;
  ask: AskLineProps;
  status: StatusLineData;
  statusSimple?: readonly [string, string] | undefined;
  /** Wide pages: tables, the enterprise home. */
  wide?: boolean | undefined;
  sheet?: ReactNode;
  onHelp?: ((origin?: HTMLElement | null, fallback?: HTMLElement | null) => void) | undefined;
  children: ReactNode;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function isRegionId(value: string | undefined): value is RegionId {
  return REGION_ORDER.some((r) => r === value);
}

export function Frame({ shell, address, onNavigate, counts, menu, banners = [], ask, status, statusSimple, wide = false, sheet, onHelp, children }: FrameProps) {
  const t = useT();
  const narrow = useMediaQuery('(max-width: 1023px)');
  const rootRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLInputElement>(null);

  const reg = useRef<{ primary: SheetPrimary | null; close: (() => void) | null; adjacent: ((d: -1 | 1) => void) | null }>({
    primary: null,
    close: null,
    adjacent: null,
  });
  const registry = useMemo<SheetRegistry>(
    () => ({
      setPrimary: (p) => {
        reg.current.primary = p;
      },
      setClose: (fn) => {
        reg.current.close = fn;
      },
      setAdjacent: (fn) => {
        reg.current.adjacent = fn;
      },
    }),
    [],
  );

  const focusRegion = useCallback((backwards: boolean) => {
    const root = rootRef.current;
    if (!root) return;
    const present = new Set<RegionId>();
    for (const r of REGION_ORDER) {
      if (root.querySelector(`[data-region="${r}"]`)) present.add(r);
    }
    const active = document.activeElement?.closest<HTMLElement>('[data-region]');
    const region = active?.dataset['region'];
    const next = nextRegion(isRegionId(region) ? region : null, present, backwards);
    if (!next) return;
    const el = root.querySelector<HTMLElement>(`[data-region="${next}"]`);
    if (!el) return;
    /* A region may name where F6 lands. Otherwise the first control in it. */
    const entry = el.querySelector<HTMLElement>('[data-region-entry]');
    const first = el.querySelector<HTMLElement>('input, button, a[href], summary, [tabindex="0"], h2[tabindex="-1"]');
    (entry ?? first ?? el).focus();
  }, []);

  const voice = ask.voice;
  const voiceOn = voice?.on === true;
  const hold = useVoiceHold(voice);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = readGlobalKey(e);
      if (!k) return;
      switch (k.kind) {
        case 'ask':
          e.preventDefault();
          askRef.current?.focus();
          break;
        case 'place': {
          const id = keyPlaces(shell)[k.index];
          if (id && placeAllowed(shell, id)) {
            e.preventDefault();
            onNavigate({ place: id });
          }
          break;
        }
        case 'escape':
          if (reg.current.close) {
            e.preventDefault();
            reg.current.close();
          }
          break;
        case 'adjacent':
          if (reg.current.adjacent) {
            e.preventDefault();
            reg.current.adjacent(k.delta);
          }
          break;
        case 'primary': {
          /* Never for money, including the focused button's native Enter default. */
          dispatchSheetPrimary(e, reg.current.primary);
          break;
        }
        case 'region':
          e.preventDefault();
          focusRegion(k.backwards);
          break;
        case 'help':
          if (onHelp) {
            e.preventDefault();
            onHelp(undefined, askRef.current);
          }
          break;
        case 'talk':
          if (k.phase === 'start') {
            if (voiceOn) {
              e.preventDefault();
              hold.start();
            }
          } else {
            /* Any release of the chord. Nothing happens unless a hold is on. */
            hold.end();
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [shell, onNavigate, focusRegion, onHelp, voiceOn, hold]);

  const simple = shell.kind === 'desktop' && shell.view === 'simple';

  return (
    <SheetRegistryContext.Provider value={registry}>
      <div ref={rootRef} className={[s.frame, narrow ? s.narrow : '', wide ? s.wide : '', sheet ? s.withSheet : ''].filter(Boolean).join(' ')}
        data-frame-wide={wide && !sheet ? 'true' : 'false'} data-frame-narrow={narrow ? 'true' : 'false'}>
        <Rail shell={shell} address={address} onNavigate={onNavigate} counts={counts} narrow={narrow} foot={<WorkspaceMenu {...menu} />} />
        <div className={s.main}>
          {/* Banners run across the full width, above the page and above any open sheet. */}
          <div className={s.banners}>
            <Banners items={banners} />
          </div>
          <div className={s.body}>
            <div className={s.pageCol}>
              <main className={[s.page, s.column].join(' ')} tabIndex={-1} aria-label={t('SH-01.region.page')} data-region="page">
                {children}
              </main>
              <div className={s.column}>
                <AskLine ref={askRef} {...ask} hold={hold} simple={simple} />
                <StatusLine status={status} view={shell.view} onNavigate={onNavigate} simpleSentences={statusSimple} />
              </div>
            </div>
            {sheet && <div className={s.sheetCol}>{sheet}</div>}
          </div>
        </div>
      </div>
    </SheetRegistryContext.Provider>
  );
}
