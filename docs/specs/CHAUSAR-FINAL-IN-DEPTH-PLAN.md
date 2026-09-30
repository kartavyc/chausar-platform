# Chausar final in-depth product and architecture plan

## Status, authority and reading guide

Cycle 04 repair revision: 24 September 2026. This cycle supplied 0 fresh accepted amendments; 266 accepted document gaps are addressed across the completed cycles. Each reviewer targeted 50 without padding. All four authorized cycles, with five sequential reviewers each, are complete. Repeated review does not prove that no further gaps exist. Detailed failures, evidence and dispositions are in [[research/final-plan-gap-audit-2026-09-24/README]]. This audit is separate from the supplied historical three-cycle review. No runtime acceptance is claimed.

Consolidated on 24 September 2026 from the complete Desktop copies of REVIEW.md and CHAUSAR-AGREED-IN-DEPTH-PLAN.md, current project authority, and the founder's additional discussion supplied with this authoring task.

This is the final consolidated planning document. It is not a claim that the full product exists or that all engineering choices are settled. The six product areas in section 1 and production fleet requirements remain in scope. There is no arbitrary deadline, MVP substitution or single-workflow restriction.

Five kinds of statement must remain distinct:

| Status | Meaning in this document |
|---|---|
| Founder direction | Full product breadth, existing explicit project decisions, and the additions below. These govern the plan. |
| Reviewer agreement | The baseline and mechanism requirements agreed in the supplied three-cycle review. Agreement between reviewers does not independently ratify every vendor. |
| Engineering proposal or open comparison | Concrete ways to implement the direction. Candidates remain subject to their named evidence gates. |
| Recorded implementation evidence | Dated observations and synthetic checks reported by the sources. They were not rerun for this document. |
| Accepted audit repair requirement | A concrete design and acceptance contract from the new sequential gap audit. Documented behavior is not implemented or tested behavior. |

The founder's latest additions are integral to this plan:

- Design primarily for GPT-6 Luna / Luna-class models. Constrain their work through published business definitions, scripted workflows and structured tool contracts. Sonnet-class was also mentioned; Luna-class is the explicit preference. This is a design target awaiting evaluation.
- Explain and build the complete ontology rulebook path, from authored definitions and source mappings to validated publication, generated artifacts and runtime operations.
- Research and perform the mapping exercise individually for EACH TARGET DATABASE/SYSTEM. Gather MANY online samples and resources, including broad research/scraping and helpful paid subscriptions or access where authorized.
- Use this corpus to develop the mapping language and make LLM-assisted mapping easier and reusable. Do not substitute generic chatbot training or assume fine-tuning is required.
- Support MCP servers, APIs, existing connectors and solutions, database access, files and agentic computer control behind the same Chausar contracts.
- Treat an agent opening business software and exporting a report or file as a first-class ingestion route, with the same mapping, validation, provenance and publication rules as other routes.

The research programme above is planned work. This document does not claim a corpus was acquired and does not authorize a purchase, subscription, scraping run, deployment or customer connection now. The founder subsequently asked to retain useful assistant suggestions too. They are identified as recommendations, including reusable task templates, varied source configurations and reference answers, useful sandbox access and documented samples, unseen-installation testing, and optional later fine-tuning if evaluation establishes a need. None is a settled vendor choice, spending authorization or reduction of the research scope.

The supplied later plan includes optional governed communications. That inclusion is preserved here as part of the requested consolidated direction, superseding the earlier exclusion for this plan's scope. It does not grant access to any mailbox, chat history or meeting. Each source requires its own access, retention, audience and model-processing configuration.

Read sections 1-3 for the product and rulebook, section 6 for source research and ingestion, sections 4-7 for correctness and execution, sections 8-11 for agents, applications and deployment, and sections 12-18 for component status, acceptance, sequencing and evidence. Section 19 preserves review corrections and comparison provenance. Sections 20-24 provide concrete contracts and acceptance scenarios for semantics, acquisition, workforce, authority/effects and production. Read them with their earlier narrative sections; the audit resolution register maps each finding to its correction. The short companion is [[CHAUSAR-SIMPLE-SUMMARY]].

## 1. Product destination

Build Chausar as a full enterprise decision and execution platform with one governed model of the business shared by people, AI agents, applications and analytical systems.

The product combines:

1. **Business understanding:** operational objects, relationships, metrics, documents, optional communications and external intelligence.
2. **Decision intelligence:** investigations, forecasts, scenarios, constraints, alternatives and accountable decisions.
3. **AI workforce:** specialized agents, durable mandates, skills, collaboration, computer work and governed institutional knowledge.
4. **Operational execution:** cases, approvals, typed actions, source-system updates, human handoffs and outcome verification.
5. **Application creation:** governed workspaces, dashboards, forms, tools and generated applications built on the same objects and actions.
6. **Customer-facing operations:** voice, messaging, portals and service agents using the same authority, action and evidence model.

The organizing unit is a piece of business work linked to an objective, business objects, evidence, authority, actions and measured outcomes. Chat, agents, graphs and dashboards are interfaces or mechanisms. None is the product by itself.

### 1.1 What people do in Chausar

A leader opens the business workspace to see current conditions, important changes, active objectives, investigations and work awaiting a decision. They can ask a question in ordinary language, inspect the records and definitions behind an answer, compare alternatives, authorize an action and track its result. The answer must show the period, scope, freshness, coverage and relevant uncertainty.

Continuous intelligence works on assigned goals and discovers developments within permitted areas. It creates evidence-linked findings and work. A strategy workspace lets people change assumptions, compare scenarios and inspect constraints without changing operational facts.

Specialists maintain shared business definitions, source mappings, policies, data-quality rules and analytical models. Agents help discover, draft and test these changes. Specialist publication remains distinct from routine refreshes under already published rules.

The workforce performs research, analysis, document and computer work, coordinates human handoffs, runs approved operations and maintains governed knowledge. Users can work privately, collaborate live with colleagues and agents, or delegate work that continues durably. A private investigation does not inherit a company mandate's broader access.

Applications include dashboards, forms, operational tools, decision workspaces and generated apps. Customer-facing voice, messaging and portals support service and operational workflows through the same business objects and action contracts. Production deployment includes the customer cell, updates, monitoring, recovery and support.

### 1.2 Business work and accountability

A proposed common work record connects objective, scope, owner, contributing objects, evidence, decision, approvals, action attempts and observed outcomes. Work records expose whether an agent is investigating, waiting for missing information, awaiting approval, executing, reconciling or finished.

Execution success and business success are different observations. A supplier order may be confirmed as submitted while its effect on stock availability remains unknown. Chausar measures later outcomes using published measures and explicit observation windows. It does not mark the objective achieved solely because an agent or connector says done.

The product supports established mixed-system businesses and growing companies. Its configurable model can expand to multi-subsidiary use without silently treating that expansion as already qualified. The current planning exercise adds no industry restriction or customer-discovery prerequisite.

## 2. Agreed architecture principles

### 2.1 Chausar owns the critical semantics

Chausar owns:

- the canonical business and work model;
- stable object, relationship, measure, function, action and event identities;
- authority and policy semantics;
- business-operation identity and effect reconciliation;
- evidence, provenance and revision binding;
- customer-facing product behavior.

External libraries may provide parsers, clients, workflow engines, analytical engines, sandboxes, model adapters and algorithms. They must remain behind Chausar-owned contracts.

### 2.2 One authority, multiple rebuildable projections

PostgreSQL remains the proposed authoritative store for:

- current business state;
- bitemporal history;
- identity decisions;
- relationship records;
- definition revisions;
- policy references;
- operation ledgers;
- transactional outbox records.

Cube, search indexes, vector indexes, graph engines, authorization relationship stores and caches are derived projections. They must be rebuildable from authoritative records and must expose their revision and readiness.

No projection may become an independently editable source of business truth.

### 2.3 One business-effect path

All external effects use one action protocol:

1. prepare;
2. validate authority, target state and connector capability;
3. approve when policy requires it;
4. dispatch with a stable business operation ID;
5. record provider or source receipts;
6. reconcile uncertain outcomes;
7. confirm the observed result;
8. measure later outcomes separately from execution success.

Temporal coordinates durable work. It does not replace the business-operation ledger, provider idempotency or reconciliation.

### 2.4 Separate information classes

The system must keep these classes distinct:

- observed source facts;
- authorized manual assertions;
- inferred or extracted claims;
- hypothetical scenario state.

An LLM statement does not become a source fact. A scenario does not mutate operational truth. A prepared action is not a completed effect.

### 2.5 Current access controls old information

Current authority and retention rules apply when a user or agent opens:

- historical objects;
- saved investigations;
- cached aggregates;
- paths and graph explanations;
- document snippets;
- generated reports;
- scenario results;
- model context.

Historical evidence does not create a permanent access bypass.

### 2.6 Dedicated customer cells remain the default

Each customer receives a Chausar-managed dedicated cell by default, with portable customer-cloud and private deployment profiles.

A shared tier may be considered only after isolation, economics and operating evidence justify it. Namespace separation alone is not treated as customer isolation.

### 2.7 Overall architecture and trust boundaries

The following diagram describes the intended architecture, not an implemented deployment. Chausar's harness combines interpretation, controlled execution, durable work, evidence and recovery. The model operates inside that harness.

~~~mermaid
flowchart TD
  S["Business systems, documents and optional governed communications"]
  A["MCP, APIs, existing connectors, databases and files"]
  U["Authorized computer sessions and completed exports"]
  P["Acquisition receipts, parsing and mapping"]
  V["Validation, reconciliation and controlled publication"]
  O["Chausar definitions and PostgreSQL business authority"]
  Q["Ready Cube, search, vector and optional graph projections"]
  W["Business workspace, strategy, apps and customer channels"]
  M["Luna-class interpretation and structured proposals"]
  G["Current policy, typed validation and execution guards"]
  T["Temporal coordinates work over authoritative operation records"]
  E["Connectors, computers and human handoffs"]
  S --> A
  S --> U
  A --> P
  U --> P
  P --> V
  V --> O
  O --> Q
  Q -->|Current release authority checks| W
  W --> M
  M --> G
  O --> G
  G --> Q
  G --> T
  T --> E
  E --> P
~~~

Access, retention and model disclosure are separate decisions. Permission to read a source does not automatically permit permanent copying or sending it to an external model. These controls cover metadata, source rows, exports, screenshots, logs, prompts, embeddings, summaries and derived artifacts.

A customer can combine synchronized data with on-demand source queries. Each query still binds the source snapshot or observed revision it can establish and reports any inconsistency. Freshness is chosen by business need and source capability. The platform must not promise real-time completeness for a source that only provides delayed or partial exports.

No routine Chausar staff access to customer content is the operating requirement. Customer-authorized support, technical operator privileges and their audit must be specified honestly. Dedicated infrastructure alone does not make operator access technically impossible.

### 2.8 The model's bounded job

Software defines business calculations, validation, access decisions, state transitions, retries and execution semantics. The LLM interprets a request, proposes a mapping or operation using the available contract, summarizes returned evidence and explains uncertainty. It may not invent an alternative revenue formula, silently extend a grant or infer that an external action succeeded.

Published definitions generate the model-facing operation catalog. A structured proposal names operation and definition revisions, typed parameters, requested scope and any unresolved ambiguity. Deterministic validation checks it before execution. Result contracts carry exact values, units, time, completeness, provenance and permitted explanations.

This division is the principal means of designing for Luna-class models. Constraining the task can reduce what a model must invent, but that benefit must be measured. Schema-valid output can still select the wrong account, period, meaning or customer; correctness requires semantic evaluation as well as format validation.

## 3. Canonical ontology and business model

### 3.1 Chausar-owned canonical intermediate representation

Create a versioned, JSON-compatible canonical intermediate representation, or IR, owned by Chausar. It is the semantic authority from which implementation artifacts are generated.

The IR covers:

- object types;
- value and property types;
- relationship types with edge properties;
- interfaces and capabilities;
- populations;
- measures;
- deterministic functions;
- action definitions;
- business events;
- policies and markings;
- objectives and constraints;
- source mappings;
- identity rules;
- temporal semantics;
- provenance and evidence requirements;
- projection and invalidation rules.

Every definition has an immutable identity, namespace, revision, owner, lifecycle state, dependencies and validation evidence.

### 3.2 Normative semantic details

The IR must define these directly rather than hide them in free-form annotations:

- absent, null, unknown, withheld and not-applicable values;
- exact decimal precision, scale, currency and rounding stage;
- safe large-integer and wire encodings;
- valid time and recorded time;
- source assertion, resolved fact and derived value;
- relationship identity, multiplicity and temporal cardinality;
- measure grain, join cardinality, semi-additivity and completeness;
- action preconditions, idempotency, effect class and reconciliation;
- marking propagation and declassification;
- projection freshness and invalidation;
- executable artifact identity and trust.

### 3.3 Generated targets

The IR produces reviewed artifacts for:

- PostgreSQL schema and migrations;
- API schemas and operation contracts;
- TypeScript types and runtime validators;
- durable event contracts;
- Cube models;
- authorization and marking enforcement plans;
- SDKs and agent tool definitions;
- SHACL or OWL interoperability exports where useful.

Publication fails if a required target cannot preserve the semantics of a construct. Silent semantic degradation is forbidden.

### 3.4 Authoring format comparison

The canonical IR remains fixed regardless of authoring syntax. Compare:

- direct Chausar DSL or JSON authoring;
- LinkML as an optional authoring and interchange layer;
- JSON Schema with Chausar annotations;
- CUE for compositional constraints;
- selective ODL parser or code-generation reuse.

LinkML is not preselected as the executable backbone. Its SQL support, TypeScript output and GraphQL output do not supply Chausar's migration, runtime-validation, metric, policy, action or bitemporal semantics.

Complementary tools may include:

- Ariga Atlas or an equivalent reviewed migration system;
- TypeSpec and OpenAPI for HTTP operations;
- Protobuf and Buf for durable internal events and compatibility checks;
- CUE for bundle and deployment constraints;
- SHACL and OWL as derived interoperability outputs.

### 3.5 Domain packs

Author reusable packs for:

- organization and legal entities;
- finance and accounting;
- commercial activity;
- supply chain and operations;
- workforce and capacity;
- customer service and cases;
- decisions, objectives and outcomes;
- India-specific registrations, branches, ledgers, fiscal calendars, GST and source-system semantics.

Customer extensions are namespaced and versioned. Template upgrades produce explicit impact reports and never silently change customer meaning.

### 3.6 What the ontology rulebook actually contains

The rulebook is a versioned executable description of what the business means and what operations the product permits. It is not a graph of labels alone. A relationship such as Customer has Invoice helps navigation, but does not define revenue, ownership authority, the effect of a cancelled invoice or the reporting period.

The canonical IR is the common representation consumed by Chausar's compilers and services. Its JSON-compatible direction does not settle the authoring syntax or mapping language. The following is a semantic inventory, not an existing schema:

| Definition area | Questions the definition must answer |
|---|---|
| Object | What kind of thing is this, what identifies it, and which properties are required? |
| Typed property | What exact value, unit, decimal scale, currency, validation and missing-value state is allowed? |
| Relationship | What connects to what, with what multiplicity, edge properties and temporal validity? |
| Population | Which objects are eligible, under which conditions and time interpretation? |
| Measure | At what grain is a value computed, from which population, using which aggregation and completeness rule? |
| Function | Which pure typed calculation or validation can be reused, with no undeclared I/O? |
| Action | What may change, with which preconditions, approval, idempotency and reconciliation requirements? |
| Policy | Who may read, process, publish or act, for what purpose and with which obligations? |
| Identity | How do source records refer to canonical objects, and how can a match be reversed? |
| Time | When was an assertion valid, when was it recorded, and which clock does a query use? |
| Provenance | What source, import, evidence, transformation and definition produced this assertion? |
| Source mapping | How does a particular schema, report or export express the canonical concepts? |
| Projection | What derived artifacts depend on the definition, and what makes them ready or stale? |

An object can have multiple source assertions. Resolution applies the customer's published authority rules while retaining disagreement and provenance. Similar field names are not sufficient evidence that two assertions refer to the same concept.

### 3.7 Authoring roles and publication lifecycle

Sections 20.1-20.7 make definition identity, composition, reproducibility, independent correctness, activation and concurrent editing explicit. Sections 20.8-20.50 define the value, temporal, identity, measurement and provenance behavior that publication must preserve. These are required contracts, not a new authoring-tool selection.

Reusable domain packs carry common semantics. Versioned customer extensions add local classifications, fiscal calendars, organization structures, permitted actions and source bindings. An extension must identify what it changes and its dependencies. A template upgrade must not silently reinterpret a customer's historical reports.

The intended authoring process is:

1. A specialist or agent drafts definitions from business requirements and source evidence. The draft records unknowns, examples, counterexamples and its owner.
2. The authoring front end produces canonical IR. The compiler resolves names and dependencies and checks types, units, value states, relationship cardinality and temporal rules.
3. Mapping validation checks source bindings, transformation rules, identity, supported scope and completeness. Semantic validation checks measures, policies, actions and their interaction.
4. Compilers generate target artifacts and a support manifest. If a required target cannot preserve a construct, publication fails visibly.
5. Differential tests compare the same cases across the reference evaluator, database, API validators, TypeScript/runtime validators, Cube and policy targets. Reconciliation compares permitted source reports with the proposed interpretation.
6. A specialist reviews meaning, evidence and impact and publishes an immutable release with an approved migration and activation plan.
7. Services activate compatible artifacts and expose readiness by revision. Runtime requests use the published release and current authority. Drafts remain outside shared business truth.
8. Monitoring identifies drift, failures and mismatches. Changes return through proposal, validation and publication. Rollback respects retained data, events and active-work compatibility.

~~~mermaid
flowchart LR
  D["Domain pack and customer extension drafts"]
  B["Source evidence and proposed bindings"]
  I["Canonical Chausar IR"]
  C["Semantic, compatibility and support checks"]
  X["Generate database, API, Cube, policy and tool artifacts"]
  T["Independent oracle, differential tests and source reconciliation"]
  R["Specialist publication and immutable release"]
  A["Compatible activation and projection readiness"]
  U["Runtime queries, agents, apps and actions"]
  D --> I
  B --> I
  I --> C
  C --> X
  X --> T
  T --> R
  R --> A
  A --> U
  T -->|Unresolved meaning or failed check| D
  U -->|Drift or correction proposal| D
~~~

Generated migrations do not imply unattended destructive schema changes. Publication must identify affected stored data, in-flight work, events, SDKs, projections and customer extensions. Unnecessary backward-compatibility layers are not a default. A necessary transition must still be explicit, safe and tested instead of breaking active data or work accidentally.

### 3.8 Two separate mappings

These are the two understanding mappings. Executing a source write additionally requires a qualified outbound action mapping under 23.26. A many-to-one read interpretation cannot be reversed into a source command by assumption; review and readback must preserve consequential source-specific meaning.

| Mapping | Input and output | What must be decided |
|---|---|---|
| Source-to-business mapping | A source schema, record, report or export becomes a typed canonical assertion. | Field meaning, identity, transformations, eligibility, time, units, authority and provenance. |
| Language-to-operation mapping | A person's request becomes parameters for published operations. | Which existing measure or action the user means, period, filters, scope and ambiguity. |

The source mapping is established and versioned during onboarding and evolution. Ordinary questions reuse it. The language model should not rediscover the accounting interpretation from raw tables every time someone asks about revenue.

A source adapter can expose exactly the same endpoint name in two customers while the underlying configuration means different things. Conversely, an API response, database row and UI report can describe the same business record. Canonical identity, mapping revision and acquisition context connect these cases.

A language request cannot repair an unpublished or unresolved source mapping by inventing meaning. If a user asks for revenue and two published definitions match, the system asks which meaning is intended or uses an explicitly configured default and shows it. Clear permitted read-only requests execute automatically; ambiguous or unsupported requests return a focused clarification.

### 3.9 Revenue example: illustrative semantics, not a universal formula

This example explains the definition work. It is neither implemented Chausar behavior nor a universal accounting policy. The customer and responsible specialists must publish their intended meaning.

Suppose a customer wants an exact measure called recognized revenue from posted ledger entries. A separate published measure could describe invoiced sales or cash received. Those measures may legitimately disagree because they answer different questions.

Before any formula is accepted, the definition must settle:

| Concern | Illustrative definition decision |
|---|---|
| Grain | One eligible posting line, identified within legal entity and ledger. |
| Eligibility | Posted entries in the selected book and period; draft, void and excluded adjustment states handled explicitly. |
| Account classification | A versioned customer mapping identifies the accounts and entry classes contributing to revenue. Account names alone are insufficient. |
| Sign | An explicit rule converts the source debit/credit representation to the measure's signed contribution. |
| Taxes and discounts | State whether each is included, excluded or represented by separate postings; avoid subtracting a value twice. |
| Recognition | Identify the recognition date or schedule. Invoice creation and payment dates do not silently substitute for it. |
| Currency | Preserve transaction currency, functional currency and any reporting conversion, with rate source, rate date and rounding stage. |
| Calendar | Use the customer's fiscal calendar, time zone, period boundaries and period-close policy. |
| Corrections | Preserve corrected and original recorded views; handle credit notes, reversals and later adjustments through explicit rules. |
| Relationships | Declare join cardinality so a posting joined to multiple products or contacts cannot multiply revenue. |
| Completeness | List required entities, books, periods and source states; report partial coverage or block a configured critical total. |
| Authority | Define which source assertions control the result and how unresolved conflicts appear. |

After these choices, an illustrative computation is the exact sum of eligible signed posting contributions in the selected reporting currency. The phrase hides no permission to guess eligibility, exchange rates or classification. All of those rules must already be published.

A mapping template for one system might bind its ledger ID, posting ID, status, debit, credit, currency and recognition-date fields to this definition. Another might provide a report with pre-aggregated totals. That report is usable only at its declared grain and scope. It cannot support line-level drill-down or customer segmentation it does not contain.

For a question such as "What was revenue last quarter?", the model selects the published measure and proposes the quarter, entity scope, currency and time interpretation. Software resolves the fiscal period, validates permissions and completeness, computes through the governed analytical path and returns the exact result with evidence. A follow-up about a decline can invoke published comparisons and analytical jobs, but explanations must separate measured contribution changes from causal hypotheses.

### 3.10 Proposed mapping-language requirements

Reprocessing source meaning replaces the complete prior producer-owned assertion set under 20.6, including a successfully established empty set. Merely upserting newly emitted assertions cannot remove obsolete contributions.

The mapping language should express source selectors, target objects and properties, identity keys, lookup tables, type conversion, enumerations, exact arithmetic, units, calendars, relationship construction, cardinality expectations, validity, recorded provenance, conflict rules and quality checks. Report-oriented mappings also need headers, sections, subtotal markers, page boundaries and export filters.

Mappings must distinguish row-level facts, source-supplied aggregates, extracted document claims and incomplete snapshots. Unknown cannot silently become zero; withheld cannot become null; unavailable records cannot be treated as deleted merely because a filtered export omitted them.

A reusable template declares variables to bind per customer, such as the legal entity, relevant ledger, account classifications, date fields, source timezone or custom status codes. Bindings are versioned data with review evidence. Executable custom transforms, if needed, require declared inputs, pinned code, isolation and validation under existing function/job boundaries. They do not become unrestricted model-written runtime logic.

The precise syntax, compiler structure and balance between declarative expressions and bounded transforms remain open. The corpus and DEFN-1 evidence must inform that choice.

## 4. Temporal authority, identity and correction

Apply sections 20.15-20.50 alongside this model, including coherent assertion groups, committed visibility, interval boundaries, corrected versus originally known views and reversible identity decisions. Immutable history records do not require retaining prohibited personal payloads forever: section 23.19 governs erasable payloads and honest replay limits. Current access still controls historical release.

### 4.1 Bitemporal invariant

For a fact within a tenant, two revisions may overlap in valid time or recorded time, but never in both dimensions for the same fact identity.

Use immutable recorded revisions. Derive transaction intervals from commit revisions or immutable supersession edges. Business values are not rewritten in place.

### 4.2 Typed correction primitive

A correction operation declares:

- fact identity;
- corrected valid interval;
- replacement assertion or value;
- recorded revision;
- reason and evidence;
- expected prior revision.

The operation atomically splits partial valid intervals, preserves the previous recorded-time view and emits the related projection-impact record in the same transaction.

### 4.3 Two-clock query semantics

Provide generated operators such as:

- `as_of(valid_time, recorded_time)`;
- `known_at(recorded_time)`;
- `latest_preceding(event_time, known_at, max_age)`;
- identity and relationship resolution at both clocks.

Queries must fail when corruption produces more than one eligible fact instead of selecting one nondeterministically.

### 4.4 Identity resolution

Use deterministic rules first and Splink or another qualified matcher for proposals.

Never physically merge source facts. Store:

- source-record identity;
- accepted and rejected match decisions;
- canonical membership as bitemporal mappings;
- evidence, matcher revision and reviewer;
- reversible `same_as` links;
- dependency information for unmerge propagation.

Every saved result pins the identity revision it used.

### 4.5 Conformance testing

Use PostgreSQL as the proposed authority. XTDB may be used as a semantic challenger and differential oracle for bitemporal behavior. This does not make XTDB the selected production authority.

### 4.6 Correction semantics that must survive implementation

The invariant is two-dimensional: for the same tenant and fact identity, valid ranges and recorded ranges cannot BOTH overlap. Independent exclusion rules on each range are wrong because a legitimate later correction intentionally overlaps the earlier valid range.

Illustrative case: an invoice amount of INR 100 is recorded as valid from 1 March. On 15 April, a correction states INR 80 from 1 March. A query of March as known before 15 April returns the original assertion. A query of March as known after the correction returns the corrected assertion. Both remain subject to current access and retained evidence.

The immutable-revision model derives transaction intervals or uses immutable supersession edges. Closing a stored open-ended transaction range by UPDATE is a different mutation model and must not be described as physically append-only. The correction primitive must atomically preserve unaffected sub-intervals, check the expected revision and emit its outbox/impact records.

The source review corrected its PostgreSQL temporal-key claim from version 17 to version 18 and stated that those features handle application-time constraints, not complete system-versioned bitemporality. Its recorded PERIOD foreign-key restriction was NO ACTION only. These are dated research findings to recheck for a selected release; application correction and relationship behavior must not rely on an assumed automatic cascade.

Acceptance includes touching boundaries, zero-length intervals, open-ended intervals, concurrent corrections, historical identity across unmerge and the March/April case. No store's feature name substitutes for these conformance tests.

## 5. Authorization, markings and privacy

### 5.1 One Chausar policy contract

Define one Chausar decision and obligation API. Relationship engines, policy engines, PostgreSQL RLS and Cube controls are implementations or generated targets, not independent sources of policy truth.

### 5.2 Authorization snapshot

The required vector also covers the protected content revision's causal minimum authorization basis under 23.9. A new content version cannot be released using an otherwise unexpired decision older than access changes that causally precede it. This dependency travels with the content, independently of the reader session.

Every decision binds an authorization_snapshot revision vector containing:

- tenant;
- principal, role and delegated-authority revision;
- relationship-authority revision;
- policy bundle and schema revision;
- ontology and marking-compiler revision;
- SQL/RLS artifact revision;
- Cube model and cache watermark;
- search and graph projection watermarks.

A component must prove that it can serve the required vector. If it cannot, the request waits within its declared bound, uses an explicitly permitted fallback or returns unavailable. The snapshot records a decision basis; it is not an unlimited permission lease. Long-running and paginated work obey current release checks and scoped continuation in sections 23.9 and 23.12, while coherent data and definition cuts remain separately pinned.

### 5.3 Decision algebra

Access is allowed only when every mandatory control allows at the bound revision. Alternative complete grants preserve their correlated predicates under section 23.6; do not combine unrelated pieces of separate grants into broader access. Executable obligations must compose into a feasible route and be fulfilled under section 23.5, rather than treating Boolean allows as sufficient.

Any deny wins. Unknown, stale, missing, unsupported, diagnostic or timeout outcomes deny or return explicit unavailability. No target may silently omit a rule it cannot express.

### 5.4 Marking lattice and propagation

Define a Chausar-owned marking lattice with:

- join and transform propagation rules;
- inheritance through derived artifacts;
- behavior for aggregates, documents, embeddings, summaries and exports;
- governed declassification;
- downstream invalidation and rebuilding;
- auditable reversibility.

Cedar, OPA, PostgreSQL RLS, security-barrier views and Cube suppressions are candidate generated enforcement targets. None is the marking model itself.

### 5.5 Relationship-authorization comparison

Compare behind the same contract:

- PostgreSQL-native relationship evaluation;
- OpenFGA;
- SpiceDB;
- OPA partial evaluation or Topaz for data-filter compilation where relevant.

The comparison must test revocation, projection lag, outages, explanation, broad lists, pagination, aggregates, search, graph traversal, tenant confusion, privileged database roles, rolling policy migration, audit replay and drift repair.

### 5.6 Exact and statistical release classes

**Exact governed business results** use strict authorization, marking-aware measures, complementary suppression, differencing controls, query-history controls, saved-result rechecks and audit. They receive no silent noise.

**Privacy-preserving statistical releases** are separate, clearly labeled surfaces. Where approximate output is acceptable, they may use bounded contribution, a declared differential-privacy mechanism and composition accounting.

### 5.7 Cross-engine enforcement and reproducible decisions

A relationship-store token alone cannot bind PostgreSQL state, field policies, SQL views, Cube caches and search indexes. The authorization snapshot is the shared contract across them. Store a decision manifest sufficient to explain the allowed operation, visible row set, masked fields, aggregate release and obligations, subject to retention rules. Replaying a decision for audit does not grant the former viewer access today.

The AUTHZ-1 workload must include more than 10,000 accessible objects, broad lists, pagination and hidden relationships. Test database owners, superusers and BYPASSRLS roles, permissive-policy OR composition and policy-lookup races. A filtered list and an individual-object check must agree under the same snapshot.

Run old and new workers together during policy/schema migration. Inject a missing relationship tuple, policy entity, RLS artifact, Cube suppression and lineage edge. Detect divergence and repair it deterministically. Measure revocation-to-enforcement latency and fail closed while a required projection is stale or down. Any allowed authoritative fallback must preserve the complete contract.

### 5.8 Derived information and aggregate attacks

Contributing dependencies include control and existence information, not only copied columns. Sections 23.11 and 23.16-23.25 specify hidden predicates, retention clocks, erasure, holds, privacy accounting, purpose continuity and remote artifact cleanup. Statistical privacy does not protect separately disclosed exact data. Section 23.50 governs the actual destination and already released copies.

A derived artifact inherits the join of its contributing markings under the published lattice. Dropping a sensitive column from a transform does not by itself declassify the output. A source marking change invalidates or re-marks dependent reports, exports, summaries, embeddings and caches. Declassification has its own governed approval and auditable reversal path.

Exact authorized finance and operational results retain exact values. Privacy controls may deny, suppress or narrow a release; they must not silently add noise to an exact total. A clearly labeled statistical release can use an explicit differential-privacy mechanism and composition budget when approximation is the defined purpose.

Test repeated overlapping queries, complementary cohorts, before/after changes and cache-assisted reconstruction across sessions. Minimum cohort size by itself is insufficient. Query-history accounting must follow the relevant principal and release context rather than resetting whenever a new chat begins.

## 6. Data connectivity, pipelines and projections

Section 21 supplies the concrete acquisition and research contracts for every applicable route: durable capture before acknowledgement, continuity and completion, trusted source identity, untrusted artifact parsing, computer-export integrity and separately qualified operation support. Its per-target corpus controls preserve the founder requirement for MANY samples for EACH TARGET DATABASE/SYSTEM; they do not authorize acquisition or purchases.

### 6.1 Connector contract

Every connector is a maintained product contract specifying:

- authentication and source identity;
- object and field coverage;
- read and write capabilities;
- freshness and ordering;
- deletion and correction behavior;
- rate limits and concurrency;
- schema drift;
- backfill and replay;
- idempotency and outcome reconciliation;
- residency and disclosure limits;
- operational health and recovery.

### 6.2 Acquisition methods

Select acquisition per source and dataset:

- source webhooks;
- polling;
- native logical decoding;
- Debezium Connect, Server or Engine;
- Sequin for qualified PostgreSQL-source use cases;
- PeerDB for qualified PostgreSQL-to-analytical-store use cases;
- dlt or another bounded ingestion library.

Kafka presence is one factor. It is not the selection rule.

### 6.3 Pipeline product surface

Build pipeline release gating, lineage and health as first-class product surfaces:

- source discovery and profiling;
- schema and mapping proposals;
- validation and reconciliation;
- impact analysis;
- controlled publication;
- data-quality monitoring;
- failed-record and conflict queues;
- rebuild and recovery controls.

### 6.4 Projection-impact records

The required data revision includes a validated visibility floor from causally dependent acknowledged local changes under 20.42. A healthy projection at an older cut cannot silently appear to be the completed current consequence of a newer successful change.

Every invalidating change emits a conservative record containing:

- definition and metric revision;
- affected valid-time partitions;
- identity revision;
- policy and marking epoch;
- source revision;
- event ID.

Invalidators include corrections, identity changes, policy changes, definition changes, deletion, authority changes and calendar or currency-rule changes.

A query uses a projection proven complete through its required revision, falls back to authoritative computation, or returns `PROJECTION_NOT_READY`.

### 6.5 Cube

Retain Cube as the generated analytical projection, subject to:

- explicit grain and join cardinality;
- exact decimal transport;
- revision-aware invalidation;
- current authorization and cache isolation;
- full-rebuild equivalence;
- aggregate-release controls.

Cube never becomes the write authority.

### 6.6 Flexible access through Chausar-owned contracts

MCP servers, direct APIs, existing solutions/connectors, database queries, CDC, uploaded files and agentic computer exports are supported routes. The access method can vary by customer, source and operation. This plan imposes no API-first rule and does not restrict computer use to a last resort.

MCP provides a tool/access interface. It does not establish that two tools named sales expose the same accounting concept, grain, permissions or time window. Existing connectors can reduce acquisition work but still need a declared capability profile and semantic mapping. Reuse does not add a second business control plane.

A proposed acquisition envelope records the tenant, source installation, application/version/module/configuration, access route, source/report identity, authorized actor or mandate, selected entity and filters, source period, extraction time, observed source revision where available, parser revision, artifact identity, retention class and completeness evidence. Unknown source revisions remain unknown; extraction time must not masquerade as transaction time.

Read and write support are separate capabilities. An MCP tool that can export a report is not automatically permitted to update the ledger. A vendor connector's internal retry behavior must be compatible with the Chausar operation contract before it can dispatch effects.

### 6.7 Database-by-database research and acquisition programme

The founder wants the mapping exercise performed individually for EACH TARGET DATABASE/SYSTEM, using MANY online samples and resources. The programme covers broad online research and scraping where access permits, plus helpful subscriptions or paid access when separately authorized. It is not limited to a few representative systems, one preferred source type or one assistant-selected vendor.

For each target, maintain an evidence dossier spanning the applicable application versions, modules, deployment variants, configurations and customizations. A database engine label alone is insufficient: two SQL Server databases can represent different applications, and two installations of the same ERP can implement different charts of accounts and report layouts.

The intended corpus includes:

| Material | What it helps establish |
|---|---|
| Schemas and data dictionaries | Names, types, keys, relationships, constraints and documented meaning. |
| Sample records, exports and report files | Actual value encodings, missingness, status behavior, row grain and report structure. |
| Product documentation and configuration guides | Business processes, module boundaries, source rules and configurable semantics. |
| Customer or example configurations | Fiscal calendars, account classifications, organization structures and custom fields. |
| Reference reports and known answers | Reconciliation targets and concrete counterexamples to plausible but wrong mappings. |
| Available connector implementations | Extraction behavior, pagination, supported fields, transforms and failure handling. |
| Available test environments and sandbox access | Observable behavior for corrections, exports, source updates and incomplete data. |

Record provenance, retrieval date, application/version/module/configuration tags, permitted uses and access conditions for each item. Distinguish genuine source examples, synthetic fixtures, inferred schemas and unverified community descriptions. Customer-specific material stays within its granted boundary; reusable knowledge does not imply permission to distribute the underlying data.

Recommendation: enrich the broad collection with diverse configurations and reference answers, and spend where useful on documented samples and sandbox access. These recommendations help expose variation; they do not narrow the founder's database-by-database scope, preselect a spending order or authorize purchases now.

No corpus acquisition or subscription activation was performed for this document. Inventory size is a coverage signal, not proof of semantic correctness.

### 6.8 Turning the corpus into a reusable mapping language

The purpose of collecting the corpus is to DEVELOP THE MAPPING LANGUAGE AND MAKE LLM-ASSISTED MAPPING EASIER AND REUSABLE.

For each target system, the proposed workflow is:

1. Organize evidence by the actual installation characteristics and record which business concepts it supports.
2. Work through source-to-canonical mappings, including identity, status, dates, units, accounting classifications, corrections and source authority.
3. Record recurring patterns and unresolved exceptions. Use those patterns to improve the mapping language rather than encoding every installation as an opaque script.
4. Produce reusable system/version/module mapping templates with declared customer binding points and applicability limits.
5. Attach source evidence, positive and negative examples, reconciliation reports and known-answer cases to each template.
6. Let an LLM propose a template and fill bindings using permitted installation evidence. It must point to evidence and state ambiguity instead of guessing a classification.
7. Run deterministic type, key, cardinality, coverage, temporal and reconciliation checks. Specialists resolve material business ambiguity before publication.
8. Publish the mapping revision with its domain-pack and customer-extension dependencies. Monitor drift and route exceptions back through review.

Useful template outputs include field selectors, enumerated status translations, canonical identity rules, exact value conversions, report parsers, validation cases, clarification prompts and applicability signatures. A template may be reusable even when a customer's revenue classifications still require explicit binding.

Previously unseen configurations and installations must be held out from template development and prompt examples. Evaluate source selection, semantic accuracy, ambiguity detection, reconciliation and failure behavior. Do not declare success because a model reproduces a sample it already saw.

Fine-tuning is an optional later recommendation only if evaluated failures show a need that examples, better templates, typed tools or clearer definitions do not address. It is not a founder-selected requirement or the purpose of the corpus. Any later decision needs its own data-use, model, quality and operating evidence.

### 6.9 First-class ingestion through agentic computer control

An agent can open business software, select the permitted report or data scope, export a file and feed it into the same canonical pipeline. This is part of the harness's normal capability set, on dedicated agent desktops or authorized employee computers.

The actual intended path is:

~~~mermaid
flowchart TD
  A["Authorized computer session"]
  B["Select application, company, report, filters and period"]
  C["Request export within the granted capability"]
  D["Correlate the completed artifact to this export"]
  E["Pin stable permitted bytes, source, scope, time and provenance"]
  F["Parse artifact and identify grain and coverage"]
  G["Apply published mapping or propose a reviewed binding"]
  H["Validate and reconcile with source evidence"]
  I["Deduplicate and reconcile overlapping routes"]
  J["Publish canonical assertions and projection impacts"]
  Q["Quarantine or ask for missing meaning"]
  A --> B
  B --> C
  C --> D
  D --> E
  E --> F
  F --> G
  G --> H
  H --> I
  I --> J
  D -->|Missing or incomplete artifact| Q
  H -->|Mismatch or ambiguity| Q
~~~

The session binds the tenant, authorized user or mandate, application and account, permitted scope, export destination, time limit, credential handling and revocation state. Customer visibility, interruption and handover apply. A downloaded artifact is treated as untrusted input until parsing and validation succeed.

Export completion requires observable evidence: the expected artifact exists, writing has finished, its format is readable, and its metadata or contents are consistent with the requested report and scope. A click, success toast or agent assertion alone is not proof. Where the environment cannot establish completion, the run remains incomplete or uncertain rather than publishing guessed data.

The acquisition receipt records filters, legal entity/company, selected period, source application/report identity, extraction timestamp and any available source revision or report totals. Record retained screenshot/session evidence only as governing rules permit. Retain raw source data and export artifacts for the permitted duration; where they cannot be retained, record the allowed evidence and the resulting replay limitation. Do not promise full reproduction after required evidence has expired.

A report can contain a visible page, capped rows, subtotals, hidden filters, omitted branches or a stale cached total. The parser and mapping must preserve those limits. A monthly aggregate cannot be treated as individual transactions, and a filtered export cannot establish complete company coverage or deletions.

Some applications can email, publish, schedule or modify data while exporting. Those extra effects require the ordinary action authority and operation semantics. The export path must not grant them merely because the agent has a desktop session.

### 6.10 Duplicate and overlapping ingestion routes

The same invoice may arrive through an API, a database snapshot and a UI export. The ingestion route does not create a new business identity. Reconcile using source installation and record identity, event/revision identity, mapped grain, valid interval and provenance.

An artifact digest can catch an identical file being imported twice, but cannot alone detect a regenerated or partially overlapping report. Conversely, two identical-looking amounts can be different legitimate transactions. Semantic deduplication must not discard records merely because their values match.

Keep each acquisition receipt while resolving canonical assertions under the published identity and source-authority rules. Row-level exports can link to the same source record as API rows. Aggregate reports should remain independently identified observations used for reconciliation; never add them to their constituent transactions.

A retry reuses the intended acquisition identity where appropriate and records attempts. A later changed export is a new source observation with an explicit supersession or correction relationship, not an unexplained overwrite. Concurrent routes, partial snapshots, source corrections and delayed exports must be covered in qualification.

### 6.11 India-specific source dossiers

The review's source-specific findings are preserved as dated research inputs, not freshly verified product guarantees:

- Tally: the review described XML over HTTP on port 9000, serialized single-threaded access, no native webhook/authentication at that surface, masters-before-vouchers and alter-ID polling. Always-on hosting was identified as an availability consideration. Validate the actual product, deployment and exposure boundary; a hosted VPS is not mandated for every customer.
- Zoho Books: the review reported REST/OAuth, a 100-request-per-minute organization limit and partial webhook coverage. Recheck the current plan/version limits and event coverage for each profile.
- GST e-invoice and e-way bill: the review recommended a qualified GSP aggregator and dual-IRP failover rather than assuming Chausar's own accreditation. Candidate examples were Sandbox, ClearTax and Masters India; none is selected here.
- Busy, Marg and Vyapar: the review reported ODBC read or file-export constraints. Verify actual version, modules and available interfaces. Computer-generated exports are a first-class route for these and other systems.
- SAP and Oracle: source capabilities and economics vary substantially by deployment, version, module and configuration. Product-family coverage is not proof of a working connector.

Keep researching and mapping every target independently. These examples do not define a closed source list or replace the broad corpus programme.

### 6.12 Pipeline health and publication completeness

Users and specialists need to see source availability, last successful acquisition, covered period, watermark, schema drift, failed records, reconciliation differences and publication readiness. An ingestion job finishing is distinct from the data passing semantic checks.

Invalidation and outbox consumers must tolerate missed, duplicated and out-of-order events. Readiness is recorded per conservative impact record, not inferred solely from a wall-clock refresh timestamp or maximum transaction time. An incremental rebuild must match full recomputation for corrections, identity merge/unmerge, policy/marking changes, deletion, source-authority changes, metric revisions and currency/calendar changes.

## 7. Actions, durable work and recovery

### 7.1 Durable coordination

Retain Temporal as the proposed durable business coordinator. Do not add a second scheduler that owns the same work.

Durable work binds:

- stable investigation and task identity;
- accountable mandate owner;
- authority and budget;
- pinned definitions and tools;
- retries and cancellation;
- human review state;
- action operation IDs;
- outcome evidence.

Ongoing mandate work pauses when its last accountable owner leaves until a replacement is assigned.

### 7.2 Operation ledger

The operation ledger binds tenant, action type and stable business-intent identity before distributed attempts create provider keys. It records the normalized request, status, attempts, provider scope and key validity, receipts and reconciliation state. Sections 23.27-23.31 govern identity, partial outcomes, local atomic admission and durable workflow start.

Its state model distinguishes prepared and approved intent, dispatch, source acceptance, confirmed application, observed failure and OutcomeUnknown. Requested cancellation is separate from effective cancellation; a batch records each item outcome and cannot hide partial or uncertain application behind one terminal label. Sections 23.33-23.39 define these transitions, compensation and control-message receipts.

### 7.3 Coordinated recovery

Recovery follows one state machine:

1. fence all effectful dispatch;
2. record restored cutovers and watermarks for PostgreSQL, Temporal, CDC, object storage, authorization stores and projections;
3. enumerate operations spanning the earliest and latest restored points using surviving dispatch evidence or qualified provider inventory, including effects absent from every restored local record;
4. reconcile each operation against the external provider or source;
5. restore revocations, holds and deletion obligations before access resumes;
6. rebuild disposable projections without replaying effects;
7. resume only after ledger, authority and projection invariants pass.

Queued retries cannot bypass the dispatch fence.

### 7.4 Action semantics across APIs, connectors and computers

Sections 23.26-23.40 make the execution boundary concrete. Where a guarantee depends on unchanged source state, mutation must use a qualified source-enforced condition. Local rechecking alone does not close that race. The last enforceable dispatch fence cannot revoke a request already in flight; preserve uncertainty and reconcile. Qualified native-idempotent retry remains possible within its actual scope and horizon.

Preparation resolves the target objects, expected state, proposed changes, current authority, capability support and required approvals. Approval binds the concrete request and relevant revisions, not an open-ended instruction. Dispatch revalidates current authority, target preconditions and the dispatch fence.

The ledger binds tenant, action type and stable operation key to a normalized request digest. Reusing a key with a different request is rejected. Attempts retain separate actor, worker, lease/fence, timing and provider-receipt evidence. Internal task retry identity must not replace the stable business-operation identity.

| Source capability | Required behavior |
|---|---|
| Native idempotency key and readback | Bind the key to its provider account/namespace and validity horizon; retry only within the qualified guarantee, retaining receipts and readback evidence. |
| Queryable business reference without native idempotency | Check for the prior operation using the reference and qualify race handling before retrying. |
| UI effect with observable source record | Verify the resulting record/state and bind evidence to the operation; do not equate a click with completion. |
| Non-idempotent operation with uncertain outcome | Enter OutcomeUnknown, fence conflicting retries and reconcile or request human resolution. |
| Human handoff | Track assignment, acknowledgement and source/outcome evidence separately; assignment is not execution. |

Register applicable compensations before their activities. Compensation is a new governed action that may fail; it does not erase the original effect or guarantee reversibility. Reconciliation obligations survive cancellation, revoked execution authority and mandate-owner loss, using separately scoped authority to inspect or resolve existing effects.

Computer ingestion reuses session, credential, authority and evidence boundaries. Computer writes reuse this complete action protocol. Read-only export scope and business-write scope must remain distinguishable even when both use the same application.

### 7.5 Previews, scenarios and recovery

When a chosen scenario introduces new objects, 22.31 binds each provisional branch identity to its authorized creation operation and confirmed real identity. Dependent actions wait for that binding rather than substituting a matching display name.

Previews use hypothetical branches, provisional identities and pinned assumptions. A simulated purchase order, refund or customer promise is never published as a confirmed operational fact. Accepting a scenario can create a proposed action, but execution still revalidates against current state and authority.

Recovery must handle divergent restore points. For example, a provider may have completed a refund while a restored PostgreSQL ledger or Temporal history predates its receipt. Workflow replay cannot determine by itself whether the external refund occurred.

During recovery, enumerate operations spanning the earliest and latest relevant recovery points, including those absent from restored local ledgers, using the surviving evidence contract in section 24.5. Where enumeration cannot establish safety, retain the affected dispatch fence and state the unresolved interval. Reconcile discovered operations against source/provider evidence and retain unresolved cases as OutcomeUnknown. Restore later revocations, legal holds and deletion obligations before serving data. Rebuild derived projections without dispatching old effects.

Qualification requires restore-to-divergent-points drills for each deployment profile, a real connector sandbox spanning-operation drill, and proof that queued retries cannot dispatch while the recovery fence is held.

## 8. AI workforce, knowledge and model governance

Section 22 makes completion obligations, budgets, work graphs, resumable context, collaborative artifacts, evidence grounding, analytical validity, applications and channel continuity concrete. Sections 23.1-23.15 and 23.41-23.50 govern actor identity, delegation, disclosure, secrets and destinations. Luna-class remains the primary design target, with no inferred quality result.

### 8.1 Agent definition

An agent release includes:

- role and accountable mandate;
- allowed tools and data classes;
- delegation limits;
- model classes and routing policy;
- skill and prompt versions;
- sandbox profile;
- evaluation evidence;
- disclosure and retention obligations;
- budget and termination behavior.

Agent messages never create human authority.

### 8.2 Agent runtime

Retain a replaceable agent-loop boundary. Pi core remains the leading embedded-loop candidate because its transport and tool hooks are useful, but Chausar supplies the permission and business-authority layer.

QM, Cloudflare gatekeeper-kit, Gobii, Ankole and other reviewed projects remain sources of bounded patterns. Their complete control planes are not adopted as Chausar's authority core.

### 8.3 Knowledge and context

Model claims as first-class bitemporal objects with provenance, trust class, evidence and review status.

Default retrieval remains PostgreSQL text and vector search behind the context service's authorization checks. Graphiti remains optional until it passes a real Chausar workload, access-control and erasure evaluation.

### 8.4 Model catalog

Consolidate model primitives into one catalog covering:

- provider and endpoint registration;
- model and revision identity;
- deployment location;
- allowed data classes;
- retention and training disclosure;
- evaluation results;
- cost and performance evidence;
- scenario and agent-release bindings;
- operator approval and rollback.

### 8.5 Primary Luna-class design target

The founder's explicit preference is to operate primarily with GPT-6 Luna / Luna-class models. Sonnet-class remains a mentioned alternative class, not a replacement for that preference. Names here record the design target; this document does not verify provider availability, pricing, quality or compatibility.

Build the harness so most routine reasoning occurs within authored business definitions, reusable steps and narrow tools. Avoid requiring the model to invent a fresh business process, formula or permission model on each turn. The runtime should expose the relevant operation catalog and permitted evidence, rather than an unrestricted database and all possible tools.

Recommendation: maintain reusable task/workflow templates for common work, such as a period comparison, source-export import, invoice discrepancy investigation, mapping proposal, case resolution and action preparation. Templates declare required inputs, allowed tools, expected intermediate results, stop conditions and completion evidence. These examples illustrate the approach and do not narrow the full-product scope.

Templates may compose and support branching where the contract permits. A template is versioned software and product knowledge, not a prompt that can override policy. Novel requests can still be investigated through qualified tools; unknown business meaning must remain explicit.

| Responsibility | Model role | Deterministic or governed role |
|---|---|---|
| User request | Interpret intent and identify ambiguity. | Validate operation, scope, types and authority. |
| Source mapping | Propose template/bindings and cite evidence. | Check invariants and reconciliation; specialist publishes meaning. |
| Calculation | Select published measure and explain returned result. | Compute exact values, calendars, conversions and eligibility. |
| Planning | Propose bounded steps or a permitted template. | Enforce dependencies, budgets, cancellation and state transitions. |
| Action | Prepare structured parameters and explain choices. | Approve where required, dispatch, deduplicate, verify and reconcile. |
| Computer work | Select UI actions within the session grant. | Enforce session boundaries and verify artifact or source-state evidence. |
| Explanation | Summarize evidence and uncertainty. | Bind citations, redact forbidden material and preserve information classes. |

### 8.6 Structured request and result contracts

The strict wire admission in 22.8 applies to every trusted definition, request and evidence ingress before approval or digest binding. It establishes one semantic value across consumers; schema validation after a permissive parser is insufficient.

A proposed model request includes the user's permitted objective, relevant published definitions, allowed operations, necessary evidence and explicit unresolved questions. It omits data the model has no processing grant to receive.

A proposed operation carries stable operation identity, definition/tool revision, typed parameters, scope, intended effect class and dependencies. Validation rejects invented operations, unknown fields, out-of-range values, hidden-scope requests and unsupported joins. A format-valid response can still be wrong, so selection and meaning need evaluation.

A result carries status, exact typed values, units, time interpretation, source/definition/identity revisions, freshness, coverage, evidence references, obligations and any error or ambiguity. Decimal values and large integers retain declared wire encodings instead of silently becoming lossy floating-point values. Explanations must not turn withheld fields into guessed values.

Errors distinguish unavailable data, incomplete projection, invalid mapping, ambiguous meaning, insufficient authority, source failure and uncertain external outcome. Model retries cannot convert those states to success. Escalation to another model, specialist or human follows configured grants and budgets; no stronger-model fallback is assumed to be permitted.

### 8.7 Model gateway and evaluation

Keep configurable external, private and mixed processing. Register each endpoint's model/revision, allowed data classes, region, retention/training terms, disclosure policy and qualification evidence. Model catalog consolidation reuses existing design primitives; it still requires substantial implementation and operational work.

The source implementation's exact endpoint/payload checks and synthetic adapter tests are useful foundations. They do not prove provider-side retention, cross-process network containment, full streaming/tool behavior or real-model interpretation quality. A request parameter such as store:false is not independent proof of the provider's complete retention behavior.

Qualify Luna-class operation on the actual published workflows and source mappings:

- Correct operation selection, parameter binding and ambiguity detection.
- Meaning-preserving mapping proposals across source versions, custom fields and previously unseen installations.
- Faithful explanation of exact results, gaps, conflicting claims and historical corrections.
- Refusal to promote prompt-injected documents, UI text or tool responses into authority.
- Stable behavior after tool errors, context truncation, long work, revoked access and interrupted sessions.
- Appropriate stopping on incomplete exports, reconciliation failures and OutcomeUnknown.
- Measured completion rate, semantic error rate, intervention rate, latency, token use and cost per completed task.

Set acceptance thresholds for each workload using its risk and intended behavior; none has been measured or invented here. Compare model classes on the same held-out cases and contracts when useful. A weaker result should trigger an evidenced design or routing decision, not a claim that smaller models are inherently reliable because tools are typed.

### 8.8 Workforce collaboration and institutional knowledge

Request coverage in 22.1 is checked independently of the work graph an agent creates. Completing every declared child does not complete a request whose material obligation was omitted from that graph.

Personal agents act within the requesting person's current authority. Shared-live work has an explicit audience and release policy. Delegated agents receive attenuated capabilities, bounded budgets and identifiable attempts. A child cannot create broader authority than its parent.

Durable company mandates have accountable owners, objectives, permitted areas, budgets and stop rules. Losing the last owner pauses new work until replacement and revalidation. A new owner does not restore expired data permission automatically. Notifications and handoffs need durable receipts and audience-aware content.

Claims retain their source, evidence, extraction method, trust tier, valid/recorded time and review state. Use PROV-O concepts where useful for interoperable provenance. Link claims to source episodes at write time; retrofitting evidence later is unreliable. Contradictions create review work rather than silently overwriting source facts.

Context packs pin definitions, claims, skills, evidence and disclosure rules. Retrieval and later reopening apply current permissions and retention. Optional Graphiti or any other retrieval projection must demonstrate ACL-aware behavior, tenant partitioning, hard-deletion/erasure handling and rebuildability before adoption.

## 9. Sandboxes, computers and customer channels

### 9.1 Vendor-neutral sandbox contract

Define lifecycle and capability contracts for:

- untrusted code;
- browser work;
- analytical jobs;
- dedicated desktops;
- Windows or specialist environments;
- managed, customer-cloud and disconnected deployment.

Compare OpenSandbox, E2B, direct Kubernetes with gVisor or Kata, and dedicated VM pools. Residency and full control-plane data flow must be qualified before restricted workloads.

### 9.2 Computer use

Support both dedicated agent computers and authorized employee computers. Sessions require customer configuration, explicit capability boundaries, recording and review rules, credential isolation and current revocation checks.

### 9.3 Customer channels

Voice, messaging and portals use channel-specific identities and permissions. LiveKit remains the leading media candidate, with Pipecat considered for India telephony integration. No channel may bypass ontology, action or disclosure controls.

### 9.4 Computer sessions as governed workloads

Computer work covers ingestion exports, research, application operation and approved source updates. Each workload declares its environment, allowed applications, network scope, filesystem destinations, credential delivery, model disclosure and evidence policy.

Sessions must support customer visibility, interruption, takeover, revocation and cleanup. Screen contents, clipboard data, downloads and recordings can contain protected information. They follow the same retention and disclosure rules as API payloads. The model should receive only the screen or artifact context permitted for its task.

Qualification includes wrong-account detection, source/session switching, delayed downloads, interrupted exports, truncated reports, UI layout changes, employee intervention and revocation during execution. A successful browser launch is insufficient evidence for a complete desktop or ingestion profile.

### 9.5 Customer operations and handoff

Sections 22.41-22.49 distinguish recognized speech from finalized input, generated speech from actually delivered words, requested handoff from accepted ownership, and a closed conversation from a resolved case. Customer identity assurance and exact release destinations follow sections 23.49-23.50.

A voice caller, messaging participant or portal user receives a channel-specific identity and scope. Service agents can retrieve permitted facts, open cases, propose actions, execute permitted operations and hand work to people. Channel delivery, source-system effect and later business outcome are separately evidenced.

LiveKit and Pipecat remain candidates under the media/telephony qualification described later. Channel policies govern recording, transcript retention, customer consent where applicable, staff handoff and disclosure. A phone conversation cannot bypass an approval required for the same action in the workspace.

## 10. Applications, functions and developer surfaces

### 10.1 Governed app studio

Applications consume typed object, population, measure, scenario and action interfaces. Generated code receives narrow capabilities rather than unrestricted database or network access.

Every application has:

- owner;
- release and dependency versions;
- granted capabilities;
- validation evidence;
- audience and disclosure rules;
- rollback and retirement behavior.

### 10.2 Functions

Add deterministic, side-effect-free typed functions for validations, derived fields and reusable computations.

Functions cannot perform external effects or arbitrary I/O. Effects remain actions. Large analytical work remains a job. The same function used in preparation and execution revalidation must produce the same result for the same pinned inputs.

### 10.3 Modalities

Add explicit contracts for:

- time-series properties;
- geospatial data;
- media and documents.

Each modality must define identity, lineage, authorization, retention, temporal behavior and projection rules before adding a specialist store.

### 10.4 SDK and developer tooling

Generate SDKs and agent tools from the canonical contracts. Build a developer console for definitions, mappings, policies, actions, tests and releases.

A marketplace is a separate product and governance decision covering third-party review, distribution, billing, support and revocation. It is not bundled into the SDK decision.

### 10.5 Application publication and execution

Personal exploration can create an immediate private tool within granted capabilities. Publishing a shared maintained application requires validation, ownership, audience definition, dependency review and release evidence. A generated app cannot invent independent business definitions or directly write authoritative tables.

Apps call generated object, measure, function and action contracts. The runtime mediates data access, network egress, secrets and effects. Evaluate generated code against privilege escalation, prompt injection, hidden data extraction and stale schema/policy assumptions. Signed artifact identity and pinned dependencies make the evaluated app distinguishable from an unreviewed revision.

Time-series properties declare sampling/time semantics; geospatial properties declare coordinate systems and precision; media/document properties declare content identity and derived extraction provenance. These requirements do not automatically select separate time-series, geospatial or media databases.

### 10.6 Decision intelligence and analytical jobs

Continued predictive use also follows the current quality-evidence and eligibility contract in 22.32. Unchanged inputs, historical backtests and healthy serving infrastructure do not establish that predictions remain reliable after deployment.

A feasible destination is not yet an executable recommendation. Section 22.29 requires a qualified transition from the observed starting state, preserving intermediate business constraints and actual source atomicity, before presenting an operational plan as ready to run.

Measured change explanations use the declared decomposition method, interaction treatment and residual in 22.23. Exact arithmetic alone does not establish a unique attribution convention; descriptive contributions remain separate from causal intervention claims.

Sections 22.21-22.35 define the statistical, causal, forecast, optimization, scenario and outcome contracts behind these summaries. App behavior also follows sections 22.36-22.40. Artifact signatures and pinned dependencies do not alone prove trusted provenance or safe capabilities: sections 23.43-23.44 cover supply-chain admission and browser-origin isolation, separately from functional app acceptance.

Investigations combine governed object/population queries, exact measures, evidence retrieval and analytical jobs. Findings state their scope, assumptions, gaps and uncertainty. A model-generated causal explanation remains a hypothesis unless supported by the relevant evidence and method.

Forecasts record target, horizon, training cutoff, input revision, covariates, method/model revision, backtests and uncertainty. Hierarchical forecasts require reconciliation; intermittent demand and sparse histories need explicit treatment. The FORECAST-1 comparison decides the library boundary.

Optimization jobs bind an objective, constraints, units, scenario assumptions, solver revision and feasibility result. Infeasible or timed-out runs must not be presented as optimal plans. Proposed allocations remain scenario state until approved action preparation.

Scenario comparisons retain a baseline, alternative assumptions, changed constraints, predicted outcomes and model runs. Users can reopen the original retained evidence under current access or recompute against later data, with those modes clearly distinguished.

## 11. Deployment and fleet operations

Section 24 defines the production contracts behind this inventory, including journey objectives, failure domains, recoverable evidence, safe restore identity, observed fleet state, offline closure, rollout exposure, effective configuration, live database migration, capacity, incident ownership and lifecycle qualification. Thresholds and support promises require measured profile decisions. These requirements preserve dedicated cells and the sole durable business coordinator.

### 11.1 Default cell

The default cell includes only dependencies that pass capability, recovery, security and operating-budget gates.

Maintain a continuing per-cell budget covering:

- mandatory stateful service count;
- storage and backup classes;
- restore dependencies;
- upgrade ownership;
- infrastructure cost floor;
- license and maintainer health;
- replacement cost.

Re-evaluate the budget whenever a default dependency is added or materially upgraded.

### 11.2 Fleet plane

The fleet plane covers:

- cell inventory;
- signed releases;
- compatibility constraints;
- staged release channels;
- health and readiness;
- backup and restore evidence;
- rollback;
- disconnected and customer-cloud delivery;
- audit and support boundaries.

### 11.3 Release and recovery semantics

The fleet plane carries release metadata, compatibility constraints, inventory and health. It must not become a general cross-customer content store. Support access is customer-authorized, scoped and audited.

A proposed rollout evaluates each cell's schema, policy, connector, model, projection and dependency compatibility before activation. Stage signed releases through declared channels and require readiness/health evidence before progression. A failed migration or unhealthy cell pauses the affected rollout. Rollback distinguishes reversible code changes from data changes that require a qualified forward repair or restore procedure.

Customer-cloud, private and disconnected profiles need explicit packaging, credential, update, model-routing, license and recovery qualification. Restricted workloads must not be sent through a vendor control plane whose data flows or residency have not passed the profile's requirements.

The continuous cell budget includes mandatory stateful services, backup/restore classes, operator-hours per upgrade, infrastructure cost floor, license obligations, maintainer health and replacement cost. A component can win a capability comparison but still fail the default-cell operating model. Reassess on additions and material upgrades, without inventing a monetary threshold in this document.

### 11.4 Operations and product evidence

Observe connector health, pipeline readiness, authorization failures and lag, task progress, model/tool errors, reconciliation backlog, retention/deletion progress, recovery status and per-cell resource use. Trace identifiers should connect a business operation to its attempts and evidence without exposing secrets or unnecessary content.

Use OpenTelemetry-compatible instrumentation to keep the observability backend replaceable. Evaluate restricted-data redaction and retention before collecting full prompts, screenshots or customer payloads.

Development infrastructure such as the existing Hermes, Buzz and Paperclip workspace is distinct from this customer platform. Its live agents, permissions, subscriptions and operational successes do not establish customer-cell isolation, Chausar model quality or full-platform readiness.

## 12. Agreed component position

### Retain as the baseline

- TypeScript for platform and coordination services.
- Python for analytical, matching and model workers where appropriate.
- PostgreSQL as the business authority.
- Temporal for durable coordination.
- Cube as a generated analytical projection.
- Dedicated customer cells by default.
- Stable operation identity and explicit outcome reconciliation.
- Chausar-owned canonical semantics and policy contracts.

### Retain with bounded qualification

- Pi core for the embedded agent loop.
- dlt for bounded ingestion-library use.
- Splink for match proposals.
- StatsForecast as the forecasting baseline.
- OR-Tools for CP-SAT and HiGHS as an MIP candidate.
- Docling for document processing.
- LiveKit for media and voice.
- Langfuse through OpenTelemetry-compatible instrumentation.
- Keycloak for enterprise identity, with SCIM handled as a separate production integration.

### Do not preselect

- LinkML as the ontology backbone.
- OpenFGA or SpiceDB as the final relationship engine.
- Cedar as an independent policy authority.
- E2B or OpenSandbox as the universal sandbox.
- Sequin as a universal Debezium replacement.
- Darts as the forecasting standard.
- Graphiti as the authoritative knowledge layer.
- Any dedicated graph engine before workload evidence.

### 12.1 Comparison detail retained from the review

These are dated reviewer positions and open implementation comparisons. They do not establish current vendor features, license terms or performance. Refresh release-specific evidence before adoption.

| Area | Preserved position and alternatives | Decision boundary |
|---|---|---|
| Durable coordination | Retain Temporal. DBOS is a serious bounded challenger for the highest-volume workflow, especially PostgreSQL-local effects. Cadence, Durable Functions and River were not preferred in the review because of language, platform or layer fit. | A challenger must meet the same business-effect/recovery contract. Do not introduce two coordinators for the same work. |
| Definition authoring | Direct Chausar DSL/JSON, LinkML front end, JSON Schema 2020-12 with annotations, CUE and selective syzygy ODL reuse. | DEFN-1 chooses the front end; Chausar owns the IR. OWL/SHACL are derived interoperability outputs, not operational authority. TypeQL and Foundry ODL are not selected. |
| Relationship authorization | PostgreSQL-native, OpenFGA and SpiceDB; OPA partial evaluation or Topaz for query-filter compilation. | AUTHZ-1 tests one cross-engine contract. Cedar is a possible generated evaluator, not a second policy source or generic filter compiler. |
| Ingestion | dlt remains the bounded library baseline. Existing solutions/connectors, MCP, APIs and computer exports remain available. | Library adoption does not supply writeback, deletion propagation or semantic equivalence automatically. |
| CDC | Debezium Connect, Server and Engine; qualified Sequin, PeerDB, native decoding, webhooks and polling. | CDC-1 is per connector/topology. Kafka presence alone does not choose the solution. Embedded crash duplicates still need handling. |
| Sandbox | OpenSandbox, E2B, direct Kubernetes with gVisor/Kata, and dedicated VM pools. | SANDBOX-1 qualifies each workload/deployment combination and full data flows before restricted use. |
| Agent loop | Pi core remains a leading candidate; Vercel AI SDK's provider-injection pattern is a reference, and pydantic-ai can be considered if Python loops are needed. | Chausar supplies permissions and business authority. The review did not prefer LangGraph.js or vendor-specific OpenAI/Claude loops as the core. |
| Memory | PostgreSQL text/vector retrieval, including pgvector where qualified. Graphiti is an optional experiment. | Graphiti's reported ACL/erasure limitations block prescription. Kùzu is excluded under the source review's archived-project finding. |
| Forecasting | StatsForecast baseline; compare direct Nixtla libraries including MLForecast/NeuralForecast, Darts, sktime and GluonTS. | FORECAST-1 checks parity, backtests, calibration, reconciliation and operating burden. Darts foundation-model wrappers may differ from upstream. Prophet was not retained. |
| Optimization | OR-Tools CP-SAT, HiGHS as the LP/MIP candidate; Timefold if rostering/soft constraints justify it. | Qualify workload and solver behavior; the agreed plan does not treat reviewer performance superlatives as measured Chausar results. |
| Documents | Docling baseline. The review identified license concerns with Marker and MinerU/PyMuPDF. | Recheck licenses and parsing/table quality on the actual corpus and deployment. |
| Voice | LiveKit leading media candidate; Pipecat for India telephony, including Exotel/Plivo integration evaluation. | Qualify self-hosting, SIP, identity, recording, human handoff and provider specifics. Vocode was not preferred in the dated review. |
| Observability/evaluation | Langfuse with OpenLLMetry/OpenInference or other OTel-compatible instrumentation. | Recheck edition-specific RBAC/SCIM and license needs; Phoenix was an alternative with source-reported license/governance concerns. |
| Enterprise identity | Keycloak baseline, explicit production SCIM integration; WorkOS as a managed alternative where justified. | Keycloak selection does not qualify SCIM. The review reported version-26 SCIM as preview, disabled by default and not production-recommended. |
| Entity matching | Deterministic-first, then Splink proposals with Chausar-owned serving, stewardship and unmerge propagation. | Matching quality and resource use require installation evidence; source scale claims are not Chausar benchmarks. |
| India sources | Per-product, per-version/module/configuration capability and semantic matrices. | Section 6.11 preserves the research inputs. MCP and UI export are valid access routes within the same contracts. |
| Graph projection | PostgreSQL links and bounded recursive queries first; other graph stores only if measured workloads justify them. | No fixed hop-count claim is an adoption rule. Test time, authorization, path explanations, lag and rebuild. |
| Default cell | Continuous dependency and operating-budget review. | A new default stateful service must pass operational as well as capability qualification. |

The source's fifteen-category comparison plus its additional cell-budget constraint was not exhaustive research across every technology decision. Recommendations such as avoiding Permify or Zitadel because of recorded AGPL concerns, and concerns about vendor governance changes, remain dated research inputs requiring current verification if reconsidered. E2B BYOC was described as vendor-managed, and its single-machine Embed package as evaluation-grade; neither is presumed suitable for every production profile.

## 13. Evidence gates

Each named comparison must satisfy applicable contracts in sections 20-24, not merely its feature checklist. A documented acceptance scenario is a requirement until an actual execution record proves it. Unselected components and customer-specific thresholds remain open within these boundaries.

### DEFN-1: ontology authoring and generation

Pass only when representative domain packs prove:

- exact values and null-state semantics;
- safe evolution from schema N to N+1;
- preserved temporal, metric, action and policy meaning;
- migration safety;
- identical behavior across generated targets;
- rejection of unsupported constructs.

### AUTHZ-1: relationship and policy enforcement

Pass only when the candidates demonstrate:

- cross-engine snapshot binding;
- fail-closed outages and lag;
- immediate and explainable revocation behavior;
- list, pagination, aggregate, search and graph parity;
- privileged-role and tenant-confusion resistance;
- rolling policy migration;
- replayable decision manifests;
- drift detection and repair.

### CDC-1: acquisition

Pass per connector and topology on:

- concurrent snapshot behavior;
- ordering and deduplication;
- schema drift;
- deletion and correction;
- replay and poison-event handling;
- failover and recovery;
- decimal fidelity;
- per-cell operating cost.

### SANDBOX-1: execution isolation

Pass per workload profile on:

- kernel and process isolation;
- network and egress controls;
- credential delivery and revocation;
- filesystem lifecycle;
- browser and desktop behavior;
- residency and control-plane data flow;
- recovery, upgrades and disconnected operation.

### FORECAST-1: forecasting

Compare direct Nixtla libraries, Darts, sktime and GluonTS behind a Chausar protocol using representative univariate, hierarchical, intermittent-demand and covariate workloads. Require correct backtests, calibration, reconciliation, resource use and upgrade behavior.

### Graph engine gate

Start with PostgreSQL relationship tables and bounded recursive queries. Add a graph projection only when measured Chausar workloads show a need and the candidate passes temporal, authorization, rebuild, lag and path-explanation tests.

### Detailed gate interpretation

DEFN-1 requires at least two representative domain packs as a compiler proof, not a restriction on product domains or the target-system corpus. The packs must include exact money/decimal scale/large integers/wire encodings; absent, null, unknown, withheld and not-applicable; bitemporal relationships with edge properties; metric grain, semi-additivity, fan-out and correction invalidation; action identity/reconciliation/policy obligations; and N-to-N+1 evolution across stored data, events, SDKs and projections. Publish the normative subset and target support matrix. Unsupported semantics must fail publication.

AUTHZ-1 must pass randomized differential checks against a reference evaluator, the selected relationship path, generated SQL/RLS and Cube results. Include the broad-query, privileged-role, migration, manifest-replay and drift-repair cases in section 5. A fast individual allow check is not enough.

CDC-1 must qualify snapshot concurrency, ordering, duplicate replay, poison records, drift, deletion, correction and recovery for each connector. Computer exports also need source-profile ingestion qualification, including report completion and coverage. They are not forced into CDC semantics when the source only provides snapshots.

SANDBOX-1 spans untrusted code, browser, desktop/Windows and analytical profiles across managed, customer-cloud and disconnected operation. It includes process/kernel isolation, egress, credential revocation, filesystem disposal and control-plane residency. A passing Linux code sandbox does not certify employee-computer use.

FORECAST-1 uses common Chausar input/output contracts and representative univariate, hierarchical, intermittent-demand and covariate cases. Verify output parity, backtest correctness, calibration, hierarchical reconciliation, dependencies, resource use and upgrade burden before adopting an orchestration layer.

The Luna-class and mapping-language evaluations use previously unseen configurations and installations. They measure meaning and ambiguity handling, not only valid JSON or the size of the example collection. No source review establishes that these evaluations have passed.

## 14. Dependency-led build order

The concrete contracts below extend the work packages: A uses section 20; B uses sections 23.1-23.25; C uses sections 20.15-20.50 and 24.3-24.10; D uses sections 23.26-23.40 and recovery contracts; E uses section 21; F uses sections 22.21-22.35; G uses sections 22.1-22.20 and 22.50; H uses sections 22.36-22.49 and 23.43-23.50; I uses section 24. Cross-cutting authority and retention apply throughout. This sequences the full destination rather than narrowing it.

Each work package expands the same full product. None changes the destination. These packages express dependency relationships, not dates or a rule that all work in one package must finish before any work in another begins. Broad source research informs the IR and mapping language from the start. Computer ingestion appears in source work and execution isolation, rather than being postponed solely to the final UI package.

### Work package A: semantic foundation

Deliver:

- canonical IR and compatibility rules;
- two representative domain packs;
- target support matrix;
- API and event contracts;
- generation and differential-test harness;
- definition registry and publication protocol;
- source-to-business and language-to-operation contracts, developed with corpus evidence.

### Work package B: policy and markings

Deliver:

- policy IR and reference evaluator;
- marking lattice and declassification protocol;
- authorization snapshot contract;
- generated PostgreSQL and Cube enforcement artifacts;
- decision-manifest format;
- AUTHZ-1 test harness.

### Work package C: temporal authority and projections

Deliver:

- bitemporal schema and correction primitive;
- two-clock queries and joins;
- reversible identity mappings;
- projection-impact records;
- consumer deduplication and readiness tracking;
- Cube revision-aware fallback and rebuild-equivalence tests.

### Work package D: actions and recovery

Deliver:

- typed action definitions;
- prepare, approve, dispatch and reconcile APIs;
- operation ledger;
- connector capability contracts;
- Temporal workflows bound to stable operation IDs;
- coordinated recovery state machine and restore drills.

### Work package E: pipelines and source products

Deliver:

- source discovery and profiling;
- mapping and matching proposals;
- pipeline validation and release gates;
- lineage and health surfaces;
- India ERP connector profiles;
- CDC-1 evidence per named source;
- broad database-by-database sample/resource acquisition planning, reusable mappings and customer bindings;
- MCP/API/existing-connector and computer-export routes with completed-artifact evidence;
- overlap reconciliation across file, UI, API and database imports;
- unseen-configuration mapping evaluation and source drift cases.

### Work package F: investigations and decision intelligence

Deliver:

- governed object, population and measure queries;
- evidence-linked investigations;
- forecasts, optimizers and scenarios;
- exact and statistical release classes;
- saved-result rechecks and explanations;
- leadership and strategy workspace surfaces.

### Work package G: AI workforce and knowledge

Deliver:

- agent and skill releases;
- mandates, budgets and delegation controls;
- governed context packs and claims;
- personal and shared workspaces;
- model catalog and routing;
- sandbox profiles and SANDBOX-1 evidence;
- Luna-class task templates, structured tool contracts and real-model qualification.

### Work package H: applications and customer operations

Deliver:

- governed app studio;
- typed pure functions;
- cases and approvals;
- customer portals, voice and messaging;
- computer-use profiles;
- SDKs and developer console;
- generated-application governance.

### Work package I: production fleet completeness

Deliver:

- dedicated cell packaging;
- signed releases and staged rollout;
- backup and restore evidence;
- security and operational qualification;
- observability, evaluation and cost accounting;
- customer-cloud, private and disconnected profiles;
- continuous per-cell dependency-budget enforcement.

## 15. Cross-cutting acceptance suite

The scenarios below are supplemented by every applicable acceptance clause in sections 20-24. The audit also traces sixteen integrated customer journeys in its cycle-specific document-verification record. That review checks whether the prose supplies coherent transitions; it is not a runtime test or production certification.

The full architecture is accepted only when integrated tests cover:

1. exact decimal and currency round-trips;
2. bitemporal corrections and two-clock joins;
3. identity merge and unmerge propagation;
4. hidden fields, paths, snippets and aggregates;
5. overlapping-query and differencing attacks;
6. authorization revocation under concurrency and projection lag;
7. policy and schema rolling upgrades;
8. missed, duplicate and out-of-order outbox events;
9. stale Cube partitions after retroactive correction;
10. source effect success followed by lost acknowledgement;
11. outcome-unknown reconciliation;
12. scenario isolation from operational truth;
13. prompt-injected documents failing to publish definitions or permissions;
14. generated code failing closed outside granted capabilities;
15. deletion propagating through search, vectors, graphs, caches and saved results;
16. coordinated restore without duplicate external effects;
17. full projection rebuild matching authoritative computation;
18. mandate pause and replacement-owner continuation;
19. dedicated-cell tenant isolation, including privileged roles;
20. model and sandbox disclosure controls.

### Additional integrated cases required by the founder's additions

21. A UI export finishes late, is truncated or contains a different company/period from the requested scope.
22. A report contains only aggregates or filtered rows and cannot support the requested drill-down or complete total.
23. The same records arrive by database, API and computer export, with overlapping snapshots and repeated files.
24. A schema-valid Luna-class proposal selects the wrong measure, source configuration, account classification or fiscal period.
25. A mapping template encounters an unseen installation, custom field, status code or ambiguous accounting classification.
26. A source/report change invalidates an existing binding and blocks unsafe automatic publication.
27. A model-facing prompt or UI page attempts to change shared ontology definitions or grant permissions.
28. A raw artifact expires under retention while permitted provenance remains, and the product accurately reports replay limits.
29. A source aggregate reconciles with transaction-level data without being double-counted as additional transactions.
30. Model escalation or a stronger endpoint is unavailable or forbidden, and work pauses or clarifies without bypassing policy.

Assign accountable engineering owners for connector action semantics, cross-engine authority consistency at scale and generated-application governance before those components are integrated. This preserves the review's identified programme risks without inventing staffing or deadlines.

## 16. Immediate decision package

The source reviewers agreed on the following implementation recommendations. The founder has authorized this consolidated documentation and its explicit additions; this section does not imply every open component has now been ratified:

1. Use the expanded architecture as the programme baseline with this plan attached.
2. Start with the canonical IR, policy contract and marking lattice because generated schemas, projections and controls depend on them.
3. Develop the bitemporal correction model and projection-impact protocol alongside the IR's temporal semantics.
4. Run DEFN-1 before selecting an ontology authoring front end.
5. Run AUTHZ-1 after the policy and marking semantics exist.
6. Run CDC-1 and SANDBOX-1 against named source and workload profiles rather than abstract feature lists.
7. Run FORECAST-1 when a representative forecasting domain pack and dataset exist.
8. Apply the continuing per-cell dependency budget before adopting any new mandatory stateful service.
9. Keep exact governed outputs separate from explicitly approximate statistical releases.

## 17. Recorded evidence and limits

Dated source-reported position, not live verification in this authoring task:

- The source review reported its checkout matching `origin/main` at `85f6782a54fd49a4e3720cada09b601f5fd59f29`.
- The review checkout reportedly had an untracked `verify/` directory. That is not a statement about this document worktree.
- The sources report 33 recorded passing connected checks using PostgreSQL, Temporal, Cube and synthetic model endpoints.
- The implementation described by the sources is a bounded path with hard-coded dataset, purpose and definition identifiers. It is not the general ontology, full agent workforce, full connector platform, production identity system or complete customer product.
- No real-model quality result, customer deployment, production rollout or component bake-off is established by the architecture review.

### Evidence detail and remaining limits

The review was revised on 19 September 2026 and reports inspecting the original architecture against commit 85f6782a54fd49a4e3720cada09b601f5fd59f29. It reports 11 of 11 implementation hashes matching, correcting the earlier report's 10-of-11 note. Its connected results file was dated 11 September 2026. These are source-reported observations, not fresh repository verification by this authoring task.

The recorded implementation includes authority and personal/mandate separation, Python-validated specialist publication, trigger-enforced immutable revisions, investigation/task/outbox admission in one transaction, Temporal workflow identity with REJECT_DUPLICATE, release-time authority checks, owner-loss suspension and the bounded model gateway.

The same source identifies important restrictions: literal invoices/profitability/invoice-metrics identifiers; retention capped at 86,400 seconds; exactly one eligible grant with overlapping grants denied; outbox batch abort on a non-duplicate start error; and a Cube adapter accepting exactly one aggregate row and converting to JavaScript Number. Those are bounded implementation properties and gaps to address, not the desired general-purpose semantics.

The gateway's reported single-attempt transport, maxRetries:0, refusal of tool-call/streaming paths in that tested layer, store:false parameter, HMAC digests and committed pre-send dispatch receipt establish only the inspected contract. The expanded workforce and tool architecture still requires integration and qualification.

This authoring task read documents and produced the requested Markdown files. It did not inspect all implementation code, rerun the 33 checks, qualify a real model, acquire a corpus, connect a customer system or verify production behavior. The two primary Desktop source files are preserved.

## 18. Source artifacts

New audit provenance: [[research/final-plan-gap-audit-2026-09-24/README]], its cycle-specific source/resolution registers and detailed reviewer reports. The founder-supplied EvoOntology paper is assessed in [[research/final-plan-gap-audit-2026-09-24/evoontology-input]], including limited pinned-code inspection. Section 22.50 separates model-conditioned presentation from canonical business meaning. No adoption or reproduced benchmark result is claimed.

- Expanded architecture: `CHAUSAR-EXPANDED-PRODUCT-ARCHITECTURE-2026-09-17.md`
- Con final review: `founders-concierge/workspace/review-20260917/REVIEW.md`
- Chief cycle-1 counter-review: `reviews/architecture-review-round-1-counter-review.md`
- Chief cycle-2 counter-review: `reviews/architecture-review-cycle-2-counter-review.md`
- Chief final counter-review: `reviews/architecture-review-cycle-3-final-counter-review.md`

The supplied historical three-cycle review converged on its reviewer baseline. New audit requirements in this revision are separately traceable to the current sequential gap review. Remaining component choices are evidence-gated comparisons, not hidden selections.

### Primary inputs actually read for this consolidation

- [Con review, Desktop source](C:/Users/karta/Desktop/REVIEW.md), revised through round 3 on 19 September 2026.
- [Reviewer-agreed plan, Desktop source](C:/Users/karta/Desktop/CHAUSAR-AGREED-IN-DEPTH-PLAN.md).
- The founder's further discussion and clarification passed into this authoring task, including the later instruction to retain useful assistant recommendations with their status made explicit.
- Current local [[AGENTS]], [[INDEX]], [[STATE]], [[IDEA]], [[DECISION-LOG]], [[LIVE-STATE]] and [[platform/INDEX]] for project authority and the distinction between product and development infrastructure.

The expanded architecture and counter-review paths listed above are references named by the supplied source documents. This consolidation does not claim to have independently reread every linked artifact or reverified its external links.

## 19. Review corrections and comparison provenance

### 19.1 Corrections that must not be lost

| Earlier claim or risk | Final interpretation preserved in this plan |
|---|---|
| PostgreSQL 17 temporal constraints provide the answer. | The review corrected the relevant feature version to 18 and separated application time from complete bitemporal semantics. The two-dimensional invariant and typed correction primitive remain Chausar requirements. |
| Closing an open transaction range is append-only. | It is an update. The agreed model uses immutable recorded revisions and derived intervals or supersession edges. |
| OpenFGA lacks attribute conditions. | The review corrected this: OpenFGA has CEL-based conditions. AUTHZ-1 compares complete cross-engine semantics, not that mistaken distinction. |
| SpiceDB is selected. | PostgreSQL-native, OpenFGA and SpiceDB remain comparison candidates. A ZedToken alone does not bind other engines. |
| LinkML supplies the ontology runtime. | It is an optional front end. Its reported SQL limitations, static TypeScript interfaces and unbound GraphQL output do not supply Chausar's custom compilers or runtime. |
| Cedar is the markings solution. | Chausar owns the lattice and propagation rules. Cedar/OPA/RLS/Cube are candidate generated enforcement targets. |
| Markings are absent from the original architecture. | Propagation intent existed; executable semantics were insufficiently specified. |
| Model lifecycle is absent. | That omission claim was withdrawn. Consolidate the existing endpoint, model-release, scenario-run and evaluation primitives. |
| E2B is preselected over OpenSandbox. | Selection was withdrawn. Qualify the vendor-neutral contract across workload and deployment profiles. |
| Sequin replaces Debezium whenever Kafka is absent. | Debezium Server/Engine also cover non-Connect patterns. Acquisition remains connector-specific. |
| Darts is the forecasting standard. | It is a FORECAST-1 candidate; compare upstream parity and operating burden. |
| Graphiti is the retrieval authority. | It remains optional with access and erasure qualification. PostgreSQL-backed governed retrieval is the baseline. |
| Maximum transaction time proves fresh analytics. | It is only a signal. Conservative impact records, readiness and rebuild equivalence are required. |
| Cohort thresholds solve privacy. | Test overlapping, complementary, before/after and cache-assisted attacks; separate exact and approximate releases. |
| Temporal replay prevents duplicate external actions after restore. | Business-operation identity, provider reconciliation and recovery fencing remain necessary. |
| The alternatives review covered everything. | It covered fifteen selected high-impact categories, plus the continuous cell-budget constraint. |
| Dedicated customer namespaces establish isolation. | They do not. Dedicated-cell and privileged-role isolation need evidence. |

### 19.2 Repository evidence and reuse limits

The review reports roughly 97 of about 100 independently rechecked claims as fully verified. That is the reviewer's historical evidence summary, not an independently reproduced score here.

Its important attribution corrections were:

- OpenFang's reported default-allow behavior applied when no allow rules existed at all; configured allow rules made unmatched tools implicitly denied.
- The inspected Ankole README did not name Pi as its loop, even though other composition findings stood.
- The distributed-fencing warning associated with gatekeeper-kit was the report author's interpretation, not a quoted source comment.
- Five of six inspected LinkWork component revisions differed from the umbrella repository's submodule gitlinks. Component findings must stay tied to the actual inspected revisions.
- Reported LinkWork/MCP allow-on-no-match or degrade-to-allow branches are not acceptable substitutes for Chausar's fail-closed contract.
- Pi supplied transport/tool hooks but no complete permission system; Chausar must provide its own authority boundary.
- syzygy's parser/code-generation and domain-pack ideas remained useful despite recorded post-commit side-effect, audit and tuple-sync caveats.
- operational-ontology's ownership/writeback pattern had recorded reverse-failure divergence limits.
- Weave was found substantial, including object-set execution and policy tests, while optional row-policy enforcement, best-effort logging and degraded saga behavior still required qualification.
- Some other ontology repositories were incomplete skeletons or had missing files. Repository counts, stars or appearance are not implementation acceptance evidence.

The review discussed QM, Cloudflare gatekeeper-kit, Gobii, Markus, OpenAcme, Nexora, Teros, Provision, WhiteOps and other repositories as bounded research inputs. Their complete schedulers, authority models and control planes are not adopted. Source-reported popularity, licenses and maintenance status must be refreshed when a concrete dependency is selected.

### 19.3 Foundry comparison preserved as research, not a parity claim

The review used official Palantir documentation to examine executable ontology, security, pipelines, functions, property modalities, developer tools, AI and fleet delivery. The following links are carried forward from that supplied review and were not freshly browsed for this document.

| Comparison area | Product implication for Chausar | Source references carried forward |
|---|---|---|
| Executable business model | Objects, relationships and actions must share typed meaning. | [Ontology](https://palantir.com/docs/foundry/ontology/overview/), [action types](https://palantir.com/docs/foundry/action-types/overview/) |
| Data security | Make marking propagation, classification, property protection and governed release executable. | [Security](https://palantir.com/docs/foundry/security/overview/), [markings](https://palantir.com/docs/foundry/security/markings/), [classification controls](https://palantir.com/docs/foundry/security/classification-based-access-controls/), [property markings](https://palantir.com/docs/foundry/security/property-security-markings/), [restricted views](https://palantir.com/docs/foundry/security/restricted-views/), [object policies](https://palantir.com/docs/foundry/object-permissioning/object-security-policies/) |
| Pipeline backbone | Add release gating, lineage, health and controlled publication as product surfaces. | [Data integration](https://palantir.com/docs/foundry/data-integration/overview/), [Pipeline Builder](https://palantir.com/docs/foundry/pipeline-builder/overview/), [pipeline delivery](https://palantir.com/docs/foundry/pipeline-builder/outputs-deliver-pipeline/) |
| Typed functions | Make pure validation and derived computation reusable across apps and actions. | [Functions](https://palantir.com/docs/foundry/functions/overview/), [media functions](https://palantir.com/docs/foundry/functions/media/) |
| Rich modalities | Define time-series, spatial and media contracts with the same governance. | [Time series](https://palantir.com/docs/foundry/time-series/time-series-overview/), [time-series properties](https://palantir.com/docs/foundry/time-series/time-series-properties/), [geospatial ontology](https://palantir.com/docs/foundry/geospatial/ontology/), [geotemporal integration](https://palantir.com/docs/foundry/geospatial/integrate-geotemporal-series-with-the-ontology/) |
| Developer experience | Generated SDKs, a definition/action console and governed pack distribution. Marketplace economics remain a separate choice. | [OSDK](https://palantir.com/docs/foundry/ontology-sdk/overview/), [TypeScript OSDK](https://palantir.com/docs/foundry/ontology-sdk/typescript-osdk/) |
| AI and fleet | Consolidate model governance and specify staged deployment, rollback and disconnected profiles. | [AIP](https://palantir.com/docs/foundry/aip/overview/), [Apollo](https://palantir.com/docs/apollo/) |

The review found no documented direct counterpart in the cited material for Chausar's complete prepare/approve/dispatch/reconcile protocol, governed context packs, persistent attenuated mandates, dedicated customer cells and customer-facing channel primitives. This is a finding about that documentation comparison, not proof that another product lacks all related capabilities, and not evidence Chausar has implemented an advantage.

The comparison also raised the economics of organizational silos versus dedicated cells. The consolidated plan retains dedicated managed cells as the default because that is the existing product direction; a shared tier requires explicit isolation and operating evidence. The comparison does not silently change that decision.

### 19.4 Source-to-plan traceability

| Input requirement | Where it is handled |
|---|---|
| Full six-part product and production destination | Sections 1, 9-11 and work packages A-I. |
| Canonical IR, authoring comparison and domain packs | Sections 3, 12 and DEFN-1. |
| Detailed rulebook publication path and two kinds of mapping | Sections 3.6-3.10 and the authoring diagram. |
| Revenue semantics | Section 3.9, explicitly illustrative. |
| Many samples for every target database/system | Sections 6.7-6.8 and work package E. |
| Mapping language, reusable bindings and unseen evaluation | Sections 3.10, 6.8, 8.7 and 15. |
| MCP, APIs and existing solutions | Sections 6.1, 6.6 and component contracts. |
| First-class agentic computer-export ingestion | Sections 6.9-6.10, 9.4, work package E and acceptance cases 21-23. |
| Luna-class preference and constrained operation | Sections 2.8, 8.5-8.7 and work package G. |
| Bitemporal, authorization, projection and recovery corrections | Sections 4-7 and 19.1. |
| Five open comparisons and continuous cell budget | Sections 11-13. |
| Useful assistant suggestions retained as recommendations | Status, sections 6.7-6.8 and 8.5. |
| Dated evidence and no invented production/model proof | Sections 17-19. |

This revision consolidates the supplied direction and accepted repairs through all four audit cycles. The audit records document coverage and remaining implementation evidence; neither repeated review nor document length establishes completeness. Engineering, measured qualification and the source-research programme remain future work, and recorded requirements do not establish completed implementation.


## 20. Semantic execution contracts

These are required design behaviors of the planned platform. They do not describe implemented or tested behavior. The finding register preserves the motivating counterexamples and research.

### 20.1 Definition names, identities and successors

Definition references in mappings, tools, apps, saved work and durable events use immutable identities and an explicit revision/bundle rule. Labels and aliases are separately versioned discovery metadata. A rename preserves identity; a change to the meaning of the concept requires an explicit semantic revision or a new identity under the change classification below. Retired definitions keep permitted tombstones and successor links. One-to-many successors and ambiguous aliases return an unresolved candidate set. They never silently redirect retained work to a different concept.

Acceptance: rename, retire and reuse a label in a namespace; saved references retain their original meaning or return a typed retired-definition state. New name lookup shows ambiguity and records its resolved identity. Resolves C01-R1-001.

### 20.2 Domain-pack composition

The IR defines deterministic composition for extension, refinement, interfaces, constraints and intentional overrides. Import order cannot decide business meaning. An override identifies the exact overridden definition/revision and the changed rule. Incompatible requirements, dependency cycles and silent weakening of inherited obligations fail validation. The effective bundle records the source of each composed rule and exposes conflicts to the specialist.

Acceptance: permuting input pack order produces the same effective semantics or the same conflict; incompatible currency requiredness and unit rules fail with both origins identified. Explicit reviewed resolution agrees across generated targets. Resolves C01-R1-002.

### 20.3 Reproducible generation

Each compiled release binds canonical IR representation, transitive dependency graph, compiler/generator versions, templates, target capabilities, relevant calendar/timezone data and generated semantic-artifact digests. Build metadata that can vary independently is separated from semantics. Dependencies are resolved before approval; clean reproduction does not perform uncontrolled network resolution. A changed compiler input produces a new build identity even when authored definitions are unchanged.

Acceptance: independent clean builds produce identical semantic artifacts. A changed compiler or timezone input is detectable and triggers impact review. Canonical serialization must preserve declared decimal and large-integer encodings. RFC 8785 is a serialization reference, not proof of reproducible compilation. Resolves C01-R1-003.

### 20.4 Independent correctness evidence

Differential agreement is necessary but insufficient. Each supported construct has a normative semantic rule and independently derived expected-answer fixtures. The expected-answer path must not reuse the same implementation of the operation under test. Include metamorphic/conservation properties and deliberately faulty mutants covering sign reversal, duplicate joins, wrong eligibility and rounding. Specialist review records why the expected meaning is correct, including cases whose proper answer is unresolved.

Acceptance: a common defect injected into both reference evaluator and generated target is rejected by an independent oracle or invariant even when those engines agree. Resolves C01-R1-004.

### 20.5 Bundle activation

Definition publication has staged, validated, ready, active, superseded and failed states. A customer-authority compare-and-swap activates one immutable manifest after required artifacts and compatible data/publication epochs are ready. A request resolves its bundle once and carries that binding through its dependent operations and result assembly. Live source revisions remain separately recorded; ordinary row updates do not require a new ontology release. Staging does not expose partial releases, and a required incompatible target yields explicit unavailability.

Acceptance: pause one target at cutover and run multi-step work. Every result uses a compatible old or new bundle; no result combines an unreviewed version mixture. Failure leaves the active pointer unchanged. Resolves C01-R1-005.

### 20.6 Meaning changes and restatement

Publication classifies presentation-only change, compatible extension, reinterpretation of retained data and incompatible business meaning separately from wire/schema compatibility. A change specifies prospective or retrospective application, affected dependencies, rebuild requirements and treatment of active work. Original historical results and explicit restatements are distinct artifacts with a difference explanation. A same-shape change to revenue eligibility, sign, calendar or source authority is never assumed harmless because the API still returns a decimal.

Acceptance: keep a measure's schema fixed while changing eligibility. The semantic impact report detects it, identifies dependent apps/alerts and requires an explicit restatement strategy. No blanket backward-compatibility layer is implied. Resolves C01-R1-006.

Every replaceable mapping publication unit identifies its source scope, interpretation revision, producer ownership and complete output assertion set or equivalent replacement relation. Successful remapping reconciles the old owned set with the new set, including explicit complete emptiness, and retracts obsolete contributions through normal temporal correction. Failed/incomplete output cannot clear the old set. Activate replacement with completeness/impact evidence and expected prior-generation checks. Preserve other producers' assertions, permitted historical belief and retention restrictions. Unreconstructable meaning becomes an explicit limitation on current certification.

Additional acceptance: Remap one input from two outputs to one and then to a justified empty set. Remove only obsolete owned contributions; independent source support survives and permitted as-known history remains. Interrupt replacement and race a newer publication: incomplete or stale work cannot clear or resurrect the set. Rebuilt projections match corrected authority. Resolves C02-R2-002.

### 20.7 Concurrent authoring

Drafts, validation results and approvals bind a base bundle and affected dependency revisions. Publication rejects a stale base with a semantic conflict report. A rebase creates a new candidate and reruns affected checks; material changes invalidate prior approval. Automated merging is allowed only for changes whose independence is established by the composition/dependency contract. Immutable release storage alone does not prevent lost updates.

Acceptance: publish one of two drafts from the same base, reject the stale second draft, then rebase and prove both intended changes survive without reusing an outdated approval. Resolves C01-R1-007.

### 20.8 Missing-value algebra

Define tagged absent, null, unknown, withheld and not-applicable states across serialization, requiredness, equality, ordering, boolean predicates, joins, arithmetic and aggregates. Separate a missing-value state from a calculation error. Predicate evaluation distinguishes known inclusion, known exclusion and indeterminate eligibility; the published measure/population rule declares whether indeterminate membership propagates incomplete coverage, enters review or blocks an exact critical result. Defaults and conversions are explicit operations. Release policy also governs whether a withheld-state indicator may itself be disclosed.

Acceptance: test every state through comparisons, boolean operations, aggregates, joins and serialization. Unknown or withheld data cannot silently become zero or make a population appear complete. Targets unable to preserve an operation's state semantics fail publication. Resolves C01-R1-008.

### 20.9 Exact arithmetic profile

The IR's numeric execution profile specifies intermediate precision, result scale, tie-breaking and rounding boundaries, signed zero, division/remainder, overflow/underflow and exceptional values. Money rejects non-finite values. Other numerical types permit them only if explicitly defined. Rounding is a declared operation or boundary rather than an incidental target cast. Unsupported ranges return typed failures; no arbitrary universal precision limit is selected here.

Acceptance: cross-target fixtures cover positive/negative half ties, repeated sums, division by zero, extreme magnitudes and rounding before versus after aggregation. Compare exact encodings and error classes. [PostgreSQL numeric semantics](https://www.postgresql.org/docs/18/datatype-numeric.html) illustrate why storage type alone is insufficient. Resolves C01-R1-009.

### 20.10 Units and contextual conversion

Quantities carry dimensional signatures and legal-operation rules. Distinguish scale, affine and context-dependent conversions. Business conversions such as boxes to items bind product, packaging, valid/recorded time and conversion revision. Percentage and dimensionless-ratio scaling is explicit. The compiler requires a published compatible conversion path and rejects incompatible arithmetic. UCUM may supply vocabulary and physical-unit rules; it does not define a customer's packaging or business meaning.

Acceptance: adding distance to currency fails; affine temperature conversion cannot use multiplication alone; missing product-specific package conversion stays unresolved; historical package-size changes reproduce the correct quantity at both clocks. [UCUM specification](https://ucum.org/ucum). Resolves C01-R1-010.

### 20.11 Text identity and ordering

Each value type declares equality and ordering semantics, including any normalization, collation and locale dependence. Opaque source identifiers preserve their exact representation unless a published source-specific rule establishes a safe conversion. Search normalization does not establish canonical identity. Pin versions that affect semantics and use stable tie-breakers for ordered populations. Detect collisions before a normalization change becomes active.

Acceptance: case-distinct codes, Unicode composition variants and locale-sensitive letters preserve intended identity and produce consistent joins/order across targets. Unsafe collisions block activation. Resolves C01-R1-011.

### 20.12 Controlled vocabularies

Vocabulary members have stable identities, versioned labels, lifecycle and applicability. Definitions distinguish closed sets from extensible classifications. Required business mappings must handle every eligible source code or emit an explicit unmapped state. A default branch cannot imply posted, paid or otherwise eligible status without an authored rule. Retired codes remain interpretable under retained historical releases. Consumer-specific impact determines whether an unknown blocks a critical result, creates a gap or affects only a descriptive field.

Acceptance: introduce a new status with an unchanged schema; the affected critical measure becomes unresolved rather than silently counting it. Rename/retire an old member without losing historical meaning. Resolves C01-R1-012.

### 20.13 Expression termination and resource bounds

The language defines evaluation order, dependency-cycle rules and resource behavior. Pure functions cannot perform effects, but they also cannot run without a qualified resource/termination contract. Distinguish prohibited definition cycles from expressly supported recursive business traversal. Supported recursion declares termination or convergence, resource bounds and the completeness meaning of a boundary. Custom transforms declare input/output limits. Exhaustion is an execution failure or explicit incomplete traversal, never a valid value or partial canonical publication.

Acceptance: reject direct/indirect definition cycles; constrain a cyclic business traversal and oversized pure computation with useful diagnostics; never cache timeout as a completed calculation. Resolves C01-R1-013.

### 20.14 Validation scope

Every validation rule declares its consistency scope: field, assertion, object/document, transaction group, partition, population or release. It also declares failure effect: reject, quarantine, publish with a stated gap or block specified critical consumers. The scope of unresolved data propagates into coverage. A permissive row-level rule cannot certify a larger document or population as complete. Promotion after correction is deterministic and retains the permitted exception history.

Acceptance: one bad optional field, one missing invoice line and one partition-wide invariant produce their distinct declared outcomes. An incomplete invoice is never labelled complete, while unaffected data can remain usable. Resolves C01-R1-014.

### 20.15 Assertion and resolved-fact identity

Separate raw source-record revision, interpreted assertion and resolved-fact identities. Temporal uniqueness keys state the tenant, object/property or edge, source discriminator where applicable, and declared cardinality. Conflicting assertions from different sources can coexist over the same valid and recorded interval. A resolved single-valued fact cannot have two selected values in the same temporal cell. Its resolution records contributing assertions and the authority-rule revision.

Acceptance: retain simultaneous conflicting source addresses, select or report unresolved under the published rule, and reject two competing resolved single-valued results for the same temporal cell. Unrelated property histories remain independent. Resolves C01-R1-015.

### 20.16 Source-authority resolution

Resolution rules declare eligible assertion set, property/entity scope, precedence, time applicability, expiry and permitted combination. Freshness, arrival order and authority are separate concepts. Return selected, combined, unresolved or insufficient-evidence with reasons and contributing identities. An expired manual override cannot continue merely because it is the latest recorded assertion. Changes in resolution policy invalidate affected resolved facts and derived results.

Acceptance: equal-priority contradictions, expired overrides and late older observations resolve consistently independent of ingestion order, with both-clock historical evidence. Customer-specific precedence remains a published specialist decision. Resolves C01-R1-016.

Define the canonical assertion universe independently of the viewer's visible subset. Resolution uses a separately authorized processing scope and propagates selected and control-dependent restrictions; release returns the permitted canonical fact or a safe withheld/unavailable outcome. A resolver unable to establish the required universe cannot certify a canonical winner. A permitted source-specific or viewer-scoped observation may be shown under its own explicit definition, never silently substituted for canonical truth. This grants no new service privilege.

Additional acceptance: Hide the higher-priority 1000 assertion from a viewer who can inspect a lower-priority 100 assertion. Do not label 100 as canonical merely because filtering removed the winner. A permitted source view remains explicitly scoped; diagnostics reveal no hidden source/value. Changing viewer access alone does not rewrite canonical resolution identity. Resolves C02-R1-005.

### 20.17 Business consistency groups

Domain packs declare cross-record groups whose invariants and visibility must be coordinated, such as invoice header/lines, balanced journal entries or paired reversals. Stage fragments until the declared group can be certified; record source transaction evidence where available and canonical publication identity. A source without a coherent snapshot must expose that limit. Readers receive a prior complete version, an explicit incomplete state or the new complete group, according to the consuming contract.

Acceptance: reorder group fragments and query between arrivals. No critical consumer sees a certified half-update, and concurrent corrections validate against a consistent base. This defines logical atomic publication without inventing a distributed source transaction. Resolves C01-R1-017.

State-dependent invariants also declare their complete conflict domain across separate commits, including membership, absence/range predicates and every mutation route. Bind that domain to qualified authoritative enforcement such as suitable constraints, a shared guard or serializable validation. Conflicting admission revalidates the entire rule against a fresh base or returns conflict; passing a check on an earlier snapshot cannot authorize a later effect. Independent domains remain concurrent.

Additional acceptance: Synchronize two removals that each preserve a minimum-membership rule alone, then concurrent inserts under a maximum rule. Only an invariant-preserving combination commits; rejected attempts admit no executable effect. Stable per-row versions and atomic individual writes alone cannot pass. Resolves C02-R1-001.

### 20.18 Source identity continuity

Source record keys include installation lineage, dataset/type, required uniqueness partition, source key and generation/incarnation where reuse is possible. Document the actual uniqueness scope and reset signals. Repointing a connection, restoring a database or importing a reused report number triggers continuity assessment. Where continuity cannot be established, preserve separate observations until evidence supports a match. Connection labels and file paths are not business identities.

Acceptance: repeat identifiers across companies, books, years and restored installations; valid duplicates reconcile across routes while unrelated reincarnations remain distinct. Preserve source key encodings. Resolves C01-R1-018.

### 20.19 Identity-cluster integrity

Separate hard must-link/cannot-link evidence from scored match proposals. Validate the resulting cluster, not only the proposed edge, against object-type, uniqueness, temporal and exclusion rules before promotion. An indirect path cannot bypass a durable rejected match. Conflicting proposals enter stewardship with the problematic path explained. Removal or unmerge recomputes affected membership while preserving historical identities and lineage.

Acceptance: A-B and B-C proposed links cannot silently unite A and C when verified cannot-link evidence exists. Removing an edge recomputes affected components and downstream impacts. Splink remains a proposal algorithm behind these business constraints. Reuse existing library constraint mechanisms where they meet the published rule; unsupported invariants remain explicitly enforced at the Chausar boundary. Resolves C01-R1-019.

### 20.20 Matching qualification and abstention

Qualify candidate-generation recall, pair and cluster precision, false merges and false splits by object class and evidence stratum. Define an evaluated promotion policy and an abstention/stewardship region; no universal score threshold is assumed. Include rare consequential mistakes and held-out installations. Test deterministic rules too. Distribution drift or missing identifiers suspends the affected automatic promotion profile while allowing separately valid ingestion.

Acceptance: removal of a key identifier and ambiguous high-impact pairs produce review or abstention under the qualified profile; aggregate accuracy cannot mask false canonical merges. Threshold selection is an accountable customer/specialist decision using measured evidence. Resolves C01-R1-020.

### 20.21 Consequences of identity correction

Identity corrections classify affected artifacts as recomputable outputs, retained decisions, pending effects or completed effects. Recompute outputs under the new identity revision; preserve decisions under their original evidence with a correction notice. Ambiguous pending targets require new preparation and revalidation. Completed effects create scoped reconciliation/review work and, where appropriate, a separate governed corrective action. Unmerge never silently retargets an operation or rewrites the justification for an effect.

Acceptance: after unmerge, a completed refund remains historically attributed and flagged, while a prepared second refund cannot dispatch against an ambiguous successor. Resolves C01-R1-021.

### 20.22 Recorded visibility cuts

Recorded-time semantics use a durable authority visibility cut with a defined commit/publication protocol. Sequence allocation, transaction start time and wall-clock timestamps do not establish commit visibility. Mapping a human time to a knowledge cut must use retained evidence of that mapping and state its precision. Equal timestamps, concurrency, imports and recovery cannot cause a historical cut to acquire facts that became visible later. Source clocks remain separate from the cell's knowledge ordering.

Acceptance: A allocates an earlier revision then stalls; B commits; capture a cut; A commits later. Reopening the captured cut includes B and excludes A despite allocation order. Repeat with clock skew and equal timestamps. Resolves C01-R1-022.

### 20.23 Temporal value conventions

The IR defines supported dates, instants, intervals, precision and conversion rules, with explicit canonical bounds for each interval type. Empty, unbounded and unknown validity are distinct. Date-only business facts use a declared calendar/timezone interpretation; they do not inherit ambient server midnight. Instantaneous events have an explicit representation. Unknown effective time restricts historical use rather than pretending an assertion was valid forever.

Acceptance: specify exact outcomes for touching periods, zero-length intervals, subsecond boundaries, date-only transfers and absent dates across correction splitting and joins. Resolves C01-R1-023.

### 20.24 Temporal join contracts

A published join path declares its operator, both-clock inputs, multiplicity and required coverage: event-time point lookup, interval intersection, latest-preceding lookup or a declared allocation method. Include identity and edge validity, not only endpoint timestamps. Missing coverage remains visible; unintended multiple eligible matches fail. Duration or quantity allocation must be authored rather than inferred from an overlapping interval.

Acceptance: mid-period territory change, relationship gap and later retroactive correction produce independently expected point/interval/as-known attribution. Current dimension values cannot silently reassign historical measures. Resolves C01-R1-024.

### 20.25 Historical interpretation vectors

A retained result binds valid-time scope, data knowledge cut, definition bundle, mapping interpretation, identity and source-authority revisions separately. Original-interpretation replay and later-definition restatement are explicit modes. Current authorization still governs both. A new historical question discloses its selected interpretation; missing retained definitions/evidence produce a stated replay limit, not an invented reconstruction. Definition effective applicability and publication/knowledge time remain distinct.

Acceptance: reclassify an account without changing records, then reproduce the earlier result and separately show a restatement with a difference explanation. Resolves C01-R1-025.

### 20.26 Future-effective state and temporal expiry

Known future assertions do not become current until their declared validity applies. Projections whose result changes as time passes carry an expiry/effective boundary as well as event watermarks. Query-time validity or existing durable coordination enforces that boundary. Withdrawal is a new recorded correction; any scheduled materialization rechecks the still-applicable revision and authority. This does not itself authorize a scheduled external effect.

Acceptance: a future price becomes current at the boundary without a new source event; a prior withdrawal prevents activation while preserving historical planned views. Resolves C01-R1-026.

A compound semantic evaluation binds one business evaluation instant and calendar context for implicit current/date/age operations, separate from source data cuts. Pass it to evaluators, analytical steps and cache identity; pure functions do not read an ambient wall clock. Reuse requires a compatible instant or proven validity interval. An intended later observation is a new evaluation with its own binding. Authorization expiry and effect dispatch still check current authoritative time and policy.

Additional acceptance: Delay sibling price/promotion branches across a shared effective boundary and repeat with a cached branch or partial retry. The answer represents one declared instant, or exposes separate observations without claiming coherent current state. An earlier business instant never preserves revoked access. Resolves C02-R1-003.

### 20.27 Source observation versus canonical knowledge

Retain distinct source event/effective time, source revision/snapshot time, acquisition observation time and canonical publication/knowledge cut. Unknowns remain unknown. Source timestamps cannot backdate when Chausar learned a fact. Source-only responses bind the external cut and permitted retained evidence or disclose non-replayability. A delayed source can correct historical valid time without rewriting the product's knowledge history.

Acceptance: a March report acquired in June is excluded from an April Chausar-known view, while later analysis may use it at a later knowledge cut. Expired evidence has a visible replay limitation. Resolves C01-R1-027.

### 20.28 Semantic lifecycle events

Distinguish source-record deletion, assertion retraction, validity termination, business-object retirement and governed content erasure. Each declares effects on historical truth, source availability, serving eligibility and retained evidence. A retraction records its reason and corrects the affected valid scope while preserving the former recorded belief where retention permits. Physical source deletion does not prove that the business object never existed.

Acceptance: archived employee, never-valid duplicate invoice and expired supplier relationship yield their different intended current/historical results. Privacy erasure follows its separate obligations. Resolves C01-R1-028.

### 20.29 Corrections versus real compensating events

Mappings distinguish an erroneous assertion correction from cancellation, reversal, credit adjustment or replacement that actually occurred as a business event. Related transaction identities and their roles are explicit. A real later event remains an event; a historical error uses the correction primitive. Each measure states how it treats the distinction. Reconcile updated source state with separate adjustment documents so the same economic change is not counted twice.

Acceptance: a real April credit and a retrospective March typo correction can share a final balance while producing different justified period/as-known views. Updated invoice plus credit note must not double subtract. Resolves C01-R1-029.

### 20.30 Events, observations and inferred transitions

Business events, state observations and inferred transitions have separate identities and completeness contracts. Events carry available occurrence/order evidence; repeated state snapshots do not create new events. Inferred transitions record their method and observation interval, including possible missing intermediate events. A published state-to-event conversion cannot satisfy a consumer requiring exact event completeness unless its source evidence supports that guarantee.

Acceptance: preserve two distinct same-valued payments, emit no new payment from unchanged snapshots, and label a snapshot jump as incomplete event evidence. Trigger consumers bind the appropriate semantic event identity. Resolves C01-R1-030.

Preserve order provenance and incomparable event sets. Order-sensitive consumers declare required evidence and a permitted ambiguity rule. Where every admissible ordering is equivalent under a qualified operator, evaluation may proceed without imposing fictitious chronology. Otherwise obtain stronger evidence, expose unresolved alternatives or apply an explicitly published arbitration decision distinct from observed order. Deterministic presentation order cannot become factual temporal precedence. Later evidence resolves ambiguity through recorded correction.

Additional acceptance: Permute delivery and identifiers of two incomparable assignments. A last-event-dependent result stays unresolved unless a declared arbitration rule applies, while an order-independent sum remains usable. Adding causal evidence yields an explained resolution. No exhaustive ordering enumeration or global clock is required. Resolves C02-R1-004.

### 20.31 Aggregation algebra

Measures declare legal rollup dimensions, intermediate state, merge operation and finalization. Ratios carry compatible numerator/denominator populations; averages retain appropriate weights or sufficient state. Order-sensitive measures declare ordering. A source aggregate supports a higher-level calculation only if the available state is sufficient for that measure. An average-only export cannot silently stand in for its absent numerator and denominator.

Acceptance: combine unequal branch conversion populations from raw data and sufficient aggregate state and obtain the same result; reject an insufficient average-only input rather than averaging averages. Resolves C01-R1-031.

### 20.32 Conserved allocations

Many-to-many attribution uses explicit allocation relationships with source amount/quantity, target share, units, temporal revision and provenance. Publish conservation, over-allocation, unallocated remainder and rounding-residual rules. Observed allocations and derived allocation methods retain their information class. A valid relationship without allocation evidence does not support additive segmented attribution by itself.

Acceptance: split invoices and partial shipments reconcile segment sums plus unallocated remainder to the source; over-allocation fails and rounding residual assignment is deterministic. Historical results use the applicable allocation revision. Resolves C01-R1-032.

### 20.33 Exact and approximate analytical representations

Computational approximation is distinct from privacy noise. Each non-additive measure declares whether its contract requires raw detail, mergeable exact state or a qualified approximation. A sketch, sampled quantile or median of medians cannot silently serve an exact result for performance reasons. Permitted approximations carry method and uncertainty/error semantics and remain separate in caching and release metadata. Insufficient inputs produce non-derivability.

Acceptance: overlapping branch populations and skewed distributions match the exact oracle when required; an average/count-only export cannot reconstruct absent overlap/distribution information. An approximate query is clearly identified and cannot populate an exact cache entry. Resolves C01-R1-033.

### 20.34 Stock, flow and balances

Measures explicitly distinguish event flow, point stock, opening/closing balance and time-weighted average. Declare carry-forward, permitted observation age, opening state, eligible movements and coverage. Reconstructed balances reconcile opening, movements and closing evidence. Carry-forward is an authored business rule, not an implicit missing-data default. Summing across time is legal only for the declared class and dimensions.

Acceptance: unchanged balances, missing opening state, late movements and stale snapshots yield the specified result or gap; simple and duration-weighted averages remain distinct. Resolves C01-R1-034.

### 20.35 Currency conversion

A conversion binds amount basis, source/target currencies, quote direction, rate class, temporal lookup, permitted triangulation and precision/rounding stages. Tag source-provided functional/reporting amounts so they are not converted twice. Missing or stale rates create typed incompleteness unless a published fallback specifies a valid alternative. Rate corrections participate in lineage and explicit restatement.

Acceptance: direct/inverse quotes, holidays, stale rates, triangulation and already-converted amounts produce exact expected outputs or explicit missing-rate results. No provider or universal accounting policy is selected by this contract. Resolves C01-R1-035.

### 20.36 Fiscal comparisons

Versioned calendar objects define period boundaries, timezone, business-day cutoff and comparison mappings. Comparisons state prior-period, fiscal prior-year, like-for-like elapsed coverage or another published mode. Unequal period length and missing comparison periods are disclosed. Period close/reopen is a business lifecycle event distinct from calendar membership.

Acceptance: a 53-week year, late-night trading cutoff and incomplete quarter produce explicit expected date sets and denominators. Luna cannot choose a hidden comparison alignment from a vague phrase. Resolves C01-R1-036.

### 20.37 Cohorts and windows

Cohort measures specify entry event/time, subject identity, inclusion/exclusion, denominator snapshot, observation horizon and maturity/censoring treatment. Rolling measures distinguish elapsed time from row-count windows, with timezone, ties and late-event policy. Immature subjects remain labelled or excluded under the published rule rather than treated automatically as failures.

Acceptance: mature/immature cohorts, sparse observations and late outcomes produce correct eligibility and maturity under the selected knowledge cut. Seven calendar days and seven observed rows remain distinct operations. Resolves C01-R1-037.

### 20.38 Coverage manifests

Coverage binds an independently evidenced expected domain, observed domain, declared exclusions and unknown domain at a revision. Expectations may derive from configuration or authoritative inventory but carry their own freshness and limitations. Compose coverage through joins, filters and aggregation. Distinguish complete empty scope from missing acquisition and unresolved eligibility. Processing every received row successfully is insufficient to certify complete company coverage.

Acceptance: a zero-activity branch, missing branch, newly created branch absent from an old inventory and filtered report produce different justified states. Exact zero is released only when the contract supports complete emptiness. Resolves C01-R1-038.

### 20.39 Analytical filter placement

The query IR separates row predicates, group predicates, ranking/top-N selection and denominator scope. Each measure specifies which filters affect its components. Optimization and pushdown preserve those semantics or reject the plan. Result evidence identifies numerator/denominator populations. A denominator-preserving business rule never bypasses row authorization, markings or aggregate-release controls.

Acceptance: annual customer sales from many small invoices and top-ten revenue share match expected membership and denominators before/after optimization. An unsafe denominator is suppressed or denied under existing policy. Resolves C01-R1-039.

### 20.40 Persistent population modes

Live populations retain expressions and declared update rules; frozen populations retain reviewed membership plus the evidence/value revisions needed for their purpose; materialized populations identify their publication cut. Each binds definitions, parameters, data/identity interpretation and relevant ordering. Changing mode creates a new revision. Retention limits remain explicit. A frozen set used for effects still revalidates current target state and authority without silently expanding to new members.

Acceptance: after new records, value corrections and identity split, live membership updates while frozen work stays explainable or reports ambiguity/expired evidence. A prepared bulk action cannot expand automatically. Resolves C01-R1-040.

### 20.41 Discriminating reconciliation

A mapping/measure reconciliation contract records reference-report identity and scope, compared counts, sums, keys, dimensions, temporal partitions and justified tolerances. Check slices that expose likely classification, attribution and timing errors, not only a grand total. Tolerances have units and explicit absolute/relative behavior; no arbitrary percentage qualifies exact business meaning. Missing or uncertain reference evidence limits qualification, and source reports themselves are not assumed infallible.

Acceptance: offsetting branch misattribution, an omitted invoice/credit pair and a shifted period are detected despite a matching total. A tolerance change requires a reviewed contract revision. Resolves C01-R1-041.

### 20.42 Data-consistency manifests

Compound results bind a per-source data-consistency vector separate from authorization: observed cut, acquisition interval, completeness frontier and established causal dependencies. Operations declare whether they need one coherent source snapshot, reconciled cross-source evidence or permitted bounded asynchronous evidence. Independent source revision numbers cannot be compared as a universal clock. If required consistency is unavailable, wait, reconcile or return unavailable; permitted partial analysis exposes its mismatch and limits.

Acceptance: skewed ERP invoices and bank receipts cannot produce an apparently coherent exact current balance or unjustified collection action. Updated authorization does not erase data-cut evidence. Resolves C01-R1-042.

Committed local changes return scoped visibility receipts whose minimum authoritative cut follows causally dependent interactive refreshes, navigation/reconnect and continued work. Validate tenant, history/environment incarnation and semantic scope; arbitrary client revision values are not authority. A dependent read waits, uses a qualified authoritative route or visibly remains pending until it covers that cut. Historical reads explicitly selecting an older cut remain available. Confirmed external application has a separate acquisition-pending state until local observation catches up.

Additional acceptance: Hold projection progress at cut 103, acknowledge a local correction at cut 104 and refresh through another route/reconnect. The dependent view cannot label cut 103 as the completed current consequence of cut 104. Unrelated and explicitly historical reads retain their declared behavior; foreign-tenant or restored-history receipts cannot establish a floor. Resolves C02-R1-002.

### 20.43 Population algebra

Populations declare member type, identity grain, temporal/identity revision and set or multiset semantics. Union, intersection, difference and projection require compatible contracts. Cross-grain conversion names a relationship and an explicit expansion/collapse rule. Preserve inclusion reasons when overlapping membership is consolidated. Customer-level deduplication must not erase distinct account-level obligations.

Acceptance: overlapping overdue/complaint sets yield one customer with two reasons at customer grain and distinct obligations at account grain. Incompatible types/cuts require explicit conversion. Membership overlap cannot itself create duplicate business actions. Resolves C01-R1-043.

### 20.44 Relationship topology

Relationship types declare applicable acyclicity, symmetry/antisymmetry, transitivity, order and role-exclusion rules, with temporal scope. Inverses are either derived from a shared authoritative edge or separately asserted with a reconciliation rule. Local cardinality does not establish a valid hierarchy. Traversal depth limits do not prove absence of cycles. Valid cyclic peer networks remain allowed where the domain contract permits them.

Acceptance: detect a one-parent cycle, accept a permitted cyclic relation and correctly distinguish an apparent cycle whose edges never coexist in time. Derived inverse edges and hierarchy rollups agree without double counting. Resolves C01-R1-044.

### 20.45 Temporal reference integrity

Relationships declare endpoint type/existence, identity generation, required validity coverage and deferred-resolution behavior. Stage unresolved references rather than certifying them as facts. Endpoint correction, retirement or identity split triggers dependent-edge revalidation. A domain rule selects quarantine, reviewed correction or interval adjustment; no database cascade implies business meaning automatically.

Acceptance: children-before-parent import, parent validity correction and identity split produce visible staging/revalidation and preserve legitimate historical links. Critical queries cannot silently traverse uncertified edges. Resolves C01-R1-045.

### 20.46 Mapping reference dependencies

Mappings declare lookup datasets and their exact revision/time semantics, required key cardinality, scope and missing-key behavior. Resolve the dependency vector once per declared consistency unit. A changed classification or conversion lookup is an interpretation change even if the mapping code is unchanged. Ambient current settings cannot be undeclared inputs. Impact analysis handles affected published facts and downstream results.

Acceptance: mid-import lookup modification cannot publish mixed interpretations; duplicate and missing keys produce their declared error/unresolved state with reference provenance. Resolves C01-R1-046.

### 20.47 Lineage precision

Canonical assertions link to source record/field identities or permitted artifact coordinates and to transformation/lookup revisions. Aggregates identify contributing sets or a reproducible query description with coverage. Each output declares its lineage and replay capability. Coarse provenance is allowed where access/retention requires it, but cannot be described as row-level explanation. Raw evidence expiry updates what can actually be replayed.

Acceptance: trace a report-derived amount through split pages, repeated headers and subtotal rules; identify affected assertions after a parser correction. After evidence expiry, explain the remaining and lost verification capability. Resolves C01-R1-047.

### 20.48 Source lexical interpretation

Parsing profiles declare encoding, numeric/date locale, grouping/decimal separators, signs, timezones, identifier preservation and spreadsheet stored/displayed-value treatment. Separate valid parse, ambiguous parse and failure before business mapping. Resolve ambiguous lexemes from source evidence or reviewed bindings rather than server locale or model guesses. Preserve permitted raw lexemes and diagnostics; profile change is a versioned reinterpretation with impact analysis.

Acceptance: ambiguous day/month dates, decimal/group separators, negative parentheses, leading zeros and conflicting cell formats either follow the selected convention or remain unresolved. Resolves C01-R1-048.

### 20.49 Mapping-template applicability

Templates publish checkable preconditions and evidence requirements over application/version, modules, configuration, customizations and relevant observed behavior. Applicability is proven, contradicted or unknown. Unknown required meaning prevents automatic publication and creates focused research/binding work. Evidence is versioned and rechecked when the relevant configuration or behavior changes, even if the schema does not.

Acceptance: same-version installations with different gross/net tax or recognition behavior cannot silently share an incompatible mapping; missing configuration evidence causes abstention. This strengthens broad reuse without narrowing the corpus programme. Resolves C01-R1-049.

### 20.50 Business object lifecycles

Domain packs can define versioned legal transitions, prerequisites, terminal/reopen behavior and cross-property invariants. Imports, apps and action preparation consume the same lifecycle meaning. Distinguish source-observed state, intended transition and confirmed correlated effect. Impossible or out-of-order observations create a declared reconciliation state; a known enum token alone does not prove an action succeeded.

Acceptance: normal, skipped, reversed and reopened transitions have consistent interpretation across consumers under the pinned lifecycle, and source observations require the proper evidence/correlation to confirm an external result. No universal ERP lifecycle is imposed. Resolves C01-R1-050.


## 21. Acquisition and research execution contracts

These are planned behavior and acceptance requirements, not implemented guarantees. All access routes, including computer exports, remain first-class and subject to their actual source capabilities.

### 21.1 Durable capture and processing frontiers

Before acknowledging source delivery or advancing a checkpoint, durably bind permitted payload or a qualified replayable reference, source position and receipt/deduplication identity. Keep captured, parsed, validated and published progress separate. For each declared ordering domain, advance only a justified frontier and retain unresolved holes; unordered sources use their appropriate receipt-set contract rather than a fictional global sequence. A no-copy profile states exactly what replay evidence remains available.

Acceptance: crashes around receipt, checkpoint and publication boundaries produce replay or explicit loss, never an acknowledged silent skip or duplicate canonical contribution. Resolves C01-R2-001.

Before discarding a repeated immutable event/revision identity, verify equivalence of its declared business content under the qualified decoder and normalization. The source profile defines the identity domain and immutable fields, excluding legitimate mutable delivery metadata. Equivalent deliveries reuse one logical receipt; incompatible content creates an owned conflict, restricts affected publication/readiness and requires reconciliation, including after an earlier copy was published. Mutable resource identifiers use separate observation/version semantics. Retention-limited comparison evidence yields an honest unverified state or qualified reacquisition, never assumed equality.

Additional acceptance: Send authentic same-identity payloads with different critical amounts in both arrival orders. Neither silently establishes a certified winner. Harmless formatting/delivery metadata changes remain equivalent. Repeat after evidence expiry with truthful limits and privacy-qualified comparison evidence; no indefinite raw payload or hash retention is required. Resolves C02-R2-001.

### 21.2 Snapshot-to-stream handoff

Each streaming profile declares snapshot cut, log start, overlap window, collision ordering and completion barrier. Use a source-supported coupled boundary where available. Otherwise qualify a reconciliation strategy and expose its unresolved interval. Late snapshot rows cannot overwrite newer streamed revisions, and snapshot completion alone cannot mark change capture caught up.

Acceptance: inserts, updates and deletes before/during/after chunk scans and scan restarts converge to an independent source read at the declared cut, with boundary and collision evidence. Sources lacking this guarantee retain explicit limits. Resolves C01-R2-002.

### 21.3 Lost continuity and resynchronization

Track continuous, gap-suspected, gap-confirmed, resynchronizing and reconciled states per affected source scope. Expired delta tokens or missing log positions cannot silently reset to now. Establish a new baseline and reconcile membership/deletions under source capability. Current-state repair and unrecoverable historical-event loss are different outcomes. Scope the interruption so unaffected qualified datasets can continue.

Acceptance: expire required source history, reconnect and verify the visible missing interval persists until the declared reconciliation completes. A full scan cannot certify events that no longer exist. Resolves C01-R2-003.

### 21.4 Pagination evidence

Endpoint profiles declare paging/order/tie rules, snapshot capability, cursor lifetime and terminal evidence. Preserve opaque continuations and required request context. Detect cursor loops and contradictory counts; a short or empty page is terminal only under the source contract. When a moving collection cannot be traversed consistently, expose that limitation and reconcile rather than label success as completeness.

Acceptance: page-boundary insertion/deletion, empty intermediate pages and repeated continuations yield a verified complete traversal or a scoped incomplete result with its page chain. Resolves C01-R2-004.

### 21.5 Polling cursors

Qualify incremental fields for precision, visibility, monotonicity, backdating and coverage of child/related updates. Define inclusive overlap and stable ties or use a genuine change sequence. Lookback intervals are bounded mitigations, not guarantees against unbounded retroactive changes. Profiles specify anti-entropy scans or equivalent recovery for changes incremental predicates cannot detect.

Acceptance: equal-timestamp late-visible rows, backdated corrections and child-only changes are retrieved or explicitly outside the qualified guarantee. Compare emitted identities and cursor progress with an independent complete read. Resolves C01-R2-005.

### 21.6 Authenticated webhook ingress

The immutable receipt-equivalence contract in 21.1 applies before treating authentic repeated identity as a duplicate. Equivalent delivery metadata may vary, but conflicting business content cannot be silently discarded.

Verify the source's required original bytes, signature/authentication and replay/freshness evidence before routing into a tenant/source-bound inbox. Attacker-provided tenant labels cannot establish routing authority. Acknowledge the durable admission boundary in 21.1, then parse and publish asynchronously. Invalid signatures, unknown versions and admission failures have bounded explicit responses. Duplicate authentic deliveries retain one logical receipt.

Acceptance: altered signed bytes, forged source labels, authentic replays and crashes around acknowledgement do not admit forged facts or lose acknowledged messages. Signing and freshness rules remain provider-specific. Resolves C01-R2-006.

### 21.7 Subscription lifecycle

Treat notification subscriptions as managed acquisition resources with source identity, covered scope, provider ID, expiry, renewal and confirmed active status. Compare expected with active scope so one healthy branch cannot hide another expired subscription. Existing durable coordination handles renewals and lifecycle/missed-event signals. Renewal does not erase the evidence of a previous gap; scoped reconciliation closes it.

Acceptance: expire or remove one subscription while others stay active. Health identifies the uncovered scope and its recovery, rather than declaring the whole source current from unrelated traffic. Resolves C01-R2-007.

### 21.8 Patch reconstruction

A transport profile declares full images versus patches, available before/after fields and base-revision requirements. Apply patches to the correct permitted retained base. Transport omission of an unchanged value differs from canonical absent/null/unknown. A missing base yields unresolved reconstruction or a separately identified new snapshot; an out-of-band current read cannot masquerade as the original historical event.

Acceptance: omitted unchanged fields are preserved, a missing base fails explicitly, and a racing later source read retains its own observation identity. No retention exception is implied. Resolves C01-R2-008.

### 21.9 Bulk reset barriers

Connector profiles declare keyless truncate, collection reset and dataset replacement support and their ordering domains. Represent scope and source generation/position as a reset barrier. Fence or reconcile affected partitions until reset and replacement data are ordered safely. Apply the semantic lifecycle rules in 20.28 separately; physical reset does not establish permanent business nonexistence.

Acceptance: cross-partition reset/insert interleaving, reset replay and restart during replacement leave no stale survivors or erased newer rows at the declared cut. Unsupported reset detection remains a visible source limitation. Resolves C01-R2-009.

### 21.10 Event-specific decoding

Acquisition evidence binds the wire schema/version or immutable decoding descriptor required by that message or file. Select a qualified decoder before semantic mapping; a current adapter version cannot redefine old queued bytes. Unknown versions quarantine explicitly. Schema transitions state which batches/streams may coexist. Retire old decoders when retained and in-flight obligations permit, not by assuming unconditional backward compatibility.

Acceptance: interleaved old/new events after upgrade decode with exact correct values or fail with their version identified. The source-version-to-decoder-to-mapping chain remains inspectable. Resolves C01-R2-010.

### 21.11 Fenced acquisition ownership

Bind acquisition partition/run ownership to an enforced generation. Checkpoint writes and baseline activation reject expired ownership, even when an old worker resumes with valid credentials. Backfill and live positions remain separate until a declared source-aware collision rule and compare-and-swap promotion reconcile them. Duplicate permitted staging evidence need not be forbidden. Temporal coordinates work; authoritative writes enforce ownership.

Acceptance: pause A, transfer ownership to B, publish newer data and resume A. A cannot advance the frontier or activate an obsolete baseline. Resolves C01-R2-011.

### 21.12 Failed-record repair lifecycle

Exceptions have stable identities, affected scope, reason, owner, retry eligibility, pinned evidence and terminal disposition. Repair identifies the changed parser, mapping, source record or governed manual assertion. Reprocessing preserves acquisition lineage and the selected revision; ticket acknowledgement alone cannot close a data gap. Closure requires verified publication or an explicit accepted exclusion under the semantic coverage contract. Poison records have bounded retries, with unrelated work proceeding where its consistency rules permit.

Acceptance: correct and replay a quarantined event twice; observe one logical result, retained failure lineage and evidence-based closure. Unexplained direct value alteration is rejected. Resolves C01-R2-012.

### 21.13 Bounded pipeline pressure

Bound admitted work by relevant record, byte and processing dimensions across capture, parsing, validation and publication. Propagate pressure without discarding acknowledged input. Distinguish capture pause from publication pause: source replay expiry can turn delay into data loss. Track backlog age against the source recovery window and expose degraded or gap-risk states before qualified limits are exceeded. Measure capacity and workload priorities rather than inventing universal limits.

Acceptance: stall validation under sustained input and an oversized artifact; resources remain bounded, receipts remain recoverable, lag is honest and unaffected qualified serving work retains its declared envelope. Resolves C01-R2-013.

### 21.14 Source operational impact

Source profiles declare read-induced locks, snapshot lifetime, retained logs, sessions, report jobs and cancellation/cleanup behavior. Expensive acquisition runs within the customer's configured source-impact envelope. Monitor permitted source-pressure evidence or disclose inability to measure it. Track ownership of temporary source resources so interrupted work cleans up only its own slots, cursors and jobs. A read-only label is not a guarantee of harmless load.

Acceptance: abandon a long snapshot/slot and simulate source pressure. Observe verified cleanup or an actionable outstanding obligation, without deleting another consumer's resources. Resolves C01-R2-014.

### 21.15 Shared provider quotas

Capability profiles identify the provider's actual quota scopes, including organization, application, credential, endpoint and concurrency where relevant. All eligible acquisition and interactive callers share admission accounting for those scopes. Honor provider backoff signals; inventory SDK retries so transport attempts remain bounded within the logical attempt budget. Deferred/rate-limited work exposes its freshness consequences. Rates and priorities remain measured, source-specific configuration.

Acceptance: concurrent agent queries, backfills and report jobs obey their aggregate controlled quota, avoid synchronized unbounded retry and show observable fair progress under the declared policy. Resolves C01-R2-015.

### 21.16 Installation capabilities

Separate discovery, installation, acquisition, maintenance and removal capabilities. A setup manifest names persistent source mutations, required privilege, ownership, verification and cleanup/reversal limits. Govern setup effects through the existing action boundary; normal read capability does not authorize source tables, publications, subscriptions or scheduled exports. Verify preprovisioned resources without silently replacing them.

Acceptance: run initialization with read-only credentials and then a specifically scoped setup grant. Every attempted mutation matches the manifest; partial owned resources are reconciled after failure. This plan authorizes no actual setup action. Resolves C01-R2-016.

### 21.17 Upstream visibility drift

Record expected permitted source visibility and refresh its attestation on observable changes and qualified intervals. Compare accessible entity/module/field inventories with the expected scope. Successful authentication and responses do not establish unchanged visibility. Reduced or unverifiable visibility changes coverage, invalidates unsupported deletion inference and remains distinct from local Chausar authorization. Inspect only permitted metadata.

Acceptance: remove one subsidiary or field from an otherwise valid source role. The next run exposes affected coverage without interpreting hidden records as deleted or empty. Resolves C01-R2-017.

### 21.18 Persisted connector state transitions

Version connector configuration, operational state and extraction-relevant dependencies together. Releases declare supported state read/write formats, changed defaults, transition steps and baseline requirements. Test preserved state and in-flight attempts before activation. Code rollback and state-format reversal are separate capabilities; an unsupported state version fails before frontier changes. Explicit retirement is allowed without indefinite backward compatibility.

Acceptance: resume saved state with the candidate, interrupt its declared transition and exercise rollback or forward repair. Source calls and canonical revisions show no unexplained loss, duplication or implicit reset. Resolves C01-R2-018.

### 21.19 Hierarchical fetch completion

Source acquisition dependency graphs distinguish parent enumeration from completion of child collections, pages and attachments. Record per-parent fetch state and qualified terminal evidence, including empty versus unfetched. Semantic consistency groups determine publication consequences, but transport must preserve which child fetch failed. Sources without counts use qualified traversal evidence or retain unknown coverage.

Acceptance: fail one child page, return a genuinely empty collection for another parent and omit a required relationship request. Receipts distinguish all three; retrying a child neither recreates its parent nor silently certifies the collection. Resolves C01-R2-019.

### 21.20 Asynchronous source export jobs

Track source export intent, accepted job identity, running, ready, retrieval, captured, failed, expired and uncertain states where supported. Reconcile lost submission acknowledgements before repeating expensive jobs. Bind download results to source job identity, requested scope and cut; refreshing a link cannot silently substitute a newly generated report. Track scoped orphan cleanup obligations. Computer profiles lacking job IDs may use qualified observable evidence and retain honest uncertainty.

Acceptance: lose submission acknowledgement, delay completion, expire retrieval and cancel generation. Reconcile the logical acquisition and all known source jobs without passing newer output off as the old snapshot. Resolves C01-R2-020.

### 21.21 Qualified MCP discovery

Capture negotiated protocol capabilities, server identity, complete paginated tool catalog and relevant schema/behavior digests. Bind Chausar operations to the qualified catalog revision. List-change notifications and observed mismatches trigger scoped qualification, not expanded authority. Document a fast path for harmless metadata changes; unsupported capabilities and material contract changes cannot silently enter durable work.

Acceptance: paginate discovery, remove or change a tool during a task and reconnect with different capabilities. Invoke only a verified compatible binding or pause with the exact mismatch. No MCP version is selected here. Resolves C01-R2-021.

### 21.22 MCP result normalization

Normalize transport/protocol error, tool error, partial output, complete typed output and unresolved resource reference into distinct Chausar states. Validate the qualified output schema and choose an explicit authoritative representation when structured and text blocks coexist. Resource links require independently authorized bounded retrieval and capture. Annotations are hints, not permission evidence. Qualified parsers may support unstructured tools while preserving their limitations.

Acceptance: return successful transport with tool error, contradictory content, a broken resource link and a valid empty dataset. None becomes the other; exact values are not reconstructed by model guesswork. Resolves C01-R2-022.

### 21.23 Source pushdown equivalence

For each operation, qualify exact source pushdown, semantics-preserving local residual evaluation or unsupported status. Source plans retain canonical predicate meaning and translation-test identity. Residual filtering requires sufficiently complete permitted input; filtering a limited first page cannot certify a complete answer. Null, collation, date, sort and limit behavior must preserve requested membership. A proposed alternative states its changed meaning.

Acceptance: compare source-only and complete controlled local routes on edge cases and disable one capability. Return equal qualified membership/coverage, a correct residual route or an explicit limitation. Full synchronization is not mandatory. Resolves C01-R2-023.

### 21.24 Acquisition cache identity

Bind cached representations and validators to source identity, permitted scope, relevant request parameters/headers, credential visibility context and schema. A not-modified response refers only to the same qualified representation and retained bytes. It cannot establish a new source transaction time or prove broader completeness. Visibility/configuration changes invalidate affected entries; policy governs storage lifetime.

Acceptance: reuse a URL across companies, filters and visibility changes with conditional responses. Mismatched bytes never receive the new context, and missing retained content causes reacquisition or explicit unavailability. Resolves C01-R2-024.

### 21.25 Coherent artifact transfer

Where supported, bind retrieval to a strong source version/validator, expected length and part manifest. Resume only with proven byte-version continuity, otherwise restart as a distinct attempt. Validate complete transfer before immutable capture and parsing. Interpret full versus partial response status correctly: a full replacement response cannot be appended to the old partial file. Filename, size and weak validators alone cannot certify identity. Safe full retrieval remains available where resume cannot be qualified.

Acceptance: change equal-sized remote bytes between range requests and corrupt one part. Reject/restart the mixed version and retain the actual captured digest, without publishing a parseable but incoherent file. Resolves C01-R2-025.

### 21.26 Parser containment

Qualified maintained parsers run with isolated temporary storage, no ambient credentials and controlled egress. Resolve archive members within the assigned root, disable unauthorized external entities/references and detect actual media type. Bound expansion, nesting, pages and execution resources against measured workload needs. Unsupported/encrypted input enters an explicit state; derived content retains the source trust class.

Acceptance: malicious archives, expansion bombs, external-reference XML and malformed document fixtures produce no unauthorized filesystem/network effects and bounded consumption. Failure diagnostics are safe and partial business assertions remain unpublished. No parser is claimed safe merely because a file scan passes. Resolves C01-R2-026.

### 21.27 Spreadsheet calculation provenance

Distinguish literals, formulas, cached values, external dependencies and volatile calculations. Record available calculation engine/revision/freshness evidence. Accept formula results only under qualified source-supplied or recalculation policy; a parsing library need not calculate anything. Govern recalculation effects and preserve it as a derived artifact rather than replacing original source bytes. Exact totals cannot be guessed from formula text by Luna.

Acceptance: stale/missing caches, changed inputs, external links and volatile formulas yield a traced qualified result or explicit limitation. Check against independent known answers without unauthorized link execution. Resolves C01-R2-027.

### 21.28 Probabilistic document extraction

Qualify extraction by critical field, layout/language stratum and intended use. Preserve source coordinates and engine evidence. Extracted candidates become verified assertions only through qualified acceptance, independent deterministic checks or permitted specialist review. Calibrate abstention on held-out artifacts; page-average confidence cannot certify a critical sign or digit, and the same failed extraction of a source total is not independent corroboration.

Acceptance: degraded scans, merged/multiline cells, confusable digits and missing signs expose field-level and critical-value errors. Unqualified exact values abstain while uncertain descriptive extraction can remain useful with its status visible. Resolves C01-R2-028.

### 21.29 Export-to-download correlation

Bind each capture to its initiating session/action/report intent using a qualified browser handle, job identity, isolated destination or application event. Filename and timing alone are insufficient when attempts overlap. Ambiguous correlation remains unresolved; identical filenames remain distinct captures, and content scope is checked after causal association. Employee computers remain supported through qualified observable evidence.

Acceptance: overlap identically named exports with reversed completion order and an unrelated download. Correctly associate artifacts or disclose ambiguity with the actual correlation evidence. Resolves C01-R2-029.

### 21.30 Immutable processing custody

After completion/correlation checks, acquire an immutable permitted artifact version or a protected read whose byte stability is enforced or verified. A stable path or open file handle alone does not prevent in-place mutation. Bind digest, byte length, storage version and processing attempt; parse those same verified bytes and reference them from derived records. Cleanup follows verified custody transfer. No-retention processing may use protected transient staging or streams and must expose its later replay limitation.

Acceptance: replace a file between hash and parse, mutate during reading and close its browser context immediately after completion. Process one verified sequence or reject the race. Retained evidence, where allowed, reproduces exactly the processed bytes. Resolves C01-R2-030.

### 21.31 Mutable computer context

Verify source account, entity/company, environment, report and effective scope immediately before export submission, then capture available result-side identity. Shared sessions can change context without reauthentication. A context change invalidates prepared assumptions; insufficient identity evidence requires a qualified confirmation method or unresolved scope. This is a harness check, not a demand for founder approval of each click.

Acceptance: switch company in another tab or test/production environment between preparation and submission. No receipt asserts scope solely from the session's initial binding. Resolves C01-R2-031.

### 21.32 Human takeover protocol

Use exclusive control ownership and an input-dispatch epoch. Takeover invalidates queued old-epoch input and records already-dispatched inputs whose effects remain uncertain. Resume requires a new observation, current context checks and reconstruction from durable work state. Human changes are observed evidence rather than assumed execution of the agent's old plan. Existing coordination remains authoritative.

Acceptance: take over between queued clicks, change the screen and return control. Old queued input cannot execute after transfer; bounded already-dispatched races are disclosed and reconciled. Resumed work re-observes before acting. Resolves C01-R2-032.

### 21.33 Authentication interruptions

Authentication-required and human-input-required states suspend stale UI sequences without autonomous credential guessing. Preserve acquisition intent and known job identity. After authorized human completion, recheck account/context and reconcile potentially submitted exports before rebuilding steps. Keep secrets and challenge responses outside ordinary receipts and model logs. Unsupported challenges receive an honest handoff.

Acceptance: expire authentication just before and just after submission. Resume from fresh evidence with correct job reconciliation and no credential leakage or stale-coordinate replay. Resolves C01-R2-033.

### 21.34 Committed report parameters

Each qualified computer report profile defines observable postconditions for selected identities, committed dates, applied filters and export readiness. Wait for state changes rather than assuming that a typed string or elapsed delay proves selection. Re-observe after asynchronous/layout changes; visual or accessibility evidence can qualify according to the environment. Unprovable effective values remain unresolved scope.

Acceptance: test debounced dates, unselected autocomplete text, virtualized lists and disabled export controls. Export only after verified effective parameters, or expose actionable uncertainty with minimal permitted evidence. Resolves C01-R2-034.

### 21.35 Effective report definitions

Bind acquisition to the source report revision/effective configuration where available. Distinguish caller parameters from inherited filters, calculated columns, personalization and cache behavior. Where revisions are unavailable, retain permitted semantic evidence and limitations. Material changes trigger mapping applicability and reconciliation checks; unchanged report names/layouts are insufficient proof of unchanged meaning.

Acceptance: change a hidden status filter or calculation without renaming the preset. Detect the revision or fail qualified behavioral checks before asserting complete publication. No proprietary source-code extraction is assumed. Resolves C01-R2-035.

### 21.36 Compound artifact sets

Compound acquisition manifests identify required/optional members, roles, partitions, source context and generation/attempt correlation. Stage until the required set meets its consumer contract; distinguish explicit partial output from completion. Reject cross-run assembly and ambiguous duplicate roles. Archive presence does not prove every member was extracted correctly. Semantic consistency groups govern later publication.

Acceptance: reverse master/detail arrival, omit a required member and substitute one from another run. Preserve member lineage and prevent false completion; qualified set promotion is atomic at its declared publication boundary. Resolves C01-R2-036.

### 21.37 Per-target research register

Maintain every named target database/system and discovered variant in a living research register. Track versions/modules/configurations, sought and obtained materials, routes/concepts qualified and unresolved evidence. Distinguish unresearched, unavailable, access-blocked and unsupported. Coverage retains the per-target denominator; many files for one ERP cannot hide untouched targets. No representative subset silently replaces EACH TARGET DATABASE/SYSTEM.

Acceptance: add an unsampled target/variant and trace its visible open status to its dossier, sample families and mapping-language questions. Corpus growth alone cannot mark it covered. Resolves C01-R2-037.

### 21.38 Corpus-use boundaries

Record reviewed permission evidence for retrieval, retention, parsing, model disclosure, evaluation, derived templates, redistribution and optional future training separately. Bind grants to source/artifact classes and responsible decisions. Unresolved downstream restrictions follow derivatives until reviewed; unknown permission blocks the disputed use without cancelling unrelated research. Crawl rules do not establish use authorization. Source-specific interpretation remains subject to qualified review, not a universal legal assumption.

Acceptance: research-only samples support permitted inspection but cannot enter prohibited model requests or distributed examples. Changed terms can locate affected derivatives. Paid-access willingness remains separate from purchasing authorization. Resolves C01-R2-038.

### 21.39 Restricted corpus intake

New external material enters restricted intake before shared indexing, prompts or distribution. Inspect provenance, secrets, sensitive identifiers and unexpected embedded content. Record genuine, synthetic, transformed, unknown or mixed status with evidence; public availability and sample labels do not certify safety. Sanitization creates a separately versioned derivative with transformation lineage, semantic-property checks and residual limitations. Automated screening cannot promise perfect detection.

Acceptance: planted secrets, hidden sensitive sheets and falsely labelled synthetic rows stay quarantined before shared use. Reinspect sanitized derivatives and verify that needed mapping test properties survived. Resolves C01-R2-039.

### 21.40 Research assertion evidence

Research assertions retain exact source revision, applicable scope, common origin, authority basis and contradictions. Distinguish documented behavior, observed sandbox results, inference and community claims. Mapping proposals cite these assertions and expose incompatible evidence. Resolve through focused tests or accountable specialist review; mirrored claims do not become independent votes and official documentation can still conflict with actual observations.

Acceptance: several mirrors repeat one incorrect interpretation while a configuration guide disagrees. Preserve one origin family and an explicit contradiction; a template cannot silently turn it into a universal rule. Resolves C01-R2-040.

### 21.41 Corpus correction and withdrawal

Version research items/assertions as active, superseded, disputed or withdrawn, with dependencies into language requirements, templates, prompts, evaluations and derivatives. Corrections generate scoped requalification; use-right changes trigger applicable removal obligations. Preserve only permitted tombstone/provenance evidence and identify historical claims whose support is invalid or unavailable. No perpetual retention or model-unlearning guarantee follows.

Acceptance: correct a dictionary rule and withdraw a sample family. Enumerate affected artifacts, stop prohibited uses and requalify meaning-dependent outputs without disabling unrelated work. Resolves C01-R2-041.

### 21.42 Independent installation holdouts

Assign installation/source-family lineage before splitting. Keep clones, derivatives, repeat exports and near-duplicates together; isolate labels, summaries and retrieval indexes as well as raw files. Freeze split/access manifests. Tuning on an exposed qualification failure makes that case development evidence and requires fresh independent qualification. No fixed split percentage or smaller target scope is imposed.

Acceptance: plant renamed clones, mirrored exports and answer summaries across splits. Detect shared origin and prevent forbidden retrieval; every result retains corpus revision, allowed context and exposure history. Resolves C01-R2-042.

### 21.43 Mapping evaluation denominators

Report target/version/configuration/route strata with attempted, supported, answered, abstained, reviewed and incorrectly accepted counts. Separate proposal accuracy from end-to-end publishable mapping, critical semantic errors from minor defects and sparse evidence from confident estimates. Declare weighting and missing strata before scoring. Measured risk and workload determine qualification thresholds; neither excessive abstention nor confident guessing can hide behind one pooled score.

Acceptance: a dominant easy target cannot conceal failure on a minority target, and answered-only accuracy cannot conceal near-total abstention. Reproduce metrics from case-level outcomes and the frozen manifest. Resolves C01-R2-043.

### 21.44 Reference-answer stewardship

Reference labels retain applicable scope, evidence, derivation, reviewer role, uncertainty and revision. Represent determined answers, legitimate alternatives and unresolved meaning distinctly. Existing specialists adjudicate material disagreement using evidence; missing configuration can make clarification the correct answer. Label corrections identify affected metrics/templates and preserve prior score provenance. Deterministically generated labels remain useful when assumptions and derivation are qualified.

Acceptance: independent reviewers receive an ambiguous and a determined case. Preserve accepted clarification for ambiguity; correct a mistaken label and locate every evaluation claim needing reassessment. Resolves C01-R2-044.

### 21.45 Corpus-to-language requirements

Track recurring or irreducible semantic patterns through evidence families, language requirements, candidate constructs, counterexamples, interactions and conformance tests. Distinguish a template binding from a parser repair or genuine language capability. Publish supported constructs and visible custom-transform escape hatches. Justify constructs by meaning and composition, not vendor field names. Established authoring tools remain candidates under DEFN-1.

Acceptance: trace independent source patterns through IR expression, generated validation and held-out mapping. Expose any supposedly declarative template that depends on an undeclared opaque script. Resolves C01-R2-045.

### 21.46 Synthetic evidence limits

Synthetic fixtures record generator/seed/revision, modeled constraints/distributions, edge cases and omissions. Sanitized derivatives verify preserved business relationships. Separate construct/fault tests from observed-source and independent-installation evidence; designed adversarial cases do not establish real-world prevalence. Synthetic data supports reproducibility but cannot replace the broad real-source programme or prove unobserved vendor/model quality.

Acceptance: inject known generator defects and broken sanitization joins. Detect invalid realism assumptions; repeated seeds never count as independent installations. Resolves C01-R2-046.

### 21.47 Coherent evidence bundles

Link schemas, configurations, samples and reference reports by demonstrated compatibility and shared installation state where known. Record observed co-occurrence, analogy, unknown relationships and bridging tests separately. Reference answers bind their exact input/report/filter bundle. Vendor labels and filenames alone cannot establish that individually authentic materials ever described one real setup.

Acceptance: pair authentic incompatible versions/editions and require the proposal to expose unsupported assumptions. Coherent sandbox bundles retain enough configuration and source-cut evidence to reproduce their claims; unpaired material remains useful with limits visible. Resolves C01-R2-047.

### 21.48 Reproducible source experiments

Record initial business configuration/state, fixtures, intended operations, concurrent actors and cleanup/reset evidence. Prefer isolated scopes where available; otherwise disclose interference. Verify the relevant business reset rather than trusting a successful reset button. Distinguish source behavior from demo-only restrictions. This contract neither authorizes paid access nor narrows the target programme.

Acceptance: repeat an experiment from verified initial conditions, then introduce residue and concurrent edits. Detect changed preconditions or mark inconclusive; another reviewer can reconstruct setup without hidden history. Resolves C01-R2-048.

### 21.49 Operation-level support claims

Maintain support qualification by source/version/deployment/module/route/operation with clear discovered, tested, qualified and degraded status. Attach conformance evidence, limits, owner and last verified revision. Reuse the Chausar contract suite with route-specific tests across MCP, libraries, direct access and computer exports; CDC alone cannot qualify every route. Customer-visible claims derive from this matrix.

Acceptance: qualify only customer reads, then request writeback or another module. Expose the actual unsupported operation; degrade one route without obscuring independently qualified alternatives. Missing support guides further work rather than reducing product scope. Resolves C01-R2-049.

### 21.50 Source retirement and replacement

Connections have active, paused, draining/reconciling, disconnected and retired states. Disconnect fences new acquisition/publication by generation while explicitly handling already-admitted obligations under current policy. Reconcile owned source jobs/subscriptions/resources and preserve permitted identity/provenance with visible freshness loss. Reconnect assesses continuity and chooses verified resume or a new baseline; identical address does not prove installation identity.

Acceptance: disconnect during export/backfill, deliver late events and replace the installation at the same address. Old-generation publication is blocked, cleanup remains visible and no new source inherits old cursors/identities without evidence. Retention and current access still govern history. Resolves C01-R2-050.


## 22. Workforce, decision and application contracts

### 22.1 Delegated completion

The durable work graph declares mandatory/optional contributions, cancellation propagation and surviving obligations. A parent completes only when required contributions have acceptable outcomes and unresolved effects have accountable reconciliation owners. Explicit partial delivery can retain visible continuation; detached work requires ownership. Late contradictions attach to the work record and can amend/reopen it. Configure existing Temporal child lifecycle behavior to this contract, rather than letting a library default decide business completion.

Acceptance: a blocked mandatory child prevents unexplained parent completion; a late contradiction reaches its owner once without replaying external effects. Resolves C01-R3-001.

Bind material requested outcomes, constraints, explicit inclusions/exclusions and delivery conditions to the objective revision, with source references and unresolved interpretation. Link them to planned work and final acceptance evidence. Planning edits and completion check for unassigned, dropped or unproved request obligations independently of the graph the planner created. Each becomes satisfied, explicitly partial/blocked, justified inapplicable or removed by an authorized objective amendment. Agents cannot silently make requested work optional. Use lightweight deterministic and qualified semantic checks appropriate to the task; this does not require perfect natural-language formalization or approval of every plan.

Additional acceptance: Omit one dimension from a three-part request before creating the graph, then finish every child. Report incompleteness or an explicit partial result identifying the obligation. Dropping its work node later also cannot satisfy the unchanged objective. An authorized amendment can remove it while preserving reusable evidence for unaffected obligations. Inspect request-to-obligation-to-work-to-deliverable links. Resolves C02-R3-001.

### 22.2 Conserved delegated budgets

One authoritative budget scope reserves and suballocates capacity atomically across parent, children and tool/model work. Distinguish estimated admission, bounded permitted exposure, actual settlement and uncertain consumption. Parent spend plus live reservations stays within the authorized envelope; cancellation or timeout alone cannot refund a still-running remote job. Separate monetary, token, time and resource ceilings. Work whose cost exposure cannot be bounded must use an explicitly qualified admission policy and disclose that limit.

Acceptance: concurrent children cannot each spend a copied full balance. Replayed settlement does not double-charge, and uncertain consumption remains reserved until justified resolution. No arbitrary cap or provider price is selected. Resolves C01-R3-002.

### 22.3 Objective amendments

Record ordered user intent revisions as clarification, added constraint, replacement or cancellation, with author and affected scope. Bind subtasks and prepared outputs to the revision they satisfy. Material steering identifies obsolete work, replans/stops affected children and invalidates stale outputs; already completed effects retain reconciliation obligations. Clear steering applies directly without unnecessary confirmation. Preserve unaffected useful work and ask only about consequential ambiguity.

Acceptance: amend an exclusion/deadline while a child is paused. Its old result is revalidated or marked stale; the final deliverable identifies the objective revision fulfilled. Resolves C01-R3-003.

### 22.4 Typed workflow dataflow

Template graphs bind each input to producer result identity, information class, acceptable status and required evidence. Hypotheses, verified computations, observations and action receipts are not interchangeable merely because their wire fields match. Explicit governed conversions and dependency predicates determine step readiness. Record branching/join reasons, rerun checks after plan edits and prevent partial/failed producers from satisfying complete dependencies. Exploratory work may propose new qualified graphs.

Acceptance: hypothesis substitution, plausible failure payloads and reversed sibling completion cannot satisfy the wrong dependency. Valid execution retains exact producer IDs and evidence through the result chain. Resolves C01-R3-004.

### 22.5 Resumption after context loss

Build a protected resumption capsule from authoritative work state: objective revision, resolved parameters/exclusions, required tasks, relevant accepted/rejected hypotheses, open questions, result references and unresolved obligations. Summaries aid navigation; they do not replace authority. Validate capsule coverage against the work graph and rehydrate only currently permitted evidence. Missing/expired necessary context produces a scoped limitation, rather than silent omission or a requirement to retain whole chats indefinitely.

Acceptance: repeated compaction/restart preserves decisive exclusions and uncertain outcomes by identity or recoverable reference. Compare behavior with the equivalent uncompressed scenario, and expose unavailable evidence. Resolves C01-R3-005.

### 22.6 Collaborative artifact integration

Ordinary work products have revisions and explicit editing scopes/branches. Contributions name base revision, changed regions and evidence. Reject stale destructive replacement or perform a qualified merge with visible conflicts. The lead's completion record accounts for mandatory contributions as integrated or deliberately rejected with reasons. Contribution provenance remains subject to current access. Reuse suitable established revision/merge mechanisms; no particular editor or CRDT is selected.

Acceptance: concurrent disjoint edits survive and overlapping edits conflict or receive reviewed resolution. Worker success alone cannot certify that its content reached the final artifact. Resolves C01-R3-006.

### 22.7 Semantic progress and termination

Define workload-specific progress evidence: relevant new information, resolved uncertainty, verified intermediate result or accepted state transition. Track equivalent repeated attempts and delegation ancestry. Error classes distinguish retriable, correctable, capability-blocked and unresolved-meaning states; repeating a blocked operation needs a justified changed precondition. No-progress handling surfaces a blocker, bounded alternative or focused question while preserving useful partial work. Silence alone is not a stall.

Acceptance: unsupported-tool loops, reciprocal delegation and identical searches stop or change strategy under the qualified policy, while legitimately converging work continues. No universal turn threshold is selected. Resolves C01-R3-007.

### 22.8 Complete model proposals

Gateway adapters track receiving, completed, refused, truncated, cancelled and transport-uncertain outcomes. Assemble fragments by qualified invocation/call identity; a tool proposal must have protocol-supported completion evidence before admission. Parseable prefixes are insufficient. Separate model invocation, tool proposal and stable business-operation identities, so duplicate protocol events cannot create new work. Refused or incomplete content cannot become an instruction.

Acceptance: changing valid-JSON prefixes, duplicate completions, refusal with content and disconnects produce no premature dispatch and one admitted logical proposal for a completed replay. Business effect verification remains a separate downstream boundary. Resolves C01-R3-008.

Trusted admission establishes one unambiguous wire-to-semantic value before schema validation, normalization, approval or digesting. Reject duplicate decoded member names, including escaped aliases, and other representations whose qualified decoders disagree. Review, policy and dispatch consume the admitted typed value or its qualified canonical encoding instead of independently reinterpreting raw control bytes. Other transports need equivalent uniqueness rules. Raw source bytes may remain untrusted evidence under a source-specific parser; they do not establish ambiguous control meaning.

Additional acceptance: Send duplicate amount/target keys through each control ingress. Reject before preparation/outbox admission. Accepted fixtures produce the same typed meaning at review, policy, digest and execution, and changed meaning fails operation binding. No parser library or blanket ban on unfamiliar source formats is implied. Resolves C02-R1-007.

### 22.9 Qualified model feature profiles

Qualify exact endpoint/adapter/model revisions for each workflow's schema, modality, context and tool interaction needs, alongside policy and budget. Unsupported required features fail visibly rather than being dropped. A qualified alternative path, such as text-only processing, is explicitly different with its own evidence. Distinguish health, transport compatibility and semantic quality; qualification is bounded evidence, not a guarantee against every future model error. Preserve the primary Luna-class direction.

Acceptance: controlled schema-ignoring, modality-dropping and incompatible-correlation endpoints are rejected for affected workflows before reliance, while supported economical routes remain eligible. Resolves C01-R3-009.

### 22.10 Operation discovery recall

Published discovery metadata binds purposes, disambiguating examples, parameter semantics and aliases to operation identities. Catalog retrieval records search scope, match basis and competing meanings. Insufficient selection evidence permits bounded discovery expansion or clarification; no shortlist match does not prove the product lacks a capability. Evaluate retrieval recall separately from choosing correctly when the needed operation is available.

Acceptance: omit recognized revenue from an initial shortlist containing net sales. The harness expands, clarifies or declares uncertainty rather than confidently substituting the nearest operation; candidate IDs explain whether failure arose in retrieval or interpretation. Resolves C01-R3-010.

### 22.11 Search completeness and negative claims

Retrieval declares permitted corpus scope, index readiness/revision, method, limits and completeness class. Ranked top-k absence cannot prove universal absence. Strong negative claims require qualified exhaustive procedures over a declared expected domain; otherwise say what was not found within the searched evidence. Missing/unavailable indexes differ from verified emptiness, but diagnostics themselves must respect disclosure policy and cannot reveal forbidden material's existence.

Acceptance: contrary clauses outside top-k or in an unindexed appendix prevent an unqualified no-restriction conclusion. A qualified exhaustive procedure finds them or exposes an authorized scoped coverage limitation. Resolves C01-R3-011.

### 22.12 Recall within authorized evidence

Qualify search against an exact permitted-subset oracle across permission selectivity, languages and rare concepts. Choose measured prefiltering, iterative/partitioned/hybrid search or exact fallback as suitable; no new vector store is mandated. Search exhaustion/quality limits differ from permission denial. Denied text cannot enter rerankers or context to improve recall, and all result/diagnostic release remains governed.

Acceptance: inaccessible nearest neighbors cannot hide a permitted relevant item without the profile exposing its measured recall limitation. Compare with the authorized-subset oracle and inspect context/logs for leaks. Resolves C01-R3-012.

### 22.13 Context-complete evidence fragments

Fragments retain hierarchy and dependencies needed for meaning, including definitions, headings, exceptions, table headers, units and footnotes. Context assembly includes necessary permitted qualifiers or marks evidence insufficient for the proposed conclusion. Exact extraction and correct coordinates do not establish complete interpretation. A withheld essential qualifier cannot be ignored to assert an unqualified rule.

Acceptance: split exceptions/headings/units across chunks. The final answer preserves their limiting meaning or abstains, and the context manifest shows what justified that decision. Chunk size and extraction method remain empirically qualified. Resolves C01-R3-013.

### 22.14 Communication claim semantics

Claims represent author/speaker, quoted or reported attribution, polarity, modality, conditions, entity, asserted/mentioned time and speech act. Unknown attribution and conditionality remain explicit. Converting a wish, question or conditional proposal into a commitment/fact/action premise requires a supported governed transition. Compare contradictions only within compatible scopes and conditions. This defines behavior for permitted content and grants no communication-source access.

Acceptance: negation, quotation, conditional and speaker variants produce distinct claims and downstream treatment. A conditional shipment cannot silently become a firm promise. Resolves C01-R3-014.

### 22.15 Lessons and reusable guidance

Distinguish episodes, candidate lessons, personal preferences, approved procedures and published business rules. Candidate lessons declare evidence, applicability and counterexamples; the appropriate owner/specialist process controls promotion. Personal preferences do not silently become company instructions, and authoritative calculations stay in the ontology. Superseded/rejected guidance is excluded from current instructions even if an old summary still mentions it.

Acceptance: a successful exception remains scoped when a similar case would make it wrong. After retirement, history may remain inspectable where permitted but cannot re-enter context as current policy. Resolves C01-R3-015.

### 22.16 Claim-to-evidence support

Bind exact answer quantities, units, signs, periods and populations to typed results, rendering or checking them deterministically where possible. Interpretive assertions identify supporting spans and support class; unsupported prose is removed, qualified or reviewed. Link existence, entailment, arithmetic fidelity and current access are distinct checks. Qualified prose review has explicit limitations and need not use a second or stronger model.

Acceptance: reversed trends, wrong percentages/periods and valid irrelevant citations fail the relevant check. Supported concise paraphrases remain valid without verbatim copying; the evidence map identifies support for each substantive claim. Resolves C01-R3-016.

### 22.17 Multilingual meaning fidelity

Keep canonical typed values and immutable identifiers separate from localized presentation. Qualified language profiles cover numeral/currency/date rendering, terminology and code-switched identifiers. Preserve negation, conditions and uncertainty; deterministically render critical structured content where feasible. Test real supported-language workflows with grounded meanings and native-language review. Unqualified language support is visible rather than invented fluency.

Acceptance: equivalent multilingual questions preserve operations, lakh/crore magnitudes, signs, exceptions and IDs. Changed conditions or scales fail despite fluent grammar and valid citations. No fixed language list/provider is chosen here. Resolves C01-R3-017.

### 22.18 Conversational bindings

Maintain resolved object/measure/period/currency/comparison bindings and their provenance. Workspace changes are versioned observations, not silent replacements for conversation scope. Each turn identifies inherited, changed and unresolved parameters. Conflicting references receive focused clarification; clear follow-ups continue automatically. Answers and prepared actions expose human-readable resolved scope using the same identities passed to validation.

Acceptance: alternate customers/periods, change the workspace and say same as before or its manager. Resolve clear references directly and clarify genuine conflicts without guessing from recency. Retain parameter origins in the proposal manifest. Resolves C01-R3-018.

### 22.19 Repeated-run reliability

Freeze evaluation cases, environments and allowed attempts before trials. Retain every retry, failure, intervention and resource cost. Report single-attempt success, repeatability and success under the deployed retry policy separately, with uncertainty/severity and equivalent comparison budgets. Environment failures use a declared inconclusive rule rather than selective exclusion. Failed-attempt cost belongs in task economics.

Acceptance: distinguish intermittent one-in-several success from consistent completion and reproduce all metrics from the trial ledger. Cherry-picked successful transcripts cannot qualify a release. Trial counts and thresholds follow measured variance/risk, preserving the Luna-first target. Resolves C01-R3-019.

### 22.20 Qualified evaluation graders

Use deterministic checks for exact values, operation identities and forbidden effects. Model-assisted graders cover declared aspects with calibrated rubrics and independently labelled cases. Test order, verbosity, paraphrase and polished wrong answers; version grader model/prompt, retain disagreements and adjudication. Generator self-approval alone cannot qualify high-impact behavior. Grader uncertainty/failure triggers appropriate review, not certification.

Acceptance: wrong-customer answers fail regardless of style, candidate reordering exposes instability and specialist adjudication checks calibration. No universal grading vendor or human review of every low-impact response is required. Resolves C01-R3-020.

### 22.21 Exploratory and confirmatory discovery

Distinguish descriptive exploration, confirmatory tests and continuous monitoring. Inferential jobs record searched families, adaptive selections, effect sizes, sample support and a qualified multiplicity/sequential method. Selected nominal significance cannot stand for family-level certainty. Exploratory anomalies remain useful leads with their status visible; appropriate independent/prospective evidence supports confirmation. Exact business-threshold alerts need not be hypothesis tests.

Acceptance: search many noisy slices with a planted real effect. Expose the search family and reproduce the declared inference without promoting cherry-picked noise to an established opportunity. No universal method or significance cutoff is selected. Resolves C01-R3-021.

### 22.22 Business alert episodes

Alert definitions specify condition identity, activation/clear rules, relevant persistence/hysteresis, severity transitions and reopening. Correlate successive observations into episodes with evolving evidence; unavailable data is not a cleared condition. Late corrections can visibly amend/retract an episode. Notify meaningful transitions and escalate through accountable response policies rather than opening work on every evaluation tick.

Acceptance: oscillation, sustained breach, data loss and retroactive correction produce a coherent episode and traceable resolution/uncertainty. A genuinely different condition still creates new work. Thresholds and notification preferences remain configured business choices. Resolves C01-R3-022.

### 22.23 Causal identification

Causal jobs define intervention, outcome, population, horizon and estimand, with assumptions, confounders, selection/missingness concerns and identification strategy. Separate supported identification from exploratory estimation. Sensitivity/refutation evidence accompanies claims but cannot prove observational assumptions true. Prediction, feature contribution and intervention effects retain different labels; fitted association alone cannot justify an action's expected benefit.

Acceptance: controlled confounding distinguishes predictive association from the specified intervention effect. Missing required confounders expose non-identification or sensitivity limits. Qualified designs retain their tested uncertainty; no causal library or universal method is selected. Resolves C01-R3-023.

Descriptive change decomposition is a published operation separate from causal inference. Bind baseline/comparison populations, factors, method/order or symmetry rule, interaction allocation and explicit residual. Contributions plus residual reconcile to the exact change under declared rounding. Distinguish scope additions/removals from within-population changes. Missing factors or incomplete coverage yield a partial bridge, and the model cannot mix contributions from incompatible methods. Business conventions remain named choices rather than a universal decomposition formula.

Additional acceptance: For 10 units at 10 changing to 20 units at 12, reconcile the 140 increase including the 20 interaction under the chosen method. Add/remove a product and show scope effects separately. Permutations change results only as the declared method allows. A descriptive bridge never becomes an intervention claim without separate causal evidence. Resolves C02-R1-009.

### 22.24 Operational forecast backtests

Each forecast origin binds event cutoff, recorded-knowledge cut and feature availability lags. Fit preprocessing, selection and tuning only on eligible training history for that origin. Operational as-known evaluation differs from explicitly restated diagnostic analysis. Score deployed horizons/cadence against appropriate benchmarks; one-step performance cannot certify a longer horizon. Unavailable retained origin evidence limits reproducibility rather than authorizing indefinite retention.

Acceptance: late corrections and whole-series preprocessing cannot leak into an earlier operational fold. Origin manifests reconstruct the qualified slices and separately label restated results. Resolves C01-R3-024.

### 22.25 Future covariate availability

Features declare knowability, horizon coverage and known, planned, assumed or predicted status. Bind each forecast to its exact future driver paths and revisions. Missing required inputs block that model or use a separately qualified alternative. Scenario assumptions and imputation are explicit; uncertain drivers require qualified uncertainty propagation or an acknowledged limitation. A partial future row set cannot satisfy a horizon-wide requirement.

Acceptance: remove future promotion values and replace actual weather with forecast weather. The job exposes missing inputs/assumptions and changes interpretation appropriately instead of preserving an unjustified uncertainty claim. Resolves C01-R3-025.

### 22.26 Probabilistic forecast composition

Typed outputs identify target distribution, horizons, quantiles/coverage, calibration scope and joint dependence/sample representation where composition is supported. Distinguish prediction intervals, parameter confidence and scenario ranges. Aggregate only through qualified joint/reconciliation procedures; adding marginal interval endpoints does not certify aggregate coverage. Downstream consumers declare uncertainty use and cannot treat a probabilistic bound as a deterministic guarantee.

Acceptance: correlated branch fixtures reject unjustified interval arithmetic and evaluate marginal/aggregate calibration separately. Interfaces name interval type and limits. Exact governed totals and privacy noise remain distinct concepts. Resolves C01-R3-026.

### 22.27 Censored decision targets

Forecast definitions separate observed quantities from intended decision targets and observation constraints. Capture permitted availability, capacity, closure and substitution evidence where relevant. Qualified methods may model censoring; otherwise describe the output as constrained observed sales or fulfilled activity. Do not invent lost demand or interpret stockouts as ordinary zero demand.

Acceptance: controlled demand capped by stock cannot qualify a naive sales predictor as an unconstrained-demand model merely because sales prediction succeeds. Declare assumptions, missing censoring evidence and uncertainty. Domain packs choose appropriate target meaning without a universal estimator. Resolves C01-R3-027.

### 22.28 Optimization preferences

Job definitions classify hard rules, relaxable preferences and objective components with units, priorities and accountable owners. Specify weighted versus lexicographic trade-offs and justify penalty scales. Agents may propose alternatives but cannot silently select material business preferences or soften obligations. Relevant alternative/Pareto choices explain the recommendation. Changed hard/soft classification creates a new scenario specification under applicable authority.

Acceptance: opposing cost/service allocations respond explainably to declared priorities. Unbound material weights remain a customer/job setup decision, not an invented universal founder choice. No solver selection follows. Resolves C01-R3-028.

### 22.29 Solver encoding and validation

Record numeric scaling, bounds, tolerances and encode/decode transforms. Independently validate returned decisions against original typed business constraints before action preparation. Solver-feasible status applies to the encoded model; report original-constraint residuals and qualified tolerances separately. Permitted rounding repairs create new candidates with rechecked objective/constraints rather than silent clipping. Current operational preconditions still require action-time revalidation.

Acceptance: fractional limits, extreme coefficients and intentionally lossy scaling expose solver-feasible but business-invalid solutions. Correct encodings retain transform and residual evidence. No universal tolerance is prescribed. Resolves C01-R3-029.

Separate destination feasibility from executable transition qualification. A ready-to-execute multi-step recommendation binds its starting cut, action graph, qualified operation atomicity, relevant durations/temporary resources and intermediate-state invariants. Establish a permitted sequence or concurrency protocol; simultaneous calls are not an atomic cross-source change. Missing evidence produces a destination-feasible proposal with an explicit execution gap. Temporary resources, maintenance windows or relaxed constraints are separately authorized scenario changes. After material deviation, reassess the remaining path from observed state while preserving completed effects and normal reconciliation.

Additional acceptance: A final roster swap satisfying every destination constraint cannot be labelled ready if every available individual move violates continuous coverage. A qualified atomic swap or expressly permitted staged arrangement must pass its own path checks. Interrupted execution revalidates remaining transitions and exposes unknown duration/atomicity assumptions. Bounded templates or established planning checks suffice; no general optimal planner or guarantee under arbitrary environmental change is required. Resolves C02-R3-002.

### 22.30 Infeasibility and relaxation

Distinguish proven infeasible, unknown/time-limited, invalid and feasible outcomes with solver evidence. Where supported, map conflict subsets to business rules and state whether they are minimal or merely sufficient. Diagnostic inability remains inconclusive. Relaxations are new scenario proposals preserving the original job, changed constraints, authority and trade-offs; no rule is silently removed to manufacture a solution.

Acceptance: a contradictory staffing case can expose a verified conflict while an early-stopped feasible case remains unknown. Every proposed relaxation identifies changed rules and cannot appear as already approved operational work. Resolves C01-R3-030.

### 22.31 Coherent scenario revisions

Scenario inputs and derived analyses form a dependency graph. Assumption changes create immutable revisions and mark affected descendants stale/pending; independent jobs remain reusable. A complete comparison requires compatible input/scenario vectors across required runs. Partial refresh is visibly partial. Acceptance selects a coherent revision and then enters ordinary current-state action preparation, never whichever stale widgets happen to be visible.

Acceptance: change price while downstream demand/optimization is delayed. Stale descendants cannot masquerade as a fully evaluated comparison, and manifests identify exactly what was recomputed. Resolves C01-R3-031.

Namespace provisional objects by scenario branch/revision. An acceptance/materialization relation binds each to its authorized creation intent, stable operation identity and confirmed real canonical/source identity. Existing-object selection resolves explicitly under current identity/state. Dependent preparation consumes the confirmed branch-specific binding; OutcomeUnknown creation blocks or visibly limits downstream work. Never substitute a label match or another branch's object. Preserve the hypothetical graph and trace materialized outcomes through existing records, without another coordinator or blanket authorization of all nodes.

Additional acceptance: Accept one of two identically named branches, lose the creation receipt and resume with a similarly named real object present. Reconcile the original creation without label substitution or duplicate creation; downstream effects wait for confirmed binding. Partial materialization leaves owned real results and explicit incomplete nodes. Resolves C02-R1-008.

### 22.32 Analytical applicability

Model releases declare target/population, supported input regimes, history needs and known exclusions. Assess scenario inputs as within supported evidence, extrapolative or unsupported. Permitted exploratory analysis outside the envelope remains useful but cannot inherit calibrated uncertainty or qualified recommendation status. Domain changes trigger focused reevaluation. Specialists establish evidence boundaries without imposing universal numerical limits or forbidding ambitious exploration.

Acceptance: ordinary, extreme-intervention and cold-start cases receive the appropriate applicability assessment, retained with downstream summaries instead of presenting all as equally calibrated. Resolves C01-R3-032.

Continued predictive use has current quality evidence separate from input applicability and historical qualification. Bind predictions to model/use revision, origin, horizon, population, input/definition cut and target-observation rule. Join permitted mature outcomes and evaluate declared error, bias or calibration by material use and stratum. Record evidence age, coverage, owner and scoped quality status with an explicit consumer eligibility response. Immature, missing, selected or intervention-altered labels yield qualified limitations, not automatic success or proved degradation. Input drift alone cannot certify predictive quality. Requalification may restore use; retraining is a separately governed candidate change using existing coordination and retention controls.

Additional acceptance: With balanced input X=0/1, switch the target from Y=100+50X to Y=150-50X while holding artifact, input and target marginals and totals fixed. Mature sufficient evidence under the qualified policy exposes opposing errors and changes affected recommendation eligibility. Delayed or selectively observed labels retain honest pending/limited states. Preserve unaffected uses, original forecasts and prior error evidence; inspect cohort identities, denominators and actual consumer response. No universal cadence, threshold or immediate-detection guarantee is selected. Resolves C02-R5-001.

### 22.33 Numerical job reproduction

Bind execution/environment artifacts, dependency revisions, permitted inputs, preprocessing, random seed/state, relevant parallelism and checkpoint compatibility. Declare exact replay, statistically equivalent rerun or retained-result inspection as different capabilities. Resume only a compatible checkpoint/specification; changes create a new run. Input expiry limits claimed reproduction. Reuse established packaging and sandbox contracts without requiring bitwise equality across all hardware.

Acceptance: repeat controlled jobs, change dependencies/seeds and attempt mismatched checkpoint resume. Preserve the original result and expose new-run or reproduction limits rather than silently substituting output. Resolves C01-R3-033.

### 22.34 Conflicting recommendations

Exploratory scenarios do not reserve real resources. At commitment/approval, expose overlapping inventory, capacity and budget assumptions through a portfolio or expiring planning-intent view with accountable arbitration. Revalidate combined commitments at the relevant resource cut. Internal intent is distinct from a verified upstream reservation, which requires an authorized action. Action dispatch still checks current state.

Acceptance: two individually feasible plans exceeding joint capacity cannot appear jointly committed without a resolved conflict. Intent expiry/change frees only its justified planning allocation. Customer priorities remain explicit rather than choosing one function automatically. Resolves C01-R3-034.

### 22.35 Outcome follow-through

Decisions attach owned observation obligations: measure/population, baseline, window, maturity/lag rules and pending, observable, inconclusive, achieved/not-achieved and amended states. Distinguish observed improvement from causally attributed benefit and record relevant concurrent interventions where known. Late evidence/corrections revise assessments with history; cancellation/owner changes explicitly transfer or close obligations. Execution receipts stay separate.

Acceptance: delayed payments, unavailable data and overlapping campaigns produce honest pending/inconclusive assessments and traced amendments, without rewriting completed effects or inventing causal credit. Outcome definitions remain customer-specific. Resolves C01-R3-035.

### 22.36 Stale application drafts

Forms bind the displayed object revision and track intended edits separately from untouched fields. Preparation sends typed patch/equivalent explicit intent. Conflicts show relevant current/draft differences while preserving safe unsaved input. Rebase only demonstrably independent changes; material conflicts receive deliberate resolution and new preparation. Reload-and-blind-resubmit cannot expand intended changes or overwrite another user's work.

Acceptance: change a phone while another worker changes payment terms, then test competing phone edits. Preserve independent updates and expose real conflicts; prepared scope/revision matches what was reviewed. Resolves C01-R3-036.

### 22.37 Display and submission fidelity

Semantic value types govern widget editing, validation and formatting. Compact presentation differs from exact inspection and consequential review. Keep identifiers as text, percentage scale explicit and preview/submission derived from the same typed value; changed values invalidate preview. Rounded charts disclose that precision and cannot alone represent exact commitments.

Acceptance: rendered round trips preserve large IDs, fractional/negative money and percentages. Compare user review, preparation and submission values; abbreviated labels provide exact inspection where needed. No locale/library is imposed. Resolves C01-R3-037.

### 22.38 Accessible complete workflows

Shared surfaces and generated templates require semantic controls, keyboard navigation/focus management, textual evidence alternatives, non-color-only state, accessible errors and asynchronous status announcements. Validate investigation, correction, evidence inspection and action review with assistive technology and realistic data. Tested components do not certify their assembled workflow. Record barriers and remediation; automated scans alone are insufficient.

Acceptance: keyboard/screen-reader users perceive scope, uncertainty, errors and final state and complete/recover the whole task. A formal conformance level remains an explicit product requirement to ratify before claiming conformance; no legal certification is asserted. Resolves the concrete workflow omission in C01-R3-038, with that target choice retained in the resolution register.

### 22.39 Generated-app functional contracts

Shared releases specify intended tasks, bound operations, field/measure meaning, transitions and completion evidence. End-to-end fixtures include normal, empty, incomplete and failure conditions, with independent expected answers and control-to-operation traces. Security/type/build success cannot prove correct business wiring. Private tools disclose their qualification status without imposing a heavyweight ceremony on every exploratory artifact.

Acceptance: wrong-measure cards, draft buttons wired to submission and partially applied filters fail task checks even when permission and compilation checks pass. Release evidence separates functional and security qualification. Resolves C01-R3-039.

### 22.40 Live-view continuity

Subscriptions bind authorized scope and revision/sequence domain. Detect gaps/reordering and resynchronize from authorized authority when continuity is uncertain. Reconnect rechecks access and selected object/work revisions. Render connecting, stale, resynchronizing and current states honestly; optimistic status differs from confirmed state, and connection recovery cannot certify business completion.

Acceptance: missed/reordered updates and suspended-browser reconnect converge to actual task/operation state or visibly remain stale. Stale success never bypasses preparation/revalidation. Qualified latency bounds remain measured rather than promising instantaneous consistency. Resolves C01-R3-040.

### 22.41 Voice intent finality

Bind recognized intent to audio/transcript segment identity, language, finality and resolved critical values. Interim text may support non-effectful speculation but cannot authorize an action. Qualify recognition of IDs, amounts, dates and negation, with risk-appropriate readback or correction. Transcript revisions invalidate stale proposals; confirmation refers to the exact resolved request and prompt under existing approval policy.

Acceptance: interim reversals, similar-sounding IDs, delayed negation and code-switching produce no effect from obsolete text. Uncertain critical values trigger focused clarification without repeating every low-risk sentence. Resolves C01-R3-041.

### 22.42 Spoken delivery evidence

Distinguish generated, queued, played-through and interrupted segments using available playback evidence. Client playback is not proof of human comprehension. Context and handoff summaries retain supported delivered extent and uncertain tails; interruptions re-evaluate unanswered questions and unheard material conditions. Deduplicate transcription events by qualified segment identity. Agreement requires a separately correlated customer response.

Acceptance: interruption before/after a condition, media disconnection and duplicate events cannot make the record claim the full answer was heard. Recover missing material without repeating completed effects. Profiles lacking precise playback evidence disclose that limit. Resolves C01-R3-042.

### 22.43 Accepted human handoff

Handoffs have requested, queued, offered, accepted, active, failed and completed states with exclusive response ownership/control epoch. Transfer a minimal permitted context package containing intent, verified facts, pending actions, unheard disclosures and unresolved outcome identities. Until responsibility is accepted, the agent retains a qualified holding/fallback role. A joined media connection alone is not case acceptance.

Acceptance: closed queues, queued-speech races and reconnects leave one accountable response owner and truthful transfer status. Failure offers configured continuation, rather than abandoning the caller or inventing staff availability. Resolves C01-R3-043.

### 22.44 Cross-channel case continuity

Keep conversations separate from business cases and record link evidence/status. Authenticated selection or qualified continuation evidence can join permitted context; similarity proposes a link rather than granting it. Correlation never widens identity assurance or access. Case merge/split preserves message identities, pending obligations and stable operation references. Potential duplicate remedies are reconciled before competing dispatch.

Acceptance: voice-to-portal continuation reuses appropriate work while different issues sharing a contact remain separate. Raced duplicate requests do not create two remedies merely because they arrived through different channels. Resolves C01-R3-044.

### 22.45 Accountable customer commitments

Represent commitment proposals and confirmed communications with beneficiary/case, promised outcome, conditions, due window, authority, owner and supporting capacity/effect evidence. Keep estimates, targets, conditional promises and accepted commitments distinct. Permitted promises create durable follow-up and escalation. Changes or inability to meet them require accountable amendment and communication through configured authority; no universal SLA or new messaging permission is implied.

Acceptance: a callback promise creates owned work, a conditional estimate retains conditions and an unsupported guarantee is blocked/rephrased. Owner loss or missed due time cannot disappear behind conversation closure. Resolves C01-R3-045.

### 22.46 Revision-aware messaging intent

Normalize message identity, thread, revision, reply relationships and available ordering evidence. Preserve permitted revision history and invalidate unexecuted proposals based on superseded messages. Qualified channel profiles assemble complete intent using suitable bounded grouping or explicit completion; elapsed delay alone never proves no correction is coming. Effects bind current resolved instruction, while post-dispatch changes become new governed work.

Acceptance: corrections arriving before originals, pending-message edits and split constraints cannot silently execute superseded intent. Unresolvable order yields focused clarification; no fixed delay/provider is chosen. Resolves C01-R3-046.

### 22.47 Evidence-based case closure

Case definitions distinguish waiting-for-customer/source from resolution and declare evidence/reasons: answered, customer-confirmed, verified remedy, withdrawn or administrative closure with unresolved status. Late replies preserve the original case/obligations and follow explicit reopen rules. Closing a conversation cannot abandon effects, commitments or reconciliation. Metrics separate administrative closure from verified issue resolution.

Acceptance: informational cases close under qualified policy, unresolved remedies retain honest status and late dissatisfaction reopens without resetting away prior obligations. No universal customer-acknowledgement requirement or SLA is imposed. Resolves C01-R3-047 using the common lifecycle framework in 20.50.

### 22.48 Actionable human decision inbox

Decision requests bind work, reviewer, priority rationale, due/expiry conditions, dependencies and supersession. Group related items without merging authority or hiding substantive differences. Present the actual decision, timing, alternatives and consequences. Withdraw obsolete requests with history and escalate unmet responsibility under configured policy; routine progress can remain quiet. Delivery is distinct from human acknowledgement.

Acceptance: duplicate, related-but-distinct, expired and urgent requests remain understandable and correctly actionable. Queue staleness cannot submit an expired approval. Priorities and notification frequency remain customer choices. Resolves C01-R3-048.

### 22.49 Delivered-answer correction

Version answer artifacts and tie defect reports to claims, result bindings and known consumers. Distinguish source/definition correction from interpretation/presentation error. Confirmed defects create visibly superseding corrected artifacts and impact review of saved decisions, apps and communications. Authorized notifications follow existing policy, with limits for uncontrolled exports. Completed effects use ordinary reconciliation/correction; history is not rewritten to imply the right answer was originally delivered.

Acceptance: correct a saved wrong-but-cited answer without changing source truth. Preserve original evidence, explain the error and mark known downstream impact; old decisions cannot silently acquire new original evidence. Resolves C01-R3-049.

### 22.50 Model-conditioned improvement boundaries

Classify improvement proposals as canonical meaning, customer source binding, model-facing discovery/representation or runtime behavior. Require failure-attribution evidence before selecting the repair layer. Model-specific presentation is a versioned projection over shared canonical identities/meaning. It must preserve operation semantics and pass relevant model/app regressions. Actual meaning changes require independent business evidence and specialist publication; average benchmark improvement cannot authorize reinterpretation. Record rejected hypotheses to avoid recycling failed edits.

Acceptance: remedy confusion between recognized revenue and invoiced sales through qualified presentation while retaining both rules. A candidate merging them for one model's score fails invariance or enters explicit meaning review. Paired model evaluation is separate from semantic correctness. EvoOntology is a research comparison, not an adopted publisher/control plane. Resolves C01-R3-050.


## 23. Authority, privacy and effects contracts

### 23.1 Federated principal continuity

Immutable Chausar principal IDs bind verified issuer/subject identities, tenant trust configuration and binding lifecycle. Email and names are mutable attributes. Account linking, rehire and issuer migration require authorized continuity evidence; matching addresses or unqualified subjects cannot transfer grants or approval history. Validate authentication audience and tenant membership independently from client assertions. Preserve permitted retirement provenance without inventing indefinite retention.

Acceptance: identical subjects from two issuers and recycled email addresses stay distinct, while an email rename preserves the correct subject's account. Controlled migration retains attributable history and only intended current grants. Resolves C01-R4-001.

### 23.2 Provisioned principal lifecycle

Provisioning declares creation, suspension, membership change, deletion and reactivation semantics, upstream version evidence and stale-update handling. Suspension precedence and authoritative reconciliation prevent delayed membership changes from silently restoring access. SCIM provides no universal order across independent user/group changes; incomparable evidence requires conservative reconciliation rather than invented timestamp order. A principal revocation generation invalidates dependent sessions and delegated admission within the qualified propagation bound. Reactivation reassesses current grants and paused mandates instead of reversing every suspension consequence. Historical attribution does not establish current eligibility.

Acceptance: reordered disable/group-add events and lost removals cannot retain or resurrect unintended authority. Reconciliation detects divergence, sessions cease admission within the measured bound and rehire receives only current intended authority. Resolves C01-R4-002.

### 23.3 Authenticated workload delegation

Authenticate the workload actor separately from the human or mandate it represents. A Chausar-issued delegation reference binds subject, actor, tenant, scope, parent, audience, expiry and revision. Receiving services verify actor and current authoritative delegation, including attenuation and parent revocation. Worker-supplied principal fields or recorded historical actors cannot issue authority. Maintenance privileges remain distinct from business-user representation; no token format or service mesh is selected.

Acceptance: a valid worker credential with substituted human, tenant, mandate or parent fails. An issued attenuated child works within scope and stops new admission after effective parent revocation. Historical chains remain audit evidence, not independent grants. Resolves C01-R4-003.

### 23.4 Trusted policy attributes

Each decisive policy attribute names its authoritative source, permitted issuer, scope and freshness. Verified context supplies actor and tenant; authorized work assignments establish purposes where required. Requested purpose differs from approved processing purpose. Client/model assertions cannot establish emergency status, device trust or mandate authority. Unknown/stale required attributes follow the existing fail-closed decision algebra. Retain minimal permitted evidence references rather than unnecessary environmental personal data.

Acceptance: forged purpose, emergency, trusted-device and mandate fields cannot select a more permissive policy branch. An authoritative assignment change is observed at the required admission/release boundary. No universal device telemetry or emergency scheme is imposed. Resolves C01-R4-004.

### 23.5 Executable policy obligations

Typed obligations define merge/conflict rules, enforcement points and fulfillment evidence. Admission establishes a compatible execution plan before protected processing/disclosure. Pre-release conditions such as approval or redaction must succeed before release; continuing obligations become durable owned work in the existing coordinator. Incompatible or unsupported required constraints produce denial/unavailability, not silent omission. The result records the actual fulfilled plan. Preserve distinct retention, processing-location and release restrictions instead of collapsing them to one Boolean.

Acceptance: incompatible routes/locations or a failed mandatory transform prevent release. Compatible work records merged obligations, enforcement receipts and pending post-release duties; qualification detects a generated target dropping a constraint. Resolves C01-R4-005.

### 23.6 Correlation-preserving grant algebra

Evaluate grants as complete predicates over resource, operation, purpose, audience, route, time and actor. Alternative grants may satisfy a declared control; independent mandatory controls intersect and applicable denies dominate. Never union individual fields into an unissued cross-product. Record supporting grants and all applicable obligations with deterministic redundant-grant handling. The target algebra replaces the bounded implementation's exactly-one-eligible-grant behavior only after qualification; that historical limitation remains honestly recorded.

Acceptance: payroll access plus external processing of public sales cannot authorize external processing of payroll. Redundant grants do not cause an outage, valid disjoint grants work and reference/API/SQL/projection decisions agree without losing joint constraints. Resolves C01-R4-006.

### 23.7 Approval independence

Configurable approval predicates declare roles, distinct accountable people, requester/beneficiary conflicts, delegation eligibility, ordering, quorum and veto. Verified principal continuity establishes independence; sessions, aliases and role counts do not. Bind each approval's authenticated actor and represented authority to the concrete request. Current eligibility, expiry, withdrawal and policy revision determine whether it still counts at dispatch. Agents may prepare/relay evidence but cannot manufacture independent human consent.

Acceptance: two sessions, linked accounts, two roles or two child agents of one person cannot satisfy a distinct-person policy. Two eligible independent people can, until a relevant revocation invalidates the quorum. No universal two-person requirement is imposed. Resolves C01-R4-007.

### 23.8 Transaction confirmation assurance

Action-risk profiles specify accepted channels, authentication assurance/age, anti-forgery protection and significant fields presented for confirmation. Generate the review payload from the authoritative prepared request. Context-bound single-use confirmation covers those details and expires on material change. Required step-up authentication establishes assurance but is not itself transaction approval. Recovery cannot silently downgrade the profile. Ordinary policy-authorized work need not acquire an extra confirmation ceremony.

Acceptance: forged cross-origin approval, stale sessions under the relevant profile, replay and generic login completion fail. Valid intentional confirmation binds the reviewed amount/destination/scope to the dispatched request; changed details require renewed approval where applicable. Resolves C01-R4-008.

### 23.9 Release-time revocation

Long reads, streams and asynchronous reports have bounded authority leases or equivalent release checkpoints. Pinned data/definition consistency does not pin permission forever. Revocation stops admission and further protected release within the qualified bound; handle buffered material under current policy and record delivered extent. An authority change may require interruption/restart rather than mixing fragments into a falsely complete result. Already disclosed bytes cannot be recalled merely by revocation.

Acceptance: revoke during paging, after computation before download and with buffered stream chunks. Further release stops at the declared boundary, the client sees incomplete/interrupted status and delivery evidence distinguishes controllable buffers from already disclosed content. Resolves C01-R4-009.

Protected content revisions bind a causal minimum authorization basis established through the qualified authority/publication path, covering preceding relevant access and inherited-relationship changes. Preserve or safely combine that dependency through projections, caches, derivatives and model context. Release satisfies both current-policy rules and this content-bound floor, independently of the reader session. Qualified coherent authority/content transactions or equivalent protocols can establish it; arbitrary writer timestamps and incomparable engine token numbers cannot. Without compatible evidence, wait, use a permitted authoritative route or withhold the revision. Existing revocation bounds for unchanged content remain separately qualified.

Additional acceptance: Pause authority replication within its normal bound, confirm a group removal, then add new protected report content without changing its direct ACL. Another session of the removed member cannot receive the new revision or derivative through an older unexpired decision. A compatible check denies it; an eligible member can use a qualified current route. Inspect content identity, minimum dependency, evaluated vector and released extent. No global clock, relationship-engine choice or universally immediate revocation is implied. Resolves C02-R4-001.

### 23.10 Before-and-after write authority

Authorize explicit field/relationship changes against current and proposed state. Distinguish ordinary edits from authority-affecting transitions such as owner, tenant, marking and protected relationships. A readable starting object does not permit every valid-schema destination. Generated APIs expose only qualified writable properties, and bulk changes apply the rule to each object within their declared consistency boundary. Business transition legality and actor permission remain separate checks.

Acceptance: an allowed contact edit cannot smuggle ownership, tenant or confidentiality changes. An explicitly authorized transfer succeeds with required evidence and recorded before/after authority effects; extra fields do not bypass generated API restrictions. Resolves C01-R4-010.

### 23.11 Query-use information flow

Authorize protected fields/relationships in predicates, sorting, grouping, joins and diagnostics as well as returned columns. Qualified query shapes prevent forbidden values from determining visible membership/order except through an approved release contract. Normalize sensitive integrity/existence errors and document the observable application threat boundary and residual side channels. Display masking cannot leave an unrestricted comparison oracle. This supplements the existing exact/statistical aggregate release rules and does not promise elimination of every physical timing channel.

Acceptance: threshold search, hidden ordering and uniqueness/reference probes over datasets differing only in forbidden facts cannot reveal unapproved differences. Approved aggregate releases retain their explicit rationale and limits. Resolves C01-R4-011.

### 23.12 Bound continuation state

Protect pagination state integrity and bind tenant, principal or explicit sharing capability, normalized query, data/definition cut, authority context and expiry. Later pages reapply current release authority under 23.9; changed scope or parameters require rejection or declared restart. Opaque encoding alone supplies neither authenticity nor authorization. Minimize sensitive token contents and preserve qualified ordering/completeness for legitimate continuations. Server-held and stateless implementations remain available.

Acceptance: token transfer across users/tenants, tampering and changed filters fail without revealing original scope. Revocation between pages stops prohibited disclosure, while a legitimate continuation preserves the declared traversal contract. Resolves C01-R4-012.

### 23.13 Trusted database request context

A serving transaction starts through a trusted wrapper that establishes verified actor, tenant and policy context before bounded execution. Missing context fails closed; transaction completion safely releases the pooled connection. Untrusted SQL cannot change trusted attributes, roles or privileged context-setting functions. Qualify aborted initialization, savepoints, prepared statements and pooling modes. Separate maintenance paths. Transaction-local settings can support the design but cannot secure an interface that still permits arbitrary context changes.

Acceptance: alternate tenants on one connection, interrupt setup, exercise rollback/savepoints and attempt SQL-level impersonation. No request inherits prior authority; observed SQL context matches the admitted request even through failures. Resolves C01-R4-013.

### 23.14 Authority administration

Classify authority-bearing definitions, grants, memberships and relationships separately from ordinary business data. Administration capabilities define a permitted delegation envelope and govern privilege expansion under the current meta-policy. Ontology publication alone does not grant security administration. A policy change cannot retroactively authorize its own unreviewed approval. Customer-configured bootstrap and emergency recovery have explicit roots of trust, bounded access and audit; powerful administrators are permitted where deliberately authorized.

Acceptance: specialist publication or ordinary object editing cannot create a self-grant without the required administrative authority. Legitimate changes identify their governing meta-policy and approval, including concurrent updates and recovery. Resolves C01-R4-014.

### 23.15 Capability transport and use

Use the actor/delegation bindings in 23.3 and require receivers to validate intended audience, tenant, scope, validity and use constraints. Downstream calls obtain qualified exchanged/brokered credentials rather than passing a token to a different audience. Risk-qualified sender/use binding and authoritative consumption prevent copying or replay of single-use capabilities. Reusable read capabilities remain explicitly reusable within their scope and lifetime. No signature-valid token is automatically valid for every service.

Acceptance: wrong-service/provider presentation and unauthorized copying fail. Single-use confirmation cannot authorize a second invocation, while legitimate exchanged capabilities retain current actor attribution and attenuation. No universal token format or algorithm is selected. Resolves C01-R4-015.

### 23.16 Derivative retention clocks

Retention obligations retain triggering event, absolute deadline, purpose and derivation rules. Summarizing, embedding, accessing or copying protected inputs does not silently restart their clocks. Mixed artifacts use an enforceable qualified strategy such as earliest applicable expiry, separable content or recomputation from remaining permitted evidence. A different retention basis/declassification needs independent authorized evidence. Markings alone cannot represent every time/purpose constraint, and inseparable content limits remain explicit.

Acceptance: chained last-minute summaries cannot extend protected content's life. Mixed-deadline artifacts stop serving expired content, while justified recomputation preserves unrelated permitted material. No customer retention duration or legal conclusion is invented. Resolves C01-R4-016.

### 23.17 Erasure without resurrection

Record authorized erasure scope before deletion fan-out and enforce its generation/suppression rule on later publication and retrieval. Delayed jobs, replayed imports and derivatives cannot restore erased content. Enumerate known stores and track verified deletion, restricted pending expiry, failure and external uncertainty separately. Preserve only permitted tombstones and require an explicit allowed new basis before reacquisition. Existing recovery fences reuse the same obligation authority.

Acceptance: pause parser/embedding work, erase the input, then resume and replay it. Protected content stays unavailable. A failed target leaves owned incomplete work rather than a global success claim, and later reacquisition cannot occur solely because an old key reappears. Resolves C01-R4-017.

### 23.18 Preservation and use restrictions

Versioned holds declare authority, scope, reason, permitted custodians and release conditions. A configured precedence rule or explicit unresolved-policy state resolves conflicts with deletion/expiry; the platform does not infer legal priority. Restricted custody can preserve evidence while ordinary reading/model processing remains denied. Serialize the irreversible deletion decision against current applicable holds. Hold release re-evaluates overdue obligations without resetting their clocks. Cross-store failures stay visible.

Acceptance: raced hold/deletion, access revocation during preservation and hold release after expiry follow the resolved policy. Ordinary retrieval never gains permission merely because evidence must be kept; unresolved precedence has an accountable owner. Resolves C01-R4-018.

### 23.19 Erasable content and durable history

Prefer immutable identities/permitted metadata with references to separately governed payloads. Inventory unavoidable embedded content in revisions, workflow history, receipts and backups. Qualify each class's purge, restricted custody or encrypted-content/key lifecycle strategy rather than claiming all append-only data is exempt or all encryption is erasure. Retain allowed operation identity/tombstones without forbidden payloads. Historical explanation and replay claims shrink honestly when evidence expires.

Acceptance: plant sensitive content in objects, action inputs and work history, then execute the configured erasure and inspect declared stores/replay paths. Allowed operation identity survives, forbidden content is removed or demonstrably inaccessible under the qualified method, and backup limitations remain visible. Resolves C01-R4-019.

### 23.20 Digest and identifier privacy

Treat hashes, pseudonymous IDs and lineage metadata as potentially sensitive. Distinguish integrity verification from privacy protection: low-entropy plaintext hashes can be guessed, and deterministic keyed outputs still expose equality. Where pseudonyms are appropriate, use established primitives, tenant/purpose separation, controlled access and qualified key lifecycle. Define necessary correlation and rotation/deletion effects on retained lookupability. A digest is not automatically anonymous or safe fleet metadata.

Acceptance: dictionary attacks and cross-tenant/purpose equality checks expose no unnecessary public linkage. Inspect support/export surfaces while preserving legitimate internal deduplication within its authorized boundary; record residual linkability and key-handling assumptions. Resolves C01-R4-020.

### 23.21 Statistical privacy accounting

Statistical products declare privacy unit/adjacency, post-transformation contribution bounds, sensitivity, mechanism, accountant and composition domain. Reserve privacy loss atomically before first disclosure and bind output to a durable release identity. Replaying that same released output differs from independently sampling again. Uncertain delivery cannot automatically refund privacy loss, and overlapping datasets/populations use the appropriate shared accounting. Unsupported joins or bounds block the claimed guarantee. Exact releases remain exact and require their separate policy; statistical privacy does not protect a simultaneous exact disclosure.

Acceptance: concurrent releases, repeated-subject joins and lost-response retries preserve bounds and budget. New noise is accounted for; previously published output retains its identity. Parameters and utility require qualification, with no universal epsilon selected. Resolves C01-R4-021.

### 23.22 Exact-release threat boundaries

Each exact aggregate surface declares protected populations, linked-principal/mandate accounting, permitted query families, collusion assumptions and external-knowledge limits. Conservative policies constrain releases when relevant combined knowledge cannot be tracked. Sessions or renamed roles cannot reset the same accountable actor's history. Do not claim that arbitrary overlapping exact answers can preserve every hidden individual value. Prior external disclosures remain irreversible; no silent noise or surveillance of all human collaboration is implied.

Acceptance: complementary queries across linked identities, mandates and controlled collaborators are blocked/constrained within the declared protection model. Reports expose unprotected cases and cannot describe revocation as undoing past disclosure. Resolves C01-R4-022.

### 23.23 Control-dependent markings

Contributing information includes predicates, branch conditions, joins, negative tests and membership decisions as well as copied values. Propagate restrictions to observable existence, metadata, tasks and notifications when these depend on protected evidence. Where precise dependency tracking is unavailable, conservatively mark the relevant scope or require qualified release/declassification. Negative claims inherit their search scope's restrictions. Constant output text can still disclose a secret through whether it is emitted.

Acceptance: a public constant message conditioned on a sensitive flag, absence test or branch remains restricted or explicitly authorized for release. Removing copied sensitive fields cannot remove its control dependency. No universal language-level proof is claimed. Resolves C01-R4-023.

### 23.24 Purpose-preserving reuse

Applicable processing-purpose obligations follow evidence into context and derived results. Each consuming task establishes its current authorized purpose using 23.4 and checks reuse independently of ordinary read access. A material objective-purpose change triggers a new processing decision and, where needed, a rebuilt permitted context. Ownership, freshness or the model's belief that reuse is useful cannot waive the constraint. Explicit authorized compatible reuse remains available and records its decision.

Acceptance: the same user's permitted emergency-contact summary cannot silently become sales-outreach input. A separately authorized use works; cache reuse and objective amendments cannot bypass purpose eligibility. No universal consent dialog or legal basis is invented. Resolves C01-R4-024.

### 23.25 Provider-side artifact custody

Persistent model-provider files, stores, caches and job inputs are governed artifacts with remote identity, tenant/purpose, creation authority, deadlines and qualified cleanup capability. Track resource reuse and descendants. Cancellation or local deletion does not close remote cleanup obligations. Distinguish requested, acknowledged, verified-to-available-extent and unsupported deletion/expiry. Lost creation responses require reconciliation. Routes lacking required guarantees are ineligible for the affected data class; no request flag or HTTP success proves complete provider erasure.

Acceptance: lose a remote creation acknowledgement, cancel and rotate credentials. Reconcile the resource and preserve cleanup ownership; reject cross-purpose/tenant reuse and report provider limits. Private, external and mixed processing remain supported when qualified. Resolves C01-R4-025.

### 23.26 Source-enforced mutation conditions

Action profiles distinguish atomic conditional mutation, source reservations/transactions and weaker read-then-write checks. Where supported, pass the expected version or predicate into the mutation itself. A failed condition creates a conflict and new preparation, not a blind overwrite retry. Weaker routes disclose residual races and cannot promise stronger invariants without a qualified source protocol. Internal locks and UI readback do not establish external atomicity; computer actions remain first-class within their qualified guarantees.

Acceptance: alter the source after final read and before dispatch. A strong profile rejects stale mutation at the source. A weaker profile exposes its limitation and restricts unsupported invariants without claiming equivalent concurrency control. Resolves C01-R4-026.

Actions qualify a versioned canonical-to-source write mapping, separate from source ingestion and language interpretation. Declare source command/enum/amount meaning, writable and preserved fields, required original-source evidence and unrepresentable cases. Preparation binds that transformation and consequential source meaning. Never invert a lossy read mapping by assumption. Use qualified partial mutation or preserve distinctions from the exact source base; missing choices require clarification or rejection. Readback checks source postconditions before canonical normalization can conceal an incorrect effect.

Additional acceptance: Two distinct source hold codes map to canonical blocked. An unrelated update preserves each original hold; an ambiguous transition requires an authored choice. A wrong dispatched code fails outcome qualification even if it maps back to blocked. API and computer routes both qualify this boundary. Resolves C02-R1-006.

### 23.27 Business-intent admission

Domain action definitions declare intent/correlation scope and applicable uniqueness rules. Resolve the authoritative operation identity before distributed attempts, linking duplicate requests only when they represent the same intended business occurrence. Detect competing active intents even when transport IDs differ. Deliberate repeats require distinct authorized occurrences; equal payloads alone do not prove duplication. Use existing operation authority, not independent deduplication decisions in each agent/channel.

Acceptance: concurrent requests for one remedy with different transport IDs converge to one operation. Same-valued payments for distinct obligations both remain possible. Retain the business correlation evidence and avoid silently issuing fresh keys to bypass uncertain outcomes. Resolves C01-R4-027.

### 23.28 Provider retry horizons

Qualified action profiles record idempotency namespace, retention horizon, request-equivalence behavior, first-dispatch evidence and account/endpoint binding. Automatic retry requires a still-valid deduplication guarantee or independent evidence of safe continuation. Expired or changed provider scope leaves OutcomeUnknown or a qualified lookup/manual resolution path; it cannot erase Chausar's original operation identity. SDK retries obey the same bound. No provider-specific retention period is generalized.

Acceptance: expire provider keys, switch account scope and lose the first response. No blind retry creates a second effect; in-window retry converges to the original result and later reconciliation explains its evidence. Resolves C01-R4-028.

### 23.29 Item-level bulk effects

Bulk intent freezes a manifest of item identities, requests, approvals and parent aggregation rules. Track per-item attempts and confirmed, failed or uncertain outcomes with correlated receipts. Declare partial-execution policy and actual source atomicity. Retry/compensate only justified subsets; confirmed items do not become new operations because the batch timed out. Parent completion exposes residual obligations under 22.1, and recovery cannot expand the approved population.

Acceptance: mixed success, item rejection, truncation and duplicate submissions preserve known outcomes and visibly uncertain items without blind full-batch replay. Where available evidence cannot establish one effect, report uncertainty rather than claiming exactly-once external execution. Resolves C01-R4-029.

### 23.30 Atomic local effect admission

The authoritative local transaction validates expected state, records business intent/operation identity, applies permitted local state changes and inserts related outbox work atomically. Local approved/intended state remains distinct from confirmed external state. Consumers handle repeated delivery and consult authoritative operation state; external calls remain outside the database transaction and use normal reconciliation. Temporal continues to coordinate the admitted work, with PostgreSQL authority and no new business scheduler.

Acceptance: crash/rollback at each local write boundary. Every committed approval has one logical durable continuation; rolled-back approval dispatches none. Duplicate delivery may produce attempts but cannot create a fresh business operation or justify duplicate external effects. Resolves C01-R4-030.

### 23.31 Verified workflow admission

Allocate stable workflow identity from authoritative work before startup, binding tenant, type, input digest and generation. Reconcile uncertain starts and already-existing responses against qualified execution metadata/state before acknowledging outbox admission. Existence alone cannot establish the intended continuation. Separate pending admission, acceptance and terminal work. If coordinator retention no longer supplies needed evidence, use the authoritative lifecycle's explicit recovery route rather than blind ID reuse.

Acceptance: lost startup acknowledgements and duplicate outbox delivery converge to one intended workflow. A pre-existing ID with incompatible binding creates a visible conflict and cannot consume the event as success. No additional scheduler or indefinite history is required. Resolves C01-R4-031.

### 23.32 Enforceable effect fences

Each action profile identifies its last enforceable dispatch boundary. A qualified broker or source mechanism checks current operation/generation and prevents workers from bypassing it with unrestricted credentials. Local lease expiry alone cannot stop a paused process or recall an already-transmitted request. Classify in-flight nonrevocable calls explicitly, retain uncertainty and block conflicting replacement dispatch pending reconciliation. Native idempotency and source conditions may support the guarantee where qualified.

Acceptance: pause a worker before transmission, transfer ownership and resume the stale worker. The controlled boundary rejects it, or the weaker profile contains the uncertain attempt without a conflicting replacement. Observe actual source effects as well as ledger records. Resolves C01-R4-032.

### 23.33 Asynchronous effect finality

Profiles map transport receipt, admitted/pending work, applied effect, rejection, reversal and uncertainty to distinct states. Every receipt states what it proves and identifies the qualified finality/readback method. Durable observation follows asynchronous work under a bounded policy with owned unresolved state. Downstream consumers requiring applied state cannot treat a successful transport response or job ID as that state. Later reversals retain the earlier applied evidence where applicable.

Acceptance: initial acceptance followed by rejection, eventual application or missing final status produces three honest outcomes. Only qualified application evidence confirms the effect; calculation and customer promises cannot rely on acceptance alone. No universal status-code interpretation is imposed. Resolves C01-R4-033.

### 23.34 Reconciliation proof

Profiles declare authoritative observation source, correlation keys, uniqueness, visibility/finality bounds and criteria for negative evidence. Distinguish confirmed applied, confirmed not applied, conflicting and inconclusive. Weak matches or an empty lagging index remain unresolved. Human adjudication records inspected evidence, rationale, authority and residual risk; it cannot rewrite observations. A retry that assumes absence needs qualified absence proof, while a still-valid idempotent retry follows 23.28 without assuming absence.

Acceptance: delayed indexing, same-valued candidates and lookup outage cannot become unsupported success/failure. Later authoritative evidence justifies the transition. Manual resolution preserves the original uncertainty and any residual exposure. Resolves C01-R4-034.

### 23.35 Requested and effective cancellation

Separate cancellation request, local execution quiescence, source cancellation and compensation outcomes. Record crossed dispatch boundaries and in-flight work. A completed effect can coexist with a cancelled objective; the user-facing status says what stopped, what happened and what remains unknown. Provider cancellation or reversal is separately governed where required. After cancellation, ordinary retries stop while narrowly authorized reconciliation can continue without reviving the original objective.

Acceptance: cancellation before dispatch, during transmission, during source processing and after confirmation yields distinct truthful states. Acknowledged workflow cancellation cannot label an uncertain source effect as never executed or imply reversal. Resolves C01-R4-035.

### 23.36 Current-state compensation

Remedies bind original effect evidence, desired restorative outcome, affected fields/resources, prerequisites and current-state conditions. A dependency graph orders dependent remedies; independent ones may run in parallel when qualified. Do not overwrite intervening legitimate changes with historical snapshots. Compensation uses its own stable operation, authority and reconciliation, preserving partial failures as owned obligations. A successful remedy does not erase confirmation of the original effect.

Acceptance: intervening human edits survive, inventory/shipment remedies respect prerequisites and a failed remedy stays visible. Retry reuses the same remedy identity. Domain authors select feasible remedies without assuming universal reversibility or automatic refund/cancellation permission. Resolves C01-R4-036.

### 23.37 Business validity windows

Prepared actions carry applicable not-before, expiry, business-calendar and latest-safe dispatch/completion conditions. Check them with a qualified authoritative clock at admission and dispatch, including retries and recovery. Critical clock uncertainty follows an explicit conservative policy. Expired unsubmitted intent requires new preparation; already-dispatched work still needs reconciliation. Technical workflow timeout, authorization lifetime and commercial validity are distinct.

Acceptance: an outage pushes an approved action past its cutoff and prevents new dispatch despite unchanged parameters/permissions. A previously transmitted operation retains its real uncertain/applied state. Calendar/timezone interpretation follows published meaning; no universal approval duration is invented. Resolves C01-R4-037.

### 23.38 Replay-safe workflow evolution

Bind live workflows to a qualified code/build routing strategy. Keep nondeterministic I/O in recorded activities or supported deterministic mechanisms. Release qualification replays representative retained histories, including review, cancellation and compensation paths. Migration/continue-as-new states compatibility and pending-obligation transfer. Retire older workers after safe completion or qualified migration, without preserving compatibility indefinitely. Business-definition pins do not substitute for coordinator-code replay compatibility.

Acceptance: inserted incompatible commands and nondeterministic branches fail qualification against old histories. Approved migration preserves operation identities and unresolved obligations without reissuing completed effects. Use supported Temporal mechanisms; no second coordinator is introduced. Resolves C01-R4-038.

### 23.39 Applied workflow control decisions

Authoritative control admission records message identity, work generation, expected state/revision, authenticated actor and payload binding. Deliver idempotently using supported coordinator mechanisms and distinguish accepted, applied, rejected and superseded. Handlers validate authoritative decision references, not arbitrary signal claims. Preserve pending decisions/deduplication across run transitions. Display completed business transition only from applied evidence; transport acknowledgement is insufficient. Reuse existing authority records where they satisfy this contract.

Acceptance: lost response, duplicate approval, superseded preparation and continue-as-new with active handlers apply one valid decision to its intended state. Stale controls reject visibly and signal acceptance cannot impersonate final approval/cancellation. Resolves C01-R4-039.

### 23.40 Cross-work feedback control

Carry causal origin/operation lineage through effects and reacquired observations where supported. Trigger profiles define self-originated updates, semantic no-op equivalence, permitted propagation and cycle handling. Detect recurring causal patterns across distinct successful tasks and suspend affected automation with an accountable explanation while preserving source ingestion. Without source correlation, qualify convergence or conservative trigger rules and disclose limits. Intentional iterative work remains explicitly bounded rather than spawning accidental independent recursion.

Acceptance: opposing cross-system normalizers and self-fed channel messages converge or enter an owned stop state before unbounded effects. Legitimate external changes still trigger, and generic same-value suppression cannot erase meaningful events. No universal depth limit is imposed. Resolves C01-R4-040.

### 23.41 Effective network destinations

Qualified egress enforcement checks scheme, host, port, resolved destination, network class and credential audience at the effective connection boundary. Revalidate redirects/subresources and prevent unauthorized cross-origin credential forwarding. Protected internal/control-plane endpoints and alternate address/protocol forms need explicit grants. Browser, parser, tool and analytical traffic cannot bypass the declared boundary. Retain minimal safe decision metadata. Public research and authorized private source endpoints remain supported.

Acceptance: controlled redirects, changed DNS, private-address responses and cross-origin header forwarding reach only permitted destinations without leaking credentials. A hostname allowlist alone cannot certify this behavior; policy failures are visible. Resolves C01-R4-041.

### 23.42 Brokered secret use

Prefer opaque credential references and trusted connector/session injection only at the permitted destination. Ordinary agents receive results rather than plaintext secrets. Any unavoidable exposure needs an explicitly qualified workload profile; general prompts, receipts, URLs, histories and diagnostics exclude secrets by construction. Version credential bindings and verify source-account continuity during rotation. Authorized reconciliation may retain narrowly scoped access without restoring revoked execution privileges or silently switching source identity.

Acceptance: canary credentials stay out of declared agent-visible/log/history surfaces. Rotation during OutcomeUnknown preserves original account binding, blocks new unauthorized use and leaves unresolved cleanup/reconciliation honestly owned. No vault vendor or legacy-secret permission is implied. Resolves C01-R4-042.

### 23.43 Executable provenance admission

Artifact admission checks expected authorized signer/builder, source revision, resolved dependencies, build parameters, artifact digest and evaluation/capability manifest. Isolate dependency installation/builds from production secrets and authority. Check execution eligibility, including revoked trust and offline-policy freshness. Signing proves neither authorized origin nor harmless dependencies, and reproducibility can repeat malicious behavior. Prefer established provenance/build tooling without selecting a compliance level or vendor.

Acceptance: valid signatures from unapproved builders, unexpected build parameters and undeclared dependency installation effects fail their relevant gate. The exact approved artifact runs only with reviewed capabilities, and revoked trust changes eligibility under the qualified profile. Resolves C01-R4-043.

### 23.44 Browser trust separation

Distinguish inert evidence, active generated apps and core workspace UI. Qualify sanitization/content policies for inert content and isolated origins/sandboxed execution for active apps. Narrow parent-child bridges validate origin, source window, schema and capability. Untrusted origins do not inherit core cookies/secrets. Forms, links, downloads, popups and automatic resource loads follow explicit policy. Server sandboxing does not by itself protect the user's browser.

Acceptance: malicious HTML, injected app scripts, forged frame messages and sensitive remote-resource parameters cannot access core session authority or ungranted operations. Valid rich app workflows continue through the qualified bridge. No frontend framework or all-content-inert restriction is imposed. Resolves C01-R4-044.

### 23.45 Server-initiated MCP work

Treat negotiated reverse requests such as sampling/elicitation as proposed work tied to the originating invocation and server identity. Chausar independently checks purpose, context, route, budget and user-interaction authority. Technical capability negotiation grants no customer permission. Reject unsolicited/out-of-scope requests; server instructions cannot widen roots, promote authority or select forbidden context. Required secret entry uses an approved protected route rather than generic model-visible forms.

Acceptance: cross-server context requests, unauthorized routes, unexpected secret elicitation and requests without a permitted initiating relationship fail or enter the appropriate user-controlled flow. Legitimate bounded sampling records its own disclosure/cost decision. No protocol version or optional capability is mandated. Resolves C01-R4-045.

### 23.46 Qualified environment reuse

Execution environments move through assigned, draining, reset, verified-clean or quarantined states. Inventory residual files, processes, mounts, network/browser sessions, clipboard, credentials, caches and snapshots. Reuse requires a qualified clean baseline or explicit same-context continuation. Unknown cleanup quarantines the environment. Snapshot rehydration checks original context and current retention/secrets. On employee computers, restrict cleanup to authorized workload-owned state and use qualified isolation instead of assuming permission to reset the person's machine.

Acceptance: residual-channel canaries cannot be recovered by the next narrower workload; interrupted cleanup prevents pool admission. Declared same-context continuation preserves only authorized state, and unsupported employee-computer isolation remains visible. Efficient pooling remains allowed when qualified. Resolves C01-R4-046.

### 23.47 Mandatory audit durability

Separate policy-required security evidence from best-effort telemetry. Admit required minimal evidence with the authoritative transition or before protected release at its qualified boundary; export asynchronously with durable receipts. Failure to admit mandatory evidence follows explicit fail-closed/unavailable policy. Protect origin, integrity/order and inspection, recording permitted corrections without rewriting history. Apply secret exclusion and content retention/erasure. Define the threat model rather than promising invulnerability to an operator controlling every key.

Acceptance: telemetry outage and crash cannot erase mandatory transition evidence. Qualified tamper/omission tests produce detection; nonmandatory metrics can degrade without blocking unrelated work. No permanent raw logging or WORM vendor is required. Resolves C01-R4-047.

### 23.48 Encryption key lifecycle

Define custody, tenant/content/purpose scope, version references, rotation, compromise response and recovery dependencies using established key-management mechanisms. Qualify which operators can cause decryption and which customer controls actually constrain them. Align key granularity with holds/erasure before claiming cryptographic deletion. Distinguish lost keys, unavailable key services and revoked permission. Retained recovery capability remains subject to the applicable content policy and deployment profile.

Acceptance: rotate during writes, recover an older backup, revoke one scope and interrupt key access. Permitted recovery succeeds or reports precise limits; tenant keys cannot decrypt other tenants and scoped erasure cannot destroy unrelated held records. No specific KMS/HSM or absolute operator-impossibility claim is chosen. Resolves C01-R4-048.

### 23.49 Customer identity assurance

Separate contact metadata, channel possession, authenticated person, represented organization and transaction authority. Disclosure/action profiles specify sufficient assurance and qualified step-up tied to the case/request. A changed contact detail cannot unquestioningly verify itself. Shared accounts and customer delegates have explicit scope. Failed verification preserves safe public assistance and handoff while avoiding sensitive account-existence disclosure. Enterprise federation identity and confirmation rules remain separate supporting contracts.

Acceptance: spoofed/reassigned identifiers, shared phones, known invoice details and authenticated users lacking financial authority cannot gain sensitive powers. Valid step-up binds and expires correctly while harmless service remains available. No universal caller login, biometric product or formal certification is asserted. Resolves C01-R4-049.

### 23.50 Destination-bound information release

Prepared outbound release binds artifact/content revision, classification, destination identity, resolved audience or approved dynamic-audience rule, channel and expiry. Revalidate material audience changes at dispatch. Required revocable access uses a qualified recipient-bound method; bearer links and raw attachments explicitly carry weaker controls. Separate delivery from reading/comprehension. Retraction stops only future controllable access and cannot erase already received copies. Ordinary read permission is not permission to send bytes to any destination.

Acceptance: altered recipients, changed group membership and forwarded links respect the approved audience rule. Revocation after download reports irreversible prior disclosure honestly. Authorized sharing still completes with artifact/recipient evidence; no blanket attachment prohibition or new messaging authorization follows. Resolves C01-R4-050.


## 24. Production and integrated delivery contracts

### 24.1 User-journey reliability

Material journeys and deployment profiles declare usable completion, latency, freshness and durability indicators as applicable. Define eligible events, good outcomes, exclusions, observation boundary and missing-telemetry uncertainty before measuring. Distinguish valid policy denial from unavailable permitted work without removing inconvenient observations. Named owners apply an explicit operating response to exhausted reliability allowances, such as pausing ordinary rollout while continuing necessary repair. Numerical objectives and commercial promises require measured profile-specific decisions.

Acceptance: HTTP success with unusable results, pre-API outage and legitimate denials receive their declared treatment in independently reproducible indicators. Controlled budget exhaustion triggers the stated response. No arbitrary target or scope reduction is selected. Resolves C01-R5-001.

### 24.2 Failure domains and one writer

Each cell profile declares dependency topology and tolerated host, zone, storage, network and control-service failures. Qualify promotion eligibility, old-primary exclusion, client rerouting and rejoin through established infrastructure. Keep one admitted authoritative writer for each customer history. If prior-writer exclusion cannot be established, follow a safety-preserving unavailable/recovery state rather than accept divergent authorities. Include identity, coordinator persistence and storage dependencies; several replicas sharing one failure domain do not establish independent resilience.

Acceptance: host loss, applicable zone loss, partition and rejoin produce the claimed availability while preventing concurrent authoritative writes. Rejoining nodes cannot overwrite selected history. No universal cloud, replica count or new consensus protocol is imposed. Resolves C01-R5-002.

### 24.3 Complete recovery sets

A recovery catalog binds backups, usable cuts, log/timeline continuity, object versions, configuration, compatible executables and authorized key/credential recovery references. Validate dependency closure before declaring a set recoverable. Profile-specific recovery-point/time objectives state owners, measurement scope and source replay limits. Drill a fresh environment without undocumented dependence on the lost host, measuring permitted journey restoration and actual recovered data boundaries. Retention can limit recoverability and must remain explicit.

Acceptance: missing log segments, objects, configuration or executables invalidate readiness or identify the exact prerequisite. A complete restore reaches declared usable journeys with measured elapsed time, not merely running database processes. Resolves C01-R5-003.

### 24.4 Independently protected recovery copies

The profile's recovery threat model identifies copies that survive ordinary live-cell destructive credentials and common administrative failure. Qualify separate administrative domains, protected retention or offline custody as appropriate, including keys and authorized deletion. Monitor changes to recovery protection. Drills assume the original administration environment is unavailable or untrusted. Legitimate erasure/expiry follows a reviewed recovery-copy policy; protection cannot silently become indefinite forbidden retention.

Acceptance: in an isolated drill, the simulated live-cell identity cannot destroy the declared surviving recovery set. Separately authorized recovery works, and legitimate scoped expiry does not weaken unrelated protected copies. No storage vendor or universal retention duration is selected. Resolves C01-R5-004.

### 24.5 Discoverable post-restore effects

Effectful profiles need a recoverable minimal dispatch/intent witness or qualified provider inventory sufficient to enumerate possibly applied effects absent from the restored ledger. Bind durability, retention and privacy to the claimed recovery window. Compare surviving evidence with restored authority before reopening dispatch. If enumeration cannot be established, retain a scoped uncertainty fence and qualified source/manual audit. A missing row in an old backup never proves no external effect occurred.

Acceptance: apply an operation after every chosen local restore cut, then restore without its row. Recover its identity from qualified surviving evidence or refuse to certify that effect domain safe. Existing infrastructure may supply the witness; no second business authority or universal remote journal is mandated. Resolves C01-R5-005.

### 24.6 Acknowledged write durability

Transaction categories and deployment profiles state what a success acknowledgement promises under immediate failure, including required durable copies and promotion eligibility. Do not silently weaken that promise when replicas fail. A deliberately weaker recovery point identifies affected writes, lost-write detection and user-visible reconciliation. Revocations and effect-intent records require compatible evidence recovery. Measure commit latency and availability together with durability; a connected asynchronous replica alone proves neither zero loss nor safe promotion.

Acceptance: acknowledge controlled revocation, approval and ordinary edits, then lose the primary before replica progress. Preserve promised-durable writes or enter the explicitly qualified lost-write recovery state. No universal synchronous configuration or zero-loss SLA is invented. Resolves C01-R5-006.

### 24.7 Safe restored-cell identity

Separate customer identity, current authoritative cell incarnation and environment role. Every restore/clone starts nonserving and noneffectful under independently enforced credential/network admission, even if the copied database says its fence is open. Production activation requires explicit ownership transfer, current policy recovery and endpoint validation. Drill/forensic copies have purpose-limited inspection and cannot automatically join production queues, schedules or source accounts. Original operation IDs remain evidence rather than executable authority in a clone.

Acceptance: restore two copies while production runs. Neither can contact production effects or consume production work; authorized promotion activates only the selected incarnation. Useful drills and relocation remain supported. Resolves C01-R5-007.

### 24.8 Logical corruption recovery

Runbooks distinguish infrastructure loss, physical corruption and wrong committed business meaning. Locate affected revisions using lineage and independent checks, establish a trustworthy basis and account for later unaffected work. Choose a qualified scoped correction or restore path; restoring an older whole cell requires reconciling later permitted inputs, effects, revocations and erasure. Validate representative independent business answers as well as bytes before releasing the relevant fence.

Acceptance: a validly committed wrong-ownership migration followed by legitimate work is detected and corrected/recovered without silently discarding later obligations or repeating effects. Storage checksums alone cannot pass. Recovery owners choose from evidenced options, with data loss and retention limits visible. Resolves C01-R5-008.

### 24.9 Online projection generations

Build an isolated projection generation from a pinned authoritative cut and definition/policy artifacts while capturing the complete relevant change suffix. Apply deletes/corrections and current-access constraints, then validate equivalence and atomically switch the serving pointer only after catch-up/readiness. Failed or partial generations never serve. Retire old generations after qualified reader/evidence needs end; old readers still obey current release authority. Reconstruction cannot replay business effects.

Acceptance: concurrent deletion, correction, policy change and pre-cutover crash expose a complete permitted old/new generation or explicit unavailability. Compare the new generation with authority at its declared cut and verify suffix continuity. No new coordinator or indefinite old-index retention is required. Resolves C01-R5-009.

### 24.10 Independent projection verification

Use periodic/risk-triggered anti-entropy checks against authoritative cuts, definitions, policies and manifests, independently of the invalidation path being assessed. Qualify sampled or complete recomputation, dependency coverage and partition reconciliation for the stated assurance. Mismatch withdraws affected readiness and creates evidence-preserving repair/rebuild work. Report verification coverage and age; sampling cannot establish universal correctness. Reusing the authoritative evaluator is suitable where the seeded fault path remains independent.

Acceptance: suppressed impacts, omitted dependency edges and falsely advanced checkpoints are detected within declared coverage/bounds and cannot remain misleadingly ready. Repairs converge through existing mechanisms. Cadence and cost limits require measurement rather than a universal full-scan schedule. Resolves C01-R5-010.

### 24.11 Observed fleet state

Fleet records distinguish desired, last-applied and independently observed component/configuration identities, with observation time and trust. Missing observations become unknown; partial installation remains partial. Drift affecting qualified capabilities restricts the affected use or rollout and opens owned reconciliation. Collect only permitted operational metadata. Emergency local repairs must be evaluated before any controller overwrites them with an older desired state.

Acceptance: manually change a running image or setting, stop its observer and interrupt an installation. The fleet separately reports drift, unknown and partial states instead of presenting the desired version as observed health. Resolves C01-R5-011.

### 24.12 Cell commissioning and resource binding

Each commissioning record binds customer, environment, cell incarnation, deployment profile and expected infrastructure identities, including authority store and permitted endpoints. Validate observed account/resource identity against independently supplied expectations before intake or effects. Uncommissioned cells cannot serve customer work. Setup is resumable and records resources already created; retries cannot bind a second customer or silently duplicate resources.

Acceptance: swap database/storage endpoints, copy an environment identifier and present valid credentials for the wrong cloud account. Commissioning rejects each mismatch before customer data moves; a correct resumed setup activates exactly the intended cell. Inner application authorization does not substitute for this outer binding. Resolves C01-R5-012.

### 24.13 Management-plane outage behavior

Each profile declares which local capabilities survive loss of fleet management and which need fresh management authorization. Map those dependencies, including locally available configuration/artifacts, without weakening current business policy. Continue permitted local reconciliation and evidence recording. Fleet commands bind the current cell incarnation and expected configuration revision. On reconnect, reconcile observed local changes before applying queued management commands.

Acceptance: disconnect management during reads, workflows and rollout, then perform an authorized local repair. Each capability follows its declared outage behavior, and stale queued commands cannot reverse the repair. No unmeasured offline grace period or fleet access to customer content is implied. Resolves C01-R5-013.

### 24.14 Offline dependency closure

Disconnected profiles carry a qualified manifest of direct and transitive dependencies needed for installation, runtime tasks, updates, diagnosis and recovery. Include lazy model/tokenizer/browser/parser assets, verification material, permitted distribution rights and documented local routes. Explicitly declare optional unavailable capabilities. Qualification uses a clean environment and empty caches with external resolution denied; no silent cloud fallback can rescue a claimed offline pass. Trust expiry and replacement have an offline-capable procedure.

Acceptance: remove cached assets, deny egress, install and restore the profile, then exercise its claimed capabilities. Every dependency resolves through its permitted local route or the qualification fails visibly. This does not require bundling every model. Resolves C01-R5-014.

### 24.15 Representative rollout evidence

A rollout evidence manifest identifies changed paths, deployment profiles, configurations, workload classes and delayed outcomes exercised, alongside untested coverage. Promotion evidence must apply to the next population. Evaluate useful journey outcomes over sufficient events and relevant business cycles; elapsed time and process health alone cannot establish this. Use qualified fixtures or governed shadow observations for rare paths without duplicating external effects or exposing content.

Acceptance: a healthy canary with no traffic through the changed path, or only a different deployment profile, cannot qualify the next stage. Obtain applicable evidence or record an explicit scope exclusion. Evidence quantity and observation windows are justified per risk, not invented universally. Resolves C01-R5-015.

### 24.16 Aggregate fleet change exposure

Fleet admission accounts for all active rollouts and maintenance across affected cells, shared dependencies and failure domains. Apply an explicit aggregate exposure policy and identify incompatible simultaneous changes. Serialize conflicts or qualify the joint configuration. Emergency repairs still declare exposure and authority. Reserve affected exposure until observed stabilization or an explicit failed-change disposition; installer completion alone does not release it. New failures pause relevant pending promotions.

Acceptance: independently small rollouts whose union exceeds the qualified exposure bound, or whose changes create an unqualified same-cell combination, cannot proceed independently. A delayed failure after installation still restricts further promotion. This is deployment admission, not another durable business coordinator. Resolves C01-R5-016.

### 24.17 Effective runtime configuration

Define typed configuration with explicit precedence, scope, defaults, validation and secret references. Derive a safe identity for the effective running configuration and include it in qualification and incident evidence. Classify behavior-changing settings for applicable checks, staged activation and reversal or forward repair. Reject unknown/conflicting required settings instead of silently falling back. Emergency overrides have authority and expiry or incorporation into the desired configuration. Secret identity uses safe broker references, not guessable hashes of low-entropy values.

Acceptance: changing a consequential flag without changing code still requires its qualified change path. Conflicting or missing settings fail visibly, and incident evidence reconstructs permitted effective configuration or states the privacy limit. Resolves C01-R5-017.

### 24.18 Live authority-store migration

Every authoritative database migration declares phases, reader/writer compatibility, backfill ordering and race protection, restart points and cutover checks. Protect concurrent updates/deletes through version conditions or a qualified write pause and change handoff. Bound lock waiting and resource use with preflight and abort criteria. Mark irreversible boundaries and the forward-repair path. Retire temporary transition code when the transition completes; permanent dual paths are not the default.

Acceptance: race live edits and deletions against backfill, interrupt/retry phases and hold a blocking transaction. Preserve committed meaning, avoid resurrection and respect the lock budget. Recovery works on both sides of the irreversible boundary. Zero downtime is claimed only where demonstrated. Resolves C01-R5-018.

### 24.19 Authority-store maintenance debt

Assign ownership and measured safety margins for vacuum progress, blocking transaction age, log retention and durable storage headroom. Alerts identify the blocking cause and a safe intervention before authority commits become unavailable. Bound long readers where appropriate and reserve maintenance capacity. Qualification includes sustained updates, deletions and retention activity, not only clean-database query throughput. Interventions preserve promised snapshots, backup chains and required history; discarding needed logs is not an acceptable capacity repair.

Acceptance: block vacuum and stall a log consumer under controlled load. Detect the cause and act within the qualified margin while preserving commit availability and recovery promises. Thresholds follow measured profiles, not universal constants. Resolves C01-R5-019.

### 24.20 Cross-workload resource admission

Admission accounts for actual scarce resources across workload classes, including authority connections, memory, CPU, accelerators, queued work and durable storage. Provide qualified fairness and reserved capacity or equivalent isolation for essential policy, revocation, outcome reconciliation and recovery work. Bound waiting and expose queued, rejected or degraded outcomes. Reconcile estimated with observed cost and define safe overrun handling. Priority is granted by policy, never by an agent's assertion. Coordinate this with provider quotas and spend limits without treating either as a substitute.

Acceptance: saturate analysis and model work while revocation and reconciliation still meet qualified bounds. Test starvation, underestimated costs and forged priority requests. Resolves C01-R5-020.

### 24.21 Scaling usable capacity

For each profile, qualify scale signals, worker classes, initialization readiness, downstream bottlenecks and stable adjustment behavior. Count warming, ready, draining and failed capacity separately. Admission increases only with usable capacity; more instances cannot overrun database connections, model/provider limits or artifact distribution. Scale-in uses the owned drain protocol and respects stateful/hardware placement. Telemetry loss invokes an explicitly bounded manual mode or qualified fixed capacity, not an unsubstantiated elasticity claim.

Acceptance: slow warmup, placement failure, a constrained database and changing demand do not turn requested capacity into premature admission. Measure achieved throughput, latency, warmup and failed-provisioning cost. Accepted jobs retain ownership during scale-in. Resolves C01-R5-021.

### 24.22 Disaster-time recovery headroom

Recovery profiles include peak resource preconditions for temporary copies, log replay, object transfer, rebuilding and validation while surviving customers remain active. Identify reserves, usable quotas or alternative locations and the failure domains they survive. Qualify simultaneous recovery priorities where capacity is insufficient for all cells at once. Reassess requirements as retained data and topology grow. Protected evidence or validation cannot be silently discarded to make a restore fit.

Acceptance: remove the declared failed capacity and recover under representative surviving load. Measure space, throughput, placement and quota constraints. Publish unmet prerequisites and limited objectives instead of equating an empty-environment drill with disaster readiness. Reserve amounts and service priorities remain explicit measured operating decisions. Resolves C01-R5-022.

### 24.23 End-to-end deadlines and retry ownership

Synchronous call chains propagate a usefulness deadline and cancellation context, allocating bounded time per hop. Assign retry ownership and account for SDK retries so nested attempts cannot multiply silently. Use bounded backoff and controlled dependency recovery probes; permanent authorization, validation and applicability failures do not retry. Expired reads/computations release resources or expose their cleanup state. Durable workflows keep their business lifecycle, and effectful operations retain identity, reconciliation and uncertainty after caller deadline expiry.

Acceptance: inject a slow dependency beneath nested clients and count every attempt and elapsed work. Stay within the declared call policy, prevent probe floods, and prove timeout never becomes false effect cancellation or permission to resubmit with a new identity. Resolves C01-R5-023.

### 24.24 Owned process drain

Worker classes define starting, ready, draining and stopped states. Planned termination first stops new admission and withdraws the applicable routing/queue participation, then completes or durably hands off accepted work through existing checkpoint/fencing rules. Bound the drain interval and classify unresolved work after forced termination. External effects keep original operation identities and uncertainty. Stateful components use their qualified handoff sequence; elapsed sleep or process exit alone cannot prove drain completion.

Acceptance: terminate at idle, after admission, during computation and around external dispatch. No work enters after the declared boundary; accepted work remains owned and forced termination enters its documented recovery path. Rollout reports unresolved work separately from exited processes. Resolves C01-R5-024.

### 24.25 Precise health signals

Each component separates startup progress, process liveness and capability readiness. Specify what each signal proves and which controller action it permits. Dependency failure changes the relevant capability/routing state without automatically requiring caller restart. Readiness requires compatible initialized local artifacts and policy state. Observations have freshness and unknown states; probes are bounded and inexpensive. Customer readiness derives from the necessary end-to-end path, not a generic green process check.

Acceptance: delayed startup, shared dependency loss, process deadlock and missing local artifacts produce distinct qualified responses. Shared dependency loss cannot trigger an uncontrolled restart cascade. Probe timings require empirical qualification and do not select a deployment orchestrator. Resolves C01-R5-025.

### 24.26 Capability-specific degradation

Maintain a profile-specific capability/dependency matrix stating what continues, waits or stops for each material dependency failure. Include required evidence freshness, reduced result scope, visible limitations and recovery conditions. Exact semantics and mandatory authority remain intact. Alternative models/stores/routes require their own current-policy qualification. Restore capability labels only after relevant state is revalidated, and admit recovery backlog gradually through existing capacity controls.

Acceptance: fail retrieval, model serving, a projection and authorization separately, then restore them in another order. Qualified unrelated capabilities remain usable; affected journeys follow declared limits, with no unauthorized route fallback or stale success claim. A capability may stop when its guarantees cannot survive. Resolves C01-R5-026.

### 24.27 Monitoring blindness

Track observation age, expected event/heartbeat coverage and collector/export failures separately from measured service health. Required missing evidence becomes unknown or degraded, including for rollout admission. Critical availability claims have an appropriately independent harmless journey probe or equivalent permitted observation path, with notification delivery tested end to end. Disconnected profiles use qualified local alternatives. Permitted local buffering is bounded and records loss rather than accumulating indefinitely.

Acceptance: stop exporters, block their network, fail monitoring storage and break alert delivery independently. Last-known green expires truthfully and the claimed independent route reveals blindness. Rollout and incident behavior reflect missing evidence. Operational observation failure is distinct from mandatory decision-audit durability. Resolves C01-R5-027.

### 24.28 Accountable incident response

Define incident declaration, severity, accountable ownership, response roles, escalation and accepted handoffs for an AI-native operating team. Maintain a permitted durable timeline of affected capabilities, decisions, mitigations and unresolved outcomes. Coordinate conflicting repairs through existing authority controls. Restoration criteria measure business-service recovery and distinguish mitigation from reconciliation completion. Any customer notification follows already authorized channel/audience rules. Closure records causal evidence, uncertainty and owned corrective actions with checked completion.

Acceptance: exercise an unattended alert, responder handoff and conflicting repairs. Escalation reaches an accountable operator, one coherent repair plan governs changes, and unresolved business outcomes remain visible after the API recovers. Staffing counts and communication commitments are not presumed. Resolves C01-R5-028.

### 24.29 Supported platform lifecycle

Maintain a versioned support matrix for platform, operating environment and mandatory dependency combinations, with owners, verified upstream lifecycle evidence, update routes and requalification/retirement conditions. Qualify transitions before a supported combination becomes unmaintainable, including offline package delivery and data/workflow disposition. Exceptions identify limitations, owner and review/expiry. Distinguish running functionality from qualified support and lifecycle risk without silently abandoning customer data custody. Retire obsolete transition paths rather than promising indefinite compatibility.

Acceptance: simulate a mandatory dependency losing maintenance or requiring an incompatible repair. Identify affected cells and provide a tested transition or explicit exception; support claims and long-running work disposition remain truthful. No vendor dates or support windows are invented. Resolves C01-R5-029.

### 24.30 Later vulnerability evidence

Relate component inventories to immutable artifacts and observed deployments so later verified vulnerability evidence can change admission, continued-use and rollback eligibility. Assess actual version, configuration and exposure rather than equating every advisory match with exploitation. Own remediation, containment or time-bounded exceptions, and re-evaluate when evidence changes. Emergency fixes retain necessary semantic, recovery and profile checks, including disconnected delivery. Track observed installation rather than treating a patched build as a repaired fleet.

Acceptance: seed a test advisory affecting running and rollback artifacts. Identify applicable cells, prevent an unqualified risky rollback and follow repairs to observed state. Include an unaffected configuration and an offline cell. Urgency and exception authority require explicit risk decisions. Resolves C01-R5-030.

### 24.31 Customer exit and custody

An authorized exit inventory includes permitted authoritative records, definitions, mappings, stable identity relationships, temporal/lineage evidence, customer-owned artifacts and operation status. Supply machine-readable schemas, revision information and a completeness manifest. Identify restricted material that cannot be handed over and explain omissions. Before decommissioning, reconcile or explicitly transfer/retain ownership of pending effects and preservation duties. Govern the handover destination, keys, retention and erasure; confirm custody where the applicable policy requires it.

Acceptance: independently parse a controlled exit containing historical corrections, restricted material and an uncertain effect. Reconstruct representative permitted meaning, verify omissions and preserve accountable outcome ownership. Shutdown cannot imply complete erasure while valid preservation obligations remain. Formats and service terms remain explicit choices. Resolves C01-R5-031.

### 24.32 Planned cell relocation

Relocation declares transfer checkpoints, intake handoff, stable customer/business identities, new environment incarnations and a single-authority cutover. Inventory callbacks, subscriptions, sessions, workers and credentials bound to the old location. Drain or transfer owned work through existing protocols and verify convergence before the qualified authority/routing switch. Keep the old cell fenced; handle late arrivals through a bounded authorized redirect or reconciliation path. State when reversal is safe and when returning needs a new migration rather than reviving old state.

Acceptance: relocate with active ingestion, an outstanding effect and delayed old-address callbacks; interrupt before and after cutover. Prevent dual authoritative writes, unexplained source gaps and abandoned effects. A qualified stop-and-copy move is allowed; zero downtime is not presumed. Resolves C01-R5-032.

### 24.33 Production and test authority separation

Bind workload identities, secret grants, source installations and callbacks to environment role and incarnation at actual access/effect boundaries. Fresh or refreshed nonproduction environments start without production intake/effect authority. Use qualified fixtures or explicitly scoped production testing. Copied customer data, derivatives and logs retain current-use and retention controls. Test identifiers and receipts cannot automatically satisfy production operations or release evidence. Apply independent trust roots or an equivalent enforceable profile boundary.

Acceptance: inject valid production credentials/configuration into staging and replay a production callback there. Reject or quarantine before intake/effect. A permitted fixture succeeds without promoting its receipts into production proof. Real-model and first-class computer-route testing remain supported under explicit authority. Resolves C01-R5-033.

### 24.34 Executed qualification bound to candidate

A qualification record binds artifact, effective configuration, semantic revisions, profile, required test definitions, input/reference revisions, evaluator identity and execution receipts. Derive the gate result from required coverage and observed outcomes. Missing, skipped, interrupted or unverifiable required cases remain unqualified; a supplied aggregate pass flag is insufficient. Promotion binds that exact record, with relevant changes requiring re-evaluation. Keep synthetic transport, real-model quality, enforcement and production evidence categories distinct.

Acceptance: stale candidate digests, changed settings, omitted cases, forged summaries and interrupted runs cannot establish qualification. Authorized retained receipts support independent reconstruction of a valid gate, including uncertainty and explicit exceptions. EvoOntology informs this boundary without authorizing canonical mutation or proving model quality. Resolves C01-R5-034.

### 24.35 Integrated performance envelope

Qualified workloads specify arrival process, operation mix, data shape/skew, cache state, concurrency and simultaneous failure/recovery work. Measure offered, admitted and completed work separately, including tail latency, queue age, resource peaks, correctness and essential-control progress. Describe load-generator slowdown behavior and account for missing/timed-out arrivals. Bind evidence to hardware/profile/configuration and dataset shape. Test growth and saturation so claims stop at the observed envelope and excess demand has bounded admission behavior.

Acceptance: combine cold starts, hot keys/large objects, ingestion, analysis and rebuild with a dependency interruption. Account for every intended arrival, including rejection and queueing. Report measured service/safety behavior rather than adding isolated component maxima or relying on warm-cache averages. Resolves C01-R5-035.

### 24.36 Recurring business occurrences

Schedules are versioned business intents with time-zone/calendar or elapsed-time basis, recurrence, exclusions, occurrence identity, effective revision and explicit overlap/missed-run policy. Preview ordinary and exceptional occurrences. Admit each under current mandate/policy and business validity; catch-up cannot authorize expired effects. Distinguish pausing future occurrences, stopping a workflow and cancelling an external effect. Record skipped, coalesced, deferred and manually replayed occurrences. Reuse qualified Temporal scheduling instead of adding another coordinator.

Acceptance: cross a clock transition, outage, long previous run and pending schedule edit. Produce the declared occurrence set with bounded catch-up and truthful coverage. Replay preserves business-intent identity or explicitly represents an authorized new action. Calendar and missed-run choices are user-visible. Resolves C01-R5-036.

### 24.37 Safe artifact reclamation

Artifact classes identify authoritative reference roots for live deployments, work, evidence and qualified recovery/rollback. Reclamation prevents a new consumer from acquiring an artifact across its deletion boundary without revalidation. Record retirement/deletion evidence and use a qualified grace/quarantine mechanism where needed. Privacy and retention obligations still govern: a forbidden artifact cannot remain merely because stale work references it; that work receives an explicit revoked or unreplayable disposition. No new business-state authority is introduced.

Acceptance: race cleanup with workflow resumption and snapshot acquisition, then recover using a retired but still required artifact. Permitted live references protect it and new references cannot cross unnoticed. A valid erasure instruction makes dependent work explicitly unavailable rather than silently substituting another revision. Resolves C01-R5-037.

### 24.38 Sampled time-series meaning

Series contracts declare observation kind, expected/actual coverage, duplicate-time handling, interval alignment, weighting and explicit gap-fill/interpolation. Distinguish instantaneous readings, interval averages, accumulated quantities and states using shared unit/stock-flow semantics. Derived series retain method/version and observed, estimated or unavailable value status. Bound reconstruction to its applicability and propagate missingness/uncertainty consistently through charts, models and exact queries. Sample corrections invalidate every affected derived interval.

Acceptance: irregular samples, duplicate times, long gaps and a corrected boundary match independent results under separately declared duration/sample weighting. Interpolation cannot pass an observed-data requirement. Display and computation agree on gaps and recomputation scope. Domain-specific interpolation remains a published choice; no specialist database is selected. Resolves C01-R5-038.

### 24.39 Spatial interpretation and transforms

Spatial values bind reference system, axis order, units, geometry type, validity and precision/uncertainty. Explicit qualified transforms carry method/version and domain; relabeling is not transformation. Declare distance/containment and boundary inclusion, applicable wrap behavior and invalid/out-of-domain disposition. Source and derived geometry use the same authority, lineage and temporal rules. Location-sensitive decisions apply an explicit conservative or abstention rule when uncertainty matters.

Acceptance: swapped axes, relabeled projected coordinates, unit mismatch, boundaries, invalid geometry and a supported wrap case match independent fixtures or fail explicitly. Unsupported/uncertain geometry cannot justify an unqualified exact action. Supported systems and libraries need evidence; this does not claim universal geometry support or select a separate spatial database. Resolves C01-R5-039.

### 24.40 Media fragment coordinates

Every media/document fragment binds its representation identity and coordinate/time convention. Derivative transformations state whether fragment mapping is exact, approximate or unavailable. Apply qualified mappings when rendering evidence or moving annotations. Removed content and unsupported alignment retain the original reference with a visible limitation, rather than a guessed derivative location. Both representations retain current access and retention controls; boxes, pages, audio times and frames have explicit origins/units.

Acceptance: crop, rotate, resize, reorder pages and change timebase in controlled fixtures. Independently inspect the rendered fragment against intended source content. Unmappable or removed fragments fail visibly. A successful fetch is not proof of localization, and forbidden originals need not be retained to preserve a replay claim. Resolves C01-R5-040.

### 24.41 Group and intercompany measures

Group measures declare effective membership, combination/consolidation basis, counterpart identity, elimination/adjustment rules and unresolved-difference treatment. Bind existing currency, fiscal-period and temporal contracts. Preserve entity facts and record group adjustments separately with provenance, revision and ownership. Distinguish operational combined views from specialist-qualified financial consolidation. Missing subsidiary coverage and unmatched counterpart evidence remain visible rather than silently netting to zero.

Acceptance: independently derive the declared measure for internal/external sales, an unmatched counterpart and mid-period membership change. Explain each inclusion/elimination, preserve entity reports and restate affected group results traceably when rules change. The customer/domain owns the reporting basis; no accounting-regime compliance or implemented multi-subsidiary quality is implied. Resolves C01-R5-041.

### 24.42 Produced artifact completion and consumer meaning

Result generation remains private and in progress until a final manifest binds its immutable generation, query/semantic revision, authorized scope, data cut and justified part/coverage/content checks. Only then publish a ready reference. Partial or sampled output has machine-readable limitations and cannot inherit a complete label. Resume within the same generation or explicitly supersede it; never mix parts from different cuts. Current release authority still applies and failed temporary material follows retention cleanup.

Acceptance: interrupt after a readable CSV prefix, omit a partition and retry against changed data. No incomplete/mixed result becomes ready. Independently check final evidence and deny revoked access even to a technically complete file. Unknown expected row count requires a justified alternative completion witness, not an invented count. Resolves C01-R5-042.

Produced-format profiles name intended consumers and distinguish inert data from deliberately authored active formulas, links or executable features. Imported formula-like strings cannot acquire executable authority merely through export. Use a qualified inert representation, including explicit value typing where supported. Disclose safety transformations and provide a separately qualified exact machine-readable representation when needed; never silently corrupt canonical strings, IDs or negative numbers. If consumer safety and requested exactness cannot both be met, offer a qualified alternative or state the limitation. Intentional active content requires its reviewed artifact capability.

Additional acceptance: Use harmless formula-like literals, delimiter/quote boundaries, negative exact values and large IDs in each claimed consumer profile. Check cell types, displayed meaning and attempted external activity through declared open/save/reopen use. Data remains inert and faithful, while permitted formulas stay explicit. Unsupported consumers or round trips receive no blanket safety claim. Resolves C02-R2-003.

### 24.43 Installed customer journey readiness

Maintain capability readiness separately from process health and overall product scope. Bind each material enabled journey to its actual installation, mappings, user-role policy, model/tool route and deployment profile. Use authorized harmless fixtures or explicitly approved live procedures to verify governed intake, exact reads, evidence display and enabled action preparation/reconciliation. Record blocked/incomplete portions and remediation owners. Configuration impacts invalidate relevant readiness evidence without arbitrary whole-customer re-onboarding.

Acceptance: healthy components with a wrong ledger, missing field permission or stale tool endpoint cannot qualify the affected journey. Correct the binding and exercise that path under the actual role. Synthetic transport success cannot stand in for real-model quality or unrestricted effect permission. This is installation qualification, not a customer-discovery prerequisite or scope reduction. Resolves C01-R5-043.

### 24.44 Entitlement transitions

Where the chosen commercial model uses them, define active, expiring, unverifiable, suspended and ended entitlement states with a capability matrix. Separate permission for new work from safe settlement of admitted effects, customer data custody/export and retention/erasure responsibilities. Qualify offline verification/renewal without presuming a grace period. Show cause and remedy. Entitlement uncertainty cannot silently trigger destructive cleanup or an unauthorized cloud route. Changes use governed configuration and audit controls.

Acceptance: exercise expiry, verifier outage, restored old entitlement state and termination with an unresolved operation. Preserve declared custody and reconciliation ownership, distinguish commercial unavailability from corruption/authorization failures and retain deployment restrictions. Commercial terms and retained capabilities require explicit choices; this clause grants no legal entitlement or billing model. Resolves C01-R5-044.

### 24.45 Bounded, meaningful telemetry

Telemetry classes have permitted dimensions, cardinality/size budgets, bounded exporter queues and explicit backpressure/drop behavior. Keep high-cardinality correlation IDs in governed trace/event paths rather than unlimited metric labels. Required audit records retain their separate admission/durability contract. Service indicators use qualified counts/sampling with visible loss and uncertainty; sampled traces are not silently a complete denominator. Observe and bound telemetry's own resource use.

Acceptance: generate distinct IDs, oversized spans and a failed backend under load. Resource consumption remains bounded, mandatory audit obligations hold and loss is visible. Compare a known error ratio with an independent count: the indicator remains justified or becomes explicitly unqualified. No fixed sampling rate, limit or observability vendor is selected. Resolves C01-R5-045.

### 24.46 Contained resilience exercises

Each disruptive exercise binds an authorized environment/incarnation, exact fault, expected observation, duration, stop criteria, accountable owner and independently usable abort path. Prefer isolated fixtures; live exercises need explicit authority and impact limits. Record what was actually injected and observed. Verify cleanup postconditions rather than treating a reversal request as completion. Loss of the controller cannot strand an indefinite fault. Test artifacts/effects remain separate from customer facts and normal operation proof.

Acceptance: wrong targets are refused, failed controllers leave an effective abort path, a fault that never occurred cannot count as a passed recovery test, and residual changes prevent a restored declaration. This document authorizes no live fault injection. Resolves C01-R5-046.

### 24.47 Transport trust continuity

Inventory endpoints, service identities, issuers/trust roots, validity windows, owners and client classes without private keys. Qualify certificate renewal and trust/name transitions, including offline delivery and intermediate-chain changes. Observe what each endpoint actually serves and validate from affected client trust contexts. Use an approved staged overlap where necessary and deliberately retire old trust. Expiry or identity mismatch produces explicit unavailability and an owned repair; verification cannot be silently disabled.

Acceptance: stale client trust, one endpoint serving old material, wrong service name and unreachable renewal route are detected with client-specific evidence. Issuance alone does not establish successful rollout. Trust topology and lifetimes remain profile choices using established libraries and key custody. Resolves C01-R5-047.

### 24.48 Partial infrastructure ownership

Track provisioning intent, stable operation identity and discovered resource IDs from first allocation through commissioning or abandonment. Reconcile uncertain creation before retrying through the existing operation protocol. Every managed resource has customer/environment binding, owner, dependencies and retention/recovery obligations, including failed and retiring installations. Decommission by verified reference/obligation checks, access revocation and provider-side disposition. Ambiguous resources enter owned investigation, not name-based deletion or invisible indefinite cost.

Acceptance: interrupt after external creation but before local completion, retry and later clean up. Discover the owned resource without duplication, preserve protected recovery material and spare unrelated similarly named resources. Interrupted teardown leaves visible resources/credentials and an accountable next action. No infrastructure mutation is authorized by this planning clause. Resolves C01-R5-048.

### 24.49 Shared fleet failure domains

Map shared critical providers, accounts, registries, trust/network services and administrative credentials to affected cells. State correlated failure/compromise impacts and the conditions under which local work or recovery remains independent. Alternative/cached paths require policy, freshness and provenance qualification. Limit administrative scope and reserve shared capacity where justified by commitments. Dedicated-cell claims must disclose these independence limits.

Acceptance: in controlled qualification, fail a shared dependency and constrain account-wide capacity. Observed affected cells match the map, local degradation follows its contract and recovery does not require the lost bootstrap path. Administrative credentials cannot alter unrelated cells beyond their declared scope. Duplicate infrastructure only when justified by evidence and cost, not as a universal requirement. Resolves C01-R5-049.

### 24.50 Location constraints across all paths

Deployment profiles explicitly state the scope of permitted storage/processing locations and applicable exceptions. Inventory actual locations/onward flows for primary state, replicas, backups, telemetry, temporary artifacts, support and provider-persistent content. Check failover, restore, relocation and auxiliary processing before restricted activation. Unverifiable location is a qualification limitation, not an inherited primary-database guarantee. Provider/topology changes trigger affected-flow requalification.

Acceptance: a permitted primary location cannot hide a forbidden backup target, out-of-profile recovery destination or unverified diagnostic route. Identify each before restricted use, preserve allowed routes and prevent failure-driven unauthorized relocation. Restrictions come from explicit customer policy and appropriate specialist review; no jurisdiction, cloud or legal-compliance claim is invented. Resolves C01-R5-050.
