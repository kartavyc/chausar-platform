// Chausar venture launcher: following the build on GitHub, read only (package P4).
// At most nine GET calls per sync, every path part and query value encoded, every response digested and kept
// as a receipt. Only fine-grained tokens are accepted, and they stay in memory (the SecretShelf). The status
// says only what GitHub shows and lists what Chausar cannot see.
import { ChausarError, authorize, check, type Context, type State } from '../../contracts.ts';
import type {
  BuildFollowRecord, BuildStatus, BuildStatusWord, GitHubFixture, GitHubReadRecord, GitHubRequest, GitHubResponse, GitHubTransport,
  HandoffRecord, RepoRef, SecretName, VentureDeps, VentureResults,
} from '../contracts.ts';
import { digest, exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { latestBrief } from './brief.ts';
import { checkConnectorFields } from './connector-truth.ts';

export const TOKEN_LINK = 'https://github.com/settings/personal-access-tokens/new?name=Chausar%20read%20only&description=Lets%20Chausar%20read%20one%20app%20repo.%20Read%20only.&expires_in=90&contents=read&metadata=read&deployments=read&actions=read';

export const GITHUB_API = 'https://api.github.com';
export const GITHUB_API_VERSION = '2026-03-10';
export const MAX_GITHUB_CALLS = 9;
const READ_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 1024 * 1024;
const TEN_MINUTES = 10 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

export const CANNOT_SAY = Object.freeze([
  'Whether your app works.',
  'Your Lovable or Replit preview.',
  'How many builder credits you used.',
  'Your live address, unless a host records a deployment.',
  'Whether your client data is locked down.',
]);
export const CANNOT_SAY_WORKFLOW = 'Whether your UI check is safe to run: its workflow needs read-only permissions.';
export const CANNOT_SAY_FIXTURE = 'These answers come from a synthetic recording, not your real repo.';

const LOVABLE_BOTS = new Set(['lovable-dev[bot]', 'gpt-engineer-app[bot]']);

const readFailed = (message = 'GitHub did not answer as expected. Try again later.') => new ChausarError('GITHUB_READ_FAILED', message);

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw readFailed('GitHub sent more than Chausar reads at once.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Real GitHub REST reads. Conditional requests with ETags are planned, not built. */
export function defaultGitHubTransport(): GitHubTransport {
  return {
    kind: 'github-api',
    async read(request: GitHubRequest): Promise<GitHubResponse> {
      check(typeof request?.path === 'string' && request.path.startsWith('/') && !request.path.startsWith('//') && request.path.length <= 2000,
        'INVALID_VENTURE_REQUEST', 'GitHub reads use a path on the API.');
      const url = new URL(GITHUB_API + request.path);
      check(url.origin === GITHUB_API, 'INVALID_VENTURE_REQUEST', 'GitHub reads stay on api.github.com.');
      const headers: Record<string, string> = {
        Accept: request.accept === 'raw' ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': 'chausar-local',
      };
      if (request.token) headers.Authorization = `Bearer ${request.token}`;
      let response: Response;
      try {
        response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
      } catch {
        throw readFailed('GitHub could not be reached. Check your connection and try again.');
      }
      let body: string;
      try {
        body = await readCapped(response);
      } catch (error) {
        if (error instanceof ChausarError) throw error;
        throw readFailed('GitHub stopped answering part way. Try again.');
      }
      const remaining = response.headers.get('x-ratelimit-remaining');
      return {
        status: response.status,
        etag: response.headers.get('etag'),
        body,
        rateRemaining: remaining !== null && /^\d{1,9}$/.test(remaining) ? Number(remaining) : null,
      };
    },
  };
}

/** Synthetic recordings only. Looks up the exact path; a missing path is a 404. */
export function createFixtureGitHubTransport(fixture: GitHubFixture, vars?: () => Record<string, string>): GitHubTransport {
  check(fixture !== null && typeof fixture === 'object' && fixture.label === 'synthetic recording', 'INVALID_VENTURE_REQUEST',
    'GitHub recordings must be labelled synthetic recording.');
  check(fixture.responses !== null && typeof fixture.responses === 'object' && !Array.isArray(fixture.responses), 'INVALID_VENTURE_REQUEST',
    'This GitHub recording has no responses.');
  const responses = fixture.responses;
  return {
    kind: 'fixture',
    async read(request: GitHubRequest): Promise<GitHubResponse> {
      const entry = typeof request?.path === 'string' && Object.hasOwn(responses, request.path) ? responses[request.path] : null;
      if (!entry) return { status: 404, etag: null, body: '{"message":"Not Found"}', rateRemaining: null };
      let body: string;
      if (typeof entry.body === 'string') {
        const values = vars ? vars() : {};
        body = entry.body.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (whole, name: string) => Object.hasOwn(values, name) ? String(values[name]) : whole);
      } else {
        body = JSON.stringify(entry.body);
      }
      return { status: entry.status, etag: entry.etag ?? null, body, rateRemaining: null };
    },
  };
}

// ---------------------------------------------------------------------------
// venture.build.link { repo, token? } (level admin, app only)
// ---------------------------------------------------------------------------

const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const INVALID_REPO_MESSAGE = 'Use your repo as owner/name, or paste its address from github.com.';

export function parseRepo(input: unknown): RepoRef {
  check(typeof input === 'string' && input.length <= 300, 'INVALID_REPO', INVALID_REPO_MESSAGE);
  const text = input.trim();
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    let url: URL;
    try { url = new URL(text); } catch { throw new ChausarError('INVALID_REPO', INVALID_REPO_MESSAGE); }
    check(url.protocol === 'https:' && url.hostname === 'github.com' && url.port === '' && !url.username && !url.password && !url.search && !url.hash,
      'INVALID_REPO', INVALID_REPO_MESSAGE);
    check(text.startsWith('https://github.com/'), 'INVALID_REPO', INVALID_REPO_MESSAGE);
    path = text.slice('https://github.com/'.length).replace(/\/$/, '');
  } else {
    path = text;
  }
  const parts = path.split('/');
  check(parts.length === 2, 'INVALID_REPO', INVALID_REPO_MESSAGE);
  const owner = parts[0];
  const name = parts[1].endsWith('.git') ? parts[1].slice(0, -4) : parts[1];
  check(OWNER.test(owner) && NAME.test(name) && name !== '.' && name !== '..', 'INVALID_REPO', INVALID_REPO_MESSAGE);
  return { owner, name };
}

export function secretNameFor(repo: RepoRef): SecretName {
  return `github:${repo.owner}/${repo.name}`;
}

export function checkToken(token: unknown): string {
  check(typeof token === 'string' && token.startsWith('github_pat_'), 'TOKEN_NOT_FINE_GRAINED',
    'Use a fine-grained token that starts with github_pat_, for this one repo. Create one with the link on this screen.');
  check(token.length >= 20 && token.length <= 255 && /^[\x21-\x7E]+$/.test(token), 'INVALID_VENTURE_REQUEST',
    'Paste the whole token: 20 to 255 characters with no spaces.');
  return token;
}

export function latestFollow(state: State, ventureId: string): BuildFollowRecord | null {
  const all = listRecords(state, 'venture-build-follow', ventureId);
  return all.length ? all[all.length - 1] : null;
}

export async function linkRepo(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BuildFollowRecord> {
  requireAppChannel(ctx, 'venture.build.link');
  const body = exactPayload(payload ?? {}, ['repo', 'token'], ['repo']);
  // 4J7 (K6): GitHub's capability set names every field following a repo takes.
  checkConnectorFields('github', 'read-repo', Object.keys(body));
  const repo = parseRepo(body.repo);
  const token = body.token === undefined ? null : checkToken(body.token);
  authorize(deps.store, ctx, 'admin');
  readVenture(deps, ctx);
  const name = secretNameFor(repo);
  const before = deps.secrets.get(name);
  if (token) deps.secrets.set(name, token);
  else deps.secrets.delete(name);
  let previous: BuildFollowRecord | null = null;
  try {
    const record = await ventureAction(deps, ctx, 'admin', 'build.link', tx => {
      previous = latestFollow(tx.state, tx.venture!.id);
      const follow: BuildFollowRecord = {
        ...tx.base('venture-build-follow'), repo, tokenState: token ? 'in-memory' : 'none', linkedAt: tx.now, lastStatus: null,
      };
      const stored = tx.put(follow);
      tx.emit('repo-linked', { repo: `${repo.owner}/${repo.name}`, tokenState: follow.tokenState });
      return stored;
    });
    const old = previous as BuildFollowRecord | null;
    if (old && secretNameFor(old.repo) !== name) deps.secrets.delete(secretNameFor(old.repo));
    return record;
  } catch (error) {
    if (before === null) deps.secrets.delete(name);
    else deps.secrets.set(name, before);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// venture.build.sync {} (level prepare)
// ---------------------------------------------------------------------------

type ReadCall = GitHubReadRecord['calls'][number];

function jsonOf(response: GitHubResponse): unknown {
  try { return JSON.parse(response.body); } catch { throw readFailed('GitHub sent an answer Chausar could not read.'); }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function shortText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && !/[\u0000-\u001F\u007F]/.test(value) ? value : null;
}

function isoOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Who made the last commit, from the logins GitHub verifies, never from the free-text git author name. */
export function commitAuthor(item: Record<string, unknown>, newestHandoff: HandoffRecord | null): NonNullable<BuildStatus['lastCommit']>['by'] {
  const logins = [item.author, item.committer]
    .map(user => (plainObject(user) && typeof user.login === 'string' ? user.login.toLowerCase() : null))
    .filter((login): login is string => login !== null);
  if (logins.some(login => LOVABLE_BOTS.has(login))) return 'lovable';
  if (logins.some(login => login.endsWith('[bot]') && login.includes('replit'))) return 'replit';
  if (logins.some(login => login.endsWith('[bot]'))) return 'other';
  if (newestHandoff?.builder === 'replit') return 'repo-account';
  return 'you';
}

function deploymentFrom(statusBody: unknown, asOf: string): BuildStatus['deployment'] {
  if (!Array.isArray(statusBody) || statusBody.length === 0 || !plainObject(statusBody[0])) return null;
  const status = statusBody[0];
  if (status.state !== 'success' || typeof status.environment_url !== 'string' || status.environment_url.length > 2000) return null;
  let url: URL;
  try { url = new URL(status.environment_url); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return { host: url.hostname || null, url: url.href, at: isoOf(status.created_at) ?? isoOf(status.updated_at) ?? asOf };
}

function statusWord(conflict: string | null, lastCommit: BuildStatus['lastCommit'], asOf: string): BuildStatusWord {
  if (conflict) return 'sync-conflict';
  if (!lastCommit) return 'repo-connected';
  const age = Date.parse(asOf) - Date.parse(lastCommit.at);
  if ((lastCommit.by === 'lovable' || lastCommit.by === 'replit') && age <= TEN_MINUTES) return 'builder-making-changes';
  if (age > ONE_DAY) return 'quiet';
  return 'repo-connected';
}

export async function syncRepo(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BuildStatus> {
  exactPayload(payload ?? {}, []);
  authorize(deps.store, ctx, 'prepare'); // before any GitHub read
  const { state, venture } = readVenture(deps, ctx);
  const follow = latestFollow(state, venture.id);
  check(follow, 'REPO_NOT_LINKED', 'Follow your GitHub repo first.');
  const token = deps.secrets.get(secretNameFor(follow.repo));
  check(follow.tokenState !== 'in-memory' || token, 'GITHUB_UNAUTHORIZED', 'Enter your GitHub token again. Chausar keeps tokens in memory only.');

  const briefs = listRecords(state, 'venture-brief', venture.id);
  const latest = latestBrief(state, venture.id);
  const handoffs = listRecords(state, 'venture-handoff', venture.id);
  const newestHandoff = handoffs.length ? handoffs.reduce((a, b) => (b.at >= a.at ? b : a)) : null;

  const o = encodeURIComponent(follow.repo.owner);
  const r = encodeURIComponent(follow.repo.name);
  const base = `/repos/${o}/${r}`;
  const calls: ReadCall[] = [];
  const read = async (path: string, accept: 'json' | 'raw'): Promise<GitHubResponse> => {
    check(calls.length < MAX_GITHUB_CALLS, 'GITHUB_READ_FAILED', 'Chausar reads GitHub at most nine times per check.');
    let response: GitHubResponse;
    try {
      response = await deps.github.read({ path, accept, etag: null, token: token ?? null });
    } catch (error) {
      if (error instanceof ChausarError) throw error;
      throw readFailed('GitHub could not be reached. Check your connection and try again.');
    }
    check(response && Number.isInteger(response.status) && typeof response.body === 'string', 'GITHUB_READ_FAILED', 'GitHub did not answer as expected. Try again later.');
    calls.push({ path, status: response.status, etag: typeof response.etag === 'string' ? response.etag.slice(0, 200) : null, bodyDigest: digest(response.body), fetchedAt: deps.clock().toISOString() });
    return response;
  };

  // 1. The repo. Failures here store nothing.
  const repoResponse = await read(base, 'json');
  if (repoResponse.status !== 200) {
    if (repoResponse.status === 401) throw new ChausarError('GITHUB_UNAUTHORIZED', 'GitHub refused the token. Create a new read-only token with the link on this screen.');
    if (repoResponse.status === 404) throw new ChausarError('GITHUB_NOT_FOUND', 'GitHub did not find that repo. Check the name, and that your token can read it.');
    if (repoResponse.status === 403 && repoResponse.rateRemaining === 0) throw new ChausarError('GITHUB_RATE_LIMITED', "GitHub's hourly limit was reached. Try again later.");
    throw readFailed();
  }
  const repoBody = jsonOf(repoResponse);
  check(plainObject(repoBody), 'GITHUB_READ_FAILED', 'GitHub sent an answer Chausar could not read.');
  const defaultBranch = shortText(repoBody.default_branch, 255);
  check(defaultBranch, 'GITHUB_READ_FAILED', 'GitHub did not say which branch is the main one.');
  let htmlUrl: string | null = null;
  if (typeof repoBody.html_url === 'string' && repoBody.html_url.length <= 500) {
    try {
      const parsed = new URL(repoBody.html_url);
      if (parsed.origin === 'https://github.com' && !parsed.username && !parsed.password) htmlUrl = parsed.href;
    } catch { htmlUrl = null; }
  }
  const repoView: BuildStatus['repo'] = {
    fullName: shortText(repoBody.full_name, 200) ?? `${follow.repo.owner}/${follow.repo.name}`,
    private: typeof repoBody.private === 'boolean' ? repoBody.private : null,
    defaultBranch,
    htmlUrl,
  };

  // 2. The newest commits on the main branch.
  let lastCommit: BuildStatus['lastCommit'] = null;
  let sha: string | null = null;
  const commitsResponse = await read(`${base}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=20`, 'json');
  let commitsReadable = false;
  if (commitsResponse.status === 200) {
    const commits = jsonOf(commitsResponse);
    check(Array.isArray(commits), 'GITHUB_READ_FAILED', 'GitHub sent an answer Chausar could not read.');
    commitsReadable = true;
    if (commits.length > 0) {
      const item = commits[0];
      check(plainObject(item) && typeof item.sha === 'string' && /^[0-9a-f]{40}$/.test(item.sha), 'GITHUB_READ_FAILED', 'GitHub sent a commit Chausar could not check.');
      sha = item.sha;
      const commit = plainObject(item.commit) ? item.commit : {};
      const when = isoOf(plainObject(commit.committer) ? commit.committer.date : undefined) ?? isoOf(plainObject(commit.author) ? commit.author.date : undefined);
      check(when, 'GITHUB_READ_FAILED', 'GitHub sent a commit without a date.');
      const message = typeof commit.message === 'string' ? commit.message.split(/\r?\n/)[0].replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 200) : '';
      lastCommit = { sha, at: when, by: commitAuthor(item, newestHandoff), message };
    }
  }

  // 3. Branches, for a sync conflict.
  let syncConflictBranch: string | null = null;
  const branchesResponse = await read(`${base}/branches?per_page=100`, 'json');
  if (branchesResponse.status === 200) {
    const branches = jsonOf(branchesResponse);
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        const name = plainObject(branch) ? shortText(branch.name, 255) : null;
        if (name && (name.startsWith('lovable-sync') || name === 'lovable-fallback')) { syncConflictBranch = name; break; }
      }
    }
  }

  let briefMarker: BuildStatus['briefMarker'] = 'not-checked';
  let briefMarkerVersion: number | null = null;
  let markerFile: string | null = null;
  let uiWorkflow: BuildStatus['uiWorkflow'] = 'not-checked';
  let checks: BuildStatus['checks'] = commitsReadable ? 'none-reported' : 'not-readable';
  if (sha) {
    const ref = encodeURIComponent(sha);
    // 4. The brief marker file.
    let markerText: string | null = null;
    let markerStatus = 0;
    for (const file of ['AGENTS.md', 'replit.md']) {
      const response = await read(`${base}/contents/${encodeURIComponent(file)}?ref=${ref}`, 'raw');
      markerStatus = response.status;
      if (response.status === 200) { markerText = response.body; markerFile = file; break; }
      if (response.status !== 404) break;
    }
    if (markerText !== null) {
      const ids = [...markerText.matchAll(/chausar-brief-id:[ \t]*(chb_[a-z0-9]{8})(?![a-z0-9])/g)].map(match => match[1]);
      if (latest && ids.includes(latest.briefId)) {
        briefMarker = 'found';
        briefMarkerVersion = latest.version;
      } else {
        const older = briefs.filter(brief => ids.includes(brief.briefId)).sort((a, b) => b.version - a.version)[0];
        if (older) { briefMarker = 'older'; briefMarkerVersion = older.version; } else briefMarker = 'missing';
      }
    } else {
      briefMarker = markerStatus === 404 ? 'missing' : 'not-checked';
    }

    // 5. The UI lint workflow.
    const workflowPath = ['.github', 'workflows', 'ui-lint.yml'].map(encodeURIComponent).join('/');
    const workflowResponse = await read(`${base}/contents/${workflowPath}?ref=${ref}`, 'raw');
    if (workflowResponse.status === 200) {
      uiWorkflow = workflowResponse.body.includes('contents: read') && !workflowResponse.body.includes('pull_request_target') ? 'found' : 'needs-fix';
    } else if (workflowResponse.status === 404) {
      uiWorkflow = 'missing';
    }

    // 6. Runs for this commit; only runs named "UI lint" count.
    const runsResponse = await read(`${base}/actions/runs?head_sha=${ref}&per_page=5`, 'json');
    if (runsResponse.status === 200) {
      const runsBody = jsonOf(runsResponse);
      const runs = plainObject(runsBody) && Array.isArray(runsBody.workflow_runs) ? runsBody.workflow_runs.filter(plainObject) : [];
      const uiRuns = runs.filter(run => run.name === 'UI lint');
      const newestCompleted = uiRuns.find(run => run.status === 'completed');
      if (uiRuns.some(run => run.conclusion === 'failure')) checks = 'failed';
      else if (newestCompleted && newestCompleted.conclusion === 'success') checks = 'passed';
      else checks = 'none-reported';
    } else {
      checks = 'not-readable';
    }
  }

  // 7. Deployments, and the newest status of the newest one.
  let deployment: BuildStatus['deployment'] = null;
  const asOf = deps.clock().toISOString();
  const deploymentsResponse = await read(`${base}/deployments?per_page=5`, 'json');
  if (deploymentsResponse.status === 200) {
    const deployments = jsonOf(deploymentsResponse);
    if (Array.isArray(deployments) && deployments.length > 0) {
      const first = deployments[0];
      const id = plainObject(first) && (typeof first.id === 'number' || typeof first.id === 'string') ? String(first.id) : '';
      check(/^[0-9]{1,20}$/.test(id), 'GITHUB_READ_FAILED', 'GitHub sent a deployment Chausar could not check.');
      const statusesResponse = await read(`${base}/deployments/${encodeURIComponent(id)}/statuses?per_page=1`, 'json');
      if (statusesResponse.status === 200) deployment = deploymentFrom(jsonOf(statusesResponse), asOf);
    }
  }

  const transport = deps.github.kind;
  const status: BuildStatus = {
    word: statusWord(syncConflictBranch, lastCommit, asOf),
    asOf,
    readId: null,
    repo: repoView,
    lastCommit,
    briefMarker,
    briefMarkerVersion,
    markerFile,
    uiWorkflow,
    checks,
    deployment,
    syncConflictBranch,
    cannotSay: [
      ...CANNOT_SAY,
      ...(uiWorkflow === 'needs-fix' ? [CANNOT_SAY_WORKFLOW] : []),
      ...(transport === 'fixture' ? [CANNOT_SAY_FIXTURE] : []),
    ],
  };

  return ventureAction(deps, ctx, 'prepare', 'build.sync', tx => {
    const current = latestFollow(tx.state, tx.venture!.id);
    check(current && current.id === follow.id, 'APPROVAL_STALE', 'Your repo link changed while Chausar was reading. Check GitHub again.');
    const readRecord: GitHubReadRecord = { ...tx.base('venture-build-read'), repo: { ...follow.repo }, calls, transport };
    tx.put(readRecord);
    const finished: BuildStatus = { ...status, readId: readRecord.id };
    tx.replace({ ...current, lastStatus: finished });
    tx.emit('repo-synced', { readId: readRecord.id, word: finished.word, calls: calls.length });
    return finished;
  });
}

// ---------------------------------------------------------------------------
// venture.build.status {} (level read)
// ---------------------------------------------------------------------------

export async function buildStatus(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureResults['venture.build.status']> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readVenture(deps, ctx);
  const stored = latestFollow(state, venture.id);
  // The shelf is memory only: after a restart a stored 'in-memory' token is gone, so say so.
  const follow = stored ? { ...stored, tokenState: deps.secrets.has(secretNameFor(stored.repo)) ? 'in-memory' as const : 'none' as const } : null;
  const handoffs = listRecords(state, 'venture-handoff', venture.id)
    .map((record, index) => ({ record, index }))
    .sort((a, b) => (a.record.at === b.record.at ? b.index - a.index : a.record.at < b.record.at ? 1 : -1))
    .map(item => item.record);
  return { follow, brief: latestBrief(state, venture.id), handoffs, tokenLink: TOKEN_LINK };
}
