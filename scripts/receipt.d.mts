// Types for scripts/receipt.mjs (D11): the common test receipt format.
export const TEST_RECEIPT_FORMAT: 'chausar.test-receipt.v1';
export type ReceiptRow = { file: string; ms: number; tests: number; pass: number; fail: number; skip: number };
export type ReceiptTotals = { files: number; ms: number; tests: number; pass: number; fail: number; skip: number };
export type Shard = { index: number; total: number } | null;
export type TestReceipt = { format: 'chausar.test-receipt.v1'; tool: string; startedAt: string; finishedAt: string; shard: Shard; files: ReceiptRow[]; totals: ReceiptTotals };
export function testReceipt(input: { tool: string; startedAt: string; finishedAt: string; shard?: Shard; files: ReceiptRow[] }): TestReceipt;
export function readTestReceipt(receipt: unknown): TestReceipt;
export function receiptSeconds(receipt: unknown): Record<string, number>;
export function nodeTimingRows(text: string, toPath: (file: string) => string): ReceiptRow[];
export function vitestRows(report: unknown, toPath: (file: string) => string): ReceiptRow[];
