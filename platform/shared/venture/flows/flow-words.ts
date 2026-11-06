// Chausar venture launcher, recorded flows (wave 6, package 6H2; DECISIONS D41): the words and the site rule that the
// engine (flows/recipe.ts, flows/methods.ts) and the Ink app's fake engine share, so the two cannot drift. Browser-safe:
// nothing here imports Node or the engine (fetch-policy-core.ts is pure data).
import { FETCH_POLICY_HOSTS } from '../build/fetch-policy-core.ts';

export const FLOW_WORDS = Object.freeze({
  action: 'Choose a flow action.',
  name: 'Give the flow a short name.',
  url: 'Open a web address that starts with https.',
  credentials: 'A recorded flow never keeps a name or password in its address.',
  site: 'A recorded flow works on an https site, or on this computer only.',
  browser: 'Recorded flows run in the Chausar desktop app, in its own browser window.',
  flow: 'Choose one of your recorded flows.',
  version: 'Choose a version of this flow.',
  run: 'Choose one of your flow runs.',
  app: 'Approve this inside the Chausar app.',
  barred: 'This site does not allow automated use, so Chausar never records or runs a flow on it. Do it yourself there.',
});

/** Why a web address cannot be a flow's site, or null: https on a public name, or http on this computer's loopback only. */
export function originProblem(url: unknown): string | null {
  let parsed: URL;
  try { parsed = new URL(String(url)); } catch { return FLOW_WORDS.url; }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const privateLiteral = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/.test(host) || /^(?:fc|fd|fe8)/.test(host);
  if (parsed.username || parsed.password) return FLOW_WORDS.credentials;
  // A site whose terms bar automated use (LinkedIn first: a hard stop no setting unlocks), as the page reader keeps it.
  if (FETCH_POLICY_HOSTS.some(name => host === name || host.endsWith(`.${name}`))) return FLOW_WORDS.barred;
  if ((parsed.protocol === 'https:' && !privateLiteral) || (parsed.protocol === 'http:' && loopback)) return null;
  return FLOW_WORDS.site;
}
