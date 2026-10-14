# Exact public invoice deletion acceptance

This checkpoint carries the unchanged 8,347-byte Windows reproduction from the independent C-local run against `bb1de95af0d47f169d5641b69ade5cb1d85939ff`. `checks/invoice-source-deletion-public-regression.test.ts` has SHA256 `3ca2a5d14d459089de1e9754c0a5dd55e64ce46d379dd7002585152f9903be97`. The four `source/platform/runtime` files merely re-export the actual repository Engine/server/types, preserving every original import and test byte. No implementation is substituted.

Use installed Node 24.13.1 and the existing project dependencies. No acquisition, real data, vendor/model call, native database or GUI is required. The case creates its own encrypted experimental-file workspace, uses public authenticated loopback Engine requests, and removes only its checked temporary child. On Windows the original requires a C: temporary directory.

```text
node --test .verification/invoice-purge/checks/invoice-source-deletion-public-regression.test.ts
```

The original failed at line 112 after confirming source facts, job and receipt were removed. Two `invoice-job-operation-v1` answers remained. One retained `outstandingMinor: "7500"`, `collectedMinor: "2500"`, `outcome: "open"`, proof digest/ID and receipt ID. The second retained its preparation proof references and missing-consent question. No model or reminder send occurred. The child joined and its owned disposable workspace was removed.

`checks/invoice-source-deletion-portable.test.ts` is an explicitly disclosed portability variant: only the scratch-root assertion differs. It retains the exact same imports, synthetic records, public requests, preconditions, final purge assertion and cleanup. It accepts C: on Windows and `/tmp` on Linux, refuses other roots, and preserves the containment checks before removal. Linux behavior has not been executed by this Windows lane. Use it in the cloud source lane:

```text
node --test .verification/invoice-purge/checks/invoice-source-deletion-portable.test.ts
```

This is acceptance for the derived-payload purge. A coordinated repair must also prove opaque no-resend identity, refusal/unknown rather than absence or refund, preserved original approval/proof digests, and safe retention cleanup. Simply deleting operation markers is insufficient.

Source-only private checkpoint; no main merge or release qualification. PostgreSQL transfer remains native-unrun and approval-blocked. No raw private streams or business data are included.
