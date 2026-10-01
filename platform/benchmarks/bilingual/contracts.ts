export type Language = 'en' | 'hi';
export type FixtureId = 'shop' | 'large' | 'viewer-main' | 'source-revoked' | 'member-revoked' | 'other-receipt-owner';
export type Track = 'authored-typed-request' | 'local-question-parser';
export type ExpectedAnswer = {
  kind: 'answer'; operation: string; valueMinor: string; currency: 'INR';
  figures: Record<string, string>; entities: string[];
  completeness: 'reconciled-imports' | 'empty';
  requiredGap?: string; excludedEntities?: string[];
  assumptions?: Record<string, string>;
};
export type ExpectedRefusal = { kind: 'refusal'; mechanism: 'error-code'; code: string }
  | { kind: 'refusal'; mechanism: 'unsupported-question'; message: string };
export type BenchmarkCase = {
  id: string; fixture: FixtureId; track: Track;
  question: Record<Language, string>; method: 'calculation.run' | 'conversation.ask' | 'receipts.get';
  payload: Record<string, unknown>; expected: ExpectedAnswer | ExpectedRefusal | Record<Language, ExpectedAnswer | ExpectedRefusal>;
  worked: Record<Language, string>;
};
export type BenchmarkPackage = {
  schema: 'chausar.bilingual-synthetic-package.v1'; version: 1; fixtureOrigin: 'authored-synthetic';
  hiddenDatasetsIncluded: false; sealedDatasetsIncluded: false; attackPackIncluded: false;
  cases: BenchmarkCase[];
};
export type PublicBenchmarkPort = { request(method: string, payload?: Record<string, unknown>): Promise<any> };
export type AnswerSemantics = {
  operation: string; valueMinor: string; totalMinor: string; currency: string;
  figures: Record<string, string>; entities: string[]; completeness: string;
  gaps: string[]; excludedEntities: string[]; assumptions: Record<string, unknown>;
  period: unknown; comparePeriod: unknown; branch: unknown;
};
export type Observation = { kind: 'answer'; semantics: AnswerSemantics; receiptVerified: boolean; dictionaryVerified: boolean; scopeVerified: boolean }
  | { kind: 'refusal'; mechanism: 'error-code'; code: string }
  | { kind: 'refusal'; mechanism: 'unsupported-question'; message: string }
  | { kind: 'invalid'; reason: string };
export type CaseResult = {
  id: string; language: Language; track: Track; question: string;
  expectedKind: 'answer' | 'refusal'; outcome: 'right' | 'wrong' | 'refused';
  correct: boolean; mismatches: string[]; observation: Observation;
};
export type Score = {
  total: number; right: number; wrong: number; refused: number;
  correct: number; incorrect: number; expectedRefusals: number;
  matchedRefusals: number; unexpectedRefusals: number;
};
