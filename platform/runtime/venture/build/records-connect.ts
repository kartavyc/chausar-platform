// Chausar connectors: the shared connectors' shapes (Ink v2 wave 5, package 5A6): page monitors, mail imported from
// files, the owner's own local apps, the webhook handoff and speech providers. Package 5-0 named them as placeholders;
// 5A6 replaces them here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned from an
// outside source.
import type { Display, IsoDate, IsoTime, MicroString, MinorString, UploadFormat } from '../contracts.ts';

// ---------------------------------------------------------------------------
// Monitors (K16)
// ---------------------------------------------------------------------------

/** What a monitor watches for: any change, a text appearing, or a price falling below the owner's figure. */
export type MonitorKind = 'change' | 'contains' | 'price-below';
/** One alert a monitor raised, in the engine's words. */
export type MonitorAlert = { at: IsoTime; line: Display };
/**
 * venture-monitor: one page the owner asked Chausar to watch (watch: what for; 'kind' is the record's own field). The
 * first check keeps a seed and alerts nothing; each later change alerts once. lastDigest: sha256 of what was watched;
 * lastValue: 'yes' or 'no' for a text, the price in minor units for a price, null for a change. failures: errors in a
 * row, which push nextCheckAt back 1, 2, 4, 8, 16 then 24 hours. alerts: newest last, at most 20 kept.
 */
export type MonitorBody = {
  url: string;
  host: string;
  watch: MonitorKind;
  text: string | null;
  selector: string | null;
  belowMinor: MinorString | null;
  seeded: boolean;
  lastDigest: string | null;
  lastValue: string | null;
  lastCheckedAt: IsoTime | null;
  nextCheckAt: IsoTime;
  failures: number;
  lastError: Display | null;
  alerts: MonitorAlert[];
  removedAt: IsoTime | null;
  line: Display;
};
/** venture.monitors.add's request: a page, what to watch for, and the owner's picked element for a price. */
export type MonitorInput = { url: string; kind: MonitorKind; text?: string; selector?: string; belowRupees?: string };
/** One monitor as the screens show it. */
export type MonitorView = {
  id: string; url: string; host: string; kind: MonitorKind; line: Display; lastCheckedAt: IsoTime | null; nextCheckAt: IsoTime | null;
  alert: MonitorAlert | null; failing: boolean; removed: boolean;
};
/** venture.monitors.list's answer. hosted: monitors run only where Chausar keeps running (not the hosted app). */
export type MonitorsView = { monitors: MonitorView[]; line: Display; hosted: boolean };

// ---------------------------------------------------------------------------
// Mail in
// ---------------------------------------------------------------------------

/**
 * One attachment of an imported message. name is Chausar's own ('attachment-1.pdf'); clientName the sender's, screened
 * (null when held). The bytes are kept only for a kind Chausar can read (PDF, CSV, XLSX, a transcript) and only up to an
 * upload's size, each screened on its own when it is read; anything else is listed with its size and kept no further.
 */
export type MailAttachment = {
  id: string; name: string; clientName: string | null; format: UploadFormat | null; bytes: number; digest: string; contentBase64: string | null; line: Display;
};
/** venture.mail.import's answer. */
export type MailImportView = { added: number; repeats: number; skipped: number; held: number; threads: number; line: Display };
/** The playbook desk a message goes to (support tickets, recruiting resumes, the assistant's inbox). */
export type MailDesk = { playbook: string; kind: string };
/** One thread as the screens show it: its first subject, who wrote last, how many messages and where they came from. */
export type MailThreadView = {
  id: string; subject: Display; from: string; count: number; lastAt: IsoTime; sources: ('mailbox' | 'file-import')[]; clientId: string | null;
  desk: MailDesk | null; held: boolean;
};
/** venture.mail.threads's answer: the threads, and the read-only mailbox's state (4E3) with its manual path. */
export type MailThreadsView = { threads: MailThreadView[]; mailbox: { connected: boolean; label: 'read'; line: Display; manualPath: Display } };

// ---------------------------------------------------------------------------
// The owner's local apps (K13)
// ---------------------------------------------------------------------------

export type LocalAppId = 'baocut' | 'kimo' | 'filmcraft';
/** What a local app asked the owner to do (exit 2), until a later run of it works. */
export type LocalAppNeeds = { remedy: Display; next: Display | null; at: IsoTime; command: string };
/** venture-local-app: one owner-installed app's last run and what it asked of the owner. One record per app. */
export type LocalAppBody = { app: LocalAppId; lastRun: { at: IsoTime; command: string; exit: number | null; line: Display } | null; needs: LocalAppNeeds | null };
/** One local app as Connections shows it: write when it is on this computer, else planned with the manual path. */
export type LocalAppView = {
  id: LocalAppId; name: string; label: 'write' | 'planned: write'; found: boolean; note: Display; licence: Display; manualPath: Display | null; needs: LocalAppNeeds | null;
};
/** venture.localApps.list's answer. */
export type LocalAppsView = { apps: LocalAppView[]; hosted: boolean; line: Display };
/** How one run of a local app ended: its exit code (null when stopped or never started), its output, and why not. */
export type LocalAppRun = { code: number | null; stdout: string; stderr: string; timedOut: boolean; startError: string | null };
/**
 * The engine's port to the owner's own programs (VentureDeps.localApps): find one on PATH, never installing anything,
 * and run it without a shell, with a time limit. Absent means the real one; tests pass a fake.
 */
export type LocalAppPort = {
  locate(binary: string): string | null;
  run(path: string, args: readonly string[], timeoutMs: number): Promise<LocalAppRun>;
};

// ---------------------------------------------------------------------------
// The webhook handoff (K24)
// ---------------------------------------------------------------------------

export type WebhookKind = 'n8n' | 'make';
/** venture.webhook.set's answer. The address itself never comes back: only its host. */
export type WebhookView = { kind: WebhookKind; set: boolean; host: string | null; line: Display; test: 'answered' | 'unknown' | null };

// ---------------------------------------------------------------------------
// Speech out
// ---------------------------------------------------------------------------

/** A provider's stock voice and the licence its output is used under. */
export type SpeechVoice = { id: string; name: string; language: string; licence: Display };
/** A provider's price per million characters in micro US dollars, from its own page, with the day it was checked. */
export type SpeechPrice = { microsPerMillionChars: MicroString; checkedOn: IsoDate; source: string };
/** One provider as Connections shows it. waitsOn and manualPath say what a planned one waits for and what to do meanwhile. */
export type SpeechProviderView = {
  id: string; name: string; label: 'write' | 'planned: write'; languages: string[]; voices: SpeechVoice[]; maxChars: number; price: SpeechPrice | null;
  waitsOn: Display | null; manualPath: Display | null; note: Display;
};
/** venture.speechOut.providers's answer. */
export type SpeechProvidersView = { providers: SpeechProviderView[]; line: Display };
/** What a speech call costs before it is made: the characters, the figure and the price it came from. */
export type SpeechQuote = { provider: string; voice: string; chars: number; micros: MicroString; figure: Display; price: SpeechPrice; textDigest: string };
