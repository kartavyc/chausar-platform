/**
 * Wrappers that turn add-ons people already have (Agent Skills `SKILL.md` folders and MCP
 * `tools/list` results) into parts of an unsigned `chausar.plugin.v1` document for review.
 * Nothing here runs outside code: scripts are refused, instructions stay data, and an MCP tool
 * runs only when the package carries WebAssembly code for it.
 */
import { check } from '../contracts.ts';
import { digest } from '../actions.ts';
import { DATA_KINDS, LIMITS, PLUGIN_FORMAT, isScript, safePath } from './plugin-format.ts';
import type { CodeEntry, DataEntry, DataKind, PluginDocument, SkillEntry, ToolEntry, Words } from './plugin-format.ts';
import { NETWORK_LIMITS, requestShapeValid } from './plugin-network.ts';
import type { RequestSpec } from './plugin-network.ts';
import { schemaProblems } from './plugin-schema.ts';
import { parseRemote } from './plugin-mcp.ts';
import type { McpEndpoint } from './plugin-mcp.ts';

export type Refused = { path: string; code: string; words: Words };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const plain = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const unquote = (value: string) => { const v = value.trim(); return (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) ? v.slice(1, -1) : v; };

/** A small YAML-subset reader for skill frontmatter: scalars, flow lists, block lists and one level of nested map. */
export function parseFrontmatter(markdown: string): { fields: Record<string, string | string[] | Record<string, string>>; body: string } {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  check(match, 'PLUGIN_SKILL_INVALID', 'A SKILL.md file starts with a frontmatter block between --- lines.');
  const fields: Record<string, string | string[] | Record<string, string>> = {}; let open: string | null = null;
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const item = /^\s+-\s*(.*)$/.exec(line); const nested = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line); const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (item && open) { const current = fields[open]; check(Array.isArray(current) || current === '', 'PLUGIN_SKILL_INVALID', 'The frontmatter mixes lists and values.'); fields[open] = [...(Array.isArray(current) ? current : []), unquote(item[1])]; continue; }
    if (nested && open) { const current = fields[open]; check(plain(current) || current === '', 'PLUGIN_SKILL_INVALID', 'The frontmatter mixes maps and values.'); fields[open] = { ...(plain(current) ? current : {}), [nested[1]]: unquote(nested[2]) }; continue; }
    check(top, 'PLUGIN_SKILL_INVALID', 'The frontmatter has a line this reader does not understand.');
    check(!Object.hasOwn(fields, top[1]), 'PLUGIN_SKILL_INVALID', 'The frontmatter repeats a field.');
    const value = top[2].trim();
    if (value === '') { fields[top[1]] = ''; open = top[1]; continue; }
    open = null;
    fields[top[1]] = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1).split(',').map(unquote).filter(Boolean) : unquote(value);
  }
  return { fields, body: normalized.slice(match[0].length) };
}

/** Wrap an Agent Skills `SKILL.md` plus its bundled text files. Scripts are refused, never carried. */
export function wrapAgentSkill(skillMd: unknown, files: unknown = {}): { skill: SkillEntry; refused: Refused[]; ignoredFields: string[] } {
  check(typeof skillMd === 'string' && skillMd.length <= LIMITS.text + 4096, 'PLUGIN_SKILL_INVALID', 'Provide the SKILL.md text, at most 64 KiB.');
  check(plain(files) && Object.keys(files).length <= 64, 'PLUGIN_SKILL_INVALID', 'Bundled files are a map of relative paths to text.');
  const { fields, body } = parseFrontmatter(skillMd);
  const name = fields.name; const description = fields.description;
  check(typeof name === 'string' && name.length <= 64 && SLUG.test(name), 'PLUGIN_SKILL_INVALID', 'The skill name is lowercase letters, digits and hyphens.');
  check(typeof description === 'string' && description.length > 0 && description.length <= 1024, 'PLUGIN_SKILL_INVALID', 'The skill needs a description under 1024 characters.');
  const toolsField = fields['allowed-tools'];
  const allowedTools = toolsField === undefined ? [] : Array.isArray(toolsField) ? toolsField : typeof toolsField === 'string' ? toolsField.split(/\s+/).filter(Boolean) : [];
  check(allowedTools.length <= 64 && allowedTools.every(tool => tool.length <= 200), 'PLUGIN_SKILL_INVALID', 'Allowed tools are a short list.');
  const license = typeof fields.license === 'string' ? fields.license.slice(0, 200) : null;
  const refused: Refused[] = []; const resources: SkillEntry['resources'] = [];
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!safePath(path) || typeof text !== 'string') { refused.push({ path: String(path).slice(0, 200), code: 'PLUGIN_RESOURCE_REFUSED', words: { en: 'Only text files with a plain relative path are carried.', hi: 'केवल सादे सापेक्ष पथ वाली लेख फ़ाइलें रखी जाती हैं।' } }); continue; }
    if (isScript(path, text)) { refused.push({ path, code: 'PLUGIN_SCRIPT_REFUSED', words: { en: 'Scripts are refused as code. Only WebAssembly runs, in the locked box.', hi: 'स्क्रिप्ट को कोड मानकर मना किया गया। केवल WebAssembly बंद डिब्बे में चलता है।' } }); continue; }
    if (text.length > LIMITS.text) { refused.push({ path, code: 'PLUGIN_CONTENT_TOO_LARGE', words: { en: 'The file is longer than 64 KiB.', hi: 'फ़ाइल 64 KiB से लंबी है।' } }); continue; }
    if (resources.length >= LIMITS.resources) { refused.push({ path, code: 'PLUGIN_CONTENT_TOO_LARGE', words: { en: 'A skill carries at most twenty files.', hi: 'एक स्किल अधिकतम बीस फ़ाइलें रखती है।' } }); continue; }
    resources.push({ path, text });
  }
  const known = new Set(['name', 'description', 'allowed-tools', 'license']);
  return { skill: { name, description, instructions: body, allowedTools, license, resources }, refused, ignoredFields: Object.keys(fields).filter(key => !known.has(key)).sort() };
}

/**
 * Wrap an MCP `tools/list` result. A tool runs only if `code` maps it to WebAssembly in the package and/or
 * `requests` declares the exact HTTPS requests Chausar may make for it, or, with `remote`, it is called on that
 * remote MCP server. A runnable tool whose argument schema falls outside the enforced subset is reported here and
 * refused on inspection; on a remote server such a tool is instead carried as a description only, as MCP asks a
 * client to leave out a tool it cannot use (so `x-mcp-header` tools are left out too).
 */
export function wrapMcpServer(toolsList: unknown, options: { serverInfo?: unknown; code?: unknown; requests?: unknown; remote?: unknown } = {}): { tools: ToolEntry[]; code: CodeEntry[]; sites: string[]; refused: Refused[]; server: { name: string | null; version: string | null } } {
  let value = toolsList;
  if (typeof value === 'string') { check(value.length <= LIMITS.document, 'PLUGIN_MCP_INVALID', 'The tools list is too large.'); try { value = JSON.parse(value); } catch { check(false, 'PLUGIN_MCP_INVALID', 'The tools list is not JSON.'); } }
  if (plain(value) && plain(value.result)) value = value.result;
  check(plain(value) && Array.isArray(value.tools) && value.tools.length <= LIMITS.tools, 'PLUGIN_MCP_INVALID', 'Provide an MCP tools/list result with a tools array.');
  const info = options.serverInfo; check(info === undefined || plain(info), 'PLUGIN_MCP_INVALID', 'Server information is an object.');
  const codeMap = options.code ?? {}; check(plain(codeMap) && Object.keys(codeMap).length <= LIMITS.code, 'PLUGIN_MCP_INVALID', 'Code is a map from tool name to a manifest and module.');
  const requestMap = options.requests ?? {}; check(plain(requestMap) && Object.keys(requestMap).length <= LIMITS.tools, 'PLUGIN_MCP_INVALID', 'Requests are a map from tool name to declared requests.');
  const remote: McpEndpoint | null = options.remote === undefined ? null : parseRemote(options.remote);
  check(!remote || (Object.keys(codeMap).length === 0 && Object.keys(requestMap).length === 0), 'PLUGIN_MCP_INVALID', 'A remote MCP server is called over MCP; it carries no code or declared requests.');
  const refused: Refused[] = []; const sites: string[] = [];
  if (info && typeof info.url === 'string') {
    let host = ''; try { const url = new URL(info.url); host = url.protocol === 'https:' && !url.username && !url.password ? url.hostname.toLowerCase() : ''; } catch { host = ''; }
    if (/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) sites.push(host);
    else refused.push({ path: 'serverInfo.url', code: 'PLUGIN_SITE_REFUSED', words: { en: 'Only a named https website can be recorded as a site.', hi: 'केवल नामित https वेबसाइट को साइट के रूप में दर्ज किया जा सकता है।' } });
  }
  if (info && (Object.hasOwn(info, 'command') || Object.hasOwn(info, 'args'))) refused.push({ path: 'serverInfo.command', code: 'PLUGIN_SCRIPT_REFUSED', words: { en: 'A local server program is refused as code. Its tools are carried as descriptions only.', hi: 'स्थानीय सर्वर प्रोग्राम को कोड मानकर मना किया गया। इसके टूल केवल विवरण के रूप में रखे गए।' } });
  const tools: ToolEntry[] = []; const code: CodeEntry[] = [];
  for (const tool of value.tools) {
    check(plain(tool) && typeof tool.name === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(tool.name), 'PLUGIN_MCP_INVALID', 'Every MCP tool needs a safe name.');
    check(!tools.some(existing => existing.name === tool.name), 'PLUGIN_MCP_INVALID', 'MCP tool names are unique.');
    const inputSchema = tool.inputSchema ?? { type: 'object' };
    check(plain(inputSchema) && inputSchema.type === 'object', 'PLUGIN_MCP_INVALID', 'An MCP tool input schema is a JSON Schema object.');
    const mapped = Object.hasOwn(codeMap, tool.name) ? codeMap[tool.name] : undefined; let codeId: string | null = null;
    if (mapped !== undefined) {
      check(plain(mapped) && Object.keys(mapped).every(key => key === 'manifest' || key === 'moduleBase64') && plain(mapped.manifest) && typeof mapped.manifest.id === 'string' && typeof mapped.moduleBase64 === 'string', 'PLUGIN_MCP_INVALID', 'Mapped code is a manifest and a base64 WebAssembly module.');
      codeId = mapped.manifest.id;
      if (!code.some(entry => (entry.manifest as any).id === codeId)) code.push({ manifest: structuredClone(mapped.manifest), moduleBase64: mapped.moduleBase64, moduleDigest: digest(mapped.moduleBase64) });
    }
    const declared = Object.hasOwn(requestMap, tool.name) ? requestMap[tool.name] : undefined;
    check(declared === undefined || (Array.isArray(declared) && declared.length > 0 && declared.length <= NETWORK_LIMITS.requests && declared.every(requestShapeValid)), 'PLUGIN_MCP_INVALID', 'Declared requests are GET or POST to a named HTTPS site with a path, a body choice and size and time limits.');
    const requests = declared ? structuredClone(declared as RequestSpec[]) : undefined;
    const entry: ToolEntry = { name: tool.name, title: typeof tool.title === 'string' ? tool.title.slice(0, 200) : null, description: typeof tool.description === 'string' ? tool.description : '', inputSchema: JSON.parse(JSON.stringify(inputSchema)), code: codeId, sites: requests ? [...new Set(requests.map(request => request.site))].sort() : codeId || remote ? [] : [...sites] };
    if (requests) entry.requests = requests;
    if (remote) {
      if (schemaProblems(entry.inputSchema).length) { refused.push({ path: `tools.${tool.name}.inputSchema`, code: 'PLUGIN_SCHEMA_UNSUPPORTED', words: { en: 'This tool declares an argument schema outside the strict subset Chausar enforces, so it is carried as a description only and cannot be called.', hi: 'यह टूल ऐसा तर्क-ढाँचा बताता है जो Chausar के सख़्त उपसमुच्चय से बाहर है, इसलिए यह केवल विवरण के रूप में रखा गया और चलाया नहीं जा सकता।' } }); tools.push(entry); continue; }
      entry.mcp = { ...remote }; entry.sites = [remote.site];
    }
    if ((codeId || requests) && schemaProblems(entry.inputSchema).length) refused.push({ path: `tools.${tool.name}.inputSchema`, code: 'PLUGIN_SCHEMA_UNSUPPORTED', words: { en: 'This runnable tool declares an argument schema outside the strict subset Chausar enforces. The plugin will be refused on inspection.', hi: 'यह चलने वाला टूल ऐसा तर्क-ढाँचा बताता है जो Chausar के सख़्त उपसमुच्चय से बाहर है। जाँच में प्लगइन मना होगा।' } });
    tools.push(entry);
  }
  for (const name of Object.keys(codeMap)) check(tools.some(tool => tool.name === name), 'PLUGIN_MCP_INVALID', 'Mapped code names a tool the server does not list.');
  for (const name of Object.keys(requestMap)) check(tools.some(tool => tool.name === name), 'PLUGIN_MCP_INVALID', 'Declared requests name a tool the server does not list.');
  return { tools, code, sites, refused, server: { name: info && typeof info.name === 'string' ? info.name.slice(0, 200) : null, version: info && typeof info.version === 'string' ? info.version.slice(0, 50) : null } };
}

export const dataEntry = (kind: DataKind, name: string, body: unknown): DataEntry => { check(DATA_KINDS.includes(kind), 'PLUGIN_WRAP_INVALID', 'Data parts are recipes, starter packs or language packs.'); return { kind, name, digest: digest(body), body: structuredClone(body) }; };

/** Assemble an unsigned document. Doors are derived from the code and tools, never typed by hand. */
export function buildDocument(input: { publisherId: string; name: string; version: string; description: string; skills?: SkillEntry[]; tools?: ToolEntry[]; data?: DataEntry[]; code?: CodeEntry[]; sites?: string[] }): PluginDocument {
  const code = input.code ?? []; const tools = input.tools ?? [];
  const manifests = code.map(entry => entry.manifest as any);
  const list = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === 'string'))].sort();
  const doors = { capabilities: list(manifests.flatMap(m => Array.isArray(m?.capabilities) ? m.capabilities : [])), sourceIds: list(manifests.flatMap(m => Array.isArray(m?.sourceIds) ? m.sourceIds : [])), sites: list([...(input.sites ?? []), ...tools.flatMap(tool => tool.sites)]) };
  return { format: PLUGIN_FORMAT, publisher: { id: input.publisherId }, name: input.name, version: input.version, description: input.description, contents: { skills: input.skills ?? [], tools, data: input.data ?? [], code }, doors };
}
