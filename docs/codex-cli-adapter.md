# The Codex command-line adapter

`platform/runtime/providers/codex-cli.ts` is the reviewed way Chausar asks an installed Codex for one text answer. The Codex program owns its own ChatGPT sign-in. The adapter takes one explicit model id. It holds no API key, opens no sign-in page, calls no backend address of its own and has no paid fallback.

What the command is and which settings it passes are in [model-routes.md](model-routes.md). How a Codex on this computer comes to be trusted is in [codex-cli-host.md](codex-cli-host.md). This page lists what the file exports.

## What the file exports

- `buildCodexCliArguments(model, schemaPath, profile)`: checks the interface profile it is given and builds the bounded command. A profile that lacks a needed flag, setting, stdin prompt or the read-only sandbox refuses the run. A control is never quietly left out.
- `parseCodexCliOutput(stdout)`: reads bounded JSON lines. The answer is the last message of the turn, which must be a JSON object, and the turn must end with a successful `turn.completed`. It refuses errors, failed or repeated turns, anything after the completed turn, events it does not know, and any tool item (a command run, a file change, an MCP call, a web search, computer use). Token usage is checked when present and never made up. The caller still checks what the answer means.
- `createCodexCliProcessAdapter({ capabilities, process, mode })`: wraps the process port a trusted host hands in. Before the one call it checks the exact arguments, the program path, the environment names, the size of the input and schema, and the time limit. A zero exit code alone is not enough: the output must parse. The module itself never starts a process, opens a sign-in file or writes a schema file.
- `codexCliBoundary(request)`: hashes the exact text sent on stdin and the declared schema. It reports `application-to-official-cli` with `providerPayloadObserved: false`, because Chausar never sees what Codex sends to its provider.
- `codexVersionAccepted(version)`, `CODEX_MINIMUM_VERSION`, `REVIEWED_CODEX_VERSIONS`: which Codex versions Chausar runs.
- `CODEX_CLI_FLAGS`, `CODEX_CLI_CONFIG`, `CODEX_FEATURES_LEFT_ON`, `unreviewedCodexFeatures`, `CODEX_QUIET_ARGS`: the flags and settings of the command, the features left on with their reasons, and how a newer Codex's new features are found and switched off.
- `CODEX_CLI_LIMITS`: 1 MiB of output, 256 events of at most 256 KiB each, a 64 KiB answer, 256 KiB of stdin, a 64 KiB schema and a two-minute time limit.

## Kinds of evidence

A profile says where its knowledge of the interface came from: `synthetic-fixture`, `official-docs` or `installed-help`. A documentation profile can build arguments. A real process needs `installed-help` evidence bound to the exact program path. A fixture profile works only in the explicit synthetic mode and can never stand for a real program.

A profile is evidence about the interface only. It does not prove a sign-in, an account's plan, that a model is available, or that a call will succeed.

## Limits

- The adapter makes exactly one call. Retries inside Codex itself, policy set by a managed computer, and every tool Codex might hold are outside what Chausar can see. Refusing a tool event cannot undo a tool Codex already tried.
- Built-in provider ids cannot be redefined, so the adapter passes no provider retry settings.

## Tests

`node --test platform/tests/codex-cli.test.ts`. Every case uses a stand-in process. None starts a real Codex, so none proves a sign-in, an account or a model.
