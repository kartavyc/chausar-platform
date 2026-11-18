# Command-line AI tools and local speech

The venture launcher connects the owner's AI through its own model port; see [venture/models.md](venture/models.md) and [venture/README.md](venture/README.md). This page covers two shared pieces under it: how an official command-line tool is started for one text answer (`platform/runtime/gateway.ts`, `platform/runtime/providers/codex-cli.ts`), and speech to text on this computer (`platform/runtime/speech.ts`).

The agent runs that do an owner's jobs are a different path. They are in `platform/runtime/venture/agent-runtime/`.

## One text answer from Codex

`buildCodexCliArguments` builds the whole command. Codex runs `exec` with `--ignore-user-config`, `--ephemeral`, `--skip-git-repo-check`, `--sandbox read-only`, `--json`, an explicit `--model`, an `--output-schema` file, and the prompt on stdin. Every setting in `CODEX_CLI_CONFIG` is passed with `--config`. Those settings:

- never ask for approval, sign in with ChatGPT only, and use the OpenAI provider;
- turn web search off, read no project instructions (`project_doc_max_bytes=0`) and keep no history;
- turn off the shell tool, apps, multi-agent, hooks, memories, goals, plugins, image viewing and image generation, browser and computer use, and the other features listed in the file.

Features that Codex turns on by default and that the route leaves on are listed in `CODEX_FEATURES_LEFT_ON`, each with its reason. A feature a newer Codex turns on that neither list covers is switched off for the call (`unreviewedCodexFeatures`). The provider retry keys are never overridden.

Chausar runs Codex `0.166.0` or a newer version in the same major (`codexVersionAccepted`). The version is a floor, not proof: what a Codex accepts is read from its own help and feature list ([codex-cli-host.md](codex-cli-host.md)). A Codex that lacks a needed flag or setting is refused. There is no fallback to a looser command.

## One text answer from Claude Code

`cliArguments` in `gateway.ts` builds the command: `--print`, `--restricted`, `--safe-mode`, no built-in tools (`--tools ''`), MCP tools disallowed, a strict and empty MCP configuration, `--disable-slash-commands`, `--no-chrome`, `--no-session-persistence`, JSON output, an explicit `--model`, one turn (`--max-turns 1`), a JSON schema and a system prompt.

## What both keep

- The tool is started without a shell. Its output is capped at 1 MiB and it has a time limit. When either is passed, the tool and what it started are ended (`defaultProcess`).
- The tool gets only the environment names it needs to find itself and its own sign-in (`CLI_BASE_ENV_NAMES`, plus `CODEX_HOME` for Codex).
- Chausar never opens, copies or saves a sign-in file or token of either tool.

Official references: the [Codex CLI reference](https://developers.openai.com/codex/cli/reference), the [Codex configuration reference](https://developers.openai.com/codex/config-reference), and the [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference).

## Local speech

Speech to text runs on this computer only, through the owner's own [whisper.cpp](https://github.com/ggml-org/whisper.cpp). The owner sets it up in the app (`venture.transcription.set`) with two full paths: the `whisper-cli` program and a model file. Chausar never installs the program and never downloads a model. A path on a network share is refused, and so is a program not named `whisper-cli`.

`SpeechService.transcribeFile` turns one sound file into SRT text:

- one run, in a temporary folder that is removed afterwards;
- the language is detected (`-l auto`), and an optional one-line prompt of up to 1,000 characters carries the business's own words;
- a time limit of ten minutes by default (one second to fifteen minutes);
- the sound is never uploaded, the run is never retried, and there is no fallback;
- when the business closes mid-run, the run is stopped and nothing is kept.

If the program or the model is no longer where it was set up, the app says so and nothing runs.

## Tests

`node --test platform/tests/codex-cli.test.ts platform/tests/speech.test.ts` covers the command-line arguments and the speech service. These tests start no real Codex, Claude Code or whisper.cpp.
