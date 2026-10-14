# Synthetic bank statements

Made-up statements in the public layout styles of five Indian banks (HDFC-like, ICICI-like,
SBI-like, Axis-like and Kotak-like headings). No real account, person or transaction appears here.
Every file reconciles: opening balance plus every entry equals each running balance and the
closing balance. Used by `platform/tests/connectors-ext-bank.test.ts`.

- `hdfc-like.csv`: Withdrawal Amt. / Deposit Amt. / Closing Balance, with a STATEMENT SUMMARY block holding Dr/Cr counts and sums.
- `icici-like.csv`: Withdrawal / Deposit Amount (INR ), both Value Date and Transaction Date, labelled balances above and below the table.
- `sbi-like.csv`: Txn Date / Value Date, Debit / Credit, in-cell "Opening Balance : ..." lines, DD Mon YYYY dates.
- `axis-like.csv`: OPENING BALANCE, CLOSING BALANCE and TRANSACTION TOTAL rows inside the table.
- `kotak-like.csv`: Amount + Dr / Cr layout; the balance has its own Dr / Cr column; summary block below.
- `hdfc-like.pdf-pages.json`: page texts in the shape the PDF helper's `pdf.extract` returns.
