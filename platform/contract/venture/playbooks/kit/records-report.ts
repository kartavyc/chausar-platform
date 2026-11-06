// Canonical browser-safe types, shared by the engine and renderer.


export type ReportBlock =
  | { kind: 'heading'; text: string; estimate: boolean }
  | ({ kind: 'prose'; text: string; estimate: boolean } & BlockScope)
  | ({ kind: 'metric'; label: string; display: string; unit: string; receiptId: string; key: string } & BlockScope)
  | ({ kind: 'bars'; label: string; bars: ReportBar[] } & BlockScope)
  | { kind: 'quote'; text: string; by: string | null };

export type BlockScope = { channel: string | null; from: IsoDate | null; to: IsoDate | null };

export type IsoDate=string;

export type ReportBar = { label: string; display: string; receiptId: string; key: string; width: number };
