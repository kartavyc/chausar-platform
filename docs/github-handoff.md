# New private repository handoff

The requested destination is **`kartavyc/chausar-platform`**, with remote URL **`https://github.com/kartavyc/chausar-platform.git`**. The final read-only GitHub API check returned HTTP 404 for that repository. No repository was created or pushed during this build. Existing `kartavyc/chausar-v1` was read only to recover the supplied specifications and must not be used as the destination.

The authenticated GitHub connector exposes file, tree, commit and reference operations for an existing repository, but no supported operation to create a repository. The available Sites source-repository credential operation only mints credentials for an existing Site project; it cannot create this GitHub repository independently. No unrelated Site or deployment was created to work around that limitation.

The local CLI request to `https://api.github.com/user` was rejected by the environment's network policy with `connectex: An attempt was made to access a socket in a way forbidden by its access permissions.` This is network failure evidence, not proof that the user's GitHub credential is invalid. No secret was read or printed. No browser action is required to inspect the source bundle.

Create the **new empty private** repository using [GitHub's repository creation page](https://github.com/new?name=chausar-platform&visibility=private): choose owner `kartavyc`, name `chausar-platform`, explicitly select **Private**, and leave README, .gitignore and license initialization unchecked. Confirm the resulting repository URL is [github.com/kartavyc/chausar-platform](https://github.com/kartavyc/chausar-platform). The visibility selection must be checked in the form; query parameters alone are not a privacy guarantee.

Alternatively, once the authorized publisher has working network access and GitHub CLI authentication, the [documented GitHub CLI command](https://cli.github.com/manual/gh_repo_create) creates a new empty private repository:

```powershell
gh repo create kartavyc/chausar-platform --private --description "Chausar local-first desktop platform preview"
```

Run creation only once. If GitHub reports that the name already exists, stop and verify its ownership, visibility and empty state. Do not switch to an existing project or force-push over its history.

After creation, publish the reviewed source from its local project directory:

```powershell
Set-Location 'C:\Users\karta\Documents\Codex\2026-10-01\new-chat-2\chausar-platform'
git status --short
git remote -v
```

If this directory already has the build's local Git commit, retain its history. Otherwise initialize and commit the complete reviewed source:

```powershell
git init -b main
git add .
git commit -m "Build Chausar local-first desktop platform preview"
```

Add the destination only when `origin` is absent. If it is present, verify it is the exact new repository before pushing; do not overwrite a different origin silently:

```powershell
git remote add origin https://github.com/kartavyc/chausar-platform.git
git push -u origin main
gh repo view kartavyc/chausar-platform --json nameWithOwner,isPrivate,url
git ls-remote origin refs/heads/main
git rev-parse HEAD
```

Verify `isPrivate` is `true` and the remote `main` hash equals the local reviewed commit. No signed native installer or live connector qualification is implied by publishing the preview source. Packaging prerequisites are documented in `runtime-binaries/README.md`; the missing real runtimes, signing prerequisites and dependency lockfile must be resolved before any production installer release.
