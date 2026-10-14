import { createHash, randomBytes } from 'node:crypto';
import { check } from '../contracts.ts';

/**
 * Sign-in in the person's own browser with PKCE. Chausar never sees a password, and this file
 * holds no client secret: an open-source app cannot keep one. The authorization code is exchanged
 * by the host's credential broker, which also stores the token outside workspace state.
 */
export type OAuthProvider = { id: string; authorize(settings: Record<string, string>): string; scopes: Record<string, readonly string[]>; groups: readonly string[]; note: string };
const zohoAccounts = (dc: string) => { check(['com', 'eu', 'in', 'com.au', 'jp', 'ca'].includes(dc), 'REGION_REQUIRED', 'Choose the Zoho data centre.'); return `https://accounts.zoho.${dc}/oauth/v2/auth`; };
export const OAUTH_PROVIDERS: Readonly<Record<string, OAuthProvider>> = Object.freeze({
  google: { id: 'google', groups: ['google-workspace'], authorize: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    scopes: { sheets: ['https://www.googleapis.com/auth/drive.file'], drive: ['https://www.googleapis.com/auth/drive.file'], calendar: ['https://www.googleapis.com/auth/calendar.readonly'] },
    note: 'Sheets and Drive use drive.file: only files you pick or Chausar created. Calendar read needs Google\'s app verification.' },
  zoho: { id: 'zoho', groups: ['zoho-books', 'zoho-crm', 'zoho-inventory'], authorize: settings => zohoAccounts(settings.dataCenter ?? ''),
    scopes: { 'zoho-books': ['ZohoBooks.invoices.READ', 'ZohoBooks.customerpayments.READ', 'ZohoBooks.contacts.READ'], 'zoho-crm': ['ZohoCRM.modules.deals.READ'], 'zoho-inventory': ['ZohoInventory.salesorders.READ', 'ZohoInventory.items.READ'] },
    note: 'Zoho limits how fast anyone may ask; a first full read of a busy company takes time.' },
  hubspot: { id: 'hubspot', groups: ['hubspot'], authorize: () => 'https://app.hubspot.com/oauth/authorize', scopes: { hubspot: ['crm.objects.deals.read'] }, note: 'A private app token with read scopes also works.' },
  xero: { id: 'xero', groups: ['xero'], authorize: () => 'https://login.xero.com/identity/connect/authorize', scopes: { xero: ['openid', 'offline_access', 'accounting.invoices.read'] }, note: 'Read scopes only.' },
  quickbooks: { id: 'quickbooks', groups: ['quickbooks'], authorize: () => 'https://appcenter.intuit.com/connect/oauth2', scopes: { quickbooks: ['com.intuit.quickbooks.accounting'] }, note: 'Intuit grants one accounting scope; Chausar uses it for reads only.' },
  shopify: { id: 'shopify', groups: ['shopify'], authorize: settings => {
    check(/^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(settings.shop ?? ''), 'SHOP_REQUIRED', 'Enter the store\'s myshopify.com address.');
    return `https://${settings.shop}/admin/oauth/authorize`; }, scopes: { shopify: ['read_orders', 'read_products'] }, note: 'Read scopes only. Price and stock changes belong to the write catalogue and always wait for you.' },
});
/** Systems signed in with a key the person creates in the system itself, read-only where it allows. */
export const KEY_SIGN_IN: Readonly<Record<string, string>> = Object.freeze({
  razorpay: 'Create an API key in Razorpay with a read-only role and enter it in Trust, credentials.',
  stripe: 'Create a restricted key with read access to balance and payouts and enter it in Trust, credentials.',
  woocommerce: 'Create a REST API key with Read permission in WooCommerce and enter it in Trust, credentials.',
  cashfree: 'Create Cashfree API keys (client id and secret) and enter them as id:secret in Trust, credentials.',
  payu: 'Enter the PayU merchant key and salt as key:salt in Trust, credentials. The salt signs each request on this computer and is never sent.',
  tally: 'Tally needs no sign-in: switch on its XML interface on port 9000 on this computer.',
});
export function providerFor(group: string): OAuthProvider | null {
  return Object.values(OAUTH_PROVIDERS).find(provider => provider.groups.includes(group)) ?? null;
}
const base64url = (bytes: Buffer) => bytes.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export function pkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()), state: base64url(randomBytes(24)) };
}
export function authorizeUrl(provider: OAuthProvider, input: { clientId: string; redirectUri: string; scopes: readonly string[]; settings: Record<string, string>; challenge: string; state: string }): string {
  check(/^[A-Za-z0-9._~-]{4,200}$/.test(input.clientId), 'OAUTH_CLIENT_REQUIRED', 'A registered sign-in app is needed for this system.');
  const redirect = new URL(input.redirectUri);
  check((redirect.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(redirect.hostname)) || redirect.protocol === 'https:', 'OAUTH_REDIRECT_INVALID', 'Sign-in returns to this computer or to the registered helper page only.');
  const url = new URL(provider.authorize(input.settings));
  url.searchParams.set('response_type', 'code'); url.searchParams.set('client_id', input.clientId); url.searchParams.set('redirect_uri', redirect.href);
  url.searchParams.set('scope', input.scopes.join(provider.id === 'zoho' ? ',' : ' ')); url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.challenge); url.searchParams.set('code_challenge_method', 'S256');
  if (provider.id === 'google') { url.searchParams.set('access_type', 'offline'); url.searchParams.set('include_granted_scopes', 'false'); }
  if (provider.id === 'zoho') url.searchParams.set('access_type', 'offline');
  return url.href;
}
