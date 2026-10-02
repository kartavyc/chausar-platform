# Current evidence for retained owner briefs

Independent HTTP acceptance found that a source correction from 5000 to 9000 made all five retained report receipts stale while the old brief stayed visible and could be accepted with repeat enabled. Receipt readback deliberately preserves historical arithmetic and reports staleness; a successful read is insufficient evidence of current freshness.

The installed Engine brief guard now requires every referenced report/alert receipt to report stale=false. It resolves receipt readiness, due decisions and alert pins from one detached current StateStore view. JobService supplies its actual writer candidate to the guard before brief completion and before acceptance/rescheduling, and the same detached snapshot when releasing list results. A refused acceptance preserves the original report, receipts, run counters, budget and schedule; no recalculation or replacement result is manufactured.

The independently authored nine-case acceptance slice remains unchanged. Three additional synthetic writer-candidate tests exercise the completion and acceptance transaction boundary and historical read redaction. They are source-boundary fixtures, not native PostgreSQL concurrency qualification. Executed results and the combined candidate identity are recorded separately by the integration coordinator; this document does not assert a green gate before execution.

Native database evidence remains pinned to published 1dc19b8. PGlite competing writers, PostgreSQL v2 archive/activation, installed GUI/devices, real providers and the blocked dedicated security review remain separate gates.
