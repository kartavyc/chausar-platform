# Wave 5 connector guide integration repair

The shard 5 guide failures were real integration gaps: available playbook connectors had no handwritten setup guide, and the older Zoho test still asserted that all Zoho access was planned. Guide validation remains strict. No generic fallback was relabelled as a real setup path.

## Scope and ownership

New `platform/runtime/venture/build/playbook-guides.ts` adds thirteen dedicated guides: `seo-wordpress`, `seo-cloudflare-kv`, the three `recruit-*` public boards, `article-transcript`, `article-local-transcription`, `article-publishing`, `overpass`, `nominatim`, `own-site`, `happenstance`, and `newsletter-owner-tool`. The newsletter author owns its catalogue and available-handoff row. These guides describe the current owner desk, least needed access, the often-missed step, the actual check performed, what leaves the app and the agent limits.

The same file replaces LinkedIn's old browser-posting instructions with copy-and-open only. In `guides.ts`, narrow shared changes add the hand guides, classify local article preparation and newsletter export as no charge, and stop asking for an obsolete LinkedIn posting-steps check. `connector-truth.ts` changes only LinkedIn's capability from browser posting to `copy-and-open`, mode `handoff`, with `text` as its sole field. A post request is refused by the capability validator.

UI ownership: `PlaybookGuide.ts`, one composition line in `Guide.tsx`, new EN/HI `pb-connector-guides.json`, and those keys in `hi-review.json`. Static copy is translated; dynamic missing-setting evidence and charge dates remain untouched. The fake guide fixture retains exact engine English and capability shapes for all thirteen new entries and the LinkedIn correction. No fake networking or publishing was added.

Tests: new `platform/tests/venture-playbook-guides.test.ts` and `app/ui/tests/places/playbook-connector-guides.test.tsx`; narrow expectation changes in `venture-guides.test.ts` and `venture-connector-truth.test.ts` reflect actual Zoho capability and the prohibited LinkedIn posting path.

## Honest setup boundaries

WordPress saves an exact approved draft and leaves publication to the owner. An application password inherits its user's rights; the guide does not pretend the password itself is scoped to drafts. Saving connection settings does not test credentials. Cloudflare requires an already installed client Worker and namespace, reads an existing key before a separately approved change, and never promises instant global propagation or retries an unknown write.

Public recruiting boards need no keys and read only published jobs. Initial installation seeds current jobs without alerts. Article source import and local transcription do not claim a remote account connection; the latter requires already installed local tools and a bounded source. Article publishing is a manual handoff. Lead guides retain source terms, OSM attribution, Nominatim restrictions and the exact paid Happenstance search approval. Newsletter recipient import/export remains blocked until the named lawyer consent review is genuinely recorded; draft preparation and the eventual manual sending path are explained separately.

Official documentation checked on 29 October 2026 for provider-specific wording:

- [WordPress application passwords](https://developer.wordpress.org/advanced-administration/security/application-passwords/): creating a separate password in the user profile, inherited user rights and HTTPS.
- [Cloudflare KV write API](https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/subresources/values/methods/update/): the `Workers KV Storage Write` permission and account/namespace target. Existing code supplies read-before-write and uncertain-result handling.
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): deliberate bounded lookup, caching, one request per second, no autocomplete/systematic geocoding, no confidential input and attribution. This guide is not a new claim that public service capacity is qualified for unlimited users.
- [Happenstance quickstart](https://developer.happenstance.ai/quickstart): own account key from Settings and network search. Current Chausar code returns the confirmed search link; the guide tells the owner to open it and does not claim automatic result polling.

No current price amounts were invented. Unchecked external prices stay explicitly unchecked. Local file handling and manual export incur no connector charge; outside service prices remain separate.

## Evidence

- `results/w5-guide-integration-red.txt`: missing handwritten guides, stale Zoho expectation, misleading LinkedIn wording and missing new localization observed before implementation.
- `w5-guide-ui-red-host.txt`: new Hindi guide regression fails on old engine-only text. The preceding restricted-cache run loaded no tests and is not counted as a behavioral RED.
- `w5-guide-linkedin-capability-red.txt`: the old browser-post capability fails the explicit handoff-only assertion.
- `w5-guide-old-record-red.txt`: a temporary copy of the old LinkedIn half-configured branch fails the old-record regression; current source was not overwritten. Temporary files were removed.
- `w5-guide-fake-red.txt`: new fake guides absent before adding exact fixture entries.
- `w5-guide-engine-final.txt`: 22/22 guide, capability, stale-record and fixture parity tests pass.
- `w5-guide-ui-green.txt`: focused guide/Hindi tests pass 24/24, including every new localized guide and unchanged unrelated guide copy.
- `w5-guides-ui-nearby.txt`: 246/247 near UI, text, source rules, accessibility and budgets pass. The sole failure is existing wave onboarding at 661 words versus baseline 330, which these setup-sheet changes do not alter. Baselines were not raised.
- `w5-guides-types.txt`: engine typecheck exits 0. The first UI type snapshot saw a transient server import graph; `w5-guides-ui-types-final.txt` exits 0 after the temporary screenshot harness was removed.

Ten real `Sheet` plus `Guide` component captures are under `results/w5-guide-shots/`: WordPress, Cloudflare, Nominatim, newsletter and LinkedIn, each in English light and Hindi dark at 390 px. `report.json` records all ten as 390 px viewport / 390 px scroll width with no axe violations. WordPress English and Cloudflare Hindi pixels were inspected. No visible clipping or unreadable contrast was found. These are component rehearsal captures, not the final wave walkthrough. Temporary browser/server processes and the two harness source files were stopped/removed.

Historical pre-review checkpoint: this repair still needed independent review and final wave gates. The review is recorded below. Live provider qualification and the separately completed tender package are outside this guide repair's scope.

Independent integrator review, 29 October 2026: spec PASS and quality PASS for this bounded repair. Reviewed the thirteen actual handoff/read/write setup descriptions, LinkedIn capability refusal and obsolete-record handling, exact fake metadata, and localized UI composition. Re-ran the guide and capability tests: 22/22 passed (`results/w5-guide-root-review.log`). Inspected the Cloudflare Hindi dark phone capture: text fits the viewport and remains legible. Full-wave onboarding word growth, provider credentials and the final screenshot walk remain separate gates. No blocker or should-fix remains in this guide scope.
