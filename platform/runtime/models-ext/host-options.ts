/**
 * Trusted start-up options for the installed app, built once by the engine when the host passed
 * none (EngineModule.hostOptions). Everything comes from CHAUSAR_* environment variables set by
 * the person installing Chausar. Secrets never enter these options: plugin credentials name the
 * environment variable that holds the key, read only at request time. Development-only options
 * (a plugin signing key, a fixed clock, a fake transport) are never built here. A malformed value
 * is left out, so the feature refuses with its own typed code rather than starting half-configured.
 */
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

type Env = Readonly<Record<string, string | undefined>>;
const ENV_NAME = /^CHAUSAR_[A-Z0-9_]{1,64}$/;
const HEADER = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const PLUGIN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SITE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function json(text: string | undefined): unknown {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}
function jsonFile(path: string | undefined, maxBytes: number): unknown {
  if (!path || !isAbsolute(path)) return undefined;
  try { if (statSync(path).size > maxBytes) return undefined; return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
}

/**
 * `CHAUSAR_PLUGIN_CREDENTIALS`: [{ keyId, plugin, site, header, env: 'CHAUSAR_…' }]. A key is bound to the
 * publisher signing key id shown on the plugin review (64 hex) and the plugin name, never to the self-declared
 * publisher id, so only a plugin verified with that key can ever cause it to be sent.
 */
export function pluginCredentialBroker(raw: unknown, env: () => Env) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) return undefined;
  const rules = raw.filter((r: any) => r && typeof r === 'object' && Object.keys(r).sort().join() === 'env,header,keyId,plugin,site'
    && typeof r.keyId === 'string' && /^[a-f0-9]{64}$/.test(r.keyId) && typeof r.plugin === 'string' && r.plugin.length <= 64 && PLUGIN.test(r.plugin)
    && typeof r.site === 'string' && SITE.test(r.site) && typeof r.header === 'string' && HEADER.test(r.header) && typeof r.env === 'string' && ENV_NAME.test(r.env));
  if (rules.length !== raw.length) return undefined;
  return (key: { keyId: string; plugin: string; site: string }) => {
    const headers: Record<string, string> = {};
    for (const rule of rules) if (rule.keyId === key.keyId && rule.plugin === key.plugin && rule.site === key.site) {
      const value = env()[rule.env];
      if (typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\r\n]/.test(value)) headers[rule.header] = value;
    }
    return Object.keys(headers).length ? headers : null;
  };
}

export function modelsExtHostOptions(input: { readonly directory: string; readonly demo: boolean; readonly env: Env }): Readonly<Record<string, unknown>> {
  if (input.demo) return {};
  const env = input.env, options: Record<string, unknown> = {};
  if (env.CHAUSAR_BENCH_TRANSCRIPTS && isAbsolute(env.CHAUSAR_BENCH_TRANSCRIPTS)) options.benchTranscripts = env.CHAUSAR_BENCH_TRANSCRIPTS;
  const clips = jsonFile(env.CHAUSAR_SPEECH_BENCH_FIXTURES, 16 * 1024 * 1024);
  if (clips !== undefined) options.speechBench = clips;
  const keys = json(env.CHAUSAR_PLUGIN_PUBLISHER_KEYS);
  if (Array.isArray(keys) && keys.length <= 32 && keys.every((k: any) => k && typeof k.publisherId === 'string' && typeof k.publicKey === 'string'))
    options.publisherKeys = keys.map((k: any) => ({ publisherId: k.publisherId, publicKey: k.publicKey }));
  const broker = pluginCredentialBroker(json(env.CHAUSAR_PLUGIN_CREDENTIALS), () => process.env);
  if (broker) options.pluginCredentials = broker;
  return Object.freeze(options);
}
