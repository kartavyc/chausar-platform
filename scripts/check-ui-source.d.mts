/**
 * Type declaration for the adjacent `check-ui-source.mjs` runtime. It describes
 * that JavaScript's eleven actual value exports so strict TypeScript tests can
 * call them. It adds no runtime behaviour, no stand-in compiler, and no
 * typechecking, build or runtime qualification claim beyond the checker's own
 * documented syntactic/heuristic scope.
 */
import type { CompilerOptions } from 'typescript';

/** The real installed compiler API, exactly as `loadTypeScript` resolves it (`imported.default ?? imported`). */
export type TypeScriptModule = typeof import('typescript');

/** Rules emitted by `checkTypeScriptSource` (20). */
export type SourceRule =
  | 'typescript-syntax'
  | 'type-suppression'
  | 'untyped-any'
  | 'forbidden-runtime-import'
  | 'part-bridge-import'
  | 'renderer-network'
  | 'renderer-files'
  | 'dynamic-code'
  | 'repeating-timer'
  | 'renderer-bridge-call'
  | 'raw-html'
  | 'unsafe-amount-number'
  | 'business-reduction'
  | 'renderer-storage'
  | 'renderer-secret-plumbing'
  | 'business-arithmetic'
  | 'literal-color'
  | 'remote-resource'
  | 'repeating-animation'
  | 'chart-green';

/** Rules emitted by `checkCssSource` (5). */
export type CssRule =
  | 'remote-css-resource'
  | 'literal-color'
  | 'reserved-series-token'
  | 'repeating-animation'
  | 'chart-green';

/** Rules emitted by `checkLocalModules` (2). */
export type ModuleRule = 'local-module-not-found' | 'local-export-not-found';

/** Rules emitted by `checkCatalogs` (5). */
export type CatalogRule =
  | 'catalogue-parity'
  | 'catalogue-punctuation'
  | 'banned-copy'
  | 'button-message-missing'
  | 'button-label-length';

/** Rules emitted by `checkReadingBudget` (4). */
export type ReadingRule =
  | 'reading-fixture-shape'
  | 'reading-budget'
  | 'primary-button-limit'
  | 'button-label-length';

/** Rules `checkUiSource` itself emits for configuration, fixture JSON and catalogue shape (4). */
export type OrchestrationRule =
  | 'tsconfig-syntax'
  | 'reading-fixture-json'
  | 'json-syntax'
  | 'catalogue-shape';

/** Every finding carries a portable file path, a rule and a message. */
export interface Finding<Rule extends string> {
  file: string;
  rule: Rule;
  message: string;
}

/** Source, CSS and module findings are located at a 1-based line and column. */
export interface LocatedFinding<Rule extends string> extends Finding<Rule> {
  line: number;
  column: number;
}

export type SourceFinding = LocatedFinding<SourceRule>;
export type CssFinding = LocatedFinding<CssRule>;
export type ModuleFinding = LocatedFinding<ModuleRule>;
/** Catalogue, reading-budget and orchestration findings carry no location. */
export type CatalogFinding = Finding<CatalogRule>;
export type ReadingFinding = Finding<ReadingRule>;
export type OrchestrationFinding = Finding<OrchestrationRule>;
export type UiSourceFinding =
  | SourceFinding
  | CssFinding
  | ModuleFinding
  | CatalogFinding
  | ReadingFinding
  | OrchestrationFinding;

/** A successfully resolved local import/export reference. */
export interface ModuleReference {
  importer: string;
  name: string;
  resolvedPath: string;
}

/** A non-local specifier, recorded whether or not TypeScript resolved it as an external library. */
export interface ExternalDependency {
  name: string;
  resolved: boolean;
  importers: string[];
}

/** A named import that an unresolved external export-star barrel may or may not supply. */
export interface UnverifiedExport {
  importer: string;
  module: string;
  name: string;
  reason: 'External export-star requires dependency semantic checking.';
}

export interface LocalModuleCheckResult {
  findings: ModuleFinding[];
  references: ModuleReference[];
  externalDependencies: ExternalDependency[];
  unverifiedExports: UnverifiedExport[];
}

/** An in-memory source entry; the checker only reads these fields. */
export interface LocalModuleEntry {
  readonly path: string;
  readonly text: string;
}

/* Option fields mirror the JavaScript destructuring defaults, so an explicit
   `undefined` falls back to the default without relaxing exactOptionalPropertyTypes. */
export interface ResolveTypeScriptPathOptions {
  readonly root?: string | undefined;
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  readonly fileExists?: ((path: string) => boolean) | undefined;
}

export interface SourceCheckOptions {
  readonly rendering?: boolean | undefined;
}

export interface LocalModuleCheckOptions {
  readonly compilerOptions?: CompilerOptions | undefined;
}

export interface CatalogCheckOptions {
  readonly buttonMessageIds?: readonly string[] | undefined;
  readonly banned?: readonly string[] | undefined;
}

export interface UiSourceCheckOptions {
  readonly root?: string | undefined;
  readonly compilerPath?: string | undefined;
}

export interface UiSourceInspection {
  syntaxFiles: number;
  renderFiles: number;
  cssFiles: number;
  jsonFiles: number;
  readingFixtures: number;
  staticButtonMessageIds: string[];
  sourceFiles: string[];
}

export interface UiSourceModuleSummary {
  checkedLocalReferences: number;
  externalDependencies: ExternalDependency[];
  unverifiedExports: UnverifiedExport[];
}

/** The aggregate report `checkUiSource` returns and the CLI prints as JSON. */
export interface UiSourceReport {
  status: 'static-checks-failed' | 'static-checks-passed';
  scope: 'Syntactic parsing and heuristic static source checks only; not full typechecking or runtime qualification.';
  compilerVersion: string;
  inspected: UiSourceInspection;
  findings: UiSourceFinding[];
  modules: UiSourceModuleSummary;
  pending: string[];
}

/** Frozen inclusive word ceilings per view and for the sheet. */
export declare const readingCeilings: {
  readonly guided: 120;
  readonly wide: 150;
  readonly simple: 90;
  readonly books: 170;
  readonly sheet: 110;
};

/** Frozen descriptions of checks this static checker does not perform. */
export declare const pendingRuntimeChecks: readonly string[];

/** Explicit `UI_TYPESCRIPT_PATH`, then a repo-local install, then the frozen workspace compiler path. */
export declare function resolveTypeScriptPath(options?: ResolveTypeScriptPathOptions): string;

/** Dynamically imports the real compiler at the given or resolved path. */
export declare function loadTypeScript(compilerPath?: string): Promise<TypeScriptModule>;

/** Parser diagnostics always; rendering capability rules only when `rendering` is not false. */
export declare function checkTypeScriptSource(text: string, file: string, ts: TypeScriptModule, options?: SourceCheckOptions): SourceFinding[];

export declare function checkCssSource(text: string, file: string): CssFinding[];

/** Sorted literal message IDs found inside `Button` elements; dynamic keys are not identified. */
export declare function staticButtonMessageIds(text: string, file: string, ts: TypeScriptModule): string[];

/** Real TypeScript module resolution plus syntactic export tables; no semantic program. */
export declare function checkLocalModules(entries: readonly LocalModuleEntry[], ts: TypeScriptModule, options?: LocalModuleCheckOptions): Promise<LocalModuleCheckResult>;

/** Accepts raw parsed catalogues; a non-string, non-object entry throws rather than returning a finding. */
export declare function checkCatalogs(en: unknown, hi: unknown, options?: CatalogCheckOptions): CatalogFinding[];

/** Accepts raw fixture items, including malformed ones and `null`, and reports their shape as findings. */
export declare function checkReadingBudget(cases: readonly unknown[]): ReadingFinding[];

export declare function checkUiSource(options?: UiSourceCheckOptions): Promise<UiSourceReport>;
