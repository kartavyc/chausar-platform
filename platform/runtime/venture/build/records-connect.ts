// Chausar connectors: the shared connectors' shapes (Ink v2 wave 5, package 5A6): monitors, mail import, the owner's
// local apps, the webhook handoff and speech providers. Package 5-0 named them as placeholders; 5A6 replaces them here,
// never in contracts.ts. Types only. Written for Chausar; nothing here is learned from an outside source.
import type { MinorString } from '../contracts.ts';

/** venture-monitor: one page the owner asked Chausar to watch, a placeholder until 5A6 lands. */
export type MonitorBody = { placeholder: true };
/** venture.monitors.add's request: a page, what to watch for, and the owner's picked element for a price. */
export type MonitorInput = { url: string; kind: 'change' | 'contains' | 'price-below'; text?: string; selector?: string; belowMinor?: MinorString };
/** venture.monitors.add's and .remove's answer. */
export type MonitorView = { placeholder: true };
/** venture.monitors.list's answer. */
export type MonitorsView = { placeholder: true };
/** venture.mail.import's answer. */
export type MailImportView = { placeholder: true };
/** venture.mail.threads's answer. */
export type MailThreadsView = { placeholder: true };
/** venture.localApps.list's answer. */
export type LocalAppsView = { placeholder: true };
/** venture.webhook.set's answer. */
export type WebhookView = { placeholder: true };
/** venture.speechOut.providers's answer. */
export type SpeechProvidersView = { placeholder: true };
