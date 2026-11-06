# Contributing to Chausar

Thanks for wanting to help. Chausar is a desktop app that helps ordinary professionals run a small AI-run service business, with the owner approving every outside effect. This page says how to send a change that can be merged.

## The licence

Chausar is free software under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`), copyright Kartavy Chauhan. The full text is in [LICENSE](LICENSE), and third-party packages are listed in [NOTICE](NOTICE). NOTICE also carries one additional permission under section 7 of the AGPL, for linking the Claude Agent SDK.

**Contributor License Agreement.** Before your first pull request can be merged, read [CLA.md](CLA.md) and write "I have read the CLA and I agree to it." with your full name in a comment on that pull request. You keep the copyright in your work; the agreement lets the project publish it under the AGPL and, if the maintainer chooses, under other licences too. One comment covers all your later pull requests.

## Before you start

1. Read [AGENTS.md](AGENTS.md). Its rules bind every contributor, human or AI. The ones people miss most are below.
2. Install Node.js 24.13.1 or later, then run `npm ci`. It installs exactly what the committed `package-lock.json` lists.
3. For a change to the app screens, look at the existing design first (`app/ui/`) and extend it. Don't redesign.

## The rules that never bend

- **Nothing that spends, sends, posts, deletes or changes a price happens without the owner approving that exact thing.** A change that skips an approval will not be merged.
- **Never fake a capability.** If something only works in a test, the label says so.
- **Money is computed by code.** Amounts are BigInt minor units with a receipt, or are labelled "model estimate". The screens never compute money.
- **No detection evasion, CAPTCHA solving, scraping against a platform's terms, or automated LinkedIn messaging.**
- **Client data stays private.** Minimum data, "Forget" really deletes, and an opt-out is honoured at once.

## How a change is made

**Test first.** Write the failing test, run it, and see it fail for the right reason. Then write the code that makes it pass. Pull requests without a test for the new behaviour will be sent back.

Run the tests near your change:

```sh
node --test platform/tests/<file>.test.ts
npx vitest run --config app/ui/vitest.config.ts <path>
```

Before you open a pull request, also run:

```sh
npm run typecheck
npm run typecheck:ui
node scripts/check.mjs
```

The engine tests need the default temp folder on the system drive. Don't point `TMP` somewhere else.

If you add, remove or upgrade a production dependency, run `node scripts/third-party-notices.mjs --write` and commit the new NOTICE. A dependency whose licence does not fit the AGPL will be flagged there and needs the founder's decision.

## House style

- **Plain English**, short words, active voice. Write for an owner who is not technical.
- **No em dashes anywhere**: code, comments, docs, screen text and commit messages. Use a comma, a colon, a semicolon or brackets. Tests check this.
- Screen text stays inside the word budgets in `app/ui/tests/baselines/words.json`. Budgets may only go down.
- Screens use design tokens only: no inline styles, type never below 12 px, contrast 4.5:1 in both themes, no sideways scroll at 390 px.
- English and Hindi: Hindi is a pack the owner picks; a missing Hindi key shows the English words. Chausar's own screen words only: engine lines and AI drafts stay English.

## Commits and pull requests

- Use conventional commit messages, for example `feat(ui): show the due date on invoices` or `fix(engine): keep the paid date when an invoice is edited`.
- One logical change per commit.
- Describe what changed and how you tested it in the pull request. The founder reviews and merges.

## Never commit secrets or private data

Never put real credentials, API keys, tokens, business exports, vaults, recovery kits, client data or personal details in a commit, an issue or a test fixture. Test fixtures must not contain strings shaped like real provider keys; build them at runtime instead. Keys belong in a file outside the repository.

## Reporting a security problem

Don't open a public issue. See [SECURITY.md](SECURITY.md) and report it privately to the repository owner.
