/**
 * Host wiring for the ca-enterprise lane: what the trusted host passes to `App` beyond the
 * desktop defaults. It reads `caent.shell` once per authorized context (the shell kind, whether
 * this person administers the installation, the role's grants, the views and the role's home),
 * and in the enterprise shell the lens and the group's companies. In every shell it reads
 * `castatus.inside`: a member holding a client's `ca` or `accountant` seat sees the CA-03 banner.
 *
 * Every reply is checked before it is used. A reply that fails its check, or an engine that has
 * no such method yet (UNKNOWN_METHOD and the like), leaves the desktop defaults in place, so the
 * desktop app is unchanged when the engine has no lane method. `home` is exposed and never
 * navigated to here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address, BannerItem, Language, Lens, PlaceId, View } from '../../app/presentation.ts';
import type { ShellKind } from '../../app/places.ts';
import { date } from '../../format/dates.ts';
import type { PlaceRpc } from '../../places/types.ts';
import type { TodayData, TodayIntents } from '../today/TodayData.ts';
import { ISO_DATE, SHELL_KINDS, validateCompanies, type Companies } from './enterprise/validate.ts';

export interface ShellFacts {
  readonly kind: ShellKind;
  readonly administers: boolean;
  /** "place.sub" grants, or null for no gate. */
  readonly allowed: ReadonlyArray<string> | null;
  readonly views: ReadonlyArray<View> | null;
  readonly home: Address | null;
}

export const DESKTOP_FACTS: ShellFacts = { kind: 'desktop', administers: false, allowed: null, views: null, home: null };

const VIEWS: ReadonlyArray<View> = ['simple', 'guided', 'books'];
const PLACES: ReadonlyArray<PlaceId> = ['today', 'ask', 'work', 'books', 'reports', 'tools', 'trust', 'company', 'clients'];
const SLUG = /^[a-z][a-z0-9-]{0,63}$/;
const GRANT = /^[a-z][a-z-]{0,31}\.[a-z][a-z0-9-]{0,63}$/;
const LENSES: ReadonlyArray<Lens> = ['whole-group', 'finance', 'sales', 'operations'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `caent.shell`, checked; null when any part does not match the contract. */
export function validateShellFacts(reply: unknown): ShellFacts | null {
  if (!isObj(reply)) return null;
  const { kind, administers, allowed, views, home } = reply;
  if (typeof kind !== 'string' || !(SHELL_KINDS as readonly string[]).includes(kind)) return null;
  if (typeof administers !== 'boolean') return null;
  if (allowed !== null && !(Array.isArray(allowed) && allowed.length <= 500 && allowed.every((g) => typeof g === 'string' && GRANT.test(g)))) return null;
  if (views !== null && !(Array.isArray(views) && views.length > 0 && views.every((v) => typeof v === 'string' && (VIEWS as readonly string[]).includes(v))
    && new Set(views).size === views.length)) return null;
  let at: Address | null = null;
  if (home !== null) {
    if (!isObj(home) || typeof home.place !== 'string' || !(PLACES as readonly string[]).includes(home.place)) return null;
    if (home.sub !== undefined && (typeof home.sub !== 'string' || !SLUG.test(home.sub))) return null;
    at = home.sub === undefined ? { place: home.place as PlaceId } : { place: home.place as PlaceId, sub: home.sub as string };
  }
  return {
    kind: kind as ShellKind, administers, allowed: allowed === null ? null : [...new Set(allowed as string[])],
    views: views === null ? null : (views as View[]), home: at,
  };
}

export function validateLens(reply: unknown): { lens: Lens; lenses: ReadonlyArray<Lens> } | null {
  if (!isObj(reply)) return null;
  const { lens, lenses } = reply;
  const known = (v: unknown): v is Lens => typeof v === 'string' && (LENSES as readonly string[]).includes(v);
  if (!known(lens) || !Array.isArray(lenses) || lenses.length > LENSES.length || !lenses.every(known)) return null;
  return { lens, lenses };
}

export type InsideFacts =
  | { readonly inside: false }
  | { readonly inside: true; readonly firmName: string | null; readonly workspaceName: string; readonly seat: 'ca' | 'accountant'; readonly endsOn: string | null; readonly can: ReadonlyArray<'read' | 'export' | 'prepare'> };

/** `castatus.inside`, checked; null when it does not match the contract. */
export function validateInside(reply: unknown): InsideFacts | null {
  if (!isObj(reply) || typeof reply.inside !== 'boolean') return null;
  if (!reply.inside) return { inside: false };
  const { firmName, workspaceName, seat, endsOn, can } = reply;
  const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
  if (firmName !== null && !text(firmName)) return null;
  if (!text(workspaceName)) return null;
  if (seat !== 'ca' && seat !== 'accountant') return null;
  if (endsOn !== null && !(typeof endsOn === 'string' && ISO_DATE.test(endsOn) && !Number.isNaN(Date.parse(`${endsOn}T00:00:00Z`)))) return null;
  if (!Array.isArray(can) || can.length > 3 || !can.every((c) => c === 'read' || c === 'export' || c === 'prepare')) return null;
  return { inside: true, firmName: firmName as string | null, workspaceName, seat, endsOn: endsOn as string | null, can: can as Array<'read' | 'export' | 'prepare'> };
}

/**
 * The CA-03 banner: "<workspace>, a client of <firm>. <seat words> until <date>." It is drawn
 * through the existing read-only banner kind with this lane's own sentence (`textKey`): the
 * banner part offers no "Back to clients" action word, so no action is attached.
 */
export function insideBanner(inside: InsideFacts | null, language: Language): BannerItem | null {
  if (inside === null || !inside.inside) return null;
  return {
    kind: 'read-only', textKey: 'ENX-ca03.banner',
    values: {
      workspace: inside.workspaceName, firm: inside.firmName ?? '', hasFirm: inside.firmName === null ? 'no' : 'yes',
      seat: inside.seat, dated: inside.endsOn === null ? 'no' : 'yes', date: inside.endsOn === null ? '' : date(inside.endsOn, 'short', language),
    },
  };
}

export interface CaEnterpriseMenu {
  readonly companies?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly companyId?: string;
  readonly onSwitchCompany?: (id: string) => void;
  readonly views?: ReadonlyArray<View>;
}

export interface CaEnterpriseShell {
  readonly kind: ShellKind;
  /** Undefined on the desktop, so `App` sees exactly what it saw before. */
  readonly administers: boolean | undefined;
  readonly allowed: ReadonlySet<string> | undefined;
  readonly home: Address | null;
  readonly menu: CaEnterpriseMenu;
  readonly banners: ReadonlyArray<BannerItem>;
  readonly lens: Lens | null;
  readonly onLens: ((lens: Lens) => void) | undefined;
  /** Today with the lens added in the enterprise shell; unchanged otherwise. */
  withToday<T extends { readonly data: TodayData; readonly intents: TodayIntents }>(today: T): T;
}

/** Reads the lane's shell facts for `key` (the authorized context) and again when it changes. */
export function useCaEnterpriseShell(rpc: PlaceRpc, key: string, language: Language = 'en'): CaEnterpriseShell {
  const [facts, setFacts] = useState<ShellFacts>(DESKTOP_FACTS);
  const [lens, setLens] = useState<Lens | null>(null);
  const [group, setGroup] = useState<Companies | null>(null);
  const [inside, setInside] = useState<InsideFacts | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const current = () => generation.current === mine;
    setFacts(DESKTOP_FACTS); setLens(null); setGroup(null); setInside(null);
    rpc.request('caent.shell', {}).then((reply) => {
      if (!current()) return;
      const checked = validateShellFacts(reply) ?? DESKTOP_FACTS;
      setFacts(checked);
      if (checked.kind !== 'enterprise') return;
      rpc.request('enterprise.lens.get', {}).then((r) => { if (current()) setLens(validateLens(r)?.lens ?? null); }, () => {});
      rpc.request('enterprise.companies', {}).then((r) => { if (current()) setGroup(checkedCompanies(r)); }, () => {});
    }, () => { if (current()) setFacts(DESKTOP_FACTS); });
    rpc.request('castatus.inside', {}).then((r) => { if (current()) setInside(validateInside(r)); }, () => {});
    return () => { generation.current++; };
  }, [rpc, key]);

  const enterprise = facts.kind === 'enterprise';
  const onLens = useCallback((next: Lens) => {
    const mine = generation.current;
    rpc.request('enterprise.lens.set', { lens: next }).then((r) => { if (generation.current === mine) { const v = validateLens(r); if (v !== null) setLens(v.lens); } }, () => {});
  }, [rpc]);
  const onSwitchCompany = useCallback((id: string) => {
    const mine = generation.current;
    rpc.request('enterprise.company.set', { id }).then((r) => { if (generation.current === mine) { const v = checkedCompanies(r); if (v !== null) setGroup(v); } }, () => {});
  }, [rpc]);

  const allowedKey = enterprise && facts.allowed !== null ? JSON.stringify([...facts.allowed].sort()) : null;
  const allowed = useMemo(() => (allowedKey === null ? undefined : new Set<string>(JSON.parse(allowedKey) as string[])), [allowedKey]);
  const banner = useMemo(() => insideBanner(inside, language), [inside, language]);
  const banners = useMemo(() => (banner === null ? [] : [banner]), [banner]);

  const menu: CaEnterpriseMenu = !enterprise ? {} : {
    views: facts.views ?? ['guided', 'books'],
    ...(group !== null ? { companies: group.companies, companyId: group.chosen, onSwitchCompany } : {}),
  };
  const lensNow = enterprise ? lens : null;
  const withToday = <T extends { readonly data: TodayData; readonly intents: TodayIntents }>(today: T): T => {
    if (lensNow === null) return today;
    return { ...today, data: { ...today.data, enterprise: { ...today.data.enterprise, lens: lensNow } }, intents: { ...today.intents, onLens } };
  };
  return {
    kind: facts.kind, administers: facts.kind === 'desktop' ? undefined : facts.administers, allowed, home: facts.home,
    menu, banners, lens: lensNow, onLens: lensNow === null ? undefined : onLens, withToday,
  };
}

function checkedCompanies(reply: unknown): Companies | null {
  try { return validateCompanies(reply); } catch { return null; }
}
