# Sharing with Chausar: draft consent text

**Status: a draft for the founder's lawyer. It is not in force.** These are working notes in plain English, not legal advice. The two extra sharing boxes ("Account words" and "Question shapes") stay closed in the app (`BOX_NOT_OPEN`) until the founder switches them on after this text has been reviewed. Nothing is sent anywhere until a reviewed intake service is deployed. Until then the app says "Sharing is not open yet. Nothing is sent."

Sections 1 to 6 are the words the app would show. Sections 7 to 9 are notes for the lawyer.

---

## 1. What this is

Chausar gets better at reading business software when it learns how real systems are laid out. If you agree, Chausar can send us the *shape* of the choices you make while setting up. This covers which kind of column held a date, whether you accepted or corrected a suggestion, and which class an account belongs to. It never covers what is in your books.

Sharing is off unless you turn it on. Nothing in the app depends on it. Saying no locks nothing.

## 2. The boxes

Each kind of sharing is a separate box. Every box starts empty. You can tick some, all or none.

- **Setup shapes.** The kinds of fields a file had (for example "a date", "an amount", "a customer reference"), the kind of report (ledger, invoice list, bank statement), the system family (for example Tally or a bank export), and whether a proposed setup was accepted.
- **Your corrections.** When you rejected or corrected a suggestion, the kind of correction and the reason, chosen from a fixed list (for example "the date format was wrong", "a different account class").
- **Account words** (not offered yet). This would share the words used in account names, with identifiers removed. It stays closed until this text has been reviewed.
- **Question shapes** (not offered yet). This would share which kind of calculation answered which kind of question. It stays closed until this text has been reviewed.

## 3. What is shared, exactly

Before anything is sent, you can open the exact file. It is made only of words from a fixed published list, such as "mapping", "accepted", "date", "decimal", "bank-statement" and "sales". It holds:

- no numbers of any kind. How often a kind of choice happened is given only as "one", "few" or "many", and each kind appears once;
- no amounts, prices, balances or dates;
- no names of customers, suppliers, staff, accounts or your business;
- no GST numbers, PAN, phone numbers, mail addresses, bank account or IFSC codes, or UPI ids;
- no file names, column titles as you wrote them, notes or any other free text.

Your computer checks the file before it can be sent and blocks it if anything that looks like a value appears. The receiving service checks it again and refuses it too.

You agree to that exact file. If anything in it changes after you agree, your agreement no longer applies and nothing is sent.

## 4. What is never shared

Your books, your files, your answers, your receipts, your customers' and suppliers' details and your money figures stay on your computer. Your books also hold other people's details, and those never leave your computer through sharing.

The sample cleaner swaps names and identifiers for made-up ones so you can look at a cleaned copy. Cleaned samples stay on your computer and are not uploaded.

## 5. How to stop, and how to delete

- **Stop:** turn sharing off in Trust → Sharing, or press Withdraw. Nothing more is sent. Agreements you had not used yet are cancelled.
- **Delete:** the "What I shared" page lists every batch with its date, size and count. Delete removes that batch from our service, together with the credits it earned. Your computer keeps a deletion key for each batch; we cannot link a batch to you by any other means.
- **Your learning log** on this computer can be cleared. Entries also expire on their own after your workspace's retention period.

## 6. What credits mean

Each shared event earns one credit. Credits are recorded against a random contributor key that your computer makes. They can be shown under a public name you choose, or under no name. Credits are a thank-you and a public record of contribution. *[Lawyer: confirm whether credits carry any value, rights or entitlement; the current design gives none.]* Deleting a batch removes its credits.

---

## 7. Notes for the lawyer: data roles

- The structure-only records are designed to hold no personal data. The receiving service stores:
  - a hash of a random contributor key;
  - an optional public name chosen by the contributor (letters only, no digits, no mail addresses);
  - the vocabulary words;
  - the time received.

  Please confirm whether the public name, or the contributor key's hash, makes the contributor identifiable under the DPDP Act 2023 and its Rules.
- The business that keeps customer data on its computer remains responsible for that data. Sharing as designed transmits none of it.
- Please also review the retention and deletion promises for the service, the location of its database, and how the service stores connecting IP addresses: for rate limiting they are held in memory only and not written to the database.

## 8. Open questions for the founder

1. **Licence** for the shared library. The plan recommends a share-alike data licence for community recipes and a private qualified library.
2. **Account words and question shapes:** whether to open them, and under which extra terms.
3. **Credits:** public or not by default (the current default is no name), and whether credits will ever carry a benefit.
4. **Age, capacity and authority:** who may agree on behalf of a business. The app allows only the owner or a co-founder, inside the app, not from a phone.

## 9. Where this is enforced

| Promise | Where it is enforced |
|---|---|
| Fixed word list | `platform/runtime/learning-ext/vocabulary.ts`, and the service's own copy |
| Scan on this computer | `structure.ts` (`scanText`, `batchBytes`) |
| Exact-file agreement | `sharing.ts` (`learningx.preview`, `consent`, `submit`) |
| Scan and validation on the service | `hosted/learning-intake/src/validate.ts` |
| Delete and credits | `hosted/learning-intake/src/store.ts` |
| Closed boxes | `OPEN_BOXES` in `vocabulary.ts` |
