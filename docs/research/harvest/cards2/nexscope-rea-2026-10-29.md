# Nexscope public app inspection, 29 October 2026

Scope: the handoff's outstanding Nexscope investigation. Used the installed REA `capture_browser_scenario` tool against the public homepage and the shipped image-to-video route in a temporary Chrome profile. No account was created, no customer files were uploaded, and no generation or paid API action was submitted. No third-party implementation was copied.

## Observed

- The homepage redirected to `https://www.nexscope.ai/`. Its rendered navigation links to an API catalogue by marketplace, image/video tools, a model library, agent integration, and usage plans. These are visible product claims, not verified backend capabilities.
- `https://www.nexscope.ai/seller/video-generation/image-to-video?ui_locale=en` displayed the shipped workspace navigation and a sign-in dialog. The workspace separates creative workflows, data/research, API keys, scheduled tasks, and usage/credits. Video workflow entries include image, URL, avatar, reference-video and bulk-video routes. The actual editor and output were not available anonymously.
- Public documentation says the hosted application's source is separate from the public knowledge repository. The official guide describes reviewing a credit estimate before generation, then reviewing the output. This is documentation evidence, not a successful generation test.

## Evidence and limits

Both REA calls returned `cleanup_incomplete`, with retained partial observations rather than a successful Evidence record. The first navigation and body wait completed; the second navigation completed but the body wait timed out. Retained accessibility snapshots were readable. No complete REA Evidence ID was returned, so none is invented here.

Local diagnostic captures: `results/nexscope-rea-public.json` and `results/nexscope-rea-video.json`. Homepage DOM SHA-256: `566bf985451d65c930ad93f64ef8054c3a42e8cbc8a7704f2fc5f43659dd64db`. Video-route accessibility SHA-256: `021b3ab95c232533e1df2f345bb32d2242f40f070a330137593d8f4a32eb210d`. Process inspection after each call found no Chrome command line containing the REA or Playwright profile markers. Temporary profile deletion was not independently verified. The capture tool's incomplete-cleanup status is preserved.

Sources: [public app](https://www.nexscope.ai/), [video route](https://www.nexscope.ai/seller/video-generation/image-to-video), [official knowledge repository](https://github.com/nexscope-ai/ecommerce-ai-tools), [official video guide](https://github.com/nexscope-ai/ecommerce-ai-tools/blob/main/docs/guides/ai-video-generator.md).

## Chausar comparison and candidate rows

These are research candidates, not additions to the 39-package wave plan.

| Row | Observed idea | Chausar comparison | Disposition |
|---|---|---|---|
| NX1 | Separate data catalogue, creative tools, API keys, scheduled tasks and usage views | Chausar has Connections, Limits and rates, playbooks and approved routines. A marketplace data catalogue with verified individual service coverage is not established. | Learn from the separation. A Nexscope connector stays planned until access, terms, provenance, exact prices and response schemas are verified. |
| NX2 | Bulk video appears as a workspace navigation entry | Chausar's social package has per-ad inputs, storyboard approvals and generation boundaries. A reviewed multi-product batch job is not established. | Later candidate: per-item owner approval, exact per-item quotes, independent outcomes and no duplicate charges. The Nexscope entry does not prove these safeguards exist there. |
| NX3 | Model library and image/URL/avatar/reference-video entry points appear together | Chausar has own-media paths and explicit planned provider paths. A unified live provider library is not established. | Later candidate: expose only qualified adapters and dated capabilities, with rights, disclosure and account requirements shown before payment. No reference-copying or unconsented avatar route. |

The earlier Q19 and U17 evidence-display ideas remain supported by the public knowledge repository. This follow-up partially resolves NEEDS-REA: the anonymous shipped interface was observed; authenticated workflows, generation results, marketplace-data provenance, actual credit charges and backend implementation remain unknown.
