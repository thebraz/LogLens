# Engineering decision register

Decisions D01–D13 originated as design contracts in the documentation pre-stage. Stage 1 implements the relevant subset and records real evidence in [Stage 1 acceptance](STAGE_1_ACCEPTANCE.md); Stage 2 functionality and local benchmark evidence are recorded in [Stage 2 acceptance](STAGE_2_ACCEPTANCE.md); reference targets and Stages 3–4 remain unverified. Changes MUST update the owning specification and acceptance coverage in the same work.

## D01 — TypeScript, Node 24, and ESM

- **Context:** local developer tooling needs portable stream/filesystem APIs and maintainable types.
- **Selected approach:** strict TypeScript compiled to ESM; Node 24.x runtime; CLI-first, no supported library API in V1.
- **Alternatives:** JavaScript-only, CommonJS, native executable, additional runtimes.
- **Rationale:** fulfills the requested platform while minimizing toolchain and dual-module complexity.
- **Consequences:** consumers need Node 24; other majors/runtimes require separate validation. No dual CJS build.
- **Reconsider when:** supported runtime policy changes or measured distribution constraints justify another artifact. Owner: [ARCHITECTURE](ARCHITECTURE.md), [RELEASE_SPEC](RELEASE_SPEC.md).

## D02 — Sequential asynchronous streaming

- **Context:** exported files may be gigabytes; global time order is not guaranteed.
- **Selected approach:** one input at a time, async iterable parsing, downstream backpressure, no whole-file copy or hidden index.
- **Alternatives:** whole-file load, parallel readers, external merge sort, database-backed ingest.
- **Rationale:** bounded state, stable source ordering, simple descriptor ownership, and portable cancellation.
- **Consequences:** output follows source/event order, not global chronology; aggregate state still consumes memory.
- **Reconsider when:** measured use cases require global sorting with an explicitly funded disk/state contract. Owner: [PERFORMANCE_SPEC](PERFORMANCE_SPEC.md).

## D03 — Explicit parser branches, per-record recognition

- **Context:** real exports mix structured and unstructured records.
- **Selected approach:** auto JSON-object candidate → timestamp text → level text → raw text; explicit format override; narrowly defined multiline continuation grammar.
- **Alternatives:** file-extension-only detection, whole-file guessing, general parser plugins, heuristic fuzzy framing.
- **Rationale:** deterministic behavior and auditable recovery without dynamic execution.
- **Consequences:** pretty-printed JSON and unspecified multiline dialects are not universally recognized; damaged candidates remain visible.
- **Reconsider when:** concrete fixtures justify an additional explicit grammar without precedence ambiguity. Owner: [PARSING_SPEC](PARSING_SPEC.md).

## D04 — Provenance-rich, nullable canonical events

- **Context:** analysis must not turn missing evidence into invented facts.
- **Selected approach:** event/source IDs, physical line and decompressed-byte ranges, raw retention/hash, ordered diagnostic codes, explicit null fields, separate output projection.
- **Alternatives:** opaque strings, vendor-shaped events, inferred defaults, implicit deduplication.
- **Rationale:** allows reproducible investigation, incomplete-evidence accounting, and stable consumer semantics.
- **Consequences:** event objects are larger; original bytes cannot be reconstructed from damaged decoded projections. Input duplicates remain counted.
- **Reconsider when:** a schema-major revision is justified by actual consumers. Owner: [DATA_CONTRACT](DATA_CONTRACT.md).

## D05 — UTC milliseconds with explicit ambiguity

- **Context:** timezone guesses and epoch unit heuristics cause plausible but wrong timelines.
- **Selected approach:** integer epoch milliseconds; RFC3339/defined date-time strings; UTC output; explicit fixed-offset assumption only for naive input; no host-local time.
- **Alternatives:** infer seconds by magnitude, local timezone default, IANA timezone library, arbitrary Date.parse acceptance.
- **Rationale:** deterministic, testable time boundaries and truthful missing-time representation.
- **Consequences:** unsupported precision/formats become diagnostics; DST/IANA handling is deferred.
- **Reconsider when:** concrete input requirements justify a revised grammar with compatibility policy. Owner: [DATA_CONTRACT](DATA_CONTRACT.md).

## D06 — Conservative exact grouping

- **Context:** aggressive variable masking can merge unrelated failures.
- **Selected approach:** versioned tuple of service/logger/severity/exact message/exception/normalized frame evidence; SHA-256 with tuple equality verification; no variable-token masking.
- **Alternatives:** message-only hashing, fuzzy similarity, regex digit replacement, AI clustering.
- **Rationale:** preserves meaningful distinctions and avoids unsupported causal grouping.
- **Consequences:** more groups/under-grouping; key capacity can saturate; fingerprints expose equality and low-entropy guessing risk.
- **Reconsider when:** curated real counterexamples support a specific safe normalization and a new algorithm version. Owner: [ANALYSIS_ENGINE](ANALYSIS_ENGINE.md).

## D07 — Bounded admission, exact overflow

- **Context:** arbitrary group/ID/time cardinality cannot be retained without bounds.
- **Selected approach:** encounter-order admission with key/byte limits, no eviction, exact counts for admitted keys and explicit overflow populations.
- **Alternatives:** unlimited maps, approximate sketches, LRU eviction, spill-to-disk database.
- **Rationale:** simple truthful degradation, no hidden persistence, deterministic retained state.
- **Consequences:** rankings after saturation are only among admitted groups; partial coverage returns exit 3.
- **Reconsider when:** measured workflows require disk-backed exact global ranking and accept a separate storage contract. Owner: [PERFORMANCE_SPEC](PERFORMANCE_SPEC.md), [ANALYSIS_ENGINE](ANALYSIS_ENGINE.md).

## D08 — Default output protection with explicit sensitive opt-out

- **Context:** logs frequently contain credentials; blind sanitization claims are unsafe.
- **Selected approach:** versioned deterministic structured-key/text-pattern redaction on all output; separate raw inclusion; paired per-invocation flags disable pattern protection only.
- **Alternatives:** unrestricted defaults, irreversible input mutation, entropy-only secret guessing, absolute-security claims.
- **Rationale:** safer defaults while preserving original analysis and acknowledging detector misses.
- **Consequences:** output can hide a search match; arbitrary PII/custom tokens may remain; escaping and limits cannot be disabled.
- **Reconsider when:** validated misses/false positives justify a policy revision with fixtures and compatibility notes. Owner: [SECURITY_MODEL](SECURITY_MODEL.md).

## D09 — Stable schemas and static reports

- **Context:** pipelines and incident artifacts require reliable consumption without a service.
- **Selected approach:** versioned deterministic JSON/NDJSON; text summaries; script-free standalone HTML and safely escaped Markdown reports.
- **Alternatives:** terminal-only output, dynamic dashboards, remote assets, platform-dependent formatting.
- **Rationale:** supports automation and local sharing with one projection/analysis model.
- **Consequences:** no interactive web report; aggregate JSON/report byte caps apply; NDJSON serves large search output.
- **Reconsider when:** explicit product authorization adds an interaction with demonstrable diagnostic value. Owner: [CLI_CONTRACT](CLI_CONTRACT.md).

## D10 — Standard library first

- **Context:** the required CLI, streams, gzip, hashing, and test runner fit Node's baseline APIs.
- **Selected approach:** zero runtime dependencies by default; TypeScript and Node typings as necessary development tools; additions need a documented concrete gap and review.
- **Alternatives:** command framework, parser framework, ORM, regex engine, broad utility packages.
- **Rationale:** reduces install/supply-chain surface without excluding a dependency that is actually necessary.
- **Consequences:** small purpose-specific argument validation/rendering stays local; full feature frameworks are not scaffolded.
- **Reconsider when:** measured maintenance/correctness evidence outweighs dependency cost. Owner: [AGENTS](../AGENTS.md), [RELEASE_SPEC](RELEASE_SPEC.md).

## D11 — Observable subprocess and artifact verification

- **Context:** unit mocks cannot prove stdin, exit statuses, OS shims, permissions, or published contents.
- **Selected approach:** Vitest unit runner (D14), real stream/integration tests, subprocess CLI checks, focused seeded property/fuzz checks, real OS/package tests and measured benchmarks.
- **Alternatives:** build-only acceptance, mock-only integration, snapshot-only assertions, unrecorded manual claims.
- **Rationale:** aligns acceptance with user-visible behavior and actual deliverables.
- **Consequences:** environment-dependent gates may remain NOT TESTED and block completion until executed.
- **Reconsider when:** evidence shows a check redundant or a missing failure mode; do not weaken a gate to conceal an unavailable environment. Owner: [TESTING_STRATEGY](TESTING_STRATEGY.md).

## D12 — New-file-only local output

- **Context:** log inspection must not overwrite user data or follow attacker-controlled output links.
- **Selected approach:** reject unsafe path components, write exclusive restrictive temp output in destination directory, atomically commit without replacement; no force/append flag in V1.
- **Alternatives:** direct writes, overwrite-by-default, platform rename with replacement, generic temp directory spool.
- **Rationale:** preserves inputs/existing destinations and avoids presenting half-written reports as committed output.
- **Consequences:** some filesystems fail safe; stdout may still be partial; crash residue is possible; OS-specific path guarantees need real tests.
- **Reconsider when:** explicit user needs justify overwrite behavior with an equally precise safety contract. Owner: [SECURITY_MODEL](SECURITY_MODEL.md).

## D13 — Strict stage and publication gates

- **Context:** documentation, functionality, hardening, and distributable verification prove different things.
- **Selected approach:** separately authorized stages, evidence-backed exits, no NOT TESTED promotion, separate authorization for publishing the exact verified artifact.
- **Alternatives:** autonomous progression through all stages, publishing after build, treating specification completion as runtime proof.
- **Rationale:** honors scope and makes implementation/release status defensible.
- **Consequences:** this pre-stage stops at Markdown; release identity/license remain owner decisions at the appropriate stage.
- **Reconsider when:** the user explicitly changes stage authorization or release scope. Owner: [STAGE_PLAN](STAGE_PLAN.md), [RELEASE_SPEC](RELEASE_SPEC.md).

## D14 — Authorized Stage 1 scope and development tooling

- **Context:** the implementation request explicitly authorizes Stage 1 and requires ESLint/Vitest, while the prior testing default used Node's runner. The request also mentions multiline/stack traces but explicitly assigns stage scope to STAGE_PLAN.
- **Selected approach:** retain one physical nonblank line per event and reject all Stage 2 commands/options, gzip and multiple inputs. Stack lines remain independent events. Replace the test-runner default with Vitest and use ESLint/typescript-eslint as development-only tools, plus TypeScript and Node 24 typings. Pin exact resolutions in package-lock.json and install with `npm ci --ignore-scripts`.
- **Alternatives:** implement Stage 2 framing prematurely; keep an unused Vitest alongside a second runner; add a CLI/runtime framework.
- **Rationale:** respects explicit stage authority and the requested toolchain without duplicate runners or runtime dependencies. Necessary tooling is local development infrastructure, not a product service or network dependency.
- **Consequences:** TESTING_STRATEGY and D11 now specify Vitest. Top-level tool licenses are MIT, except TypeScript (Apache-2.0); package metadata and engine compatibility are inspected locally. No install lifecycle script is executed. Initial unsupported ESLint 9 was replaced by the maintained installed version before acceptance. Package identity is private/local at 0.1.0 with UNLICENSED pending the owner's release decision; no Git initialization or remote action.
- **Verification:** Stage 1 unit/integration/subprocess cases and exact tool versions are in the acceptance record. Later-stage requirements and OS/package matrices are not waived.

## D15 — Basic cancellation versus OS signal delivery evidence

- **Context:** Windows child-process termination via `child.kill('SIGINT')` does not exercise a POSIX signal handler. Treating forced termination as graceful cancellation would fabricate evidence.
- **Selected approach:** test AbortSignal cancellation against an actual pending stdin reader and temporary file; test the real built entry point in subprocesses with explicitly injected Node SIGINT/SIGTERM events and expected 130/143 status; retain a separate POSIX OS-delivery test, inapplicable on Windows.
- **Rationale:** proves Stage 1 resource cleanup and status selection without claiming native console signal delivery was exercised. Stage 3 still requires actual supported-platform delivery/latency evidence.
- **Consequences:** Windows Ctrl+C delivery, native Windows SIGTERM availability and the POSIX test are explicitly not validated here. File commit checks cancellation immediately before its atomic no-replace commit point; a document already committed when a later signal arrives is not uncommitted output.
- **Owner:** CLI_CONTRACT, SECURITY_MODEL and TESTING_STRATEGY; Stage 1 evidence distinguishes the two kinds of check.

## Open owner decisions

No unresolved product/algorithm decision blocks Stage 1. Before release: the owner MUST select the license/copyright identity, confirm registry package name/account ownership and repository metadata, and explicitly authorize any external publication. These are not silently defaulted. Performance targets remain unverified until measured; evidence may require justified target revision through the owning contract, not an invented benchmark.

## D16 — Explicit Stage 2 authorization and grouping extension

- **Context:** the Stage 2 request authorizes the complete functional engine and explicitly requires grouping by severity and source. The prior CLI enum supported fingerprints and exact IDs only. The same request delegates details to the normative contracts and prohibits Stage 3/publication.
- **Selected approach:** extend `--by` and the output grouping enum with `severity` and `source`, preserving fingerprint/identifier semantics. Both new modes count all selected events; unknown levels remain explicit and same-basename sources remain separate by source ID. Update CLI/analysis/schema/help/README and actual subprocess coverage together. Keep literal search, request/trace/span exact namespaces and conservative fingerprinting; do not add regexes, heuristic variable masking or undeclared correlation aliases.
- **Rationale:** reconciles the explicit user requirement without changing existing observable modes or introducing unsupported joins. This is additive pre-1.0 functionality, not a released schema-major migration.
- **Consequences:** Stage 2 source/tooling/tests/docs/benchmarks are authorized; Stage 3, Stage 4, remote writes and publication remain unauthorized. Ubuntu reference performance is not established by a Windows smoke result, so Stage 2 cannot be declared PASS. Zero runtime dependencies; AJV already in the locked development tree is used only by the extra schema verification script.
- **Verification:** Stage 2 acceptance includes all grouping modes, exact counts, clipping/overflow, paired sensitive flags, gzip corruption/padding/expansion and compiled end-to-end workflows.

## D17 — Gzip strictness, bounded admission and measured performance

- **Context:** Node/zlib accepts trailing zero padding, contrary to the CLI requirement that trailing nongzip bytes fail. Initial measurements also showed unnecessary projection of already unadmittable high-cardinality keys.
- **Selected approach:** compare zlib consumed compressed bytes against the complete compressed stream at successful EOF; reject residual padding with GZIP_INVALID while preserving consumed evidence. Count a ratio-rejected decompressed chunk in source/run byte progress before stopping. Once a key-count cap is full, update existing groups exactly and count new-key overflow before creating a representative.
- **Rationale:** preserves the specified gzip/member and byte-accounting contracts, reduces avoidable work after saturation and leaves conservative fingerprints/counts unchanged. The canonical key comparator iterates code points without per-comparison arrays.
- **Consequences:** Node/zlib internal buffering and GC remain outside accounted aggregation bytes; observed OS RSS is measured separately. Fixed caps, partial coverage, statuses and reference targets are retained.
- **Verification:** real concatenated/corrupt/truncated/garbage/padded gzip cases; exact 10000 admitted keys plus repeated admitted members; 100000-key benchmark with 90000 overflow members; byte-identical hashes across repeated runs.

The final Stage 2 regression also checks that indented incomplete bracket/time prefixes remain continuations and that exception extraction tokenizes long dotted identifiers before checking the colon delimiter. This preserves the documented header grammar and avoids repeatedly scanning a failed exception candidate.

## D18 — Authorized Stage 3 adversarial hardening

- **Context:** the 2026-10-13 request explicitly authorizes Stage 3 and repairs. Independent tests exposed raw composite-value/escaped-key leaks, JWT punctuation misses, sensitive-key spacing misses, quadratic credential scans, stale multiline state, stalled gzip cleanup, replaceable temporary paths, and insufficient reservation for growing aggregate scalars. Encoded gzip headers could consume input without advancing decoded limits.
- **Selected approach:** retain the current architecture and zero runtime dependencies. Use bounded lexical/raw JSON and maximal-token credential scans; protect complete sensitive containers and disambiguate protected metadata keys; reset multiline exception state at flush; cancel source-owned pending reads before gzip cleanup; add independent 10/50-GiB compressed caps using existing codes; reserve 128 bytes for maximum scalar serialization growth before admission. Check temp/parent/published file identities without representing checks as atomic confinement. Check escaped HTML size before expansion, escape in bounded blocks, and copy clipped prefixes once to avoid retained ropes.
- **Alternatives:** recursive raw JSON reparsing/serialization, heuristic fingerprint changes, general parser/regex packages, silent loss of raw output, weakening path guarantees, or claiming platform certification from mocks.
- **Rationale:** repairs reproduced failures with targeted shared controls. Full ancestor-relative atomic filesystem operations are not supplied by these standard Node APIs; the remaining policy violation stays an explicit blocker rather than being redefined away.
- **Compatibility:** public options, schemas, fingerprint v1 and normalized analysis semantics are retained. Recognized sensitive patterns may be redacted more completely; compressed headers now stop at explicit additional fixed caps; conservative aggregate admission reserves scalar growth. Historical Stage 1/2 evidence is preserved. No install, Stage 4, publication, remote source review or log transmission.
- **Verification:** [AUDIT_REPORT](AUDIT_REPORT.md), regression-before/after logs, seeded 30-minute JSONL/text fuzz evidence, real Windows ACL/pipe/junction and large-workload results. Physical 10/50-GiB limit boundaries are not inferred from small injected-cap tests.

## D19 — Stage 4 native filesystem authority (owner-authorized 2026-10-14)

- Scope: 0.1.0-beta.1 LL-006/LL-008 repair. This deliberately replaces the earlier
  no-addon restriction; no telemetry, runtime npm dependency, install-time compilation
  or binary download is introduced. CLI/output/fingerprint schemas remain unchanged.
- Windows: NtCreateFile RootDirectory traversal, reject root/component reparse tags
  and non-disk/non-regular input; retain ancestors without delete sharing and input
  write sharing. Output retains its exact handle without write/delete sharing;
  NtSetInformationFile FileRenameInformation with ReplaceIfExists=false and pinned
  parent publishes atomically. FileDispositionInfoEx deletes only the owned handle,
  including a changed read-only attribute. Node/libuv owns the CRT descriptor table.
- Linux: O_PATH directory descriptors, openat/no-follow regular-file snapshot;
  O_TMPFILE mode0600, descriptor-source linkat no-replace, verified procfs fd fallback
  only for the documented unprivileged AT_EMPTY_PATH case, close unnamed uncommitted
  inode. No named-source unlink. Not executed here; mandatory platform evidence remains.
- macOS: descriptor-relative input is implemented. No complete atomic publication /
  owned-cleanup primitive has been established; output fails UNSAFE_OUTPUT rather than
  restoring the vulnerable path code. This blocks the mandatory macOS functionality
  and the entire release. No supported-platform or performance requirement is waived.
- Async positioned reads/writes remain bounded at 64 KiB with backpressure. Native
  metadata traversal/publication are bounded synchronous calls; remote filesystem
  latency is outside the local-filesystem promise. No production whole-file reader.
- Missing/incompatible native image: NOT_AVAILABLE and existing exit2 semantics,
  no fallback. stdin/stdout and help/version do not load a native image.
- Packaging: fixed package-relative platform resolution, Node-API v8 plus Node24 libuv
  API (not a claim of other Node-major ABI support), provenance SHA-256 for source and
  binary, strict artifact allowlist, gypfile:false, no consumer lifecycle hooks.
  Windows tar bin mode is normalized to0755 before final hashing/installation.
- Optional internal native audit callbacks expose deterministic before-component,
  after-component, before-leaf/create/publish/discard boundaries. They are never
  supplied by the CLI and cannot be enabled by logs, environment or config. Reentrant
  close/commit during a callback is rejected. Original pathname-hook tooling is kept
  separately; missing native injections are not PASS.
- Exit remains PARTIAL: exact multiplatform artifact, Ubuntu24.04/macOS14+ execution,
  dedicated Ubuntu performance, successful remote CI and authenticated registry /
  repository identities remain mandatory. private:true and publication prohibition
  remain active until explicit owner approval of the final fully verified artifact.

## D20 — Restricted Windows experimental GitHub milestone (2026-10-14)

- The owner's latest request targets Windows x64 / Node24 v0.1.0-beta.1 only, with
  GitHub repository/commit/tag/pre-release and verified assets. Keep private:true;
  npm publication is excluded. This does not complete or redefine original Stage4.
- Windows acceptance includes every applicable existing test, ACL/native cancellation,
  CLI/schema, dependencies, exact archive and isolated installed shim, and actual
  successful remote Windows CI on the intended commit. POSIX skips are disclosed.
- The existing full platform CI remains a separate manual workflow; Windows beta CI
  executes the Windows gate script without weakening any assertion or security rule.
- Linux native runtime, macOS safe output/native runtime, full native distribution,
  cross-platform exact-artifact/engine/CI, Ubuntu reference performance and npm
  readiness stay mandatory unresolved requirements for the original full release.
- Correct obsolete README statements about pre-native path checks; preserve historical
  Stage3/4 reports as snapshots. Documentation/metadata changes require a new archive
  hash and exact artifact installation; no reuse of an old tarball checksum.
- Initial approval review rejected the attachment-based authorization. The owner
  subsequently restated it directly in chat; public repository creation was approved
  and verified. No rejection was bypassed. Actual remote CI remains required before
  tagging/publication; see WINDOWS_BETA_ACCEPTANCE.md and the release/Actions records.
