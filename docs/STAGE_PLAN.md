# Four-stage implementation plan

Latest 2026-10-14 authorization adds the restricted Windows experimental GitHub beta
milestone described in [publication](PUBLICATION.md). The original stages, matrix,
performance and npm-readiness gates below remain unchanged; Stage 4 stays PARTIAL.

Current authorization update, 2026-10-14: Stage 4 for 0.1.0-beta.1 is authorized,
including native remediation. Its current result is PARTIAL; see
[Stage 4 acceptance](STAGE_4_ACCEPTANCE.md). Earlier stage snapshots below are historical.
No mandatory gate is waived. Publication remains separately unauthorized.

Current state: **Stage 1 PASS** on the recorded Windows execution platform, with [actual acceptance evidence](STAGE_1_ACCEPTANCE.md). Stage 2 is functionally implemented and **PARTIAL** in [acceptance](STAGE_2_ACCEPTANCE.md); reference performance gates remain **NOT TESTED**. Stage 3 was explicitly authorized on 2026-10-13 and is **PARTIAL**; see the [audit report](AUDIT_REPORT.md). Stage 4 remains **NOT STARTED / NOT AUTHORIZED**. Creating specifications is not evidence of feature completion. Each stage requires explicit authorization to start, and completion does not authorize the next stage. Publication always needs a separate explicit action.

## Pre-stage exit

Required deliverables are [AGENTS](../AGENTS.md) and the twelve documents in this directory. Exit requires existence/reference checks, cross-contract consistency review, explicit limits/status behavior, traceable acceptance, no application/test/infrastructure creation, and no claimed runtime results. The folder was initially empty; there was no existing project documentation to reconcile. Parent graph guidance was checked; the graph tool could not identify a project root, consistent with the empty folder and absent repository metadata. No graph-derived implementation claims are made.

The pre-stage MUST stop after documentation verification. License, package registry identity, and future publication authorization are release blockers only; no additional product decision is required for Stage 1.

## Stage 1 — Foundation & Architecture

**Objective:** establish a small executable foundation with safe streaming inspection and canonical parsing contracts.

**Allowed scope:** strict TypeScript/Node 24 ESM foundation, package scaffolding for local development, initial CLI help/version/inspect, one regular plain file or stdin, JSONL/one-line text and timestamp normalization, provenance, default protection, text/JSON inspection summary, safe file output, bounded parsing, cancellation/error contracts. Necessary development dependencies MAY be installed after authorization; runtime additions require a decision record.

**Deliverables:** minimal source/modules, local build/typecheck/test configuration, foundational fixtures, Stage 1 help/README accurate to available behavior, tests T01–T04 and relevant time/security/I/O/argument cases, and Markdown acceptance evidence. Package metadata may use a clearly local placeholder identity; no registry availability claim.

**Dependencies:** pre-stage documents read; supported local Node toolchain available or explicitly recorded as missing; numeric limits and public schema applied from their owners.

**Acceptance:** inspect exact counts/time bounds/provenance for valid and damaged fixtures; plain files/stdin produce equivalent analysis; UTF-8/chunk/line cases deterministic; default protected output does not expose known canaries or escapes; missing/unsafe input and output statuses are correct; no overwrite/input mutation; partial parsing returns 3; unsupported future flags/commands return 2. Stage 1 MUST NOT imply multiline/gzip/search support.

**Required validation:** typecheck/build, applicable unit/integration and real subprocess checks on the execution platform, slow writer/cancellation smoke, real safe-output tests; record environment and explicit status for every applicable row. Full supported-OS package matrix is Stage 4.

**Exit:** all Stage 1 mandatory checks PASS, docs/help match delivered subset, no foundation contract defect remains. **Deferred:** multiple files, gzip, multiline, search/common filters, grouping/correlation/reporting, performance measurement suite, adversarial audit, CI/release publication.

## Stage 2 — Complete Functional V1

**Objective:** deliver every functional V1 requirement without expanding the product's non-goals.

**Allowed scope:** multi-source/gzip/multiline extensions, complete CLI filters/search/context, conservative fingerprint grouping, exact-ID grouping, summaries/time buckets, redacted bounded representatives, JSON/NDJSON/text/Markdown/static HTML outputs, limits/overflow semantics, benchmarks, expanded tests/docs.

**Deliverables:** implemented P01–P11, tests T02–T11/T13–T14/T19 applicable cases, real CLI evidence, deterministic benchmark datasets/procedures and measured results, updated usage/limitations. All full-V1 CLI options in [CLI_CONTRACT](CLI_CONTRACT.md) MUST work.

**Dependencies:** accepted Stage 1 foundation; no change to contracts without a synchronized documented revision. Use the shared pipeline, not command-specific duplicate parsers.

**Acceptance:** mandatory supported formats preserve provenance; filters/time boundaries correct; literal search/context/count/display-limit behavior exact; grouping counterexamples stay separate; namespace correlation never implies causality; reports escaped/protected and exact within coverage; aggregate overflow truthfully marked partial; output schemas/determinism satisfy goldens; real benchmark targets measured and met or deliberately revised with measured rationale before exit.

**Required validation:** all functional units/integrations and actual CLI tests, gzip corruption and resource-cap checks, normal/stress benchmark measurements, report artifact inspection including hostile content. Reference throughput requires the specified environment; if unavailable it remains NOT TESTED and exit is blocked.

**Exit:** functional acceptance and measured gates PASS; limitations documented; every mandatory V1 function covered. **Deferred:** independent adversarial review/fuzzing, release CI/tarball matrix, registry identity/license resolution if still pending, publication.

## Stage 3 — Adversarial Audit & Hardening

**Objective:** challenge the implementation's safety, correctness, and bounds using hostile inputs and actual runtime evidence.

**Allowed scope:** security review of trust boundaries, bounded parser fuzzing, grouping/statistical correctness audit, resource-exhaustion/decompression/encoding/path/write-race tests, defect remediation, regression fixtures, affected benchmark reruns. No new product features, dashboard, daemon, remote ingestion, or speculative framework.

**Deliverables:** findings with evidence/severity/status, minimized fuzz regressions, remediation changes, T12–T16 adversarial evidence, cross-platform filesystem/signal evidence where applicable, updated limitations and decision entries if needed.

**Dependencies:** Stage 2 functional completeness and actual benchmark baseline. An architecture threat model is not a validated security assessment.

**Acceptance:** no unresolved defect violating a MUST contract; known canaries remain protected across all outputs; input cannot execute/modify prototypes; all configured limits have truthful recovery/status; aggregation invariants hold; read/write/cancellation cleanup verified; supported-platform safety behaviors executed rather than inferred.

**Required validation:** targeted exploit/regression checks, seeded bounded fuzzing, real stress/resource runs with OS RSS, race/permission/symlink/junction tests on capable OS environments, affected full regression and performance checks. Fuzz budget: at least 100000 generated records and 30 minutes per parser family on the recorded environment; retain seeds/results, not claims of exhaustive safety.

**Exit:** all mandatory adversarial cases PASS, accepted residual limitations stated, no open contract violation or unverified safety gate. **Deferred:** npm/GitHub release engineering and external publishing; no claim of absolute security.

## Stage 4 — Release Engineering

**Objective:** make the verified implementation reproducibly installable and prepare an evidence-backed release artifact.

**Allowed scope:** final docs/help/changelog alignment, owner-approved license and confirmed package identity, GitHub Actions after repository setup, package files/metadata, dry-run/tarball inspection, fresh installs, supported-OS installed-binary checks, readiness evidence. Regressions may be fixed with affected checks rerun.

**Deliverables:** accurate README/LICENSE/CHANGELOG/package metadata, CI configurations and actual successful runs, exact verified tarball/hash/file list, installed-package matrix T17, final relevant T01–T19 evidence, release readiness record and concrete publication plan.

**Dependencies:** accepted Stages 1–3, resolved owner/registry/license decisions, actual supported-platform runners, real GitHub repository for Actions. User account/ownership facts MUST NOT be invented.

**Acceptance:** [RELEASE_SPEC](RELEASE_SPEC.md) preparation steps 1–6 PASS; no mandatory FAIL/NOT TESTED; exact artifact clean-installs and behaves correctly on all supported OSes; no secrets/unwanted files; release claims match measured evidence. Changing the artifact after validation requires fresh affected checks.

**Required validation:** CI matrix, real tarball inspection and installation/uninstallation, actual platform shims/permissions, final redaction/report tests, post-change benchmarks when material behavior changed.

**Exit:** release preparation is complete once the exact artifact and readiness evidence pass. Publication is a separately authorized action; without authorization record `PUBLICATION: NOT AUTHORIZED`, not failure or implied completion of publishing. If publication is explicitly authorized, steps 7–8 require actual registry/post-publication evidence before declaring that action complete. **Deferred:** subsequent feature releases and optional enhancements.

## Evidence and gates

Each implementation stage MUST maintain a Markdown acceptance record mapping its requirements to PASS/FAIL/NOT TESTED, exact commands, environment/build identity, expected/actual outputs, and evidence locations. A check skipped because tooling/runner/permissions are unavailable is NOT TESTED. A stage cannot be declared complete with mandatory unverified criteria. No later stage may conceal missing earlier evidence. Ordinary technical choices within an authorized stage do not require repeated user confirmation.
