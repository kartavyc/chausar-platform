# Saved conversation answers: native worker boundary evidence

`platform/tests/desktop-renderer.test.ts` executes the actual renderer JavaScript and preload, the strict structured-clone IPC contract, `EngineHarness`, and the actual host-Node worker/Engine. Only automatic renderer boot is disabled. The main history fixtures supply no canned answer or list response.

Four new cases use fresh encrypted experimental-file Vaults in the Windows temporary directory. The worker environment excludes model credentials and provider configuration; model routes are empty and the send policy is `nothing`. Three CSV invoices reconcile to `120000` minor units. The explicitly selected September period includes only `100.00` and `200.00` INR invoices, producing literal billed value `30000`; the `900.00` August invoice remains outside that period. The business introduction retains its actual citations and five documented unknown categories.

The cases prove:

- Recent answers are requested on demand, with no history request during conversation rendering or ordinary asks. Opening uses the saved conversation ID and the existing receipt controls.
- Saved answer bodies, receipt IDs, value, period, rows and citations survive lock/unlock and a fresh worker opening the same encrypted Vault. The encrypted snapshot exposes neither the saved question nor imported invoice description as plaintext.
- Current source revocation omits both saved answers and makes direct reads unavailable. Source deletion remains effective after another worker opens the Vault; saved answers and the calculation receipt stay unavailable. Refused opens clear prior saved-answer dialogs.
- A completed real worker reply held at the IPC fixture boundary cannot render after the actual Lock vault action. A completed older-history reply cannot refill or recreate a closed Recent answers dialog. These are delayed actual results, not fabricated success responses.

The DOM fixture implements dialog close/removal, attribute removal and native `replaceChildren` text coercion. This caught optional `null` nodes becoming visible text in the history list; the renderer now filters those nodes, and the regression assertion remains.

Local verification: four selected native worker cases passed with no skips (`4/4`, `6284.3128 ms`). The complete renderer test file passed with no skips (`13/13`, `7668.1374 ms`). No full repository suite was run for this slice. Initial red execution failed before the new service was available; subsequent focused execution exposed the literal-null rendering regression before the final passes.

```powershell
& 'C:\Program Files\nodejs\node.exe' --test --test-concurrency=1 --test-reporter=tap platform/tests/desktop-renderer.test.ts
```

This is Windows host-Node worker and headless renderer/preload boundary evidence. Packaged Electron/GUI use, other operating systems, native database execution, live providers, vendor corpus qualification and managed connector grant expiry remain unverified by these fixtures. The current worker offers no managed-grant fixture seam; no expiry permission or result was fabricated.
