/**
 * Wave 6 first run in the fake engine, answering as the engine does:
 *   venture.ai.tools / .login.start / .login.cancel  each tool's own sign-in (platform/runtime/venture/models/login.ts):
 *       a sample Codex that is installed and signed out, whose device login prints a sample code and OpenAI's link,
 *       and finishes after three looks; Claude Code not installed. Nothing here starts a process.
 *   venture.about.read / .pick / .families           About you (core/about.ts), from the same families file. Without an
 *       AI it is the keyword guess; with one, a synthetic AI answer from the same guess and the family's own offers. A
 *       LinkedIn export is read from the same Profile.csv rules; a resume PDF is refused as on a computer with no PDF
 *       reader.
 *   venture.needs.list                                what the business needs (core/needs-data.ts), the same data.
 */
import { EngineError, type AboutReadLite, type CountryLite, type ModelStatusLite, type NeedsListLite, type ToolLite, type ToolsLite } from './types';
import { FAMILIES, familyIdeaWith, familyOf, familyTiles, isFamilyId, keywordFamilyWith, type FamilyId } from '../../../../platform/runtime/venture/core/families';
import { businessFamily, businessNeeds } from '../../../../platform/runtime/venture/core/needs-data';
import { profileEntry, profileTextFromCsv } from '../../../../platform/runtime/venture/core/profile-csv';

export const FIRST_RUN_METHODS: ReadonlySet<string> = new Set([
  'venture.ai.tools', 'venture.ai.login.start', 'venture.ai.login.cancel',
  'venture.about.read', 'venture.about.pick', 'venture.about.families', 'venture.needs.list',
]);
/** A synthetic one-time code in Codex's own shape. Never a real code. */
export const FAKE_DEVICE_CODE = ['WXYZ', '12345'].join('-');
const DEVICE_LINK = 'https://auth.openai.com/codex/device';
const LOGIN_LINE = "Chausar starts each tool's own sign-in. It never sees your password or login files.";
const PROFILE_LINK_WORDS = 'Chausar never opens profile links. Ask LinkedIn for your data export (Settings, Data privacy, Get a copy of your data) and add the ZIP it sends you.';
const NO_PDF_READER = 'Reading a resume PDF needs the PDF reader set up for Chausar on this computer. Paste a few lines about your work instead.';
const FILE_MAX_BASE64 = Math.ceil((1024 * 1024) / 3) * 4;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export interface FirstRunHost {
  hosted: () => boolean;
  /** The draft desk's AI status (venture.ai.status). */
  aiStatus: () => ModelStatusLite;
  /** The open business: its idea, country and the family kept with it, or null. */
  venture: () => { idea: string; country: { code: string; paymentRails?: readonly string[] } | null; familyId: string | null } | null;
  countries: readonly CountryLite[];
  /** The fake's own idea classifier (fake.ts classify), as the engine passes classifyIdea. */
  classify: (idea: string) => string;
}

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) throw invalid('Send one request object.');
  if (Object.keys(p).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(p, key))) throw invalid('Send the required fields and nothing else.');
}
function plain(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw invalid(`${field} must be text.`);
  const text = value.replace(/\r\n/g, '\n').trim();
  if (text.length < min || text.length > max) throw invalid(`${field} must be between ${min} and ${max} characters.`);
  if (CONTROL.test(text)) throw invalid(`${field} contains characters Chausar cannot keep.`);
  return text;
}
function bytesOf(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length > FILE_MAX_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw invalid('Add a file of at most 1 MB.');
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
/** Only a stored Profile.csv can be read without inflating; the app sends exactly that (onboarding/linkedin.ts). */
function profileText(contentBase64: unknown): string {
  const entry = profileEntry(bytesOf(contentBase64));
  if (entry.method !== 0) throw invalid('Profile.csv in that ZIP could not be read.');
  return profileTextFromCsv(new TextDecoder('utf-8', { fatal: true }).decode(entry.packed));
}

export class FakeFirstRun {
  private readonly host: FirstRunHost;
  private codex: { signedIn: 'yes' | 'no'; login: ToolLite['login']; looks: number } = { signedIn: 'no', login: { state: 'idle', code: null, link: null, line: null }, looks: 0 };

  constructor(host: FirstRunHost) { this.host = host; }

  /** Whether the sample Codex says it is signed in (its presets can then connect). */
  codexSignedIn(): boolean { return this.codex.signedIn === 'yes'; }

  /** Tests: the sample Codex is already signed in. */
  signIn(): void { this.codex = { signedIn: 'yes', login: { state: 'idle', code: null, link: null, line: null }, looks: 0 }; }

  request(method: string, p: Record<string, unknown>): unknown {
    if (method !== 'venture.needs.list' && this.host.hosted()) throw new EngineError('HOSTED_NOT_AVAILABLE', 'The hosted web app adds your AI after you keep your business.');
    switch (method) {
      case 'venture.ai.tools': exact(p, []); return this.tools();
      case 'venture.ai.login.start': return this.start(this.cli(p));
      case 'venture.ai.login.cancel': return this.cancel(this.cli(p));
      case 'venture.about.read': return this.read(p);
      case 'venture.about.pick': return this.pick(p);
      case 'venture.about.families': exact(p, []); return { families: familyTiles() };
      case 'venture.needs.list': return this.needs(p);
      default: throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
    }
  }

  private cli(p: Record<string, unknown>): 'codex' | 'claude-code' {
    exact(p, ['cli'], ['cli']);
    if (p.cli !== 'codex' && p.cli !== 'claude-code') throw invalid('Choose Codex or Claude Code.');
    return p.cli;
  }

  private codexView(): ToolLite {
    return { cli: 'codex', label: 'Codex', found: true, signedIn: this.codex.signedIn, login: { ...this.codex.login } };
  }
  private claudeView(): ToolLite {
    return { cli: 'claude-code', label: 'Claude Code', found: false, signedIn: 'unknown', login: { state: 'idle', code: null, link: null, line: 'Install Claude Code with its own installer, then check again.' } };
  }

  private tools(): ToolsLite {
    const login = this.codex.login;
    if (login.state === 'starting') this.codex.login = { state: 'waiting', code: FAKE_DEVICE_CODE, link: DEVICE_LINK, line: null };
    else if (login.state === 'waiting' && ++this.codex.looks >= 3) this.codex = { signedIn: 'yes', login: { state: 'signed-in', code: null, link: null, line: null }, looks: 0 };
    return { tools: [this.codexView(), this.claudeView()], line: LOGIN_LINE };
  }

  private start(cli: 'codex' | 'claude-code'): ToolLite {
    if (cli === 'claude-code') throw new EngineError('CLI_UNAVAILABLE', 'Install Claude Code with its own installer, then check again.');
    if (this.codex.signedIn === 'yes' || this.codex.login.state === 'starting' || this.codex.login.state === 'waiting') return this.codexView();
    this.codex.login = { state: 'starting', code: null, link: null, line: null };
    this.codex.looks = 0;
    return this.codexView();
  }

  private cancel(cli: 'codex' | 'claude-code'): ToolLite {
    if (cli === 'claude-code') return this.claudeView();
    if (this.codex.login.state === 'starting' || this.codex.login.state === 'waiting') this.codex.login = { state: 'cancelled', code: null, link: null, line: null };
    return this.codexView();
  }

  private family(id: FamilyId | null): AboutReadLite['family'] {
    if (!id) return null;
    const { label, line } = familyOf(id);
    return { id, label, line };
  }

  /** A1 final check: the AI about-read calls since the last business was made, as the engine's draft desk holds them. */
  private aiReads: string[] = [];
  /** Hands the about-read calls over to the business being made (venture.create) and wipes them here, as the handover. */
  takeAiReads(): string[] { const reads = this.aiReads; this.aiReads = []; return reads; }

  private read(p: Record<string, unknown>): AboutReadLite {
    exact(p, ['text', 'attachment']);
    if (p.text === undefined && p.attachment === undefined) throw invalid('Write a few words about your work, or add your resume or LinkedIn export.');
    const text = p.text === undefined ? '' : plain(p.text, 'What you do', 10, 2000);
    if (/linkedin\.com\//i.test(text)) throw invalid(PROFILE_LINK_WORDS);
    let fileText = '';
    let file: AboutReadLite['file'];
    if (p.attachment !== undefined) {
      const attachment = p.attachment as Record<string, unknown>;
      exact(attachment, ['name', 'kind', 'contentBase64'], ['name', 'kind', 'contentBase64']);
      const name = plain(attachment.name, 'The file name', 1, 200);
      if (/[\r\n\t]/.test(name)) throw invalid('The file name must be one line.');
      if (attachment.kind !== 'resume-pdf' && attachment.kind !== 'linkedin-zip') throw invalid('Add a resume PDF or a LinkedIn data export ZIP.');
      if (attachment.kind === 'resume-pdf') {
        const bytes = bytesOf(attachment.contentBase64);
        if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw invalid('That file is not a PDF.');
        throw new EngineError('TOOL_FAILED', NO_PDF_READER);
      }
      fileText = profileText(attachment.contentBase64);
      file = { name, included: true, line: null };
    }
    const status = this.host.aiStatus();
    const familyId = keywordFamilyWith(`${text}\n${fileText}`, this.host.classify);
    const offers = familyId ? familyOf(familyId).offers.map((offer) => ({ ...offer })) : [];
    const idea = familyId ? familyIdeaWith(familyId, text || offers.map((offer) => offer.name).join(', '), this.host.classify) : null;
    if (status.tiers.fast.presetId === 'built-in-templates') return { family: this.family(familyId), offers, country: null, evidence: null, idea, source: 'keywords', ...(file ? { file } : {}) };
    if (!status.tiers.fast.usable) throw new EngineError('TIER_UNAVAILABLE', status.tiers.fast.reason);
    const source = `${text}\n${fileText}`;
    const found = this.host.countries.filter((country) => country.code !== 'XX').flatMap((country) => {
      const phrase = new RegExp(`\\b(?:I (?:live|am based|work) in (?:the )?|Location: [^\\n]*)${country.name}\\b`, 'i').exec(source)?.[0];
      return phrase ? [{ country, evidence: phrase }] : [];
    });
    const country = found.length === 1 ? found[0]! : null;
    // A1 final check: the AI read the owner, as the engine's draft desk records the call (handed over at venture.create).
    const callId = `modelcall_about_${this.aiReads.length + 1}`;
    this.aiReads.push(callId);
    return {
      family: this.family(familyId), offers: familyId ? offers.slice(0, 3) : [], country: country ? { ...country.country } : null, evidence: country?.evidence ?? null,
      idea, source: 'ai', callId, ...(file ? { file } : {}),
    };
  }

  private pick(p: Record<string, unknown>): AboutReadLite {
    exact(p, ['familyId', 'text'], ['familyId']);
    if (!isFamilyId(p.familyId)) throw invalid('Choose one of the listed fields.');
    const text = p.text === undefined ? '' : plain(p.text, 'What you do', 0, 2000);
    const family = familyOf(p.familyId);
    return { family: this.family(family.id), offers: family.offers.map((offer) => ({ ...offer })), country: null, evidence: null, idea: familyIdeaWith(family.id, text, this.host.classify), source: 'tile' };
  }

  private needs(p: Record<string, unknown>): NeedsListLite {
    exact(p, []);
    const venture = this.host.venture();
    if (!venture) throw new EngineError('VENTURE_NOT_FOUND', 'Start a business first.');
    const familyId = businessFamily(venture.familyId, venture.idea, this.host.classify);
    return {
      family: familyId ? { id: familyId, label: familyOf(familyId).label } : null,
      needs: businessNeeds(familyId, venture.country?.code ?? null, venture.country?.paymentRails ?? []).map((need) => ({ ...need, connect: { ...need.connect } })),
    };
  }
}

export { FAMILIES };
