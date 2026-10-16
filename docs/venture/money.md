# Venture launcher: money (P3)

The money package is the back office of every venture. It prices offers, keeps clients and orders, prepares and issues invoices, records payments, and asks the existing calculator to prove billed, received and earned. Every number comes from BigInt code and has a receipt. The AI never does arithmetic here; no model is called anywhere in this package.

Code: `platform/runtime/venture/money/`. Tests: `platform/tests/venture-money.test.ts`.

## Methods

| Method | Level | What it does |
| --- | --- | --- |
| `venture.price.quote` | prepare | Prices an offer of the latest plan version, draft or accepted, and stores a price receipt |
| `venture.receipt.get` | read | Returns a price receipt; an offer receipt reads `stale` once the latest plan has a different digest |
| `venture.client.add` | prepare | Adds a client; checks a GSTIN by its checksum and fills the state from it |
| `venture.client.list` | read | Clients, newest first |
| `venture.order.create` | prepare | An order for one offer, priced by its own receipt with the client's tax treatment |
| `venture.order.list` | read | Orders, newest first |
| `venture.order.deliver` | prepare | Marks an order delivered and writes a sale fact |
| `venture.invoice.prepare` | prepare | A draft invoice from an order, with a fresh receipt; a second call replaces the draft |
| `venture.invoice.issue` | approve, app only | Issues the draft whose digest the owner approved: number, invoice fact, books receipt |
| `venture.invoice.get` | read | The invoice view: record, client, receipt, payments, document text, figures, notes |
| `venture.invoice.list` | read | Invoices, newest first |
| `venture.payment.record` | prepare, app only | Records a payment against an issued invoice and writes a payment fact |
| `venture.books.summary` | read | Billed, received and earned for a period, each with its calculator receipt, and the open invoices |

## How a price is worked out (`price.ts`)

`computePrice` takes integer minor-unit strings and returns every step with its rule:

- subtotal = unit price times quantity
- discount = subtotal times the discount in basis points, rounded half up to the minor unit (always zero from the handlers)
- amount before tax = subtotal less the discount
- tax by treatment: `none` adds nothing; `single` is one tax rounded half up; `cgst-sgst` rounds CGST and SGST each at half the rate, so their sum can differ by one from a single rate; `igst` is the full rate; `zero-rated-lut` is zero
- total = amount before tax plus tax

Quantity runs from 1 to 10000 and rates from 0 to 10000 basis points. Negative, decimal and out-of-range inputs are refused. No file in the package uses floats on money; a test checks it.

## Tax treatment (`tax.ts`)

| Situation | Treatment |
| --- | --- |
| Not registered, or a zero rate | `none` |
| Any country other than India | `single` |
| India, an offer quote (no client) | `single`, shown as "GST at 18%" |
| India, a client abroad | `zero-rated-lut` once the owner confirms an LUT, else `igst` |
| India, client and owner in different known states | `igst` |
| India, otherwise | `cgst-sgst`; when a state is unknown the receipt says "Place of supply taken as your own state." |

## Receipts (`quote.ts`)

A price receipt records the inputs (the owner's own price, the rate and where it came from, the treatment and the digest of the plan version priced), each step, the figures with their display text, the plain numbers a later sentence may cite, and an explanation built from a template, for example "1 x month at INR 2,499.00, plus GST at 18% (INR 449.82) = INR 2,948.82." The receipt checks its own explanation with the calculator's `numberGuard` before it is stored.

## Facts in the books (`facts.ts`)

Issued invoices, payments and deliveries become facts in the `chausar-books` source, so the existing calculator counts them: `billed` sums invoice facts (amount before tax), `received` sums payment facts (cash with tax) and `earned` sums sale facts (amount before tax, by delivery date). Facts are written inside the venture transaction with `insertFacts`, after a source access check. The calculator itself runs only after the transaction commits.

## Invoices and payments

- The title is `INVOICE` when the owner is not registered or the country only has plain invoices, `TAX INVOICE` when every registration field is present, and `INVOICE (not a tax invoice)` otherwise, with a note that says what to add.
- India invoices for a registered owner show the place of supply, the GSTIN and the SAC code.
- Issue numbers run `INV-0001`, `INV-0002` and so on. The books receipt for the issue day and order is kept only when its total equals the invoice's amount before tax; otherwise the invoice says why in words.
- A payment must be above zero and at most the balance. Two part payments on one day for one order share one books receipt, so the second payment says "The books receipt covers more than this payment."
- On the experimental file storage, every invoice view, the document text and the books summary say this is practice and not for real invoices.

## How it was checked

- `node --check` on every file in `money/` and on the test.
- Scoped typecheck with `typescript@5.9.3` (the scratch compiler) over `money/**` and the test: no errors.
- `node --test platform/tests/venture-money.test.ts`: 16 of 16 pass. They cover every hand-worked example in the build spec, both rounding outcomes for a unit of 105, refusals, quotes on a draft that stay current after acceptance and go stale after a new price, `numberGuard` on all five treatments, the treatment table, client checks (GSTIN `29ZZZZZ9999Z1Z4` fills state 29), orders before and after acceptance, invoice titles for India, the United States and the United Kingdom, the full India invoice text, the invoice, payment and sale facts, part and full payments, the same-day books note, the books summary for October 2026 (billed 249900, received 294882, earned 249900), a JPY venture with zero minor digits, the float guard, the error code list and the handler table.
- The parity tests `desktop-harness` and `desktop-ipc-methods` pass.

## Hand-off note

**Done.** Everything in section 6 of the build spec: all thirteen handlers, `computePrice` and `taxTreatmentFor` exported, the tests, and this page.

**Choices the integrator should know about.**

1. An invoice is priced from the accepted plan at the time it is prepared, as the spec says, not from the order's own receipt. If the owner accepts a new price after an order, the invoice uses the new price while the order's receipt and sale fact keep the old one.
2. For CGST and SGST lines, `taxLines[].rateBps` holds half the rate. For an odd rate, such as 25 basis points, that half is `12.5`, which is decimal text rather than whole basis points. Common service rates (18 percent) are even, so this does not happen in practice.
3. Paying a draft, delivering an order twice, and using a state for a client outside India refuse with `INVALID_VENTURE_REQUEST` and a plain message, since the code list has no closer code.
4. `venture.books.summary` is a read method, but the calculator stores each receipt it makes (existing calculator behaviour). Later facts mark older calculator receipts stale, so a books receipt kept on an invoice can read stale after a payment is recorded.
5. The handlers check `requireAppChannel` for issue and payment themselves too, in addition to the host's check.

**Not finished.** Nothing in P3's scope.

**Contract change needed.** None required. Optional: the comment on `BpsString` could say that a CGST or SGST line may hold half of an odd rate as `n.5`. **Applied in Phase C** (commit `b8752df`).

**Wiring change needed.** None.
