// Canonical browser-safe types, shared by the engine and renderer.


export type BankDetails = { accountName: string; accountNumber: string; ifsc: string | null; swift: string | null; bankName: string | null };

export type BillingSettings = {
  dueInDays: number;
  terms: string | null;
  reminderDays: number[];
  upiId: string | null;
  payeeName: string | null;
  bank: BankDetails | null;
  razorpay: RazorpayAccount | null;
};

export type RazorpayAccount = { mode: 'test' | 'live'; keyHint: string; savedAt: string };

export type QrMatrix = { version: number; size: number; rows: string[] };

export type InvoicePart = {
  kind: 'advance' | 'milestone' | 'partial' | 'final';
  label: string;
  shareBps: string | null;
  basisReceiptId: string;
  orderTotalMinor: MinorText;
  earlierMinor: MinorText;
};

export type MinorText = string;
