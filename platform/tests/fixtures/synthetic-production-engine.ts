import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { mock, type TestContext } from 'node:test';
import type { SQLConnection } from '../../runtime/analytics.ts';
import type { EngineOptions } from '../../runtime/engine.ts';
import { hash } from '../../runtime/contracts.ts';
import { PostgresSnapshotAdapter, type PostgresOptions } from '../../runtime/postgres.ts';
import { ExperimentalFileSnapshotAdapter } from '../../runtime/vault.ts';

// Authored test ports only. This helper never connects to PostgreSQL, launches
// analytics, reads host credentials or transports a provider request. Production
// admission/verifier code still executes; injected-sql is not native SQL proof.
const POSTGRES_URL = 'postgresql://synthetic:synthetic-fixture-only@127.0.0.1:15432/synthetic';
const registered = new Map([
  ['212b2c9a11e4124ff8be2afacea82632edf724495ee2257d6a004ccee65bb144', 'createRows'],
  ['cdb60e6d67878c1eb8956da3186ee4c644526e4af56d000cc0195acea3c55951', 'createDefinitions'],
  ['7a12fccbddbeb4a73548e122c9686c4bb35a20317514d43dad976e72afe8daf4', 'insertRow'],
  ['d2fc19b3c2ba53e23efea6d5797b50be364b5aa9894a110cdc2722ac466010ca', 'insertDefinition'],
  ['9173bc7638b026194b361d9b37cb391207219fba50d16ab50167573b01b18194', 'sum'],
  ['298a9b114a38cc6bf2a12bf6d0ef1757407412907a169a1a35732bcaabc0230f', 'net'],
  ['73a4ded9123e11ca7f6d677edba971494811d6dec400220f74b354062c50299b', 'margin'],
  ['25c1f23b388826dd2dd6977e3c991ca30de1896f9e8db1034732052cdb5e0f70', 'change'],
  ['ce1463acbadca332a6cfa14c80ee6f990a3d4dcc040e49915282fe984a94f82b', 'scenario'],
  ['a9d83a7589c9cb584cff8a4980e25b786800964fcd6c1f57536f55cb81eb1d7e', 'aging'],
]);
type Parameter = string | number | null;
type Row = { id: string; kind: string; amount: bigint; date: string; due: string | null; invoice: string | null; customer: string | null };
type Definition = { kind: string; sign: bigint };
const integer = (value: Parameter | undefined) => {
  assert.equal(typeof value, 'string');
  assert.match(value as string, /^-?(?:0|[1-9]\d*)$/);
  return BigInt(value as string);
};
const text = (value: Parameter | undefined) => { assert.equal(typeof value, 'string'); return value as string; };
const optional = (value: Parameter | undefined) => { assert.ok(value === null || typeof value === 'string'); return value as string | null; };

// Results are independently reduced from SQL INSERT parameters, never from
// receipt totals/figures. The actual DatabaseCalculator compares every figure
// and refuses mismatches. Unknown query text fails before any interpretation.
export function syntheticProjectionConnection(): SQLConnection {
  const definitions = new Map<string, Definition>(), rows = new Map<string, Row>();
  let closed = false, createdRows = false, createdDefinitions = false;
  const metric = (name: string, from?: string, to?: string) => {
    const definition = definitions.get(name);
    if (!definition) return 0n;
    let result = 0n;
    for (const row of rows.values()) if (row.kind === definition.kind
      && (from === undefined || row.date >= from) && (to === undefined || row.date <= to))
      result += row.amount * definition.sign;
    return result;
  };
  return {
    async execute(sql, parameters = []) {
      assert.equal(closed, false, 'Synthetic SQL connection is already closed.');
      const operation = registered.get(createHash('sha256').update(sql).digest('hex'));
      assert.ok(operation, 'Synthetic SQL accepts only the pinned registered prepared statements.');
      if (operation === 'createRows' || operation === 'createDefinitions') {
        assert.equal(parameters.length, 0);
        if (operation === 'createRows') { assert.equal(createdRows, false); createdRows = true; }
        else { assert.equal(createdDefinitions, false); createdDefinitions = true; }
        return [];
      }
      assert.ok(createdRows && createdDefinitions, 'Both authored projection tables must be initialized.');
      if (operation === 'insertDefinition') {
        assert.equal(parameters.length, 3);
        const name = text(parameters[0]), kind = text(parameters[1]), sign = parameters[2];
        assert.ok(sign === 1 || sign === -1); assert.equal(definitions.has(name), false);
        definitions.set(name, { kind, sign: BigInt(sign) }); return [];
      }
      if (operation === 'insertRow') {
        assert.equal(parameters.length, 7);
        const id = text(parameters[0]); assert.equal(rows.has(id), false);
        rows.set(id, { id, kind: text(parameters[1]), amount: integer(parameters[2]), date: text(parameters[3]),
          due: optional(parameters[4]), invoice: optional(parameters[5]), customer: optional(parameters[6]) }); return [];
      }
      if (operation === 'sum') { assert.equal(parameters.length, 1); return [{ total: String(metric(text(parameters[0]))) }]; }
      const earned = metric('earned'), refunds = metric('refunds'), costs = metric('costs'), net = earned - refunds;
      if (operation === 'net') { assert.equal(parameters.length, 0); return [{ total: String(net) }]; }
      if (operation === 'margin') {
        assert.equal(parameters.length, 0); const contribution = net - costs;
        return [{ earned: String(earned), refunds: String(refunds), netSales: String(net), costs: String(costs),
          contribution: String(contribution), marginBps: net === 0n ? null : String(contribution * 10000n / net) }];
      }
      if (operation === 'change') {
        assert.equal(parameters.length, 4);
        const current = metric('earned', text(parameters[0]), text(parameters[1]));
        const previous = metric('earned', text(parameters[2]), text(parameters[3])), change = current - previous;
        return [{ current: String(current), previous: String(previous), change: String(change),
          changeBps: previous === 0n ? null : String(change * 10000n / previous) }];
      }
      if (operation === 'scenario') {
        assert.equal(parameters.length, 1);
        const priceChangeBps = integer(parameters[0]), scenario = earned * (10000n + priceChangeBps) / 10000n;
        return [{ baseline: String(earned), scenario: String(scenario), change: String(scenario - earned), priceChangeBps: String(priceChangeBps) }];
      }
      assert.equal(operation, 'aging'); assert.equal(parameters.length, 1);
      const onDate = text(parameters[0]);
      const values: Record<string, bigint> = { notDue: 0n, days1to30: 0n, days31to60: 0n, days61to90: 0n, over90: 0n, outstanding: 0n, unallocated: 0n };
      const invoiceKind = definitions.get('billed')!.kind;
      const creditKinds = new Set([definitions.get('received')!.kind, definitions.get('refunds')!.kind]);
      const included = [...rows.values()].filter(row => row.date <= onDate);
      const invoices = included.filter(row => row.kind === invoiceKind);
      const credits = included.filter(row => creditKinds.has(row.kind));
      for (const invoice of invoices) {
        const credited = credits.filter(row => row.invoice === invoice.invoice && row.customer === invoice.customer)
          .reduce((sum, row) => sum + row.amount, 0n);
        const balance = invoice.amount - credited, amount = balance > 0n ? balance : 0n;
        if (balance < 0n) values.unallocated -= balance;
        const days = Math.round((Date.parse(onDate + 'T00:00:00Z') - Date.parse(invoice.due! + 'T00:00:00Z')) / 86400000);
        const bucket = days <= 0 ? 'notDue' : days <= 30 ? 'days1to30' : days <= 60 ? 'days31to60' : days <= 90 ? 'days61to90' : 'over90';
        values[bucket] += amount; values.outstanding += amount;
      }
      for (const credit of credits) if (!invoices.some(invoice => invoice.invoice === credit.invoice && invoice.customer === credit.customer))
        values.unallocated += credit.amount;
      return [Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))];
    },
    close() { closed = true; },
  };
}

export function installSyntheticProductionStorage(directory: string, folders: readonly string[],
  testMock: Pick<TestContext['mock'], 'method'> = mock): Pick<EngineOptions, 'demo' | 'storage' | 'postgresUrl' | 'analytics'> {
  assert.ok(isAbsolute(directory), 'Synthetic storage needs its owned absolute fixture root.');
  assert.ok(folders.length > 0);
  const allowed = new Map<string, string>();
  for (const folder of folders) {
    assert.match(folder, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
    const path = resolve(directory, folder), slot = hash(path);
    assert.equal(allowed.has(slot), false); allowed.set(slot, path);
  }
  testMock.method(PostgresSnapshotAdapter, 'connect', async (options: PostgresOptions) => {
    assert.equal(options.host, '127.0.0.1'); assert.equal(options.port, 15432);
    assert.equal(options.user, 'synthetic'); assert.equal(options.password, 'synthetic-fixture-only'); assert.equal(options.database, 'synthetic');
    const path = allowed.get(options.vaultSlot!);
    assert.ok(path, 'Synthetic snapshot admission refuses an unlisted owned workspace slot.');
    return new ExperimentalFileSnapshotAdapter(path) as unknown as PostgresSnapshotAdapter;
  });
  return { demo: false, storage: 'postgres', postgresUrl: POSTGRES_URL,
    analytics: { connectionFactory: async () => syntheticProjectionConnection() } };
}

