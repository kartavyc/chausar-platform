import { check } from '../../contracts.ts';
import { DEFAULT_READ_LIMITS, ReadTransportError, readAuthorityScopeHash,
  type ExportReadAdapter, type ReadEnvironment, type ReadTransportContext } from '../../connector-framework/read.ts';
import type { ConnectorOperationScope } from '../../connector-framework/registry.ts';
import { assertCompany, freezeOperation, integer, requiredText, sha256 } from './common.ts';
import { parseZohoPage, zohoSchemaFingerprint, ZOHO_ADAPTER_VERSION } from './zoho.ts';

export const ZOHO_SAVED_RESPONSE_VERSION = 'books-v3-saved-creditnotes-1';
export const ZOHO_SAVED_RESPONSE_OPERATION_ID = 'zoho-books-v3-creditnotes-saved-response';

/** Host-selected captured API responses, in page order. This is not a vendor CSV/PDF export schema. */
export type ZohoSavedResponseProfile = {
  organizationId: string; companyId: string; dataset: string;
  pageSha256: readonly string[];
};
export type ZohoSavedResponseFile = {
  content: Uint8Array; contentType: string; organizationId: string; companyId: string;
};
export type ZohoSavedResponseConfig = ZohoSavedResponseProfile & {
  operation: ConnectorOperationScope; environment: ReadEnvironment;
  /** Trusted host file custody only; no source-selected paths, API, credentials or internal retries. */
  readFile(page: number, context: ReadTransportContext): Promise<ZohoSavedResponseFile>;
};

function pinnedProfile(input: ZohoSavedResponseProfile): ZohoSavedResponseProfile {
  const organizationId = requiredText(input.organizationId);
  check(/^\d{1,100}$/.test(organizationId), 'ZOHO_SAVED_ORGANIZATION_INVALID', 'Bind an exact Zoho organization ID.');
  const companyId = requiredText(input.companyId), dataset = requiredText(input.dataset);
  check(Array.isArray(input.pageSha256) && input.pageSha256.length > 0 && input.pageSha256.length <= DEFAULT_READ_LIMITS.maxPages
    && input.pageSha256.every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)),
  'ZOHO_SAVED_MANIFEST_INVALID', 'Pin a bounded ordered set of original response SHA-256 hashes.');
  return { organizationId, companyId, dataset, pageSha256: [...input.pageSha256] };
}

/** The file set and native parser revision contribute to independent export/import qualification. */
export function zohoSavedResponseConfiguration(input: ZohoSavedResponseProfile): string {
  return sha256(JSON.stringify({ version: ZOHO_SAVED_RESPONSE_VERSION, parserVersion: ZOHO_ADAPTER_VERSION,
    resource: 'creditnotes', format: 'saved-api-list-json-utf8', ...pinnedProfile(input) }));
}

/** Saved credit-note list JSON -> existing dispatcher/bridge. No acquisition provider is installed. */
export function createZohoSavedResponseAdapter(input: ZohoSavedResponseConfig): ExportReadAdapter {
  const profile = pinnedProfile(input), operation = freezeOperation(input.operation);
  const environment = input.environment, readFile = input.readFile;
  check(['synthetic', 'sandbox', 'live'].includes(environment) && typeof readFile === 'function',
    'ZOHO_SAVED_READER_REQUIRED', 'Inject the authorized file reader and actual environment.');
  check(operation.connectorId === 'zoho-books' && operation.connectorVersion === ZOHO_SAVED_RESPONSE_VERSION
    && operation.operationId === ZOHO_SAVED_RESPONSE_OPERATION_ID && operation.kind === 'export' && operation.transport === 'file'
    && operation.applicability.applicationVersion === 'v3' && operation.applicability.module === 'creditnotes'
    && operation.applicability.configuration === zohoSavedResponseConfiguration(profile),
  'ZOHO_SAVED_OPERATION_MISMATCH', 'Qualify the exact saved credit-note response profile independently of API reads.');

  return Object.freeze<ExportReadAdapter>({ mode: 'export', operation, environment, sideEffects: 'none',
    retrySafety: 'single-attempt', retryOwner: 'dispatcher', requiredAuthScopes: Object.freeze(['files.read']),
    pagination: Object.freeze({ kind: 'page' }),
    async readPage(request, context) {
      assertCompany(request, profile.companyId, profile.organizationId);
      check(request.dataScope?.dataset === profile.dataset && request.dataScope.branches.length === 1
        && request.dataScope.branches[0] === 'all' && request.dataScope.period === undefined,
      'ZOHO_SAVED_DOMAIN_UNSUPPORTED', 'Saved responses cover only the bound resource across all branches and dates.');
      check(context.retryOwner === 'dispatcher' && readAuthorityScopeHash(context.authorization.scope) === readAuthorityScopeHash(request.authority),
        'ZOHO_SAVED_AUTHORITY_MISMATCH', 'Use dispatcher-owned attempts under the exact authorized file scope.');
      check(request.cursor === null || request.cursor.kind === 'page', 'ZOHO_SAVED_CURSOR_INVALID', 'Use the saved response page chain.');
      const pageNumber = request.cursor === null ? 1 : integer((request.cursor as { page: number }).page, 1, profile.pageSha256.length);
      if (context.signal.aborted) throw new ReadTransportError('cancelled');
      let file: ZohoSavedResponseFile;
      try { file = await readFile(pageNumber, context); }
      catch (error) { if (error instanceof ReadTransportError) throw error; throw new ReadTransportError('invalid-request'); }
      check(file?.content instanceof Uint8Array, 'ZOHO_SAVED_BYTES_REQUIRED', 'The file reader must retain original bytes.');
      const bytes = file.content.byteLength;
      if (bytes > context.maxBytes || bytes > DEFAULT_READ_LIMITS.pageBytes) throw new ReadTransportError('invalid-request', null, 'settled', bytes);
      const content = new Uint8Array(file.content);
      if (context.signal.aborted) throw new ReadTransportError('cancelled', null, 'settled', bytes);
      try {
        check(file.organizationId === profile.organizationId && file.companyId === profile.companyId,
          'ZOHO_SAVED_CUSTODY_MISMATCH', 'Host custody must bind the selected company and organization.');
        check(file.contentType === 'application/json' || file.contentType === 'application/json; charset=utf-8',
          'ZOHO_SAVED_ENCODING_UNSUPPORTED', 'This route requires declared UTF-8 JSON.');
        check(sha256(content) === profile.pageSha256[pageNumber - 1], 'ZOHO_SAVED_BYTES_CHANGED', 'The file differs from the pinned artifact set.');
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
        const parsed = parseZohoPage(text, { resource: 'creditnotes', organizationId: profile.organizationId, expectedPage: pageNumber });
        check((parsed.continuation.kind === 'complete') === (pageNumber === profile.pageSha256.length),
          'ZOHO_SAVED_INCOMPLETE_SET', 'Every supplied page must belong to one complete response chain.');
        return { content, contentType: file.contentType, rowCount: parsed.records.length, continuation: parsed.continuation,
          schemaFingerprint: zohoSchemaFingerprint(text),
          source: { reportReference: null, generatedAtMs: null, snapshotId: null, completeness: 'unknown', totalRows: null } };
      } catch { throw new ReadTransportError('invalid-request', null, 'settled', bytes); }
    },
  });
}
