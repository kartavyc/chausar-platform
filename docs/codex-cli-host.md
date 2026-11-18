# Trusting a Codex on this computer

Chausar runs a Codex only through a pinned manifest of its reviewed setup: the program's digest and version, and its own `--version`, `exec --help` and `features list` answers, each pinned. `loadCodexCliHostGateway` in `platform/runtime/codex-cli-host.ts` checks the manifest in full when the engine starts, and the program's digest is checked again before every call.

Three parties can record a manifest (`platform/runtime/codex-trust.ts`):

- **The operator**, with two environment variables set before Chausar starts. They win over the other two. This page describes that path.
- **The build**, for the Codex shipped inside the beta. The engine checks the bundle's recorded digests at start and writes the manifest into the trust folder.
- **The owner**, for a Codex found on this computer. The app shows its path, version and digest first, and keeps the manifest only when the owner confirms that exact digest.

No window, request payload, business file or method can install a manifest.

## The operator's two variables

- `CHAUSAR_CODEX_CLI_EVIDENCE_FILE`: the absolute path to a file named `codex-cli-host.json`.
- `CHAUSAR_CODEX_CLI_EVIDENCE_SHA256`: its exact lowercase SHA-256, over the raw bytes, including any BOM or CRLF.

Set both or neither. A half-set or invalid pair stops the local server before it listens, and the desktop worker before it is ready.

The manifest has this shape. Replace each placeholder with real, reviewed evidence, never with test contents:

```json
{
  "schemaVersion": 1,
  "recordedAt": "<ISO timestamp>",
  "executable": {
    "path": "<absolute native codex.exe or codex path>",
    "sha256": "<native executable SHA256>",
    "version": "<exact CLI version>"
  },
  "versionOutput": {
    "file": "version.stdout.txt",
    "sha256": "<raw version output SHA256>",
    "executableSha256": "<same native executable SHA256>",
    "version": "<same CLI version>",
    "exitCode": 0
  },
  "execHelp": {
    "file": "exec-help.stdout.txt",
    "sha256": "<raw exec help SHA256>",
    "executableSha256": "<same native executable SHA256>",
    "version": "<same CLI version>",
    "exitCode": 0
  },
  "features": {
    "file": "features.stdout.txt",
    "sha256": "<raw feature listing SHA256>",
    "executableSha256": "<same native executable SHA256>",
    "version": "<same CLI version>",
    "exitCode": 0
  },
  "configReview": {
    "source": "https://developers.openai.com/codex/config-reference",
    "reviewedAt": "<ISO timestamp>",
    "keys": ["<explicitly reviewed ordinary keys required by the adapter>"]
  }
}
```

## What the loader checks

- The manifest's pin, before it is parsed. Each recorded file's pin, before it is decoded.
- Each recorded file stays under the manifest's folder, by its real location, and is a regular file, not a link.
- The accepted file names are `version.stdout.txt`, `cli-version.txt`, `desktop-cli-version.txt`; `exec-help.stdout.txt`, `cli-exec-help.txt`, `desktop-cli-exec-help.txt`; and `features.stdout.txt`, `cli-features.txt`, `desktop-cli-features.txt`.
- The manifest and each file are at most 256 KiB. The program is at most 512 MiB.
- Every record comes from the same program and version, with exit code 0, and the version answer reads `codex-cli <version>`.
- The program's digest now equals the recorded one.
- The flags, the stdin prompt and the read-only sandbox are read from the exec help. The feature settings the adapter needs must be in that version's feature list and not marked removed.
- The ordinary settings need an explicit review against the [official configuration reference](https://developers.openai.com/codex/config-reference) or its [current location](https://learn.chatgpt.com/docs/config-file/config-reference), named in `configReview`.

Checking a manifest runs no Codex command and opens no sign-in file, user configuration or model cache.

## Limits

- The evidence is about the interface of one program on this computer. It does not prove a ChatGPT sign-in, an account's plan, access to a model or a successful answer.
- Evidence for one Codex version must not be reused for another program. Record and pin a new manifest when the program or its answers change.
- The adapter turns the shell tool off with `features.shell_tool=false`. It does not rely on `unified_exec` being off, because managed policy can force that on ([codex-cli-adapter.md](codex-cli-adapter.md)). A tool item in the output still refuses the answer.
- Chausar changes no operating system policy and no managed requirement.

## Tests

`node --test platform/tests/codex-cli-host.test.ts platform/tests/codex-cli-host-entrypoints.test.ts platform/tests/codex-trust.test.ts`. They use made-up snapshots and stand-in processes, so they show how the code behaves, not that any real Codex is trusted.
