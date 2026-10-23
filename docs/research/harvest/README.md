# Grok harvest, 21 October 2026

Research input, not a decision. Everything here is `planned` for Chausar; nothing is built.

## What was done

1. Grok Bot's X Researcher read the founder's X bookmarks and X posts from June to October 2026: 58 products with GitHub repos (`x-researcher-58.tsv`).
2. Grok Bot's open-source researcher swept six categories: 71 more (`oss-researcher-71.tsv`).
3. All 129 GitHub links were checked with `git ls-remote`: every one exists (`exists.txt`).
4. 35 were shortlisted and checked against the GitHub API for licence, dates and stars (`shortlist-verified.tsv`). Grok's figures matched.
5. Five agents shallow-cloned and read the shortlisted repos (no code run) and wrote cards:
   - [cards/harness.md](cards/harness.md): approval, safety, spend
   - [cards/quality-data-ops.md](cards/quality-data-ops.md): judges, evaluation, computer use, CRM, support
   - [cards/creator.md](cards/creator.md): YouTube and creator tools, with a draft YouTube channel playbook
   - [cards/finance.md](cards/finance.md): tax, banking, books, with a draft AI-native CA firm playbook
   - [cards/marketing-commerce.md](cards/marketing-commerce.md): social, SEO, UGC, commerce, sales, tenders, with a draft social media agency playbook

REA was not used: every shortlisted product is open source, so the source was read directly.

## The patterns worth adopting, across all cards

| Pattern | From | Chausar piece |
|---|---|---|
| Journalled actions: describe, approve, apply or reject; "outcome unknown" instead of resending; simulated results in shadow mode | cloudflare-os (Apache) | connectors, shadow mode, back office |
| Propose then Apply, with an approval token bound to action, user and session that the model never sees; one pending change | opendesk (Apache), helix-foundry (Apache) | autonomy ladder |
| Approval levels that can only tighten, a fixed floor of always-ask actions, gates that start denied and fail closed | qm (MIT), omnigent (Apache), decionis (idea) | delivery harness |
| Quote, then a one-time approval bound to the exact script hash, then a charge record before each paid call | open-edit (Apache), floe-guard (MIT) | unit economics, paid connectors |
| Reserve spend before a call, settle after; unknown price is refused, never $0 | floe-guard (MIT), rebuilt on BigInt | unit economics |
| The judge votes yes or no per rule with cited evidence; code checks the citations and counts | agentbehavior, SkillEvaluator (Apache), bridgeclip (MIT) | rehearsal and quality judge |
| Deterministic claim checks against source files, run in CI with a quality baseline | Countersign (AGPL, learn only) | quality judge |
| Exact-decimal unit economics where unknown is not zero; dated register of platform rules | sealeap (MIT), opentax-engine (AGPL, learn only) | back office, playbooks |
| Leads need a source URL and verified MX; drafts only, the owner sends | revenue-squad (MIT) | customer engine |
| Evidence ledger: only verified evidence overwrites a value | trycompai/crm (MIT) | venture desk |

## Malicious repo (never clone, run or reuse)

- **Gemma41/Onchain-Accounting** (listed as a self-hosted crypto accounting app) is malware. Found 23 Oct 2026 in the second pass (`cards2/finance2.md`): `run.bat` unpacks an opaque 21 MB `vendor.pkg` and strips the downloaded-file mark, and `service/` fetches encrypted blobs from an obfuscated host (api.failproxy.space, TLS checks off on a fallback path) and runs a Windows program from them in memory. Nothing was run; the clone was deleted. Grok's listing did not catch this, so treat every harvested repo as untrusted.

## Traps found in the code (do not copy)

- Model-written numbers in summaries or confirm cards (helix-foundry, opendesk, itr-prep-skill, nexscope Amazon-Skills).
- Platform evasion: proxy or cookie posting (postmill), clipping without rights plus unattended upload (podcast-shorts-factory), undisclosed synthetic creators (UGC-Factory).
- Licences that look open but are not: akaunting is BUSL-1.1 and bans accounting services; py-idp is AGPL or paid.
- Claims not backed by the repo: decionis policy runs on a hosted API; LongHorizon-Harness ships no harness code.

## Gaps nobody filled

GST returns, TDS, e-invoicing and Account Aggregator bank feeds for India. Chausar would build these itself, which also makes them a strong place to stand out.

## Platform facts for the connector catalogue

YouTube API uploads stay private until Google's audit passes; Instagram publishing needs Meta app review; AI voices and presenters must be disclosed. Upload, comments and DMs are `handoff` until those clear. Government portals are `planned: handoff`, and a licensed CA files.
