import { authorize, check, hash, type Context, type StateStore } from './contracts.ts';
import { CalculatorService, type CalculatorOptions } from './calculator.ts';
import { InvestigationService } from './investigations.ts';
import { ReportService, type ReportOptions } from './reports.ts';
import type { AuthorizedInvestigationSearchProjection, InvestigationSearchDocument, InvestigationSearchRequest, InvestigationSearchResult } from './investigation-search.ts';

export type ResearchSearchPort = {
  search(projection: AuthorizedInvestigationSearchProjection, request: InvestigationSearchRequest): Promise<InvestigationSearchResult>;
};
export type ResearchSearchOptions = {
  calculator: CalculatorOptions;
  reports: ReportOptions;
  adapter: () => Promise<ResearchSearchPort>;
};

/** This host join owns authorization. The SQL adapter accepts only an already authorized projection. */
export class ResearchSearchService {
  readonly store: StateStore;
  readonly options: ResearchSearchOptions;
  constructor(store: StateStore, options: ResearchSearchOptions) { this.store = store; this.options = options; }
  private projection(ctx: Context): AuthorizedInvestigationSearchProjection {
    authorize(this.store, ctx);
    const investigations = new InvestigationService(this.store, this.options.calculator);
    const calculator = new CalculatorService(this.store, this.options.calculator);
    const reports = new ReportService(this.store, this.options.reports);
    const documents: InvestigationSearchDocument[] = investigations.searchDocuments(ctx).map(document => ({
      id: document.id, kind: 'investigation', revision: document.revision, digest: document.contentHash, text: document.text,
    }));
    for (const decision of reports.decisions(ctx)) {
      // ReportService owns current journal/execution authority; the join additionally refuses stale measurements.
      const ids = [...new Set<string>([...(decision.receiptIds ?? []), ...(decision.receipts ?? []).map((item: { id: string }) => item.id)])];
      let current = true;
      for (const id of ids) {
        const receipt = calculator.receipt(ctx, id);
        if (receipt.stale) { current = false; break; }
      }
      if (!current) continue;
      const text = JSON.stringify(decision);
      documents.push({ id: decision.id, kind: 'journal', revision: decision.revision ?? 0, digest: hash(decision), text });
    }
    return { complete: true, expectedDocuments: documents.length, documents };
  }
  async search(ctx: Context, request: InvestigationSearchRequest) {
    // The full private authority hash is intentionally conservative: any concurrent vault change requires a retry.
    const before = hash(this.store.read());
    const projection = this.projection(ctx);
    const port = await this.options.adapter();
    const result = await port.search(projection, structuredClone(request));
    authorize(this.store, ctx);
    check(hash(this.store.read()) === before && hash(this.projection(ctx)) === hash(projection),
      'SEARCH_AUTHORITY_CHANGED', 'Workspace authority or saved evidence changed during search. Run it again under current access.');
    const pinned = new Map(projection.documents.map(document => [document.id, document]));
    check(result.method === request.method && result.queryDigest === hash(request.query)
      && result.projectionDigest === hash({ complete: true, documents: [...projection.documents].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) })
      && result.completeness.class === 'complete-authorized-projection'
      && result.completeness.indexReadiness === 'fresh-transactional-projection'
      && result.completeness.documents === projection.documents.length
      && result.completeness.textBytes === projection.documents.reduce((sum, document) => sum + Buffer.byteLength(document.text), 0)
      && result.completeness.matchedDocuments === result.matches.length
      && hash(result.bounds) === hash(request.bounds)
      && new Set(result.matches.map(match => match.id)).size === result.matches.length
      && result.matches.every(match => {
        const document = pinned.get(match.id);
        return document && match.kind === document.kind && match.revision === document.revision && match.digest === document.digest;
      }), 'SEARCH_RESULT_CHANGED', 'The search result differs from its pinned authorized documents.');
    return { ...result, scope: 'current-authorized-valid-investigations-and-journals' as const,
      interpretation: 'Exact declared token search over this authorized projection; no universal absence or semantic recall claim.',
      qualification: result.engine === 'postgres' ? 'native-token-search' as const : 'injected-sql-fixture' as const };
  }
}
