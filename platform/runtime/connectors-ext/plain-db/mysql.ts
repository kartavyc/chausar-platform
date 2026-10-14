import { createHash } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { Duplex } from 'node:stream';
import { check, ChausarError } from '../../contracts.ts';
import { resolvePassword, validateNetworkConnection, CATALOGUE_LIMIT, mysqlLiteral } from './sql.ts';
import type { MysqlSocketFactory, PlainDbOptions, PlainDbRow, SnapshotSession } from './types.ts';

/**
 * A minimal MySQL client for reading: protocol 4.1 text protocol only. Handshake v10,
 * mysql_native_password and the caching_sha2_password fast path, COM_QUERY, text result sets, COM_QUIT.
 * It never sends a password in clear on a plain connection, never accepts LOCAL INFILE requests,
 * never enables multi-statements, and never passes server text on.
 */
const CLIENT = {
  LONG_PASSWORD: 0x1, LONG_FLAG: 0x4, CONNECT_WITH_DB: 0x8, PROTOCOL_41: 0x200, SSL: 0x800, TRANSACTIONS: 0x2000,
  SECURE_CONNECTION: 0x8000, PLUGIN_AUTH: 0x80000,
} as const;
const MAX_PACKET = 16 * 1024 * 1024 - 1;
export const MYSQL_LIMITS = { packetBytes: MAX_PACKET, resultBytes: 256 * 1024 * 1024, columns: 512 };

const sha1 = (...parts: Buffer[]) => { const h = createHash('sha1'); for (const p of parts) h.update(p); return h.digest(); };
const sha256 = (...parts: Buffer[]) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); };
const xor = (a: Buffer, b: Buffer) => { const out = Buffer.alloc(a.length); for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i % b.length]; return out; };
/** mysql_native_password: SHA1(password) XOR SHA1(scramble + SHA1(SHA1(password))). */
export function nativePasswordScramble(password: string, scramble: Buffer): Buffer {
  if (!password) return Buffer.alloc(0);
  const stage1 = sha1(Buffer.from(password, 'utf8'));
  return xor(stage1, sha1(scramble, sha1(stage1)));
}
/** caching_sha2_password: SHA256(password) XOR SHA256(SHA256(SHA256(password)) + scramble). */
export function cachingSha2Scramble(password: string, scramble: Buffer): Buffer {
  if (!password) return Buffer.alloc(0);
  const stage1 = sha256(Buffer.from(password, 'utf8'));
  return xor(stage1, sha256(sha256(stage1), scramble));
}

/** MySQL error numbers to fixed codes. The server's message is never read into an error. */
export function mysqlErrorCode(errno: number): ChausarError {
  if (errno === 1045 || errno === 1698) return new ChausarError('DB_AUTH_FAILED', 'The database did not accept the user name or password.');
  if (errno === 1044 || errno === 1142 || errno === 1143 || errno === 1227) return new ChausarError('DB_PERMISSION_DENIED', 'This database user may not read that table.');
  if (errno === 1049) return new ChausarError('DB_DATABASE_UNKNOWN', 'The database does not exist on that server.');
  if (errno === 1146 || errno === 1054) return new ChausarError('DB_IDENTIFIER_UNKNOWN', 'The table or column is not in the database.');
  if (errno === 1792 || errno === 1290) return new ChausarError('DB_WRITE_REFUSED', 'The database refused a write inside the read-only snapshot.');
  if (errno === 3024 || errno === 1969) return new ChausarError('DB_TIMEOUT', 'The database read took longer than its time limit.');
  if (errno === 1040 || errno === 1203) return new ChausarError('DB_CONNECT_FAILED', 'The database server has no free connections.');
  return new ChausarError('MYSQL_SERVER_ERROR', 'The database refused the request.');
}

type Packet = { seq: number; payload: Buffer };
/** Packet framing with bounded buffering and a per-wait timeout. */
class PacketStream {
  socket: Duplex;
  buffer: Buffer = Buffer.alloc(0);
  packets: Packet[] = [];
  waiter: { resolve(p: Packet): void; reject(e: Error): void; timer: NodeJS.Timeout } | null = null;
  failure: ChausarError | null = null;
  timeoutMs: number;
  received = 0;
  onData = (chunk: Buffer) => {
    this.received += chunk.length;
    if (this.received > MYSQL_LIMITS.resultBytes) return this.fail(new ChausarError('MYSQL_RESULT_TOO_LARGE', 'The database sent more data than one read accepts.'));
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUIntLE(0, 3);
      if (length >= MAX_PACKET) return this.fail(new ChausarError('MYSQL_PACKET_TOO_LARGE', 'The database sent a packet larger than one read accepts.'));
      if (this.buffer.length < 4 + length) break;
      this.packets.push({ seq: this.buffer[3], payload: Buffer.from(this.buffer.subarray(4, 4 + length)) });
      this.buffer = this.buffer.subarray(4 + length);
    }
    this.deliver();
  };
  onEnd = () => this.fail(new ChausarError('MYSQL_CONNECTION_LOST', 'The database closed the connection.'));
  onError = () => this.fail(new ChausarError('DB_CONNECT_FAILED', 'The database server could not be reached.'));
  constructor(socket: Duplex, timeoutMs: number) { this.socket = socket; this.timeoutMs = timeoutMs; this.attach(); }
  attach() { this.socket.on('data', this.onData); this.socket.on('end', this.onEnd); this.socket.on('close', this.onEnd); this.socket.on('error', this.onError); }
  detach() { this.socket.off('data', this.onData); this.socket.off('end', this.onEnd); this.socket.off('close', this.onEnd); this.socket.off('error', this.onError); }
  /** Moves framing onto a TLS socket wrapping the same transport. */
  replace(socket: Duplex) { this.detach(); this.socket = socket; this.buffer = Buffer.alloc(0); this.attach(); }
  fail(error: ChausarError) {
    if (!this.failure) this.failure = error;
    if (this.waiter) { const w = this.waiter; this.waiter = null; clearTimeout(w.timer); w.reject(this.failure); }
  }
  deliver() {
    if (this.waiter && this.packets.length) { const w = this.waiter; this.waiter = null; clearTimeout(w.timer); w.resolve(this.packets.shift()!); }
  }
  next(): Promise<Packet> {
    if (this.packets.length) return Promise.resolve(this.packets.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiter = null; this.fail(new ChausarError('DB_TIMEOUT', 'The database read took longer than its time limit.')); reject(this.failure); }, this.timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
  }
  write(seq: number, payload: Buffer) {
    check(payload.length < MAX_PACKET, 'MYSQL_PACKET_TOO_LARGE', 'A request is larger than one packet.');
    const header = Buffer.alloc(4); header.writeUIntLE(payload.length, 0, 3); header[3] = seq & 0xff;
    this.socket.write(Buffer.concat([header, payload]));
  }
}

/** Reads protocol fields with bounds checks; a malformed packet is a typed refusal, never a crash. */
class Reader {
  buf: Buffer; at = 0;
  constructor(buf: Buffer) { this.buf = buf; }
  need(n: number) { check(this.at + n <= this.buf.length, 'MYSQL_PROTOCOL_ERROR', 'The database sent a malformed packet.'); }
  u8() { this.need(1); return this.buf[this.at++]; }
  u16() { this.need(2); const v = this.buf.readUInt16LE(this.at); this.at += 2; return v; }
  u32() { this.need(4); const v = this.buf.readUInt32LE(this.at); this.at += 4; return v; }
  bytes(n: number) { this.need(n); const v = this.buf.subarray(this.at, this.at + n); this.at += n; return v; }
  nulString() { const end = this.buf.indexOf(0, this.at); check(end >= 0, 'MYSQL_PROTOCOL_ERROR', 'The database sent a malformed packet.'); const v = this.buf.subarray(this.at, end); this.at = end + 1; return v; }
  rest() { const v = this.buf.subarray(this.at); this.at = this.buf.length; return v; }
  /** Length-encoded integer; null for the 0xFB NULL marker. */
  lenenc(): number | null {
    const first = this.u8();
    if (first < 0xfb) return first;
    if (first === 0xfb) return null;
    if (first === 0xfc) return this.u16();
    if (first === 0xfd) { this.need(3); const v = this.buf.readUIntLE(this.at, 3); this.at += 3; return v; }
    check(first === 0xfe, 'MYSQL_PROTOCOL_ERROR', 'The database sent a malformed packet.');
    this.need(8); const v = this.buf.readBigUInt64LE(this.at); this.at += 8;
    check(v <= BigInt(Number.MAX_SAFE_INTEGER), 'MYSQL_PROTOCOL_ERROR', 'The database sent a malformed packet.');
    return Number(v);
  }
  lenencString(): Buffer | null { const n = this.lenenc(); return n === null ? null : this.bytes(n); }
  done() { return this.at >= this.buf.length; }
}
export function lenencInt(n: number): Buffer {
  if (n < 0xfb) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfc; b.writeUInt16LE(n, 1); return b; }
  if (n <= 0xffffff) { const b = Buffer.alloc(4); b[0] = 0xfd; b.writeUIntLE(n, 1, 3); return b; }
  const b = Buffer.alloc(9); b[0] = 0xfe; b.writeBigUInt64LE(BigInt(n), 1); return b;
}

const isErr = (p: Buffer) => p[0] === 0xff;
const isEof = (p: Buffer) => p[0] === 0xfe && p.length < 9;
/** Errors the server reported in an ERR packet. The connection stays usable after them. */
const serverErrors = new WeakSet<Error>();
function errorOf(payload: Buffer): ChausarError {
  const r = new Reader(payload); r.u8();
  const error = mysqlErrorCode(r.u16()); serverErrors.add(error);
  return error;
}

export type MysqlResult = { columns: string[]; rows: (string | null)[][] };
export type MysqlClientOptions = {
  host: string; port: number; user: string; password: string; database: string; ssl: 'require' | 'disable';
  timeoutMs: number; createSocket?: MysqlSocketFactory;
};
export type MysqlClient = { query(sql: string): Promise<MysqlResult>; close(): Promise<void>; readonly tls: boolean };

/** Connects, upgrades to TLS when required, and authenticates. */
export async function connectMysql(options: MysqlClientOptions): Promise<MysqlClient> {
  const socket = options.createSocket ? options.createSocket({ host: options.host, port: options.port }) : netConnect({ host: options.host, port: options.port });
  const stream = new PacketStream(socket, options.timeoutMs);
  let tls = false;
  const destroy = () => { try { stream.detach(); stream.socket.destroy(); } catch { /* already closed */ } };
  try {
    const greeting = await stream.next();
    if (isErr(greeting.payload)) throw errorOf(greeting.payload);
    const r = new Reader(greeting.payload);
    check(r.u8() === 10, 'MYSQL_PROTOCOL_UNSUPPORTED', 'The database server speaks a protocol version this client does not.');
    r.nulString(); r.u32();
    const part1 = r.bytes(8); r.u8();
    let caps = r.u16(), part2 = Buffer.alloc(0), plugin = 'mysql_native_password';
    if (!r.done()) {
      r.u8(); r.u16(); caps |= r.u16() << 16;
      const authLength = r.u8(); r.bytes(10);
      if (caps & CLIENT.SECURE_CONNECTION) { const n = Math.max(13, authLength - 8); part2 = Buffer.from(r.bytes(Math.min(n, greeting.payload.length - r.at))); if (part2.at(-1) === 0) part2 = part2.subarray(0, -1); }
      if (caps & CLIENT.PLUGIN_AUTH && !r.done()) plugin = r.nulString().toString('latin1');
    }
    check((caps & CLIENT.PROTOCOL_41) && (caps & CLIENT.SECURE_CONNECTION), 'MYSQL_PROTOCOL_UNSUPPORTED', 'The database server speaks a protocol version this client does not.');
    let scramble = Buffer.concat([part1, part2]);
    let seq = (greeting.seq + 1) & 0xff;
    let flags = CLIENT.LONG_PASSWORD | CLIENT.LONG_FLAG | CLIENT.CONNECT_WITH_DB | CLIENT.PROTOCOL_41 | CLIENT.TRANSACTIONS | CLIENT.SECURE_CONNECTION | CLIENT.PLUGIN_AUTH;
    const fixed = () => { const b = Buffer.alloc(32); b.writeUInt32LE(flags >>> 0, 0); b.writeUInt32LE(MAX_PACKET, 4); b[8] = 45; return b; };
    if (options.ssl === 'require') {
      check(caps & CLIENT.SSL, 'DB_TLS_UNAVAILABLE', 'The database server does not offer TLS.');
      flags |= CLIENT.SSL;
      stream.write(seq++, fixed());
      const secure = tlsConnect({ socket: socket as any, servername: /^[0-9.:]+$/.test(options.host) ? undefined : options.host, rejectUnauthorized: true });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new ChausarError('DB_TIMEOUT', 'The database read took longer than its time limit.')), options.timeoutMs);
        secure.once('secureConnect', () => { clearTimeout(timer); resolve(); });
        secure.once('error', () => { clearTimeout(timer); reject(new ChausarError('DB_TLS_FAILED', 'The database server\'s TLS certificate was not accepted.')); });
      });
      stream.replace(secure); tls = true;
    }
    const authFor = (name: string, salt: Buffer): Buffer => {
      if (name === 'mysql_native_password') return nativePasswordScramble(options.password, salt.subarray(0, 20));
      if (name === 'caching_sha2_password') return cachingSha2Scramble(options.password, salt.subarray(0, 20));
      throw new ChausarError('MYSQL_AUTH_PLUGIN_UNSUPPORTED', 'The database asks for a sign-in method this client does not use.');
    };
    if (plugin !== 'mysql_native_password' && plugin !== 'caching_sha2_password') plugin = 'mysql_native_password';
    const auth = authFor(plugin, scramble);
    check(auth.length < 251, 'MYSQL_PROTOCOL_ERROR', 'The sign-in response is too long.');
    stream.write(seq++, Buffer.concat([fixed(), Buffer.from(options.user, 'utf8'), Buffer.from([0]), Buffer.from([auth.length]), auth,
      Buffer.from(options.database, 'utf8'), Buffer.from([0]), Buffer.from(plugin, 'latin1'), Buffer.from([0])]));
    for (let round = 0; round < 4; round++) {
      const packet = await stream.next(); seq = (packet.seq + 1) & 0xff;
      const p = packet.payload;
      if (p[0] === 0x00) return client(stream, tls, destroy);
      if (isErr(p)) throw errorOf(p);
      if (p[0] === 0xfe) {
        // Auth switch: a new plugin and scramble. Clear-text and unknown plugins are refused.
        const s = new Reader(p); s.u8();
        plugin = s.done() ? 'mysql_old_password' : s.nulString().toString('latin1');
        scramble = Buffer.from(s.rest()); if (scramble.at(-1) === 0) scramble = scramble.subarray(0, -1);
        stream.write(seq++, authFor(plugin, scramble));
        continue;
      }
      if (p[0] === 0x01 && plugin === 'caching_sha2_password') {
        if (p[1] === 0x03) continue; // fast auth succeeded; the OK packet follows
        if (p[1] === 0x04) {
          check(tls, 'MYSQL_FULL_AUTH_REQUIRES_TLS', 'The database asks for the password itself, which is sent only over TLS.');
          stream.write(seq++, Buffer.concat([Buffer.from(options.password, 'utf8'), Buffer.from([0])]));
          continue;
        }
      }
      throw new ChausarError('MYSQL_PROTOCOL_ERROR', 'The database sent an unexpected sign-in reply.');
    }
    throw new ChausarError('MYSQL_PROTOCOL_ERROR', 'The database sent an unexpected sign-in reply.');
  } catch (error) {
    destroy();
    throw error instanceof ChausarError ? error : new ChausarError('MYSQL_PROTOCOL_ERROR', 'The database sent a malformed packet.');
  }
}

function client(stream: PacketStream, tls: boolean, destroy: () => void): MysqlClient {
  let busy = false, closed = false;
  return {
    tls,
    async query(sql: string): Promise<MysqlResult> {
      check(!busy && !closed, 'MYSQL_CLIENT_BUSY', 'One query runs at a time on a connection.');
      busy = true;
      try {
        stream.received = 0;
        stream.write(0, Buffer.concat([Buffer.from([0x03]), Buffer.from(sql, 'utf8')]));
        const head = (await stream.next()).payload;
        if (head[0] === 0x00) return { columns: [], rows: [] };
        if (isErr(head)) throw errorOf(head);
        check(head[0] !== 0xfb, 'MYSQL_LOCAL_INFILE_REFUSED', 'The database asked to read a local file, which a read never allows.');
        const count = new Reader(head).lenenc();
        check(count !== null && count > 0 && count <= MYSQL_LIMITS.columns, 'MYSQL_PROTOCOL_ERROR', 'The database sent a malformed packet.');
        const columns: string[] = [];
        for (let i = 0; i < count!; i++) {
          const r = new Reader((await stream.next()).payload);
          for (let skip = 0; skip < 4; skip++) r.lenencString(); // catalog, schema, table, org_table
          const name = r.lenencString();
          check(name !== null, 'MYSQL_PROTOCOL_ERROR', 'The database sent a malformed packet.');
          columns.push(name!.toString('utf8'));
        }
        const eof = (await stream.next()).payload;
        check(isEof(eof), 'MYSQL_PROTOCOL_ERROR', 'The database sent a malformed packet.');
        const rows: (string | null)[][] = [];
        for (;;) {
          const p = (await stream.next()).payload;
          if (isEof(p)) break;
          if (isErr(p)) throw errorOf(p);
          const r = new Reader(p), row: (string | null)[] = [];
          for (let i = 0; i < count!; i++) { const v = r.lenencString(); row.push(v === null ? null : v.toString('utf8')); }
          check(r.done(), 'MYSQL_PROTOCOL_ERROR', 'The database sent a malformed packet.');
          rows.push(row);
        }
        return { columns, rows };
      } catch (error) {
        if (!(error instanceof Error && serverErrors.has(error))) { closed = true; destroy(); }
        throw error instanceof ChausarError ? error : new ChausarError('MYSQL_PROTOCOL_ERROR', 'The database sent a malformed packet.');
      } finally { busy = false; }
    },
    async close() {
      if (closed) return; closed = true;
      try { stream.write(0, Buffer.from([0x01])); } catch { /* closing anyway */ }
      await new Promise<void>(resolve => { const s = stream.socket; s.end(() => resolve()); setTimeout(resolve, 500).unref(); });
      destroy();
    },
  };
}

/**
 * One read-only snapshot: session READ ONLY, REPEATABLE READ, START TRANSACTION READ ONLY,
 * WITH CONSISTENT SNAPSHOT, a statement time limit, IST timestamps, then ROLLBACK and COM_QUIT.
 */
export async function withMysqlSnapshot<T>(connection: unknown, options: PlainDbOptions, timeoutMs: number, run: (session: SnapshotSession) => Promise<T>): Promise<T> {
  const c = validateNetworkConnection(connection, 'mysql');
  const password = await resolvePassword(options, c.passwordRef);
  const db = await connectMysql({ host: c.host, port: c.port, user: c.user, password, database: c.database, ssl: c.ssl, timeoutMs, createSocket: options.createMysqlSocket });
  let began = false;
  try {
    await db.query(`SET SESSION time_zone = '+05:30'`);
    try { await db.query(`SET SESSION max_execution_time = ${Math.trunc(timeoutMs)}`); } catch (error) { if ((error as ChausarError).code !== 'MYSQL_SERVER_ERROR') throw error; }
    await db.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query('SET SESSION TRANSACTION READ ONLY');
    await db.query('START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT'); began = true;
    const toRows = (result: MysqlResult): PlainDbRow[] => result.rows.map(row => Object.fromEntries(result.columns.map((name, i) => [name, row[i]])));
    const session: SnapshotSession = {
      async catalogue(table) {
        const sql = 'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()'
          + (table ? ` AND TABLE_NAME = ${mysqlLiteral(table.name)}` : '') + ` ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT ${CATALOGUE_LIMIT + 1}`;
        const rows = toRows(await db.query(sql));
        check(rows.length <= CATALOGUE_LIMIT, 'DB_CATALOGUE_LIMIT', 'The database lists more columns than a table picker shows.');
        return rows.map(row => ({ schema: c.database, table: String(row.TABLE_NAME), column: { name: String(row.COLUMN_NAME), type: String(row.DATA_TYPE), nullable: row.IS_NULLABLE === 'YES' } }));
      },
      async select(bound) {
        check(bound.params.length === 0, 'DB_VALUE_UNSAFE', 'The MySQL text protocol carries only checked literals.');
        return toRows(await db.query(bound.text));
      },
    };
    return await run(session);
  } finally {
    if (began) await db.query('ROLLBACK').catch(() => undefined);
    await db.close().catch(() => undefined);
  }
}
