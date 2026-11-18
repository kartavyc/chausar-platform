# Chausar

Millions of people have skills they could earn more from, but starting a business around those skills is a different job altogether. Chausar is being built to help them make that leap. You tell it what you're good at. It helps you figure out what service you could offer, set up the business, and get the work done with an AI team behind you. You don't need to know how to build agents or write prompts.

Chausar is a desktop app. It is a beta (version `0.1.0-preview.1`), free, built for India first and open to everyone else.

## What it does today

- **You pick a way to earn.** Tell Chausar about your work, or pick your field. It writes a plan from its built-in playbooks (the ways to earn, in `platform/runtime/venture/playbooks/`). You read the plan and accept it.
- **Your own AI does the work.** Chausar drives the Codex or Claude Code on your computer, signed in with your own ChatGPT or Claude plan, or an AI key you paste. It gives that AI Chausar's engine as tools. Chausar never reads your sign-in files.
- **You approve every outside effect.** Nothing that sends, posts, spends, issues an invoice, changes a price or deletes happens until you approve that exact thing. What waits for you is on Today.
- **Every amount has a receipt.** Code computes each amount and writes a receipt for it. A number the AI wrote is labelled "model estimate". You set every price.
- **Practice first.** A new business starts in Practice, where drafts never reach a client. Live means you approve each draft before it goes.
- **Clients, orders, invoices and payments** are kept in the app. A client's data reaches the AI only after you record that client's consent. Forget really deletes.
- **Your business stays on your computer.** Each business is an encrypted vault. The computer keeps its key for your login, or you lock it with a passphrase. There are a recovery code, automatic encrypted backups, and a move file for another computer ([docs/custody.md](docs/custody.md)).
- **Honest labels.** Every connector says `write`, `read`, `handoff` or `planned`, and the label matches what the code does.
- **English and Hindi.** Hindi is a pack you pick. It was drafted by machine and still needs a native reader.
- **Your phone can open it** in its browser, with a pairing link on the same Wi-Fi ([docs/venture/phone-access.md](docs/venture/phone-access.md)).

The first day, step by step, is in the [beta guide](docs/beta-guide.md). What each screen shows and the engine behind it is in [docs/venture/ink.md](docs/venture/ink.md) and [docs/venture/README.md](docs/venture/README.md).

## Platforms

| System | State |
|---|---|
| Windows 10 and 11 (x64) | Beta download, an installer. It is not signed yet, so Windows warns before the first run. |
| Linux (x64) | Beta download: a `.deb`, an AppImage and a `.tar.gz`. |
| macOS | The beta is set up to be built for Apple chips and Intel. One unsigned build was made and run on an Apple silicon Mac on 14 November 2026. None is signed or published. See "The Mac beta build" in [docs/desktop-releases.md](docs/desktop-releases.md). |

There is no Chausar-hosted server. The repository holds an experimental hosted server (`npm run start:hosted`), which is off by default and is not deployed anywhere ([docs/venture/hosted.md](docs/venture/hosted.md)).

## Run it from source

Install Node.js 24.13.1 or later. From this folder:

```sh
npm ci
npm run desktop
```

`npm ci` installs exactly what the committed `package-lock.json` lists. `npm run desktop` builds the app (`npm run build:ui`) and opens the Electron window in demo mode.

Other ways to run it:

| Command | What it does |
|---|---|
| `npm run dev:ui` | The screens alone, on port 5178, against a fake engine with sample businesses. No engine runs. |
| `npm start` | The local web server in demo mode. It prints a pairing link to open in a browser. |
| `npm run desktop:production` | The Electron window without demo mode. |
| `npm run doctor` | Checks Node, the data folders, your Codex and Claude Code, and the installed packages. It changes nothing. |

Data never goes inside the code folder. Servers keep it in `CHAUSAR_HOME`, or your user data folder. Test and run outputs go to `CHAUSAR_RUN_ROOT`, or the temp folder under `chausar-runs`. Every environment variable is listed in [docs/configuration.md](docs/configuration.md).

## Test it

```sh
npm run typecheck
npm run typecheck:ui
node scripts/check.mjs
node --test platform/tests/<file>.test.ts
npx vitest run --config app/ui/vitest.config.ts <path>
```

Before a pull request, also run:

```sh
npm run test:ui
npm run build:ui
npm run guard:data
node scripts/bench.mjs --shard=1/3
```

Run the three engine shards (`1/3`, `2/3`, `3/3`) one at a time. `npm run near` runs only the tests that reach the files you changed.

On a Mac the default temp folder is reached through a link, and the vault refuses linked paths. Set the real path first:

```sh
export TMPDIR="$(python3 -c "import os;print(os.path.realpath(os.environ['TMPDIR']))")/"
```

`phone-wifi-w6.test.ts` and `process-tree.test.ts` hang on macOS. Leave them out there. On Windows the engine tests need the default temp folder on the system drive.

## Build an installer

`npm run package:beta` builds the beta installer for the system and chip it runs on. It needs the Codex staged first (`npm run package:codex -- --from <the installed @openai/codex folder>`). Nothing is signed or published by these commands. The steps, the Mac build and the update feed are in [docs/desktop-releases.md](docs/desktop-releases.md).

## Known limits

- **It is a beta.** The app changes often, and parts are marked "coming later".
- **Storage is experimental.** The desktop keeps each business in an encrypted file vault that the code calls experimental. The app says so: "Test version: practice here, don't send real invoices yet."
- **Nothing is signed.** The Windows installer is unsigned, and no Mac build is signed or published.
- **Updates are not set up.** The build carries no update key and no feed address, so the app reads "not set up" and checks nothing.
- **No Chausar-hosted server.** Your computer must be on, with Chausar running, for work to go on and for your phone to reach it.
- **LinkedIn is copy-and-open only.** Chausar drafts the text. You copy it and send it yourself.
- **Never built in:** detection evasion, proxy rotation, CAPTCHA solving, scraping against a platform's terms, fake reviews, and undisclosed AI voices or presenters.
- **Hard stops no setting unlocks:** stock tips, target prices or promised returns without a SEBI registration; advocates advertising or soliciting; AI diagnosis or prescription; children's data without verified parental consent.
- **Out of scope:** GST e-invoicing, Account Aggregator feeds, and AIS, 26AS, Form 16 and 2B readers.
- **Not run for real yet:** Razorpay payment links (tested with fixtures only), phone access with a real phone, and the macOS and Linux key stores (tested with stand-ins; the Windows one was run for real).
- **Auto with spot checks is not open.** Every draft for a real client waits for your approval.

The longer list, place by place, is under "Known limits" in [docs/venture/ink.md](docs/venture/ink.md).

## Where things are

| Path | What it holds |
|---|---|
| `app/desktop/` | The Electron shell: the window, the sandboxed preload, the tray and the packaging files |
| `app/ui/` | Ink, the React app for the window, built to `app/ui/dist` ([app/ui/README.md](app/ui/README.md)) |
| `platform/runtime/` | The engine, in TypeScript ([platform/runtime/README.md](platform/runtime/README.md) is its map) |
| `platform/runtime/venture/` | The product: playbooks, the AI team, approvals, money, clients |
| `platform/tests/` | The engine tests |
| `scripts/` | Build, check, test and release scripts |
| `docs/` | What the app does and its limits |

Docs for people working on the code: the app ([docs/frontend.md](docs/frontend.md)), the desktop shell ([docs/desktop-runtime.md](docs/desktop-runtime.md)), the vault ([docs/vault.md](docs/vault.md)), engine methods outside `venture.*` ([docs/supported-features.md](docs/supported-features.md)), and signed updates ([docs/releases.md](docs/releases.md)).

## Where the plans live

Plans, specs, research and requirements are private. They are in the private repository `kartavyc/chausar-private`, not here. What the app does and its known limits stay public, in `docs/`. The rules every change follows are in [AGENTS.md](AGENTS.md).

## Licence

Chausar is free software under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`), copyright Kartavy Chauhan; see [LICENSE](LICENSE). [NOTICE](NOTICE) lists third-party packages and their licences, and carries one additional permission under section 7 of the AGPL, for linking the Claude Agent SDK. To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md) and agree to the [CLA](CLA.md). To report a security problem, see [SECURITY.md](SECURITY.md).
