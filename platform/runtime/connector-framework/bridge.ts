import { createHash } from 'node:crypto';
import { audit, authorize, check } from '../contracts.ts';
import type { Context, StateStore } from '../contracts.ts';
import { canonical, digest } from '../actions.ts';
import { assertSourceAccess } from '../trust.ts';
import { connectorOperationKey } from './registry.ts';
import type { ConnectorCapabilityRegistry, ConnectorOperationScope } from './registry.ts';
import { CAPTURE_LIMITS } from './import.ts';
import type { CaptureRequest, CapturedPageInput, ConnectorCapture, CursorImportService, ImportDomain } from './import.ts';
import { readAuthorityScopeHash } from './read.ts';
import type { ConnectorReadDispatcher, ConnectorReadResult, RawReadProvenance, ReadAuthorityScope, ReadReceipt } from './read.ts';

/** Host-installed binding. Source rows and renderer payloads cannot select decoders or reinterpret acquisition scope. */
export type ReadImportBinding = Readonly<{
  readOperation: ConnectorOperationScope;
  importOperation: ConnectorOperationScope;
  authority: ReadAuthorityScope;
  domain: ImportDomain;
  decoder: Readonly<{ id: string; version: string; schemaSha256: string; identityNamespace: string; definitionHash: string }>;
  contentTypes: readonly string[];
}>;
export type ReadImportLink = Readonly<{
  type: 'connector-read-import-link-v1'; id: string; captureId: string; sourceId: string; createdAt: string;
  importOperationKey: string; decoderDefinitionHash: string; identityNamespace: string;
  authorityScopeHash: string; dataScopeHash: string; readReceipt: ReadReceipt;
  pages: readonly Readonly<{ deliveryId: string; provenance: RawReadProvenance }>[];
}>;
export type ReadImportBridgeDependencies = Readonly<{
  /** This trusted dispatcher verifies issuer custody and detects mutation. Deserialized DTOs are refused. */
  reader: Pick<ConnectorReadDispatcher, 'assertIssuedResult'>;
  registry: Pick<ConnectorCapabilityRegistry, 'assertCanUse'>;
  importer: Pick<CursorImportService, 'decoderDescriptor' | 'open' | 'capturePage' | 'get'>;
  now?: () => string;
}>;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cursor = (value: unknown): string | null => value === null ? null : canonical(value);

/** Preserves read evidence and raw bytes; mapping review, reconciliation and fact publication remain separate. */
export class ConnectorReadImportBridge {
  readonly #store: StateStore;
  readonly #dependencies: ReadImportBridgeDependencies;
  readonly #binding: ReadImportBinding;
  readonly #now: () => string;

  constructor(store: StateStore, binding: ReadImportBinding, dependencies: ReadImportBridgeDependencies) {
    check(['read', 'export', 'guided-export'].includes(binding.readOperation.kind) && binding.importOperation.kind === 'import', 'BRIDGE_OPERATION_INVALID', 'Bind a read/export and a separately qualified import operation.');
    check(binding.readOperation.connectorId === binding.importOperation.connectorId && binding.readOperation.connectorVersion === binding.importOperation.connectorVersion
      && digest(binding.readOperation.applicability) === digest(binding.importOperation.applicability), 'BRIDGE_APPLICABILITY_MISMATCH', 'Read and import bindings must describe the same reviewed source installation.');
    check(Array.isArray(binding.contentTypes) && binding.contentTypes.length > 0 && new Set(binding.contentTypes).size === binding.contentTypes.length
      && binding.contentTypes.every(type => typeof type === 'string' && type.length <= 100 && /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+(?:; charset=utf-8)?$/.test(type)), 'BRIDGE_MEDIA_TYPE_INVALID', 'Pin the permitted raw content types.');
    this.#store = store; this.#dependencies = dependencies; this.#binding = structuredClone(binding);
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#assertDecoder();
  }

  #assertDecoder(): void {
    const descriptor = this.#dependencies.importer.decoderDescriptor();
    const expected = this.#binding.decoder;
    check(descriptor.id === expected.id && descriptor.version === expected.version && descriptor.schemaSha256 === expected.schemaSha256
      && descriptor.identityNamespace === expected.identityNamespace && descriptor.definitionHash === expected.definitionHash,
      'BRIDGE_DECODER_MISMATCH', 'Use the exact reviewed decoder definition and immutable identity namespace.');
  }

  #access(ctx: Context): void {
    const state = this.#store.read(), member = authorize(this.#store, ctx, 'prepare');
    check(state.workspace.id === this.#binding.authority.tenantId, 'BRIDGE_TENANT_MISMATCH', 'The read belongs to a different workspace.');
    assertSourceAccess(state, ctx, [this.#binding.authority.sourceId]);
    check(this.#binding.domain.branches.every(branch => member.branches.includes('*') || member.branches.includes(branch)), 'BRIDGE_BRANCH_FORBIDDEN', 'The read includes branches outside current access.');
  }

  #qualified(receipt: ReadReceipt): void {
    const current = this.#dependencies.registry.assertCanUse(this.#binding.readOperation, this.#now(), receipt.minimumQualification);
    check(receipt.qualification?.digest === current.digest, 'BRIDGE_READ_QUALIFICATION_CHANGED', 'The admitted read evidence changed before capture.');
    this.#dependencies.registry.assertCanUse(this.#binding.importOperation, this.#now(), receipt.minimumQualification);
  }

  #admit(ctx: Context, result: ConnectorReadResult, request: CaptureRequest): CapturedPageInput[] {
    this.#dependencies.reader.assertIssuedResult(result);
    this.#access(ctx); this.#assertDecoder();
    const binding = this.#binding, readKey = connectorOperationKey(binding.readOperation), importKey = connectorOperationKey(binding.importOperation);
    const authorityHash = readAuthorityScopeHash(binding.authority), domainHash = digest(binding.domain);
    check(request.sourceId === binding.authority.sourceId && connectorOperationKey(request.scope) === importKey && digest(request.domain) === domainHash,
      'BRIDGE_CAPTURE_SCOPE_MISMATCH', 'The capture must preserve the selected source, operation and data domain.');
    check(result.receipt.outcome === 'complete' && result.receipt.operationKey === readKey && result.receipt.authorityScopeHash === authorityHash
      && result.receipt.dataScopeHash === domainHash, 'BRIDGE_READ_SCOPE_MISMATCH', 'The read must bind the exact source, workspace, company, dataset, branches and period.');
    this.#qualified(result.receipt);
    check(result.pages.length > 0 && result.pages.length <= CAPTURE_LIMITS.maxPages && result.receipt.pages === result.pages.length,
      'BRIDGE_PAGE_COUNT_INVALID', 'The complete read must account for each captured page.');
    if (request.snapshot.kind === 'source-snapshot') {
      const snapshotId = request.snapshot.id;
      check(result.completeness.snapshot === 'same-declared-snapshot' && result.pages.every(page => page.provenance.source.snapshotId === snapshotId),
        'BRIDGE_SNAPSHOT_MISMATCH', 'A capture cannot promote an unknown or different source snapshot.');
    }
    const output: CapturedPageInput[] = []; let nextCursor: string | null = null, totalBytes = 0, rows = 0;
    for (const [index, page] of result.pages.entries()) {
      check(page.provenance.operationKey === readKey && page.provenance.authorityScopeHash === authorityHash && page.provenance.dataScopeHash === domainHash,
        'BRIDGE_PAGE_SCOPE_MISMATCH', 'Each raw page must preserve acquisition scope.');
      check(page.content instanceof Uint8Array && page.content.byteLength <= CAPTURE_LIMITS.pageBytes, 'BRIDGE_BYTE_LIMIT', 'The raw page exceeds capture byte limits.');
      totalBytes += page.content.byteLength; rows += page.rowCount;
      check(totalBytes <= CAPTURE_LIMITS.totalBytes && page.provenance.byteLength === page.content.byteLength
        && page.provenance.contentSha256 === sha256(page.content) && result.receipt.contentHashes[index] === page.provenance.contentSha256,
        'BRIDGE_RAW_BYTES_CHANGED', 'Raw bytes must match their admitted size and SHA-256 provenance.');
      check(binding.contentTypes.includes(page.provenance.contentType), 'BRIDGE_CONTENT_TYPE_MISMATCH', 'The source content type is outside this reviewed decoder binding.');
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(page.content); }
      catch { check(false, 'BRIDGE_ENCODING_UNSUPPORTED', 'The reviewed text decoder requires valid UTF-8 bytes.'); }
      check(Buffer.from(content!, 'utf8').equals(Buffer.from(page.content)), 'BRIDGE_RAW_BYTES_CHANGED', 'Text conversion must preserve every raw byte.');
      const from = cursor(page.fromCursor), terminal = page.continuation.kind === 'complete';
      const next = page.continuation.kind === 'complete' ? null : cursor(page.continuation.next);
      check(from === nextCursor && (terminal ? index === result.pages.length - 1 : index < result.pages.length - 1)
        && (from === null || from.length <= 4096) && (next === null || next.length <= 4096), 'BRIDGE_CURSOR_CHAIN_INVALID', 'Preserve the complete, bounded cursor chain.');
      nextCursor = next;
      const deliveryId = `read_page_${digest({ readKey, authorityHash, domainHash, decoder: binding.decoder.definitionHash, from })}`;
      output.push({ deliveryId, fromCursor: from, nextCursor: next, terminal, content: content!, schemaSha256: page.provenance.schemaFingerprint,
        decoderId: binding.decoder.id, decoderVersion: binding.decoder.version,
        sourceObservedAt: page.provenance.source.generatedAtMs === null ? null : new Date(page.provenance.source.generatedAtMs).toISOString() });
    }
    check(totalBytes === result.receipt.bytes && rows === result.receipt.rows && rows === result.completeness.actualRows,
      'BRIDGE_READ_TOTALS_INCONSISTENT', 'The read must account for every raw page, byte and source row.');
    return output;
  }

  async capture(ctx: Context, input: Readonly<{ read: ConnectorReadResult; request: CaptureRequest }>): Promise<ConnectorCapture> {
    // Validate all bytes and scope before opening a capture. Invalid input creates no durable import rows.
    const request = structuredClone(input.request), pages = this.#admit(ctx, input.read, request);
    const readReceipt = structuredClone(input.read.receipt);
    const provenance = pages.map((page, index) => ({ deliveryId: page.deliveryId, provenance: structuredClone(input.read.pages[index].provenance) }));
    const lease = await this.#dependencies.importer.open(ctx, request);
    const linkBody = { captureId: lease.captureId, sourceId: request.sourceId, importOperationKey: connectorOperationKey(this.#binding.importOperation),
      decoderDefinitionHash: this.#binding.decoder.definitionHash, identityNamespace: this.#binding.decoder.identityNamespace,
      authorityScopeHash: readReceipt.authorityScopeHash, dataScopeHash: readReceipt.dataScopeHash!, readReceipt, pages: provenance };
    const link: ReadImportLink = { type: 'connector-read-import-link-v1', id: `read_link_${digest(linkBody)}`, createdAt: this.#now(), ...linkBody };
    await this.#store.update(state => {
      const view: StateStore = { read: () => state, update: this.#store.update.bind(this.#store) };
      const member = authorize(view, ctx, 'prepare'); assertSourceAccess(state, ctx, [request.sourceId]); this.#qualified(readReceipt);
      check(state.workspace.id === this.#binding.authority.tenantId, 'BRIDGE_TENANT_MISMATCH', 'The read belongs to a different workspace.');
      check(this.#binding.domain.branches.every(branch => member.branches.includes('*') || member.branches.includes(branch)), 'BRIDGE_BRANCH_FORBIDDEN', 'The read includes branches outside current access.');
      if (!state.imports.some(record => record.type === link.type && record.id === link.id)) {
        state.imports.push(structuredClone(link)); audit(state, 'connector.read-import-linked', { captureId: lease.captureId, linkId: link.id });
      }
    });
    let capture = this.#dependencies.importer.get(ctx, lease.captureId);
    for (const page of pages) {
      this.#access(ctx); this.#assertDecoder(); this.#qualified(readReceipt);
      capture = await this.#dependencies.importer.capturePage(ctx, lease, page);
      if (capture.status === 'quarantined') break;
    }
    return capture;
  }
}
