# Product specification

Status: normative full-V1 design. The Stage 1 inspection subset is implemented; its executed checks and limitations are in [Stage 1 acceptance](STAGE_1_ACCEPTANCE.md). Stage 2 functional behavior is implemented with local verification; reference performance acceptance remains NOT TESTED. See [Stage 2 acceptance](STAGE_2_ACCEPTANCE.md). Terms MUST/SHOULD/MAY follow [AGENTS](../AGENTS.md).

## Problem and users

Developers need to diagnose application failures in exported logs without uploading sensitive data or deploying observability infrastructure. Backend engineers, local developers, CI maintainers, and incident investigators need predictable answers to: what failed, how often, where, when, and which events share an explicit identifier.

LogLens MUST provide a CLI suitable for interactive use and pipelines. It MUST distinguish observed evidence from correlation and MUST NOT infer a root cause. Supported deployment environments are local development, CI diagnostics, incident investigation, and analysis of production exports.

## Mandatory V1 requirements

| ID | Requirement | Observable acceptance |
| --- | --- | --- |
| P01 | Inspect logs and summarize severity, time coverage, sources, and parsing quality | `inspect` returns exact counters and timestamp bounds for a known fixture |
| P02 | Read regular files, multiple files, stdin, and gzip sequentially | Plain/gzip equivalents normalize identically except provenance; stdin is read once |
| P03 | Parse JSON Lines, common text, timestamp prefixes, multiline exceptions, and mixed inputs | The parser cases in [PARSING_SPEC](PARSING_SPEC.md) preserve line/byte provenance and diagnostics |
| P04 | Filter by time, severity, source, service, and explicit correlation ID | Conjunctive filters have the [CLI](CLI_CONTRACT.md) boundary and missing-value behavior |
| P05 | Search literal messages with bounded before/after context | Match counts exclude context; overlapping context is emitted once |
| P06 | Group error/fatal events without merging unrelated templates | Fingerprints obey [ANALYSIS_ENGINE](ANALYSIS_ENGINE.md); collisions are checked against tuples |
| P07 | Correlate by exact, namespaced identifiers | Equal request IDs share a bucket; a request ID never joins a trace ID by coincidence |
| P08 | Produce terminal, JSON, NDJSON where applicable, Markdown, and standalone HTML reports | Schemas, escaping, ordering, and truncation markers match [CLI](CLI_CONTRACT.md) |
| P09 | Default to redacted output and safe destinations | Synthetic credential and injection canaries satisfy [SECURITY_MODEL](SECURITY_MODEL.md) |
| P10 | Process large inputs with explicit resource bounds and cancellation | Bounded-state behavior and target measurements follow [PERFORMANCE_SPEC](PERFORMANCE_SPEC.md) |
| P11 | Be deterministic and pipeline-friendly | Fixed input/options produce byte-identical machine output, independent of locale/TTY |
| P12 | Distribute a verifiable npm CLI | Installed tarball passes [RELEASE_SPEC](RELEASE_SPEC.md); publication remains separately authorized |

Examples: count failures in a CI export; search an exception with adjacent events; compare error frequency across files; follow an explicit request ID; create a redacted incident report with provenance.

## MVP and stage allocation

The foundation MVP is Stage 1 `inspect`: one plain file or stdin, JSON Lines/basic one-line text, normalized events, text/JSON summary, safe output, and foundational checks. Full V1 is Stage 2 functional behavior plus Stage 3 hardening and Stage 4 package verification. A Stage 2 implementation is not a production-ready released V1.

All four commands, mandatory formats, gzip, multi-source processing, filtering, conservative grouping, explicit correlation, temporal counts, and reports are required V1. [STAGE_PLAN](STAGE_PLAN.md) assigns acceptance gates; [CLI_CONTRACT](CLI_CONTRACT.md) assigns option availability.

## Non-functional requirements and constraints

- MUST support Windows 11 x64, Ubuntu 24.04 x64, and macOS 14+ arm64 with Node.js 24.x. Other Node majors/architectures are unverified until added to the matrix.
- MUST use ESM, strict TypeScript, UTF-8 input/output, UTC machine timestamps, exact integer counters, and deterministic serialization.
- MUST stream input and propagate output backpressure; aggregation and context retain bounded state. Limits and unmeasured performance targets are owned by [PERFORMANCE_SPEC](PERFORMANCE_SPEC.md).
- MUST recover from record defects while visibly accounting for lost completeness; unreadable sources, corrupt gzip, and safety limits produce partial/failure statuses.
- MUST perform no input-data telemetry, external transmission, network lookups, or implicit persistence. Reports are local files or stdout.
- MUST retain evidence provenance. Arrival order is source order; cross-file sorting by timestamp is not assumed. Untimed and out-of-order logs are valid inputs.

## Explicit non-goals and optional future work

V1 excludes hosted SaaS, ingestion servers, daemons/watch/tail mode, databases, full-file indexes, distributed tracing, SIEM features, AI explanations, dashboards, arbitrary regular-expression search, glob expansion, recursive directory traversal, archives other than gzip, binary encodings, live remote sources, custom parser plugins, and approximate statistics disguised as exact counts.

Future releases MAY consider external sorting, opt-in additional parsers, IANA timezone handling, or persistent indexes only through a separately justified contract revision. They MUST NOT be scaffolded in V1. License choice and registry/package identity are release decisions, not missing Stage 1 product decisions; see [RELEASE_SPEC](RELEASE_SPEC.md).
