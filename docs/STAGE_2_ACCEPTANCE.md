# Stage 2 acceptance — PARTIAL

Executed on **2026-10-13**, Windows x64 (`win32`, OS build `10.0.26200`), Node **24.19.0**. Stage 2 was explicitly authorized by the complete functional V1 request. Stages 3–4 and publication remain **NOT AUTHORIZED**. Functional acceptance passes locally; the required Ubuntu reference performance gate remains **NOT TESTED**, so Stage 2 is not declared complete.

Build identity: **d81bfe78ef3db44c2c9c88b130772e23299015c645dce22899a583a1199326d0**; [manifest](../evidence/stage-2/build-manifest.json) covers 74 source, built, test, fixture, schema, tool, contract and configuration files. The acceptance document and evidence are excluded to avoid self-reference. Final link/manifest verification: **126 local references and all 74 file hashes PASS**.

## Delivered behavior and decisions

- Shared sequential async pipeline for explicit files, normalized-path deduplication, stdin once, magic-detected gzip and concatenated gzip members; initial opened-size boundary, per-source provenance, cancellation and partial recovery.
- Bounded multiline text framing, mixed JSON/text selection, original decompressed-byte positions/hashes, explicit orphan/retention/encoding/truncation diagnostics. Parsing and domain analysis have no filesystem/process/console/network access.
- `inspect`: exact unfiltered read/damage/diagnostic counts and selected severity/time/source summary. Undamaged events = eventsRead − damagedEvents; damaged events are counted once, independently of the number of diagnostics. Unknown level alone is informational. Error/fatal/warn remain distinct canonical counters; no severity or timestamp is invented.
- `search`: literal normalized-message matching, ASCII-only case folding, common AND/OR filters, inclusive/exclusive UTC bounds, bounded context, no overlapping duplicates, source/event order and full match counting beyond the rendered-match limit. Text/NDJSON stream with backpressure; JSON retains projected output only under its cap. No-match status 1 is tested on clean input; partial status 3 takes precedence.
- `group`: conservative versioned SHA-256 fingerprints with full tuple comparison and collision separation; exact request/trace/span namespaces; explicitly requested severity and source modes. Severity/source include all selected events, and duplicate source labels remain separate by source ID. No heuristic masking of digits, UUIDs or paths; only recognized numeric stack locations normalize.
- `report`: exact shared summaries, error groups, representative evidence, three correlation namespaces and admitted UTC temporal buckets, in JSON, safe Markdown and standalone script-free HTML. All reports expose incomplete coverage, overflow, untimed events, clipping and redaction limitations. No generation clock or remote asset.
- Zero runtime dependencies, unchanged strict TypeScript options and private package version 0.1.0. No dependency installation, Git initialization, publication, deployment or remote write during Stage 2. D16 reconciles the requested severity/source extension with the old CLI enum; D17 records gzip strictness/accounting and bounded-admission performance choices.

## Verification commands and evidence

Commands ran from the workspace root. In this execution harness, npm is invoked through `C:\Program Files\nodejs\node.exe` and `C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js` to avoid PowerShell wrapper differences. The table uses equivalent public scripts.

| Gate | Command | Actual evidence | Status |
| --- | --- | --- | --- |
| Strict types | `npm run typecheck`, through `npm run check` | Exit 0, strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes/useUnknownInCatchVariables retained | PASS |
| Lint | `npm run lint`, through `npm run check` | Exit 0; no warnings/errors | PASS |
| Production build | `npm run build`, through `npm run check` | Exit 0; real compiled ESM CLI used by subprocesses | PASS |
| Full regression | `npm run check` | **3 suites, 177 passed, 0 failed, 1 skipped, 178 collected**, duration 21.89 s | PASS |
| Schema and representative workflows | `npm run verify:stage2` | **16 checks PASS**, schema validated with locked development AJV 6.15.0, concrete content assertions and output hashes | PASS |
| Reproducible local benchmark | `npm run benchmark -- 16 100000` | **36 real subprocesses**, one warm-up plus five measured runs per workload; independent counter/severity checks, deterministic output hashes, OS peak RSS | PASS |
| Real 5 GiB correctness/memory | `node benchmarks/large.mjs` | Exactly 5242880 events / 5368709120 bytes; 86.176329 s, 59.41 MiB/s, CLI peak 175.67 MiB | PASS |
| Architecture boundary | `rg -n 'process|console|node:(fs|net|http|https|child_process)|fetch\(' src/core src/contracts` | No matches | PASS |
| Reference release throughput/memory targets | Ubuntu 24.04 x64, dedicated 4-core/8-GiB/local-SSD environment, prescribed 1/5 GiB workloads and repetitions | This execution provides Windows only; no reference runner provisioned | NOT TESTED |

The restricted sandbox denied ancestor-directory inspection and junction creation, as previously recorded in Stage 1. Real filesystem checks were rerun with authorized local access, preserving the safety checks. Initial failures were resolved; only the final [check log](../evidence/stage-2/check.log) is passing evidence. The skipped test is actual POSIX SIGINT delivery, inapplicable on Windows; injected entry-point signal events and real AbortSignal cleanup pass without being misrepresented as native console delivery.

Evidence: [CLI check oracle/results](../evidence/stage-2/cli-checks.json), [smoke log](../evidence/stage-2/smoke.log), [benchmark parameters and all runs](../evidence/stage-2/benchmarks.json), [raw benchmark run log](../evidence/stage-2/benchmark-runs.log), [saved JSON report](../evidence/stage-2/report.stdout.txt), [standalone HTML report](../evidence/stage-2/report.html), [hostile-content escaped report](../evidence/stage-2/hostile-html.stdout.txt). No real credentials or production records are used.

## Contract coverage

| Requirements | Independent oracle and observed behavior | Status |
| --- | --- | --- |
| P01 / T01 inspection | Diagnostic fixture: 10 events, 2 damaged, 6 timed/4 untimed; info=2/warn=1/error=5/fatal=1/unknown=1; UTC bounds 1970-01-01 00:00:00–00:00:05; clean seven-level/empty fixtures retained | PASS |
| P02 / T02 multi-source | Distinct copies: 20 events/4 damaged; normalized duplicate path read once; failed source preserves IDs and permits later valid/empty sources; Windows case and native path handling checked | PASS |
| P02 / T14 gzip | Plain/gzip/stdin stats equal; no extension inference; concatenated members; corrupt CRC, truncated trailer, trailing junk and zero padding fail visibly; ratio-bomb stops and next source proceeds | PASS |
| P03 / T03–T05 parsing | Existing aliases/UTF-8/limits retained; Node/Python/Java multiline, orphan/blank/JSON/header/source boundaries, CRLF/BOM original-byte hashes; multiline cap−1/cap/cap+1 drains to next header | PASS |
| P04 / T06 filters | AND families/OR values, exact service/source/IDs, severity, offset normalization, inclusive since/exclusive until; null timestamps counted before other filters; invalid ranges/flags fail before reading | PASS |
| P05 / T07 search | Literal metacharacters, multiline LF query, ASCII-only folding, normalized-message-only matching, overlap/context/filtered-position/source-boundary behavior, limit counting and no-match status | PASS |
| P06 / T08 fingerprints | Location-only changes group; different service/logger/severity/digits/exception/path/tail stay separate; full tuple comparison separates injected digest collision; intact time-only damaged errors remain groupable | PASS |
| D16 severity/source groups | Selected severity totals exactly match inspection, unknown explicit; source-ID keys disambiguate equal protected basenames; ranking/counts and schema verified | PASS |
| P07 / T09 IDs | Exact/case-sensitive/namespaced memberships, missing IDs excluded, three IDs/event allowed; equal-looking redacted values retain distinct encounter keys; request fixture bucket count=4 | PASS |
| P08,P11 / T10 output | Every JSON command validates against the checked-in schema; NDJSON start/event/summary agrees with JSON; counts/provenance asserted; repeat processes and locale/TZ changes yield identical report bytes | PASS |
| P08 / reports | Four fingerprint groups have counts 3/1/1/1; valid timestamp total equals timeline total=6; report/inspect stats equal; standalone HTML content and injection escaping checked; Markdown fences exceed content backticks | PASS |
| P09 / T11 and relevant T12 | Synthetic secrets absent from text/JSON/NDJSON/Markdown/HTML and stderr/files; raw hash null by default; explicit paired opt-out works; controls remain escaped; parser-clipped provider prefix protected; documented complete-short-token misses retained | PASS |
| P10 / T13 aggregation | 10002-event case admits 10000 keys, retains later member count=2, overflow=1; 100000-key benchmark retains exact overflow=90000; injected combined-byte/key budgets and timeline/ID saturation conserve counts | PASS |
| P10 / output bounds | 8-KiB representatives and display clipping checked; actual >32-MiB JSON search retention fails OUTPUT_LIMIT/4, recommends NDJSON, discards temp and preserves input | PASS |
| P10 / source/run bounds | Injected source/run progress at fixed caps rejects next chunk without further pulling; ratio-rejected bytes included in progress; this is cap-logic evidence, not physical 10/50-GiB workloads | PASS |
| P09,P10 / T15–T16 relevant regressions | Real junction rejection, no-replace commit race, protected temp cleanup, opened-size append/shrink, slow write, pending-stdin/stalled-output cancellation under 2s, injected signal statuses and quiet EPIPE retained | PASS |
| T18 / reference targets | Required reference 1-GiB JSONL/text/gzip and prescribed 5-GiB performance repetition suite | NOT TESTED |

Tests: [core](../tests/core.test.ts), [I/O and built CLI](../tests/io-cli.test.ts), [Stage 2 functional/resource cases](../tests/stage2.test.ts). Fixtures and the standalone verifier have independently stated expected values; zero process status alone is never used as the content oracle.

## Local benchmark measurements

Windows shared desktop, Intel i7-1255U, 12 logical CPUs, about 16 GiB physical RAM, Node 24.19.0. Storage is local C:; SSD type was not independently verified. Warm filesystem cache; one warm-up plus five measured real compiled-CLI runs. OS peak resident working set comes from Node/libuv `process.resourceUsage().maxRSS`, includes the CLI runtime/measurement wrapper, and is distinct from accounted aggregation bytes. CLI creates no child processes. Dataset hashes, seed `0x10132026`, exact bytes/counts/options, per-run results, output bytes and hashes are in the JSON evidence. No universal or Linux-reference throughput claim.

| Workload | Decompressed dataset | Median wall time | Median MiB/s | Highest measured peak RSS |
| --- | --- | --- | --- | --- |
| inspect JSONL | 16 MiB, 16384 events | 0.645798 s | 24.78 | 56.95 MiB |
| group multiline text | 16.0006 MiB, 17432 events, 10% stack continuations | 0.687096 s | 23.29 | 60.89 MiB |
| report multiline text | Same text | 0.723665 s | 22.11 | 60.85 MiB |
| inspect gzip | Equivalent 16 MiB JSONL; measured gzip ratio 4.004:1 | 0.709470 s | 22.55 | 62.59 MiB |
| search JSONL | 16 MiB; first 100 rendered matches, all 16384 counted | 0.721492 s | 22.18 | 59.45 MiB |
| group high cardinality | 97.65625 MiB, 100000 unique errors | 5.434076 s | 17.97 | 138.55 MiB |

All five measured output hashes per workload match. The high-cardinality workload correctly returns partial/3, 10000 admitted groups and 90000 overflow members; no overflow is presented as complete global ranking. Temporary datasets were removed after verified checks. The final 5-GiB streamed correctness run passed with exactly 5242880 events and 5368709120 consumed bytes, no damaged events, all info/timed. Wall time: **86.176329 s**; throughput: **59.41 MiB/s**; CLI peak OS RSS: **175.67 MiB**; bounded generator driver peak: **47.42 MiB**. [Raw large-stream evidence](../evidence/stage-2/large-stream.json) includes dataset/record/result hashes and exact options; [actual output](../evidence/stage-2/large-stream.stdout.txt) retains the counters. No 5-GiB dataset was stored. This final run does not replace the required repeated/reference suite.

## Remaining limitations and exit decision

- **No known functional defect violating the exercised Stage 2 cases remains.** This is local functional evidence, not an independent adversarial audit or production-release acceptance.
- **Mandatory reference performance acceptance is NOT TESTED.** The Ubuntu 24.04 dedicated reference runner is unavailable in this Windows execution. Full 1-GiB normal workloads and the prescribed reference repetition/environment suite were not executed. Existing thresholds have not been weakened or promoted using smaller local workloads.
- Native Windows Ctrl+C delivery, supported POSIX signals/no-follow/permissions, all Windows reparse/ACL cases and hostile ancestor-replacement races remain outside the executed local evidence. Stage 1's explicit caveats still apply; Stage 3 is not authorized.
- Pattern redaction is heuristic; custom/encoded/fragmented secrets, arbitrary PII/health information and complete short provider tokens may remain. Fingerprints expose equality/low-entropy guessing. Opt-out can produce sensitive files; safe escaping remains active.
- Unknown multiline dialects/pretty JSON, missing timestamps/IDs, same-size concurrent source overwrites, stdout persistence permissions and crash residue retain the documented limits. Saturation rankings apply only to admitted groups; display limits do not make input counts partial.
- Cross-platform installed-package verification, CI, registry identity/license and publishing belong to Stage 4 and remain NOT TESTED / NOT AUTHORIZED. No full V1 release claim.

**Stage 2 status: PARTIAL.** Functional checks and local smoke benchmarks PASS; the stage exit is blocked by the unexecuted reference performance gate. Do not proceed to Stage 3 automatically.
