# Compiled sums

`platform/runtime/compiled-calculation.ts` turns one published money definition into a small, closed contract that the calculator and the SQL check both follow. It exists so a plain sum (billed, received, earned and the like) is described once, by data, and never by an expression or SQL that someone wrote by hand.

A business gets its definitions when it is made: `workspace.create` publishes the chosen pack through `OntologyService.publish`. No screen and no engine method lets an owner write a definition of their own.

## The contract

`compileSingleSum` covers one case: a sum over a single definition. The result (`CompiledSingleSum`) pins the compiler and contract version, the operation and the definition, the record kind, the money field, the currency, the sign, what to do with a missing value (`reject` or `exclude`), the dictionary version, the definition's hash and a digest of all of it. It holds no expression, no SQL and no code.

- A published dictionary carries one compiled sum for each of its single-definition sums (`compiledSums`).
- The calculator rebuilds the contract from the published definition and compares it field by field (`assertCompiledSingleSum`). A missing, repeated or changed entry refuses the calculation. A digest alone is never trusted.
- An older dictionary with no `compiledSums` list has the contract rebuilt for it.
- The receipt records the contract and the dictionary hash it came from, and each row names the field it was read from.
- The SQL check ([analytics.md](analytics.md)) uses the same contract with its registered sum statement. Names and values stay parameters.
- Missing value `exclude` gives partial coverage; `reject` refuses.

Margin, aging, change and scenario are not compiled this way. They keep their own fixed forms.

## Tests

- `platform/tests/compiled-measure.test.ts`: literal answers, bound fields, signs, large integers, missing-value rules, refusals and older dictionary shapes.
- `platform/tests/compiled-measure-sql.test.ts`: the prepared statements in both SQL dialects and refusal on a mismatch. The connections in these tests are injected, so they do not show a real database running.
