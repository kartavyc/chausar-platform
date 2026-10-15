/**
 * The plugin file `chausar.plugin.v1`: one JSON document, signed with Ed25519 over its canonical
 * bytes. Outside text inside it (skill instructions, tool descriptions, data blobs) is data only.
 * Only WebAssembly code runs, and only through the core PluginService locked box.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { check } from '../contracts.ts';
import { canonical, digest } from '../actions.ts';
import { inspectWasm, validateManifest } from '../plugins.ts';
import type { HostFunction, PluginManifest } from '../plugins.ts';
import { schemaProblems, takesArguments } from './plugin-schema.ts';
import { NETWORK_LIMITS, placeholdersBound, requestShapeValid } from './plugin-network.ts';
import type { RequestSpec } from './plugin-network.ts';
import { endpointShapeValid } from './plugin-mcp.ts';
import type { McpEndpoint } from './plugin-mcp.ts';

export const PLUGIN_FORMAT = 'chausar.plugin.v1';
export const DATA_KINDS = ['recipe', 'starterPack', 'languagePack'] as const;
export type DataKind = typeof DATA_KINDS[number];
export type SkillEntry = { name: string; description: string; instructions: string; allowedTools: string[]; license: string | null; resources: { path: string; text: string }[] };
/**
 * `requests` and `mcp` are optional so files signed before them keep their exact bytes and digest. A tool has at
 * most one of them: declared plain HTTPS requests, or the endpoint of the remote MCP server it is called on.
 */
export type ToolEntry = { name: string; title: string | null; description: string; inputSchema: Record<string, unknown>; code: string | null; sites: string[]; requests?: RequestSpec[]; mcp?: McpEndpoint };
export type DataEntry = { kind: DataKind; name: string; digest: string; body: unknown };
export type CodeEntry = { manifest: unknown; moduleBase64: string; moduleDigest: string };
export type Doors = { capabilities: string[]; sourceIds: string[]; sites: string[] };
export type Signature = { algorithm: 'ed25519'; keyId: string; value: string };
export type PluginDocument = { format: typeof PLUGIN_FORMAT; publisher: { id: string }; name: string; version: string; description: string; contents: { skills: SkillEntry[]; tools: ToolEntry[]; data: DataEntry[]; code: CodeEntry[] }; doors: Doors; signature?: Signature };
export type TrustedKey = { keyId: string; publisherId: string; publicKey: string; origin: 'host' | 'owner'; addedAt?: string; addedBy?: string };
export type Words = { en: string; hi: string };
export type Untrusted = ReturnType<typeof untrusted>;
/** `subject` is a fixed Chausar name, a format-checked plugin name, or quoted outside text. */
export type Finding = { code: string; subject: string | Untrusted | null; words: Words };
export type SignatureStatus = 'verified' | 'unsigned' | 'unknown-key' | 'invalid';

export const LIMITS = { document: 3 * 1024 * 1024, text: 64 * 1024, resources: 20, skills: 16, tools: 64, data: 32, dataBody: 256 * 1024, code: 8, doors: 16 };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PUBLISHER = /^[a-z0-9][a-z0-9.-]{0,99}$/;
const SEMVER = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
/** The core manifest id format; any other id is outside text and never used as a key. */
const CODE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const SITE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SCRIPT_EXTENSIONS = /\.(py|pyc|sh|bash|zsh|fish|js|mjs|cjs|ts|tsx|jsx|rb|pl|php|ps1|psm1|bat|cmd|exe|dll|so|dylib|jar|class|lua|go|rs|c|cc|cpp|swift|kt|wasm)$/i;
export const isScript = (path: string, text: string) => SCRIPT_EXTENSIONS.test(path) || text.startsWith('#!');
export const safePath = (path: unknown): path is string => typeof path === 'string' && path.length > 0 && path.length <= 200 && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => part === '' || part === '.' || part === '..') && !/[\u0000-\u001f]/.test(path);

const plain = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function invalid(condition: unknown, message: string): asserts condition { check(condition, 'INVALID_PLUGIN_FILE', message); }
function exactKeys(value: unknown, keys: string[], message: string): asserts value is Record<string, any> { invalid(plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), message); }
const text = (value: unknown, max: number, min = 0): value is string => typeof value === 'string' && value.length >= min && value.length <= max;
const strings = (value: unknown, pattern: RegExp, max = LIMITS.doors) => Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string' && pattern.test(item)) && new Set(value).size === value.length;
const sortedUnique = (values: string[]) => [...new Set(values)].sort();
export const sameSet = (a: string[], b: string[]) => canonical(sortedUnique(a)) === canonical(sortedUnique(b));

/** Structural check. Content problems (scripts, sizes, digests, doors) are findings, not throws, so a file can still be inspected. */
export function parseDocument(input: unknown): PluginDocument {
  let value = input;
  if (typeof value === 'string') { invalid(value.length <= LIMITS.document, 'The plugin file is too large.'); try { value = JSON.parse(value); } catch { invalid(false, 'The plugin file is not JSON.'); } }
  invalid(plain(value), 'A plugin file is one JSON object.');
  const doc = value as Record<string, any>;
  exactKeys(doc, Object.hasOwn(doc, 'signature') ? ['format', 'publisher', 'name', 'version', 'description', 'contents', 'doors', 'signature'] : ['format', 'publisher', 'name', 'version', 'description', 'contents', 'doors'], 'The plugin file has missing or unknown fields.');
  invalid(doc.format === PLUGIN_FORMAT, 'Only chausar.plugin.v1 files are read.');
  exactKeys(doc.publisher, ['id'], 'Name the publisher with one id.'); invalid(typeof doc.publisher.id === 'string' && PUBLISHER.test(doc.publisher.id), 'Use a lowercase publisher id.');
  invalid(typeof doc.name === 'string' && doc.name.length <= 64 && SLUG.test(doc.name), 'Use a lowercase plugin name with hyphens.');
  invalid(typeof doc.version === 'string' && SEMVER.test(doc.version), 'Use a semantic version.');
  invalid(text(doc.description, 1024), 'Keep the description under 1024 characters.');
  exactKeys(doc.contents, ['skills', 'tools', 'data', 'code'], 'Contents hold skills, tools, data and code lists.');
  const { skills, tools, data, code } = doc.contents;
  invalid(Array.isArray(skills) && skills.length <= LIMITS.skills && Array.isArray(tools) && tools.length <= LIMITS.tools && Array.isArray(data) && data.length <= LIMITS.data && Array.isArray(code) && code.length <= LIMITS.code, 'A plugin holds a bounded number of parts.');
  for (const skill of skills) {
    exactKeys(skill, ['name', 'description', 'instructions', 'allowedTools', 'license', 'resources'], 'A skill has a fixed set of fields.');
    invalid(typeof skill.name === 'string' && skill.name.length <= 64 && SLUG.test(skill.name) && text(skill.description, 1024, 1) && typeof skill.instructions === 'string', 'A skill needs a lowercase name, a description and instructions.');
    invalid(Array.isArray(skill.allowedTools) && skill.allowedTools.length <= 64 && skill.allowedTools.every((tool: unknown) => text(tool, 200, 1)) && (skill.license === null || text(skill.license, 200)), 'Allowed tools and licence are short text.');
    invalid(Array.isArray(skill.resources) && skill.resources.every((resource: any) => { exactKeys(resource, ['path', 'text'], 'A resource is a path and its text.'); return safePath(resource.path) && typeof resource.text === 'string'; }), 'Resources use relative paths and text.');
  }
  invalid(new Set(skills.map((skill: SkillEntry) => skill.name)).size === skills.length, 'Skill names are unique.');
  for (const tool of tools) {
    exactKeys(tool, ['name', 'title', 'description', 'inputSchema', 'code', 'sites', ...['requests', 'mcp'].filter(key => Object.hasOwn(tool ?? {}, key))], 'A tool has a fixed set of fields.');
    invalid(!(Object.hasOwn(tool, 'requests') && Object.hasOwn(tool, 'mcp')), 'A tool either declares requests or names a remote MCP server, not both.');
    invalid(typeof tool.name === 'string' && TOOL_NAME.test(tool.name) && (tool.title === null || text(tool.title, 200)) && typeof tool.description === 'string', 'A tool needs a safe name and a description.');
    invalid(plain(tool.inputSchema) && tool.inputSchema.type === 'object', 'A tool input schema is a JSON Schema object.');
    invalid((tool.code === null || (typeof tool.code === 'string' && tool.code.length <= 64)) && strings(tool.sites, SITE), 'A tool names its code and the sites it needs.');
    if (Object.hasOwn(tool, 'requests')) invalid(Array.isArray(tool.requests) && tool.requests.length > 0 && tool.requests.length <= NETWORK_LIMITS.requests && tool.requests.every((request: unknown) => requestShapeValid(request) && tool.sites.includes(request.site)), 'A tool declares at most four GET or POST requests to its own named HTTPS sites, with size and time limits.');
    if (Object.hasOwn(tool, 'mcp')) invalid(endpointShapeValid(tool.mcp) && tool.code === null && tool.sites.length === 1 && tool.sites[0] === tool.mcp.site, 'A remote MCP tool names one https endpoint on its own site, a protocol version, and size and time limits.');
  }
  invalid(new Set(tools.map((tool: ToolEntry) => tool.name)).size === tools.length, 'Tool names are unique.');
  invalid(new Set(tools.filter((tool: ToolEntry) => tool.mcp).map((tool: ToolEntry) => canonical(tool.mcp))).size <= 1, 'A plugin wraps at most one remote MCP server.');
  for (const item of data) {
    exactKeys(item, ['kind', 'name', 'digest', 'body'], 'A data part has a kind, a name, a digest and a body.');
    invalid(DATA_KINDS.includes(item.kind) && typeof item.name === 'string' && item.name.length <= 64 && SLUG.test(item.name) && typeof item.digest === 'string' && /^[a-f0-9]{64}$/.test(item.digest), 'Data parts are recipes, starter packs or language packs with a digest.');
    canonical(item.body);
  }
  for (const entry of code) {
    exactKeys(entry, ['manifest', 'moduleBase64', 'moduleDigest'], 'A code part is a manifest and a WebAssembly module.');
    invalid(typeof entry.moduleBase64 === 'string' && entry.moduleBase64.length <= 1398104 && /^[A-Za-z0-9+/]*={0,2}$/.test(entry.moduleBase64) && Buffer.from(entry.moduleBase64, 'base64').toString('base64') === entry.moduleBase64, 'Code is a base64 WebAssembly module.');
    invalid(typeof entry.moduleDigest === 'string' && /^[a-f0-9]{64}$/.test(entry.moduleDigest), 'Code carries its digest.');
    canonical(entry.manifest);
  }
  exactKeys(doc.doors, ['capabilities', 'sourceIds', 'sites'], 'Doors list capabilities, sources and sites.');
  invalid(strings(doc.doors.capabilities, /^[a-z][a-z0-9_]{0,63}$/) && strings(doc.doors.sourceIds, /^[^\u0000-\u001f]{1,200}$/, 32) && strings(doc.doors.sites, SITE), 'Doors are short named lists.');
  if (doc.signature !== undefined) {
    exactKeys(doc.signature, ['algorithm', 'keyId', 'value'], 'A signature has an algorithm, a key id and a value.');
    invalid(doc.signature.algorithm === 'ed25519' && /^[a-f0-9]{64}$/.test(doc.signature.keyId) && typeof doc.signature.value === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(doc.signature.value), 'Signatures are Ed25519.');
  }
  invalid(canonical(doc).length <= LIMITS.document, 'The plugin file is too large.');
  return structuredClone(doc) as PluginDocument;
}

export const unsignedBody = (doc: PluginDocument) => { const { signature, ...body } = doc; return body; };
export const documentDigest = (doc: PluginDocument) => digest(unsignedBody(doc));
const signedBytes = (doc: PluginDocument) => Buffer.from(canonical(unsignedBody(doc)), 'utf8');

export function publicKeyObject(publicKey: unknown): KeyObject {
  check(typeof publicKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(publicKey) && Buffer.from(publicKey, 'base64').length === 32, 'INVALID_PUBLISHER_KEY', 'Use a base64 raw Ed25519 public key.');
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'base64').toString('base64url') }, format: 'jwk' });
}
export const keyIdOf = (publicKey: string) => createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex');
export function rawPublicKey(key: KeyObject): string { const jwk = key.export({ format: 'jwk' }); check(jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && jwk.x, 'INVALID_PUBLISHER_KEY', 'Use an Ed25519 key.'); return Buffer.from(jwk.x, 'base64url').toString('base64'); }

/** Sign the canonical unsigned bytes. The key must be Ed25519. */
export function signDocument(doc: PluginDocument, privateKey: KeyObject | string): PluginDocument {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  check(key.type === 'private' && key.asymmetricKeyType === 'ed25519', 'PLUGIN_SIGNING_KEY_REQUIRED', 'Signing needs an Ed25519 publisher key.');
  const body = unsignedBody(doc); const publicKey = rawPublicKey(createPublicKey(key));
  return { ...body, signature: { algorithm: 'ed25519', keyId: keyIdOf(publicKey), value: sign(null, signedBytes(doc), key).toString('base64') } };
}

export function signatureStatus(doc: PluginDocument, keys: readonly TrustedKey[]): { status: SignatureStatus; keyId: string | null; origin: TrustedKey['origin'] | null } {
  if (!doc.signature) return { status: 'unsigned', keyId: null, origin: null };
  const key = keys.find(item => item.keyId === doc.signature!.keyId && item.publisherId === doc.publisher.id);
  if (!key) return { status: 'unknown-key', keyId: doc.signature.keyId, origin: null };
  let valid = false; try { valid = verify(null, signedBytes(doc), publicKeyObject(key.publicKey), Buffer.from(doc.signature.value, 'base64')); } catch { valid = false; }
  return { status: valid ? 'verified' : 'invalid', keyId: doc.signature.keyId, origin: valid ? key.origin : null };
}

const w = (en: string, hi: string): Words => ({ en, hi });
/** A tool Chausar can run: it has WebAssembly code, declared requests, or both. */
export const runnable = (tool: ToolEntry) => tool.code !== null || (tool.requests?.length ?? 0) > 0 || tool.mcp !== undefined;
function toolWords(tool: ToolEntry): Words {
  if (tool.mcp) return w(`A tool on a remote MCP server at ${tool.mcp.site}, spoken to with MCP ${tool.mcp.protocolVersion}. Chausar sends each call itself, once, only after an owner or cofounder approves exactly the requests it will make, adds any key itself, and logs every request in the Network ledger. The answer comes back to you as outside text.`, `${tool.mcp.site} पर एक रिमोट MCP सर्वर का टूल, MCP ${tool.mcp.protocolVersion} से बात करता है। Chausar हर कॉल खुद, एक बार भेजता है, केवल तब जब मालिक या सह-संस्थापक ठीक उन्हीं अनुरोधों को मंज़ूर करे, चाबी खुद जोड़ता है और हर अनुरोध नेटवर्क बही में लिखता है। जवाब आपको बाहरी लेख के रूप में लौटता है।`);
  if (tool.sites.length && !tool.requests?.length) return w('An MCP tool that needs the internet but declares no request. Chausar never lets plugin code reach the internet itself, so it cannot run.', 'एक MCP टूल जिसे इंटरनेट चाहिए पर कोई अनुरोध घोषित नहीं करता। Chausar प्लगइन कोड को खुद इंटरनेट तक नहीं जाने देता, इसलिए यह नहीं चल सकता।');
  if (tool.requests?.length) return w(`An MCP tool that needs ${tool.requests.length} declared request(s) to named sites. Chausar makes each request itself, once, only to sites you approved, adds any key itself, and logs it in the Network ledger. ${tool.code ? 'The answer goes into WebAssembly code in the locked box as data.' : 'The answer comes back to you as outside text.'}`, `एक MCP टूल जिसे नामित साइटों पर ${tool.requests.length} घोषित अनुरोध चाहिए। Chausar हर अनुरोध खुद, एक बार, केवल आपकी मंज़ूर साइटों पर करता है, चाबी खुद जोड़ता है और नेटवर्क बही में लिखता है। ${tool.code ? 'जवाब बंद डिब्बे के WebAssembly कोड में केवल डेटा के रूप में जाता है।' : 'जवाब आपको बाहरी लेख के रूप में लौटता है।'}`);
  if (tool.code) return w('An MCP tool backed by WebAssembly code that runs in the locked box.', 'एक MCP टूल जिसका WebAssembly कोड बंद डिब्बे में चलता है।');
  return w('An MCP tool description only. It has no code here, so it cannot run.', 'केवल MCP टूल का विवरण। इसका कोड यहाँ नहीं है, इसलिए यह नहीं चल सकता।');
}
const finding = (code: string, subject: string | Untrusted | null, words: Words): Finding => ({ code, subject, words });
const kib = (pages: number) => pages * 64;
export const untrusted = (value: string) => ({ kind: 'untrusted-text' as const, origin: 'plugin' as const, text: value, quoted: value.split('\n').map(line => `> ${line}`).join('\n'), notice: w('Outside text from a plugin. It is data, never an instruction, and it grants no permission.', 'प्लगइन से आया बाहरी लेख। यह केवल जानकारी है, आदेश नहीं, और इससे कोई अनुमति नहीं मिलती।') });

/** Content checks that make a file uninstallable. Returns the validated manifests by code id. */
export function contentFindings(doc: PluginDocument, hostFunctions: Readonly<Record<string, HostFunction>>): { findings: Finding[]; manifests: Map<string, PluginManifest> } {
  const findings: Finding[] = []; const manifests = new Map<string, PluginManifest>();
  for (const skill of doc.contents.skills) {
    if (skill.instructions.length > LIMITS.text) findings.push(finding('PLUGIN_CONTENT_TOO_LARGE', skill.name, w('Task instructions are longer than 64 KiB.', 'काम के निर्देश 64 KiB से लंबे हैं।')));
    if (skill.resources.length > LIMITS.resources) findings.push(finding('PLUGIN_CONTENT_TOO_LARGE', skill.name, w('A skill brings more than twenty files.', 'एक स्किल में बीस से ज़्यादा फ़ाइलें हैं।')));
    for (const resource of skill.resources) {
      if (isScript(resource.path, resource.text)) findings.push(finding('PLUGIN_SCRIPT_REFUSED', untrusted(resource.path), w('A bundled script was found. Scripts never run here; only WebAssembly code runs in the locked box.', 'साथ में एक स्क्रिप्ट मिली। स्क्रिप्ट यहाँ कभी नहीं चलती; बंद डिब्बे में केवल WebAssembly कोड चलता है।')));
      if (resource.text.length > LIMITS.text) findings.push(finding('PLUGIN_CONTENT_TOO_LARGE', untrusted(resource.path), w('A bundled file is longer than 64 KiB.', 'साथ की एक फ़ाइल 64 KiB से लंबी है।')));
    }
  }
  for (const tool of doc.contents.tools) {
    if (tool.description.length > LIMITS.text || canonical(tool.inputSchema).length > LIMITS.text) findings.push(finding('PLUGIN_CONTENT_TOO_LARGE', tool.name, w('A tool description or input schema is too large.', 'किसी टूल का विवरण या इनपुट ढाँचा बहुत बड़ा है।')));
    if (!tool.sites.every(site => doc.doors.sites.includes(site))) findings.push(finding('PLUGIN_DOORS_MISMATCH', tool.name, w('A tool needs a site the plugin does not list among its doors.', 'एक टूल को ऐसी साइट चाहिए जो प्लगइन के दरवाज़ों में नहीं लिखी है।')));
    if (runnable(tool) && schemaProblems(tool.inputSchema).length) findings.push(finding('PLUGIN_SCHEMA_UNSUPPORTED', tool.name, w('A runnable tool declares an argument schema Chausar cannot fully enforce. Only a strict subset is accepted.', 'चलने वाला एक टूल ऐसा तर्क-ढाँचा बताता है जिसे Chausar पूरी तरह लागू नहीं कर सकता। केवल एक सख़्त उपसमुच्चय स्वीकार है।')));
    if ((tool.requests ?? []).some(request => !placeholdersBound(request, tool.inputSchema))) findings.push(finding('PLUGIN_REQUEST_INVALID', tool.name, w('A request path uses a value that is not a required text or whole-number argument.', 'एक अनुरोध पथ ऐसा मान लेता है जो ज़रूरी लेख या पूर्ण-संख्या तर्क नहीं है।')));
  }
  for (const item of doc.contents.data) {
    if (canonical(item.body).length > LIMITS.dataBody) findings.push(finding('PLUGIN_CONTENT_TOO_LARGE', item.name, w('A data part is larger than 256 KiB.', 'एक डेटा हिस्सा 256 KiB से बड़ा है।')));
    if (digest(item.body) !== item.digest) findings.push(finding('PLUGIN_DIGEST_MISMATCH', item.name, w('A data part does not match its digest.', 'एक डेटा हिस्सा अपने डाइजेस्ट से मेल नहीं खाता।')));
  }
  const capabilities: string[] = []; const sourceIds: string[] = [];
  for (const entry of doc.contents.code) {
    if (digest(entry.moduleBase64) !== entry.moduleDigest) findings.push(finding('PLUGIN_DIGEST_MISMATCH', null, w('A code part does not match its digest.', 'एक कोड हिस्सा अपने डाइजेस्ट से मेल नहीं खाता।')));
    try {
      const manifest = validateManifest(entry.manifest);
      check(!manifests.has(manifest.id), 'INVALID_MANIFEST', 'Code ids are unique.');
      const { imports } = inspectWasm(Buffer.from(entry.moduleBase64, 'base64'), manifest.maxMemoryPages);
      check(sameSet(imports, manifest.capabilities), 'CAPABILITY_MISMATCH', 'Imports must match the manifest.');
      manifests.set(manifest.id, manifest); capabilities.push(...manifest.capabilities); sourceIds.push(...manifest.sourceIds);
      for (const capability of manifest.capabilities) if (!Object.hasOwn(hostFunctions, capability)) findings.push(finding('PLUGIN_UNKNOWN_CAPABILITY', capability, w('The code asks for a door Chausar does not have. It cannot be installed.', 'कोड ऐसा दरवाज़ा माँगता है जो Chausar में नहीं है। इसे इंस्टॉल नहीं किया जा सकता।')));
    } catch (error: any) {
      findings.push(finding(typeof error?.code === 'string' ? error.code : 'INVALID_WASM', null, w('The WebAssembly code or its manifest failed the locked-box checks.', 'WebAssembly कोड या उसका विवरण बंद डिब्बे की जाँच में विफल रहा।')));
    }
  }
  for (const tool of doc.contents.tools) if (tool.code !== null && !doc.contents.code.some(entry => plain(entry.manifest) && entry.manifest.id === tool.code)) findings.push(finding('PLUGIN_TOOL_CODE_MISSING', tool.name, w('A tool points at code the plugin does not contain.', 'एक टूल ऐसे कोड की ओर इशारा करता है जो प्लगइन में नहीं है।')));
  if (!sameSet(doc.doors.capabilities, capabilities) || !sameSet(doc.doors.sourceIds, sourceIds)) findings.push(finding('PLUGIN_DOORS_MISMATCH', null, w('The doors listed on the outside differ from what the code asks for.', 'बाहर लिखे दरवाज़े कोड की माँग से अलग हैं।')));
  return { findings, manifests };
}

export type Review = ReturnType<typeof reviewDocument>;
/** The plain-words review shown before anything is installed. */
export function reviewDocument(doc: PluginDocument, options: { hostFunctions: Readonly<Record<string, HostFunction>>; keys: readonly TrustedKey[]; blocked: { keyIds: readonly string[]; digests: readonly string[] } }) {
  const documentDigestValue = documentDigest(doc);
  const signature = signatureStatus(doc, options.keys);
  const { findings, manifests } = contentFindings(doc, options.hostFunctions);
  const blocked = options.blocked.digests.includes(documentDigestValue) || (signature.keyId !== null && options.blocked.keyIds.includes(signature.keyId));
  if (blocked) findings.unshift(finding('PLUGIN_BLOCKED', null, w('You blocked this plugin or its publisher key. It can never be installed.', 'आपने इस प्लगइन या इसके प्रकाशक की चाबी को रोका है। इसे कभी इंस्टॉल नहीं किया जा सकता।')));
  if (signature.status === 'invalid') findings.unshift(finding('PLUGIN_SIGNATURE_INVALID', null, w('The signature does not match the file. It was changed after signing or forged.', 'हस्ताक्षर फ़ाइल से मेल नहीं खाता। फ़ाइल बदली गई है या हस्ताक्षर नकली है।')));
  const signatureWords: Record<SignatureStatus, Words> = {
    verified: w('Signed by a publisher key you trust.', 'आपके भरोसेमंद प्रकाशक की चाबी से हस्ताक्षरित।'),
    unsigned: w('Not signed. The publisher is unverified.', 'हस्ताक्षर नहीं है। प्रकाशक की पुष्टि नहीं हुई।'),
    'unknown-key': w('Signed with a key you have not trusted for this publisher.', 'ऐसी चाबी से हस्ताक्षरित जिस पर आपने इस प्रकाशक के लिए भरोसा नहीं किया।'),
    invalid: w('The signature is broken.', 'हस्ताक्षर टूटा हुआ है।'),
  };
  const items = [
    ...doc.contents.skills.map(skill => ({ kind: 'skill', name: skill.name, words: w('Task instructions. Shown to you as quoted outside text and never followed as orders.', 'काम के निर्देश। आपको उद्धृत बाहरी लेख के रूप में दिखाए जाते हैं, आदेश की तरह कभी नहीं माने जाते।'), allowedTools: skill.allowedTools.map(tool => untrusted(tool)), allowedToolsWords: skill.allowedTools.length ? w('The instructions mention tools they would like to use. This grants nothing; your own permissions still apply.', 'निर्देश कुछ टूल इस्तेमाल करना चाहते हैं। इससे कोई अनुमति नहीं मिलती; आपकी अपनी अनुमतियाँ ही लागू रहती हैं।') : null, resources: skill.resources.map(resource => untrusted(resource.path)) })),
    ...doc.contents.tools.map(tool => ({ kind: 'tool', name: tool.name, words: toolWords(tool), code: tool.code, sites: tool.sites, takesArguments: takesArguments(tool.inputSchema), schema: schemaProblems(tool.inputSchema).length ? 'unsupported' as const : 'enforced' as const, requests: (tool.requests ?? []).map(request => ({ method: request.method, site: request.site, path: untrusted(request.path), body: request.body, maxResponseBytes: request.maxResponseBytes, timeoutMs: request.timeoutMs })), mcp: tool.mcp ? { site: tool.mcp.site, path: untrusted(tool.mcp.path), protocolVersion: tool.mcp.protocolVersion, maxResponseBytes: tool.mcp.maxResponseBytes, timeoutMs: tool.mcp.timeoutMs } : null })),
    ...doc.contents.data.map(item => ({ kind: item.kind, name: item.name, digest: item.digest, words: item.kind === 'recipe' ? w('A recipe, carried as data for the recipe checker. It is never run.', 'एक रेसिपी, रेसिपी जाँचक के लिए केवल डेटा के रूप में। इसे कभी चलाया नहीं जाता।') : item.kind === 'starterPack' ? w('A starter pack, carried as data for review.', 'एक स्टार्टर पैक, समीक्षा के लिए डेटा के रूप में।') : w('A language pack, carried as data for review.', 'एक भाषा पैक, समीक्षा के लिए डेटा के रूप में।') })),
    ...[...manifests.values()].map(manifest => ({ kind: 'code', name: manifest.id, words: w(`WebAssembly code for the locked box: no internet, no files, no keys. At most ${kib(manifest.maxMemoryPages)} KiB of memory and ${manifest.timeoutMs} ms per run. It stays off until you enable its exact digest.`, `बंद डिब्बे के लिए WebAssembly कोड: न इंटरनेट, न फ़ाइलें, न चाबियाँ। हर बार अधिकतम ${kib(manifest.maxMemoryPages)} KiB मेमोरी और ${manifest.timeoutMs} ms। जब तक आप इसके सटीक डाइजेस्ट को चालू न करें, यह बंद रहता है।`) })),
  ];
  const doors = [
    ...doc.doors.capabilities.map(capability => ({ door: 'capability', subject: capability, status: Object.hasOwn(options.hostFunctions, capability) ? 'after-approval' : 'refused', words: Object.hasOwn(options.hostFunctions, capability) ? w('Ask Chausar for one number through a named door, only after you grant it for this plugin. Chausar answers as the person calling the tool; the code never reads your data directly, never sees keys and can never approve.', 'एक नामित दरवाज़े से Chausar से एक संख्या माँगना, केवल तब जब आप इस प्लगइन को यह अनुमति दें। जवाब Chausar टूल चलाने वाले व्यक्ति के रूप में देता है; कोड आपका डेटा सीधे नहीं पढ़ता, चाबियाँ नहीं देखता और कभी मंज़ूरी नहीं दे सकता।') : w('A door Chausar does not have. Refused.', 'ऐसा दरवाज़ा जो Chausar में नहीं है। मना।'), description: options.hostFunctions[capability]?.description ?? null })),
    ...doc.doors.sourceIds.map(sourceId => ({ door: 'source', subject: untrusted(sourceId), status: 'after-approval', words: w('Use numbers from this one source, only while you still allow it.', 'केवल इस एक स्रोत की संख्याएँ, जब तक आप अनुमति दें।'), description: null })),
    ...doc.doors.sites.map(site => ({ door: 'site', subject: site, status: 'after-approval', words: w('Reach this one named website over HTTPS, only after you approve it for this plugin. Chausar makes each declared request itself, once, refuses redirects, adds any key itself and logs every request in the Network ledger.', 'इस एक नामित वेबसाइट तक HTTPS पर पहुँचना, केवल तब जब आप इस प्लगइन के लिए इसे मंज़ूर करें। Chausar हर घोषित अनुरोध खुद, एक बार करता है, रीडायरेक्ट मना करता है, चाबी खुद जोड़ता है और हर अनुरोध नेटवर्क बही में लिखता है।'), description: null })),
    { door: 'keys', subject: null, status: 'never', words: w('Your keys and passwords are never passed in. If a request needs a key, Chausar makes that request itself.', 'आपकी चाबियाँ और पासवर्ड कभी अंदर नहीं दिए जाते। किसी काम को चाबी चाहिए तो वह काम Chausar खुद करता है।'), description: null },
    { door: 'files', subject: null, status: 'never', words: w('No files. The locked box cannot read or write your computer.', 'कोई फ़ाइल नहीं। बंद डिब्बा आपके कंप्यूटर पर न पढ़ सकता है, न लिख सकता है।'), description: null },
  ];
  const experimentalReasons = [
    ...(doc.contents.code.length && signature.status !== 'verified' ? ['code-from-unverified-publisher'] : []),
    ...(doc.contents.tools.length ? ['wrapped-mcp-tools'] : []),
    ...(doc.contents.tools.some(tool => tool.requests?.length || tool.mcp) ? ['network-door'] : []),
    ...(doc.contents.tools.some(tool => tool.mcp) ? ['remote-mcp'] : []),
    ...(signature.status === 'unsigned' || signature.status === 'unknown-key' ? ['unverified-publisher'] : []),
  ];
  return {
    format: PLUGIN_FORMAT, digest: documentDigestValue, publisher: doc.publisher.id, name: doc.name, version: doc.version, description: untrusted(doc.description),
    signature: { ...signature, words: signatureWords[signature.status] }, blocked,
    support: experimentalReasons.length ? 'experimental' as const : 'supported' as const, experimentalReasons,
    contains: { skills: doc.contents.skills.length, tools: doc.contents.tools.length, recipes: doc.contents.data.filter(d => d.kind === 'recipe').length, starterPacks: doc.contents.data.filter(d => d.kind === 'starterPack').length, languagePacks: doc.contents.data.filter(d => d.kind === 'languagePack').length, code: doc.contents.code.length },
    items, doors, refusals: findings,
    digests: { document: documentDigestValue, data: Object.fromEntries(doc.contents.data.map(item => [item.name, item.digest])), code: Object.fromEntries(doc.contents.code.map((entry, index) => [plain(entry.manifest) && typeof entry.manifest.id === 'string' && CODE_ID.test(entry.manifest.id) ? entry.manifest.id : `#${index}`, entry.moduleDigest])) },
    installable: findings.length === 0 && signature.status !== 'invalid' && !blocked,
  };
}
