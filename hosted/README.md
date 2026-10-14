# Chausar hosted services

The paid-plan services that run on Chausar's servers: the relay for briefs and simple approvals (WhatsApp, Telegram, mail), the link page, blind encrypted backup storage, the model allowance proxy, the always-on jobs worker, and the accounts and billing behind them. **Written and tested, not deployed.**

- `API.md`: the contract with the desktop app.
- `DEPLOY.md`: how to run it, what each part can read, and every founder step.
- `server.ts`: the entry point (`api` or `worker`). `app.ts` composes the modules.
- `shared/`: errors, tokens, the HTTP router, the module seam, and the fixed message catalogue (`templates.ts`).
- `db/`: the PostgreSQL port, migrations and the job queue on the database.
- One folder per service: `accounts/`, `billing/`, `relay/`, `link/`, `backup/`, `allowance/`, `worker/`.

The tests live in `platform/tests/hosted-link-*.test.ts` and run against a disposable PostgreSQL 16 that the test harness starts (`platform/tests/hosted-link-pg.ts`); database tests skip and say why when no server binaries exist.
