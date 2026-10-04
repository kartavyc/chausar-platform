/**
 * Exact identities for the review.
 *
 * - The review digest is SHA-256 over `JSON.stringify(draft)` of the frozen draft the
 *   person reviewed, computed with browser-safe WebCrypto (injectable for tests). It is
 *   this slice's own identity for "the bytes that were accepted". It is never shown as,
 *   or confused with, the Engine's hash.
 * - The Engine hash is `SHA256(JSON.stringify(content))` where content is the compiled
 *   dictionary without its `hash` key (ontology.ts `compileDictionary`). It is verified
 *   here over the exact received object, key order preserved.
 * - Each compiled sum carries `definitionHash` = SHA-256 over the bound definition's
 *   JSON in its authored order, and `digest` = SHA-256 over the artifact's content in the
 *   compiler's fixed field order (compiled-calculation.ts `compileSingleSum`; the Engine's
 *   `assertCompiledSingleSum` rebuilds that content rather than hashing the wire order).
 *   Both are recomputed from the received values; `contracts.ts` lays the artifact out in
 *   the compiler's order.
 * - Row and settings pins are the exact JSON text of what was accepted; comparing text
 *   is synchronous and exact, and the whole draft is rehashed before dispatch.
 *
 * What a recomputed hash proves: self-consistency only. The received content produces
 * the attached hash, so the object was not corrupted or partially altered between the
 * Engine and this screen in a way that left its hash behind. It does not prove that the
 * transport was authenticated, that the bytes came from the Engine, or who produced them;
 * a trusted transport is the parent's prerequisite, not something this check supplies.
 */

import type { Definition, DictionaryDraft, PublishedDictionary } from './contracts.ts';
import { compiledSumContentJson, publishedContentJson } from './contracts.ts';

export type TextDigest = (text: string) => Promise<string>;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex over UTF-8 text through WebCrypto. The subtle API may be injected; otherwise the global one is used. */
export function webCryptoDigest(subtle?: SubtleCrypto): TextDigest {
  return async text => {
    const api = subtle ?? globalThis.crypto?.subtle;
    if (api === undefined) throw Object.assign(new Error('DIGEST_UNAVAILABLE'), { code: 'DIGEST_UNAVAILABLE' });
    const buffer = await api.digest('SHA-256', new TextEncoder().encode(text));
    return hex(new Uint8Array(buffer));
  };
}

/** The exact JSON of the whole draft: what is sent, and what the review digest is over. */
export function draftJson(draft: DictionaryDraft): string { return JSON.stringify(draft); }

/** The exact JSON of one definition: what a row's Accept pins, and what the Engine's `definitionHash` is over. */
export function definitionJson(definition: Definition): string { return JSON.stringify(definition); }

/** The exact JSON of the proposed settings and executable bindings: what the settings Accept pins. */
export function settingsJson(draft: DictionaryDraft): string {
  return JSON.stringify({ pack: draft.pack, label: draft.label, currency: draft.currency, gstMode: draft.gstMode, fields: draft.fields });
}

export async function reviewDigestOf(draft: DictionaryDraft, digest: TextDigest): Promise<string> {
  return digest(draftJson(draft));
}

/** True only when the received dictionary's `hash` equals SHA-256 over its own content without `hash`. */
export async function publishedHashVerified(dictionary: PublishedDictionary, digest: TextDigest): Promise<boolean> {
  return (await digest(publishedContentJson(dictionary))) === dictionary.hash;
}

/**
 * True only when every compiled sum's `definitionHash` equals SHA-256 over the JSON of
 * the definition it names, and its `digest` equals SHA-256 over the artifact without
 * `digest`. A dictionary without compiled sums verifies vacuously.
 */
export async function compiledSumsVerified(dictionary: PublishedDictionary, digest: TextDigest): Promise<boolean> {
  for (const sum of dictionary.compiledSums ?? []) {
    const definition = dictionary.definitions.find(item => item.name === sum.definitionName);
    if (definition === undefined) return false;
    if ((await digest(definitionJson(definition))) !== sum.definitionHash) return false;
    if ((await digest(compiledSumContentJson(sum))) !== sum.digest) return false;
  }
  return true;
}

/** The whole Engine proof available for a published dictionary: its own hash and every compiled artifact hash. */
export async function publishedVerified(dictionary: PublishedDictionary, digest: TextDigest): Promise<boolean> {
  return (await publishedHashVerified(dictionary, digest)) && (await compiledSumsVerified(dictionary, digest));
}
