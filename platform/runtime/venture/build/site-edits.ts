// Chausar venture launcher: staged website edits (package P2-connectors).
// An agent or the owner stages an edit to one existing file: the current content, the new content and a plan digest
// over both. Nothing is written until the owner applies that exact plan digest inside the app. Before writing, the live
// file must still match what was reviewed; after writing, it is read back and must match the new content. Every step
// is logged on the edit, and an applied edit can be rolled back the same way. A write that cannot be confirmed is
// 'needs-inspection': never retried, with the original kept in the edit.
// Two targets: a site folder on this computer (real files), and a GitHub repo, which stays read-only unless the owner
// gave a write grant and a writer exists. This build ships no GitHub writer, so the GitHub card's write mode is planned.
// The stage, review by hash, apply, verify and roll back pattern follows beyondtahir/beyondseo (MIT, Copyright (c) 2026
// Muhammad Tahir Ashraf); this is a rewrite in TypeScript, not a copy.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import type { GitHubTransport, IsoTime, RepoRef, SiteEditRecord, SiteEditState, VentureDeps } from '../contracts.ts';
import { MAX_STORED_PAYLOAD, digest, exactPayload, identifier, isAppChannel, listRecords, singleLine, ventureAction } from '../records.ts';

export type SiteTarget = {
  kind: 'local-folder' | 'github';
  identity: string; // 'folder:<absolute path>' or 'github:<owner>/<repo>@<branch>'
  writable: boolean;
  read(path: string): Promise<string | null>; // null when the file does not exist
  /** Writes only if the live file still has expectedDigest; refuses with SITE_CHANGED_SINCE_REVIEW before writing otherwise. */
  replace(path: string, content: string, expectedDigest: string): Promise<void>;
};
export type GitHubWriter = {
  putFile(request: { repo: RepoRef; branch: string; path: string; content: string; expectedDigest: string; token: string | null }): Promise<void>;
};
export type GitHubWriteGrant = { scope: 'contents:write'; grantedAt: IsoTime };

export function contentDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A relative path with forward slashes inside the site: no parent steps, no drive or absolute path, no .git. */
export function sitePath(value: unknown): string {
  const ok = typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\\:\u0000-\u001F\u007F]/.test(value) && !value.startsWith('/')
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
  check(ok, 'SITE_PATH_INVALID', 'Use a path inside the site, like pages/index.html.');
  return value;
}

const isInside = (base: string, full: string) => { const rel = relative(base, full); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };

/** Real files in one folder on this computer. Writes go to a temporary file first, then replace the old one in one step. */
export function localFolderTarget(root: string): SiteTarget {
  const base = resolve(root);
  async function locate(path: string): Promise<string> {
    const full = resolve(base, ...sitePath(path).split('/'));
    check(isInside(base, full), 'SITE_PATH_INVALID', 'That path leaves the site folder.');
    const realBase = await realpath(base);
    let real = '';
    try { real = await realpath(full); } catch { real = await realpath(dirname(full)).then(dir => join(dir, basename(full))).catch(() => ''); }
    check(real !== '' && isInside(realBase, real), 'SITE_PATH_INVALID', 'That path leads outside the site folder.');
    return full;
  }
  async function readText(full: string): Promise<string | null> {
    try {
      const info = await stat(full);
      if (!info.isFile()) return null;
      check(info.size <= MAX_STORED_PAYLOAD * 4, 'INVALID_VENTURE_REQUEST', 'This file is larger than Chausar stages.');
      return await readFile(full, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw error;
    }
  }
  return {
    kind: 'local-folder', identity: `folder:${base}`, writable: true,
    async read(path) { return readText(await locate(path)); },
    async replace(path, content, expectedDigest) {
      const full = await locate(path);
      const current = await readText(full);
      check(current !== null && contentDigest(current) === expectedDigest, 'SITE_CHANGED_SINCE_REVIEW', 'The file changed since you reviewed this edit. Nothing was written.');
      const temporary = `${full}.chausar-${randomUUID()}.tmp`;
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
      try { await rename(temporary, full); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
    },
  };
}

/** One GitHub repo and branch. Reads through the read-only transport; writes only with a grant, a token and a writer. */
export function githubSiteTarget(input: {
  repo: RepoRef; branch: string; transport: GitHubTransport; token: string | null; writer?: GitHubWriter | null; grant?: GitHubWriteGrant | null;
}): SiteTarget {
  const { repo, branch, transport, token } = input;
  const writer = input.writer ?? null;
  const writable = !!(input.grant && input.grant.scope === 'contents:write' && writer && token);
  const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  async function read(path: string): Promise<string | null> {
    const encoded = sitePath(path).split('/').map(encodeURIComponent).join('/');
    const response = await transport.read({ path: `${base}/contents/${encoded}?ref=${encodeURIComponent(branch)}`, accept: 'raw', etag: null, token });
    if (response.status === 404) return null;
    if (response.status !== 200) throw new ChausarError('GITHUB_READ_FAILED', 'GitHub did not send the file. Try again later.');
    return response.body;
  }
  return {
    kind: 'github', identity: `github:${repo.owner}/${repo.name}@${branch}`, writable, read,
    async replace(path, content, expectedDigest) {
      check(writable && writer, 'SITE_WRITE_NOT_GRANTED', 'Chausar only reads this repo. Applying edits needs a write grant you give.');
      const current = await read(path);
      check(current !== null && contentDigest(current) === expectedDigest, 'SITE_CHANGED_SINCE_REVIEW', 'The file changed since you reviewed this edit. Nothing was written.');
      await writer.putFile({ repo, branch, path, content, expectedDigest, token });
    },
  };
}

/** The honest label for a target, shown wherever its edits are. */
export function siteTargetLabel(target: SiteTarget): { mode: 'read' | 'write'; status: 'available'; what: string } {
  if (target.kind === 'github') {
    return target.writable
      ? { mode: 'write', status: 'available', what: 'Applies edits you reviewed to your repo with the write grant you gave, and reads them back.' }
      : { mode: 'read', status: 'available', what: 'Reads your repo. Edits need a write grant you give, so Chausar only reads.' };
  }
  return { mode: 'write', status: 'available', what: 'Applies edits you reviewed to files in this folder, reads them back and can undo them.' };
}

function planDigestOf(edit: Pick<SiteEditRecord, 'id' | 'target' | 'path' | 'beforeDigest' | 'afterDigest'>): string {
  return digest({ id: edit.id, target: edit.target.identity, path: edit.path, beforeDigest: edit.beforeDigest, afterDigest: edit.afterDigest });
}

/** An agent or the owner stages an edit to one existing file. Nothing is written. */
export async function stageSiteEdit(deps: VentureDeps, ctx: Context, target: SiteTarget, payload: unknown): Promise<SiteEditRecord> {
  const body = exactPayload(payload, ['path', 'after', 'summary'], ['path', 'after', 'summary']);
  const path = sitePath(body.path);
  check(typeof body.after === 'string' && body.after.length <= MAX_STORED_PAYLOAD, 'INVALID_VENTURE_REQUEST', 'The new content must be text Chausar can keep.');
  const after = body.after;
  const summary = singleLine(body.summary, 'summary', { max: 200 });
  authorize(deps.store, ctx, 'prepare');
  const before = await target.read(path);
  check(before !== null, 'SITE_PATH_INVALID', 'This file does not exist. Staged edits change existing files only.');
  check(before.length <= MAX_STORED_PAYLOAD, 'INVALID_VENTURE_REQUEST', 'This file is larger than Chausar stages.');
  check(before !== after, 'SITE_EDIT_UNCHANGED', 'The new content is the same as the file.');
  return ventureAction(deps, ctx, 'prepare', 'site.edit.stage', tx => {
    const record: SiteEditRecord = {
      ...tx.base('venture-site-edit'), target: { kind: target.kind, identity: target.identity }, path, summary, before, after,
      beforeDigest: contentDigest(before), afterDigest: contentDigest(after), planDigest: '', state: 'staged',
      log: [{ at: tx.now, by: ctx.memberId, step: 'staged', line: `Staged: ${summary}` }],
    };
    record.planDigest = planDigestOf(record);
    return tx.put(record);
  });
}

function reviewed(edit: SiteEditRecord | undefined, planDigest: string, target: SiteTarget, state: SiteEditState): SiteEditRecord {
  check(edit, 'SITE_EDIT_NOT_FOUND', 'This edit is not here.');
  check(edit.state === state, 'SITE_EDIT_NOT_FOUND', state === 'staged' ? 'This edit is not waiting to be applied.' : 'Only an applied edit can be rolled back.');
  check(planDigest === edit.planDigest, 'APPROVAL_STALE', 'This edit changed since you reviewed it.');
  check(target.identity === edit.target.identity, 'APPROVAL_STALE', 'This edit was staged for another site.');
  check(contentDigest(edit.before) === edit.beforeDigest && contentDigest(edit.after) === edit.afterDigest && planDigestOf(edit) === edit.planDigest,
    'APPROVAL_STALE', 'This edit is not the one you reviewed.');
  return edit;
}

function findEdit(state: State, id: string): SiteEditRecord | undefined {
  return listRecords(state, 'venture-site-edit').find(edit => edit.id === id);
}

function decision(payload: unknown): { editId: string; planDigest: string } {
  const body = exactPayload(payload, ['editId', 'planDigest'], ['editId', 'planDigest']);
  check(typeof body.planDigest === 'string' && body.planDigest.length > 0 && body.planDigest.length <= 128, 'INVALID_VENTURE_REQUEST', 'Send the plan digest you reviewed.');
  return { editId: identifier(body.editId, 'editId'), planDigest: body.planDigest };
}

type WriteStep = { from: SiteEditState; content: 'after' | 'before'; done: 'applied' | 'rolled-back'; line: string };

async function writeReviewed(deps: VentureDeps, ctx: Context, target: SiteTarget, payload: unknown, stepInfo: WriteStep): Promise<SiteEditRecord> {
  const { editId, planDigest } = decision(payload);
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Apply website edits inside the Chausar app.');
  authorize(deps.store, ctx, 'approve');
  const edit = reviewed(findEdit(deps.store.read(), editId), planDigest, target, stepInfo.from);
  check(target.writable, 'SITE_WRITE_NOT_GRANTED', 'Chausar only reads this site. Applying edits needs a write grant you give.');
  const expected = stepInfo.content === 'after' ? edit.beforeDigest : edit.afterDigest;
  const want = stepInfo.content === 'after' ? edit.afterDigest : edit.beforeDigest;
  const live = await target.read(edit.path);
  check(live !== null && contentDigest(live) === expected, 'SITE_CHANGED_SINCE_REVIEW', 'The file changed since you reviewed this edit. Nothing was written.');

  await ventureAction(deps, ctx, 'approve', 'site.edit.claim', tx => {
    const current = reviewed(tx.find('venture-site-edit', editId), planDigest, target, stepInfo.from);
    tx.replace({ ...current, state: 'applying' });
  });

  let confirmed = false;
  try {
    await target.replace(edit.path, edit[stepInfo.content], expected);
    const after = await target.read(edit.path).catch(() => null);
    confirmed = after !== null && contentDigest(after) === want;
  } catch (error) {
    if (error instanceof ChausarError && (error.code === 'SITE_CHANGED_SINCE_REVIEW' || error.code === 'SITE_WRITE_NOT_GRANTED')) {
      await ventureAction(deps, ctx, 'approve', 'site.edit.release', tx => {
        const current = tx.find('venture-site-edit', editId);
        if (current?.state === 'applying') tx.replace({ ...current, state: stepInfo.from });
      });
      throw error;
    }
    confirmed = false;
  }

  return ventureAction(deps, ctx, 'approve', `site.edit.${stepInfo.done}`, tx => {
    const current = tx.find('venture-site-edit', editId);
    check(current, 'SITE_EDIT_NOT_FOUND', 'This edit is not here.');
    if (confirmed) {
      return tx.replace({
        ...current, state: stepInfo.done,
        log: [...current.log,
          { at: tx.now, by: ctx.memberId, step: stepInfo.done, line: stepInfo.line },
          { at: tx.now, by: 'engine', step: 'verified', line: 'Read back after writing: it matches what you reviewed.' }],
      });
    }
    return tx.replace({
      ...current, state: 'needs-inspection',
      log: [...current.log, { at: tx.now, by: 'engine', step: 'needs-inspection', line: 'The write could not be confirmed. Check the file before trying again. The original is kept in this edit.' }],
    });
  });
}

/** The owner applies the exact plan digest they reviewed. */
export async function applySiteEdit(deps: VentureDeps, ctx: Context, target: SiteTarget, payload: unknown): Promise<SiteEditRecord> {
  return writeReviewed(deps, ctx, target, payload, { from: 'staged', content: 'after', done: 'applied', line: 'Applied the edit you reviewed.' });
}

/** Puts back the content from before an applied edit, with the same checks. */
export async function rollbackSiteEdit(deps: VentureDeps, ctx: Context, target: SiteTarget, payload: unknown): Promise<SiteEditRecord> {
  return writeReviewed(deps, ctx, target, payload, { from: 'applied', content: 'before', done: 'rolled-back', line: 'Put back the content from before the edit.' });
}

/** The owner turns a staged edit down. Nothing is written. */
export async function rejectSiteEdit(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SiteEditRecord> {
  const body = exactPayload(payload, ['editId'], ['editId']);
  const editId = identifier(body.editId, 'editId');
  return ventureAction(deps, ctx, 'approve', 'site.edit.reject', tx => {
    const edit = tx.find('venture-site-edit', editId);
    check(edit && edit.state === 'staged', 'SITE_EDIT_NOT_FOUND', 'This edit is not waiting.');
    return tx.replace({ ...edit, state: 'rejected', log: [...edit.log, { at: tx.now, by: ctx.memberId, step: 'rejected', line: 'You turned this edit down. Nothing was written.' }] });
  });
}
