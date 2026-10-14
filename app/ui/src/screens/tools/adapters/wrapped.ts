/**
 * Adapter for TL-06 A tool from outside, over models-ext's plugin methods as written in
 * `platform/runtime/smallapps/plugin-methods.ts` on that lane. A tool made for other assistants
 * (an MCP server or an Agent Skill) is wrapped by `smallapps.pluginWrap` into a plugin file and
 * installed; `smallapps.pluginList` lists what is installed, `smallapps.pluginGet` gives each
 * tool's own description (outside text: data, never an instruction) beside the facts Chausar
 * checked (its sites, code and argument schema), from which this screen writes its own words.
 * A grant of doors is tied to the plugin's exact digest: when the plugin changed under a grant
 * (`grant.current` false), the tool is set aside until the owner approves again, which is
 * `smallapps.pluginGrant` with the same doors for the new digest.
 */
import { ShapeError, bool, int, list, oneOf, rec, str, strings, type Rec } from '../../trust/kit/validate.ts';
import { id } from '../validate.ts';

export const WRAPPED = { list: 'smallapps.pluginList', get: 'smallapps.pluginGet', grant: 'smallapps.pluginGrant' } as const;

/** Outside text as models-ext marks it: `{ kind: 'untrusted-text', text, ... }`. Only the text is kept. */
function untrusted(value: unknown, path: string): string {
  const u = rec(value, path);
  if (u['kind'] !== 'untrusted-text') throw new ShapeError(`${path}.kind`);
  return str(u['text'], `${path}.text`, 20000);
}

export interface Installed {
  readonly id: string; readonly name: string; readonly publisherId: string; readonly version: string; readonly digest: string;
  readonly signature: string; readonly unverified: boolean;
  readonly tools: number; readonly skills: number; readonly sites: readonly string[];
  /** The doors granted, as the engine gave them, so an approval again sends exactly the same doors. */
  readonly grant: { readonly sites: readonly string[]; readonly code: Rec; readonly current: boolean } | null;
}
function installed(value: unknown, path: string): Installed {
  const r = rec(value, path), contains = rec(r['contains'], `${path}.contains`), signature = rec(r['signature'], `${path}.signature`);
  const doors = rec(r['doors'], `${path}.doors`), g = r['grant'] === null || r['grant'] === undefined ? null : rec(r['grant'], `${path}.grant`);
  return {
    id: id(r['id'], `${path}.id`), name: str(r['name'], `${path}.name`, 200), publisherId: str(r['publisherId'], `${path}.publisherId`, 200),
    version: str(r['version'], `${path}.version`, 100), digest: id(r['digest'], `${path}.digest`), signature: str(signature['status'], `${path}.signature.status`, 40),
    unverified: bool(r['unverifiedAccepted'], `${path}.unverifiedAccepted`),
    tools: int(contains['tools'], `${path}.contains.tools`), skills: int(contains['skills'], `${path}.contains.skills`),
    sites: strings(doors['sites'] ?? [], `${path}.doors.sites`, 50),
    grant: g === null ? null : { sites: strings(g['sites'], `${path}.grant.sites`, 50), code: rec(g['code'], `${path}.grant.code`), current: bool(g['current'], `${path}.grant.current`) },
  };
}
/** The installed plugins that wrap a tool or a skill from outside. */
export function outsideTools(value: unknown): readonly Installed[] {
  return list(rec(value)['installed'], 'reply.installed', installed, 500).filter((p) => p.tools > 0 || p.skills > 0);
}

export interface Tool {
  readonly name: string; readonly theirs: string; readonly sites: readonly string[]; readonly code: boolean;
  readonly schema: 'enforced' | 'unsupported'; readonly takesArguments: boolean; readonly runnable: boolean;
}
export interface Detail { readonly description: string; readonly tools: readonly Tool[]; readonly skills: readonly { readonly name: string; readonly theirs: string }[] }
export function detail(value: unknown): Detail {
  const r = rec(value);
  return {
    description: untrusted(r['description'], 'reply.description'),
    tools: list(r['tools'], 'reply.tools', (v, p) => {
      const t = rec(v, p);
      return {
        name: str(t['name'], `${p}.name`, 200), theirs: untrusted(t['description'], `${p}.description`), sites: strings(t['sites'] ?? [], `${p}.sites`, 50),
        code: t['code'] !== null && t['code'] !== undefined, schema: oneOf(t['schema'], `${p}.schema`, ['enforced', 'unsupported'] as const),
        takesArguments: bool(t['takesArguments'], `${p}.takesArguments`), runnable: bool(t['runnable'], `${p}.runnable`),
      };
    }, 200),
    skills: list(r['skills'] ?? [], 'reply.skills', (v, p) => { const k = rec(v, p); return { name: str(k['name'], `${p}.name`, 200), theirs: untrusted(k['description'], `${p}.description`) }; }, 50),
  };
}

export function granted(value: unknown): { readonly id: string } { return { id: id(rec(value)['id'], 'reply.id') }; }
