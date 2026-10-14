# Testing strategy

This document specifies full-V1 checks. No runtime checks were executed in the historical documentation pre-stage. Stage 1 now has actual unit, integration and subprocess checks recorded in [Stage 1 acceptance](STAGE_1_ACCEPTANCE.md); Stage 2 functional units, real CLI and local benchmarks are recorded in [acceptance](STAGE_2_ACCEPTANCE.md). Reference performance and later-stage gates remain **NOT TESTED**.

## Test organization

Use Vitest with explicit semantic assertions, as requested in the Stage 1 authorization; compile TypeScript before subprocess/package tests. This deliberately replaces the original built-in-runner default (decision D14). Unit checks cover pure recognition, normalization, predicates, fingerprints, projection, and counters. Integration checks connect real stream framing/parsing/analysis/writers. CLI end-to-end checks spawn the built executable with actual argv/stdin/stdout/stderr and isolated filesystem fixtures. Release tests install the generated tarball into a new directory and invoke its installed binary through the platform's actual npm shim.

Tests MUST assert values, provenance, status, output bytes/schema, side effects, and bounded behavior, not only successful execution. Avoid snapshots that bless incorrect output without independently asserted counts. Stable serialized outputs MAY have small golden fixtures; updates need semantic review. No test may call external services or use real credentials/production health data. Temporary data MUST be isolated and removed only within a checked test-owned directory.

## Acceptance matrix

| ID / product | Cases and required oracle | Stage |
| --- | --- | --- |
| T01 / P01 | Known seven-level fixture: exact event/severity/unknown/damaged counts, min/max valid time, empty source null bounds | 1 |
| T02 / P02 | Real files and stdin, chunk splits at every UTF-8/CRLF boundary; later multi-files, duplicate paths, gzip vs plain equivalence, concatenated gzip | 1; extensions 2 |
| T03 / P03 | Auto/explicit JSONL/text, malformed objects, arrays/scalars, missing fields, alias conflicts/type blocking, last duplicate JSON key, nested dangerous keys | 1; limits 3 |
| T04 / P03 | LF/CRLF, lone CR, final no-newline, blanks, BOM, invalid UTF-8, UTF-16 rejection, exact line/byte/hash provenance | 1 |
| T05 / P03 | Multiline Node/Python/Java fixtures, orphan/blank/new-header/source boundaries, mixed JSON/text, oversized continuation draining | 2 |
| T06 / P04 | Inclusive since/exclusive until, fixed-zone assumptions, offsets/negative epoch, Feb 30, leap day/second, DST-ambiguous naive time, precision >3 digits, unknown levels, AND/OR families | 1 time parsing; filters 2 |
| T07 / P05 | Literal regex metacharacters, ASCII folding, multiline literal, before/after, overlaps, filtered intervening events, source boundary, match after display limit | 2 |
| T08 / P06 | Equal tuple groups; different service/logger/severity/digits/UUID/exception/frame/path/continuation separate; location-only frame changes group; forced digest collision keeps distinct tuples | 2 |
| T09 / P07 | Same exact ID joins; null does not; request/trace/span namespaces separate; exact case; three memberships/event; redacted equal-looking IDs retain distinct public keys | 2 |
| T10 / P08,P11 | JSON schema/goldens, NDJSON start/event/summary, no-match exit 1, static escaped HTML, safe Markdown fences, deterministic bytes across repeated processes/locales/TTY | 2 |
| T11 / P09 | Redaction corpus including nested sensitive keys, assignments, headers, bearer/provider/JWT, private blocks, URI userinfo, clipped patterns, paired sensitive flags, documented misses | 1 default; flags 2 |
| T12 / P09 | ANSI/OSC/bidi/NUL, HTML closing tags/scripts, Markdown links/fences, prototype keys; no executable payload or synthetic secret canary in protected outputs/stderr/temp files | 1 applicable outputs; all 3 |
| T13 / P10 | 5 GiB stream with independent expected counts; slow writer, line/event caps, cap boundaries ±1 byte, metadata depth/node/bytes, aggregation saturation and exact overflow | 2/3 |
| T14 / P10 | Gzip bomb/corruption/CRC/trailing bytes, source/run limit, line draining bounded by source limit; no hang or unlimited allocation | 2/3 |
| T15 / P02,P09 | Missing/unreadable file, later valid file, all failed vs valid empty source, truncation after open, append beyond initial size, symlink/junction/unsafe output/raced destination | 1 basic; all 3 |
| T16 / P10,P11 | SIGINT/SIGTERM, slow sink, EPIPE, descriptor cleanup, temp removal, no normal completion footer, signal status and latency | 1 basic; adversarial 3 |
| T17 / P12 | Packed file allowlist, npm dry-run, tarball inspect, clean offline tarball install, npm shim on Windows/POSIX, engines failure, help/version and representative commands | 4 |
| T18 / P10 | Reproducible normal/stress/adversarial runs, peak OS RSS, throughput, exact result hash; target table in [PERFORMANCE_SPEC](PERFORMANCE_SPEC.md) | 2; affected reruns 3/4 |
| T19 / P04,P08 | Unknown/repeated options, malformed numbers, command-specific flags, TTY no-input, positional `--`, stage-unavailable errors, stderr-only diagnostics, status precedence | 1/2 |

For counter expectations, use the invariants in [ANALYSIS_ENGINE](ANALYSIS_ENGINE.md) and [CLI_CONTRACT](CLI_CONTRACT.md), including unfiltered vs selected populations. A partial-result test MUST assert both usable results and coverage/status 3. Safety/output failures MUST assert no overwritten destination and correct exit 4. Display clipping MUST not change input counts or mark coverage partial by itself.

## Fixtures and focused property checks

Small checked-in UTF-8 fixtures SHOULD state physical bytes, expected event spans, canonical fields, diagnostics, selection, and output. Include file basenames that collide, secrets in every displayed field, out-of-order times, and identical data in two sources. Byte fixtures cover malformed encodings. Generated large fixtures MUST use seeds, known distributions, and independent totals; do not commit gigabytes.

Property-style checks are justified for arbitrary chunk partitions, random bounded JSON keys/strings, timestamp edge ranges, and aggregation order variations. Required properties: chunking invariance, no prototype mutation, serializer stability, counters conservation, limit-respecting retention, and absence of recognized synthetic secrets after protection. Use deterministic generators with the standard library first; a property-testing dependency needs a decision entry. Fuzzing MUST have bounded input/time budgets, reproducible seeds, and minimized failing regression fixtures. It does not substitute for explicit expected-case tests.

Security tests MUST scan stdout, stderr, generated reports, and test-created temp output for canaries. Test redaction disabled separately so the same fixtures establish explicit opt-out behavior while injection escaping remains effective. Never claim unknown-secret detection from canary coverage.

## Automated versus environment evidence

Pure/unit/integration/schema/CLI/package checks can run automatically on supported OS runners. Linux performance runs require the recorded reference environment and are a separate measured job. Actual Windows npm shim, junction/reparse detection, ACL-dependent temp visibility, SIGINT handling, and file commit semantics require real Windows execution; POSIX signal/no-follow/mode tests require POSIX execution. Unsupported SIGTERM behavior on Windows is NOT TESTED or explicitly inapplicable, never silently PASS. Symlink setup privilege failures are NOT TESTED and cannot satisfy the release gate; use a suitable environment.

Record PASS/FAIL/NOT TESTED per gate with exact command, package/build identity, OS/Node version, expected/actual totals, and output artifact/evidence location. Generated evidence MAY use Markdown under the relevant stage directory during implementation. No mandatory row is waived by a successful build, a mocked reader, an empty test suite, or another platform's result.

Stage 3 MUST review every mandatory behavior against adversarial evidence and retain regressions for remediated defects. Stage 4 reruns package/e2e checks against the final tarball after the last material change; broader reruns are required only for affected behavior or unresolved failures.
