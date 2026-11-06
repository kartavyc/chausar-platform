// Chausar venture launcher: the bank statement files the parser (bank.ts) reads, named for the owner. Data only, so the
// app can show the same list without taking the parser with it. Every entry's header and row are read by the parser in a
// test (venture-bank-formats-c4.test.ts), so a bank is named here only when the parser reads its columns.
export type StatementFormat = { bank: string; header: string; row: string };

export const STATEMENT_FORMATS: readonly StatementFormat[] = Object.freeze([
  { bank: 'HDFC Bank', header: 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance', row: '03/10/26,RENT,0000123,03/10/26,1200.00,,50000.00' },
  { bank: 'State Bank of India', header: 'Txn Date,Value Date,Description,Ref No./Cheque No.,Branch Code,Debit,Credit,Balance', row: '3 Oct 2026,3 Oct 2026,RENT,123,1234,1200.00,,50000.00' },
  { bank: 'ICICI Bank', header: 'S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )', row: '1,03/10/2026,03/10/2026,123,RENT,1200.00,0.00,50000.00' },
  { bank: 'Axis Bank', header: 'Tran Date,CHQNO,PARTICULARS,DR,CR,BAL,SOL', row: '03-10-2026,123,RENT,1200.00,,50000.00,1234' },
]);

/** The sample statement the app offers, made-up rows in the first bank's columns (app/ui/public/samples). */
export const SAMPLE_STATEMENT_PATH = 'samples/bank-statement-sample.csv';
