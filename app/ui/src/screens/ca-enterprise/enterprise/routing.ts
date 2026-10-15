/**
 * Which addresses the enterprise screens draw. This module is looked up before every other
 * lane's, so it claims only addresses the desktop shell never has (Company, Trust Channels,
 * Books Companies) and this lane's own sub-places. It never claims Trust Access, Markings or
 * Retention: the reports-tools-trust lane draws People, See and Keep there.
 */
import type { Address } from '../../../app/presentation.ts';

export const COMPANY_SUBS = ['signin', 'health', 'recovery', 'keys', 'support', 'computers', 'quality', 'build', 'licence'] as const;
export type CompanySub = (typeof COMPANY_SUBS)[number];

export type EnterpriseScreen = 'channels' | 'reviews' | 'teams' | 'holds' | 'edition' | 'companies';
export type EnterpriseRoute =
  | { readonly screen: 'company'; readonly sub: CompanySub | null }
  | { readonly screen: EnterpriseScreen };

const TRUST: ReadonlyMap<string, EnterpriseScreen> = new Map([
  ['channels', 'channels'], ['reviews', 'reviews'], ['teams', 'teams'], ['holds', 'holds'], ['edition', 'edition'],
]);

export function enterpriseRoute(a: Address): EnterpriseRoute | null {
  if (a.place === 'company') {
    if (a.sub === undefined) return { screen: 'company', sub: null };
    const sub = COMPANY_SUBS.find((s) => s === a.sub);
    return sub === undefined ? null : { screen: 'company', sub };
  }
  if (a.place === 'trust' && a.sub !== undefined) {
    const screen = TRUST.get(a.sub);
    return screen === undefined ? null : { screen };
  }
  if (a.place === 'books' && a.sub === 'companies') return { screen: 'companies' };
  return null;
}

export function handlesEnterprise(a: Address): boolean {
  return enterpriseRoute(a) !== null;
}
