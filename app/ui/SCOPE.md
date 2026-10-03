# Source-backed frontend scope

`design-screen-inventory.json` records the supplied design, not implemented screens or live engine capabilities. It retains all 123 desktop/phone entries, all 176 expanded enterprise surfaces (133 Both, 26 Enterprise, 17 internal-only), and 11 additional CA entries. Internal consoles and the enterprise customer window remain rules-only and undrawn. PH-04, CA, and enterprise retain their documented post-day-10 timing.

Every screen keeps its exact title, purpose, schedule wording, source line span, special states/rules, and direct proposed engine references. Explicit reuse is separate: BK-04 inherits FR-07, BK-18 inherits WK-13, and TD-02 inherits TD-01. A proposed method is never a claim that the current engine implements its name or signature. CA methods are not specified by the design and are left empty.

The four source files are identified by exact byte size, line count and SHA-256. Full boundary excerpts preserve phone privacy, separate client vaults, enterprise additions, common states, and open choices. This JSON is build/review metadata; it should not be shipped as the renderer's capability table or loaded into the production UI bundle.

From `task-18`, regenerate and verify without downloading dependencies:

```powershell
node scripts/generate-design-inventory.mjs
node scripts/generate-design-inventory.mjs --check
node --test app/ui/tests/inventory.test.ts
```

Tests check complete counts and exact IDs/titles, source provenance, proposed-contract status, explicit reuse, retained navigation, enterprise/CA/phone boundaries, deferred timing, and deterministic freshness. Existing renderer files and routes are unaffected.

Integrated tests can point at the immutable source directory without copying the attachments into a repository or runtime package. Both generator and provenance tests accept `UI_DESIGN_INPUTS`; the default is this workspace's `inputs` directory. Source identities keep their original `inputs/<filename>` paths and hashes regardless of the physical input directory:

```powershell
$env:UI_DESIGN_INPUTS = 'C:\Users\karta\Documents\Codex\2026-10-01\task-18\inputs'
node scripts/generate-design-inventory.mjs --check
node --test app/ui/tests/inventory.test.ts
```
