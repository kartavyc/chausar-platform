# Native Codex host activation

The normal HTTP server and desktop worker now construct their Gateway options from
operator-owned, pinned CLI interface evidence before creating the Engine. This is
an opt-in host setting. No renderer, route payload, workspace file or RPC can
install the profile. Unconfigured installations retain the existing
`CLI_CAPABILITY_REQUIRED` refusal.

Set both host environment variables before launching Chausar:

- `CHAUSAR_CODEX_CLI_EVIDENCE_FILE`: the absolute path to `codex-cli-host.json`.
- `CHAUSAR_CODEX_CLI_EVIDENCE_SHA256`: its exact lowercase SHA256, calculated over
  the recorded raw bytes, including any BOM or CRLF.

The desktop main process already copies its environment into EngineHarness, which
passes it into the worker. The server's direct entrypoint and worker's direct
entrypoint await the same verified constructors used by the focused tests. A
partial or invalid setting fails startup before HTTP listening or worker readiness.
No desktop, renderer, preload or harness changes are needed.

The manifest has this structure; placeholders must be replaced with real reviewed
operator evidence, never synthetic test contents:

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

Artifact files must stay beneath the manifest directory, including their physical
resolved locations, and snapshots must be regular files rather than links. Accepted role names are
`version.stdout.txt`, `cli-version.txt`, `desktop-cli-version.txt`;
`exec-help.stdout.txt`, `cli-exec-help.txt`, `desktop-cli-exec-help.txt`; and
`features.stdout.txt`, `cli-features.txt`, `desktop-cli-features.txt`. The manifest
and each artifact have a 256 KiB limit. The selected native binary has a 512 MiB
limit. PowerShell/npm wrapper paths are refused; Chausar spawns without a shell.

The loader checks the manifest pin before parsing it, checks each recorded artifact
pin before decoding it, requires successful records from the exact selected binary
and version, and checks its current native executable hash. Flags, stdin prompt and
read-only sandbox support are derived from the exec help. Required feature keys
are derived from that version's feature listing; a removed or absent feature is
refused. Ordinary TOML keys need an explicit review against the
[official configuration reference](https://developers.openai.com/codex/config-reference)
or its [current documentation location](https://learn.chatgpt.com/docs/config-file/config-reference).
Generic `--config` help alone does not establish support for those keys.

Configure the existing Codex route with the **exact absolute native path** in the
manifest and the explicit requested model identifier. A bare `codex` route is not
silently rewritten. The trusted host process port checks the executable hash again
immediately before each dispatch; the existing adapter then requires its bounded
arguments, schema/stdin boundary and successful `turn.completed`. It makes one
application invocation, without a fallback route or model substitution. Startup
verification executes no Codex command and opens no credentials, user config or
model cache.

An `installed-help` profile is local interface evidence. It does not establish
ChatGPT sign-in, current account entitlement, model access, successful inference,
or commercial/hosted eligibility. Synthetic in-memory snapshots and process ports
in the tests establish source behavior only. Recorded evidence for one CLI version
must not be reused for another binary. Refresh and repin the manifest when the
executable or snapshots change.

The recorded 0.159.2 Luna invocation is separate inference evidence supplied by
the diagnosis lane; this implementation does not run another inference. Its
`tools.view_image` ignored-key warning needs a provider contract correction before
that key can truthfully be declared supported. A successful version-matched
0.159.2 feature listing is now recorded by the host evidence lane; it must be
packaged and pinned with the matching version/help artifacts. Older feature evidence
cannot qualify the newer executable. This lane creates no personal installation manifest or
account/model grant.
