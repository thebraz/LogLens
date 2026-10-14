# LogLens engineering contract

LogLens is a local-first TypeScript CLI for inspecting application logs. Node.js 24 LTS and ESM are required. It MUST operate without a server, database, cloud account, AI model, telemetry, or transmission of log data.

## Authority and current status

Latest owner request, 2026-10-14: prepare and publish v0.1.0-beta.1 as an
experimental Windows x64 GitHub pre-release, including Git initialization,
commits, tags, repository creation, push and verified release assets. Keep
private:true; npm publication is not authorized. The original multiplatform
Stage 4 remains PARTIAL and its outstanding gates are unchanged. The Windows
milestone requires all Windows checks and an observed successful remote CI run.
See docs/WINDOWS_BETA_ACCEPTANCE.md for the current publication outcome.
Earlier authorization/status statements below are historical snapshots.

On 2026-10-14 the owner explicitly authorized completing Stage 4 for 0.1.0-beta.1,
including native filesystem remediation, audit, packaging and isolated installation.
This supersedes the older Stage 4 authorization statements below. Publication to
npm/GitHub still requires separate explicit approval. Stage 4 remains PARTIAL while
mandatory gates in docs/STAGE_4_ACCEPTANCE.md are unresolved.

Stages 1–3 have been explicitly authorized. The foundation and functional diagnostic engine are implemented; actual verification and limitations are recorded in [Stage 1 acceptance](docs/STAGE_1_ACCEPTANCE.md), [Stage 2 acceptance](docs/STAGE_2_ACCEPTANCE.md), and the [Stage 3 audit](docs/AUDIT_REPORT.md). Stage 2 remains PARTIAL until its reference performance gates are verified. Stage 3 remains PARTIAL while the audit's filesystem and platform gates are unresolved. Stage 4 and publication are not authorized.

MUST denotes an obligation; SHOULD permits a documented, justified exception; MAY denotes optional behavior. Requirements describe future implementation, not current capability.

Before changing a feature, agents MUST read [the product specification](docs/PRODUCT_SPEC.md), [architecture](docs/ARCHITECTURE.md), [stage plan](docs/STAGE_PLAN.md), and the relevant contracts linked below. Observable contracts MUST be preserved unless the same change deliberately revises their specifications, records its rationale in [the decision register](docs/ENGINEERING_DECISIONS.md), and updates acceptance coverage. Conflicting requirements MUST be reconciled before implementation; the document owning a rule governs its details.

| Rule owner | Scope |
| --- | --- |
| [DATA_CONTRACT](docs/DATA_CONTRACT.md) | Internal events, provenance, schema semantics |
| [PARSING_SPEC](docs/PARSING_SPEC.md) | Recognition, framing, recovery |
| [CLI_CONTRACT](docs/CLI_CONTRACT.md) | Public arguments, outputs, status codes |
| [ANALYSIS_ENGINE](docs/ANALYSIS_ENGINE.md) | Matching, grouping, correlation, statistics |
| [SECURITY_MODEL](docs/SECURITY_MODEL.md) | Trust boundaries, redaction, safe writes |
| [PERFORMANCE_SPEC](docs/PERFORMANCE_SPEC.md) | Resource limits and measurement |
| [TESTING_STRATEGY](docs/TESTING_STRATEGY.md) | Required verification |
| [RELEASE_SPEC](docs/RELEASE_SPEC.md) | Packaging and publication gates |

## Implementation rules

- MUST keep the CLI adapter separate from parsing and analysis. Domain modules MUST NOT access process globals, write output, open files, or make network requests. Inject readers/writers and cancellation at I/O boundaries.
- MUST use asynchronous streaming with backpressure. No whole-file reads, unbounded arrays/maps, process-per-record work, or hidden persistent indexes. Retained aggregation is bounded, not constant-memory by assertion.
- MUST use strict TypeScript, including `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `useUnknownInCatchVariables`. Boundary values are `unknown` until validated. Avoid `any`, unchecked casts, mutable global state, and non-null assertions that bypass input validation.
- MUST represent missing evidence explicitly. Never invent timestamps, levels, causes, or deduplicate events silently. Preserve source positions and diagnostics.
- MUST use typed error codes and safe user messages. Only the entry point chooses exit status. Expected input errors MUST NOT expose stacks, raw records, credentials, or unsafe terminal content. Recovery and partial results follow the CLI contract.
- MUST prefer Node standard library. Runtime dependencies require a concrete gap, license/support review, resource/security rationale, and a decision entry. V1 needs no runtime dependency by default; no dynamic plugins, package scripts from input, or network calls.
- MUST apply [security rules](docs/SECURITY_MODEL.md) to every renderer, diagnostic, and output path. Unsafe raw output requires the documented explicit flags.
- MUST verify observable behavior with the stage's required unit, integration, subprocess, and environment checks. Mocks/build success alone do not establish CLI or package acceptance. Use synthetic secrets and isolated temporary data.
- MUST synchronize docs, schemas, examples, tests, and help when contracts change. Record limitations without presenting unmeasured targets as results.

## Stage gates and Definition of Done

Work MUST remain within the explicitly authorized stage. The historical documentation pre-stage prohibited source creation and dependency installation; Stage 1 authorization permits its source and necessary development tooling. No autonomous stage transition, publication, deployment, or remote writes. Release publication needs separate explicit authorization.

A stage is done only when its required deliverables exist, mandatory checks have actual PASS evidence, defects violating its scope are resolved, docs agree with implemented behavior, and remaining limitations are identified. Use PASS/FAIL/NOT TESTED with commands, environment, and evidence; NOT TESTED is never PASS. See [STAGE_PLAN](docs/STAGE_PLAN.md). No Git initialization or infrastructure is required to finish this pre-stage.
