// Chausar venture launcher: one posting history per computer (Ink v2 wave 2, 2B1, catalogue K5).
// Every business on this computer posts from the same Chausar browser profile, so the same account. The risk gate
// (build/posting.ts) counts the posts of every business together: each vault keeps its own posts, and this log beside
// the browser profiles (one file per platform, next to the hold files build/browser.ts writes) notes every post right
// before it goes out, from any vault: when, and short unsalted fingerprints (the first 16 hex characters of a sha256)
// of its word groups and of the sites it links, not the words. Short and unsalted, so a guessed text can be matched
// against them; they sit on the owner's own computer beside the browser profiles, which hold far more. It keeps the
// last 30 days, 200 entries at most; an entry whose time cannot be read, or that is more than a day ahead, is dropped.
// A log Chausar cannot read or write never stops a post: the vault's own history still counts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { PostLogEntry, PostLogPort } from '../contracts.ts';

const KEEP_DAYS = 30;
const KEEP_ENTRIES = 200;

/** The folder the browser profiles live in, as build/browser.ts finds it. */
export function profileRoot(): string {
  return process.env.CHAUSAR_BROWSER_PROFILES || join(homedir(), '.chausar', 'browser-sessions');
}

const DAY = 86_400_000;

/** An entry of the right shape whose time reads as a date no more than a day ahead of now. */
function wellFormed(value: unknown, nowMs: number): value is PostLogEntry {
  const entry = value as PostLogEntry | null;
  if (!entry || typeof entry.id !== 'string' || typeof entry.connectorId !== 'string' || typeof entry.at !== 'string') return false;
  const at = Date.parse(entry.at);
  return Number.isFinite(at) && at - nowMs <= DAY && !!entry.print && Array.isArray(entry.print.shingles) && Array.isArray(entry.print.domains);
}

/** The last 200 entries written within the last 30 days. */
function trimmed(entries: PostLogEntry[], nowMs: number): PostLogEntry[] {
  return entries.filter(entry => nowMs - Date.parse(entry.at) < KEEP_DAYS * DAY).slice(-KEEP_ENTRIES);
}

/** The log on disk: <profile root>/<connector>.posts.json. Read and write failures are swallowed. */
export function diskPostLog(root: string = profileRoot(), now: () => number = Date.now): PostLogPort {
  const path = (connectorId: string) => join(root, `${connectorId}.posts.json`);
  const read = (connectorId: string): PostLogEntry[] => {
    try {
      const parsed = JSON.parse(readFileSync(path(connectorId), 'utf8')) as unknown;
      const nowMs = now();
      return Array.isArray(parsed) ? parsed.filter((item): item is PostLogEntry => wellFormed(item, nowMs)).filter(entry => entry.connectorId === connectorId) : [];
    } catch {
      return [];
    }
  };
  return {
    read,
    append(entry) {
      try {
        const next = trimmed([...read(entry.connectorId).filter(item => item.id !== entry.id), entry], now());
        mkdirSync(dirname(path(entry.connectorId)), { recursive: true });
        writeFileSync(path(entry.connectorId), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      } catch {
        // The vault keeps the post too; the next post on this computer is still counted against it there.
      }
    },
  };
}

/** A log in memory, for tests and for a host that keeps its own. */
export function memoryPostLog(): PostLogPort & { entries: PostLogEntry[] } {
  const entries: PostLogEntry[] = [];
  return {
    entries,
    read: connectorId => entries.filter(entry => entry.connectorId === connectorId).map(entry => structuredClone(entry)),
    append(entry) {
      const at = entries.findIndex(item => item.id === entry.id);
      if (at >= 0) entries.splice(at, 1);
      entries.push(structuredClone(entry));
    },
  };
}
