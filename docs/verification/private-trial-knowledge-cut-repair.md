# Saved calculation cuts and canonical custody root

The independent public acceptance at production `64e131ed5563e8875dca2ba729e1b2373f71f592` found one failure in 27 cases. Mounting the real renderer saves four normal dashboard calculations without `request.asOf`. Retrospective publication correctly refuses these unpinned requests, blocking the otherwise valid public journey.

New saved answers now retain `request.asOf ?? receipt.asOf`. The receipt already resolved that knowledge cut during the original calculation; persistence introduces no new historical cut. Explicit supplied cuts and existing answers/receipts are unchanged. The legacy refusal fixture explicitly represents an existing missing-cut record. The eight independent acceptance files are retained unchanged from `dd2b9e3bfda866806a7dd46e63466153375a773e`.

CI run 36921041711 on `64e131e` passed Ubuntu (2063 open tests) and failed Windows (1856/2053, 197 failures). Its downloaded report identifies the common `INTERCHANGE_SOURCE_SCOPE` failure during Engine attachment. The Vault has already canonicalized its directory, while the independently configured application root retained a different Windows spelling. Engine attachment now validates and canonicalizes that root through `safeDirectory` before custody compares the paths. Existing no-symlink and direct-child checks remain in place. The public custody regression uses an alternate Windows case spelling and validates actual encrypted export.

The predecessor is `c1c37e1b2c489c3d6e4aed0df9469dd290f6c77d`, tree `fec7917b0a60d39a8e72193d1e64ecf75938953d`. CI run 36912251742 passed Windows and Ubuntu, 1729 open tests each. Local benchmark counts differ by platform and must not be substituted for CI counts.

This is synthetic source and experimental encrypted-file evidence. It does not qualify native GUI/installers, real database behavior in this joined tree, live vendors/models, full archive portability, enterprise, hosted rollout, or the blocked independent security review.
