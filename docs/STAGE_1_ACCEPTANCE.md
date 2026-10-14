# Stage 1 acceptance — PASS

Executed on **2026-10-13**, Windows x64 (`win32`, OS build `10.0.26200`), Node **24.19.0**, npm **11.17.0**. Only Stage 1 was authorized. Stages 2–4, Git initialization, release packaging and remote writes were not performed. Publication: **NOT AUTHORIZED**.

## Build and environment identity

- Private local package: `loglens-local-foundation@0.1.0`; executable: `dist/bin.js`, ESM with Node shebang; zero runtime dependencies.
- TypeScript 5.9.3, ESLint 10.12.0, typescript-eslint 8.71.2, Vitest 5.0.4, @types/node 24.19.2. Exact resolutions are pinned in `package-lock.json`.
- [Environment and inspected tool licenses](../evidence/stage-1/environment.json). Top-level development tools use MIT, except TypeScript (Apache-2.0); installed engine ranges accept the actual Node runtime. Installation lifecycle scripts were disabled.
- [Build manifest](../evidence/stage-1/build-manifest.json): 39 source, built, test, fixture and configuration/README files with byte lengths and individual SHA-256 values. Its SHA-256/build identity is **`7751657ef3cb4ef2b5f7666ef5b96013d6fa85bd729e57db1a481f51dddb45c9`**, also stored in [the digest file](../evidence/stage-1/build-manifest.sha256). Documentation/evidence files are excluded to avoid a self-referential digest. No Git identity is invented.

## Executed commands and outcomes

Commands below ran from the repository root. In the execution harness, npm was invoked explicitly through `C:\Program Files\nodejs\node.exe` and `C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`; these are equivalent to the documented npm scripts and avoid differences in PowerShell's npm wrapper.

| Gate | Exact command | Observed evidence | Status |
| --- | --- | --- | --- |
| Initial development installation | `npm install --ignore-scripts --no-audit --no-fund --fetch-retries=0` | Initial tools installed; npm warned that ESLint 9 was unsupported, so it was replaced before acceptance | PASS |
| Maintained tool resolution | `npm install --save-dev --save-exact eslint@latest typescript-eslint@latest vitest@latest @types/node@24 --ignore-scripts --no-audit --no-fund --fetch-retries=0` | Installed versions recorded above, then locked; no runtime dependency added | PASS |
| Reproducible installation | `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0` | Exit 0; `added 128 packages in 6s` from the existing lockfile | PASS |
| Strict TypeScript | `npm run typecheck` via `npm run check` | Exit 0; strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, useUnknownInCatchVariables | PASS |
| ESLint | `npm run lint` via `npm run check` | Exit 0; no errors/warnings | PASS |
| Production compilation | `npm run build` via `npm test` / `npm run check` | Exit 0; compiled ESM executable used by subprocess checks | PASS |
| Complete Stage 1 suite | `npm run check` | Final exit 0; **2 suites, 135 passed, 0 failed, 1 skipped**, 136 collected; Vitest duration 11.01s | PASS |
| Real CLI samples | `node dist/bin.js ...` — exact argv in [CLI checks](../evidence/stage-1/cli-checks.json) | Nine separately saved stdout/stderr pairs; statuses 0/2/3/4 match the oracle | PASS |
| Interactive no-input guard | `node dist/bin.js inspect` in an actual terminal, followed by shell `exit $LASTEXITCODE` | Immediately returned USAGE on stderr and exit **2**, without waiting for input | PASS |
| Architecture review | `rg -n 'process\|console\|node:(fs\|net\|http\|https\|child_process)\|fetch\(' src/core src/contracts` (regex alternatives used with rg) | No matches; core/contracts do not access process, console, filesystem or network. Renderers live under output; adapters own I/O | PASS |

Full command output: [final check log](../evidence/stage-1/check.log). The final `npm run check` started at 16:01:02 in the recorded execution session. Prior failing runs were investigated and repaired; they are not used as passing evidence.

The restricted sandbox initially denied the required inspection of ancestor directories and creation of junctions. The complete filesystem suite was rerun with authorized local filesystem access, **without weakening path checks**. An additional [permission smoke](../evidence/stage-1/permission-smoke.json) explicitly verifies that the restricted environment returns INPUT_PERMISSION/exit 4 rather than bypassing the safety policy.

## Contract acceptance coverage

Test sources: [core unit/integration tests](../tests/core.test.ts) and [real I/O/CLI tests](../tests/io-cli.test.ts). All cases below executed against real assertions; subprocess cases use the compiled executable, actual argv/stdin/stdout/stderr and isolated filesystem data.

| Requirement / matrix row | Expected and actual outcome | Status |
| --- | --- | --- |
| T01 / P01 inspection | Seven-level fixture: exactly 7 events, one of each severity, 0 damaged, 3 timed / 4 untimed; earliest 2026-10-13T08:00:00.000Z, latest 2026-10-13T12:00:00.000Z. Duplicates counted separately; invalid/missing time never becomes epoch zero | PASS |
| Empty/blank inputs | Empty file: 0 bytes/events/lines, null time bounds, complete/exit 0. Blank stdin: exact blank/physical line counters, no fabricated events | PASS |
| T02 Stage 1 files/stdin | Real file/stdin analysis and consumed-byte counters equal; source kind/label differ as specified. Streaming readers pull <=64 KiB chunks and close resources; no historical event array in inspection | PASS |
| T03 format selection | Auto JSON object/text/level/free text, explicit overrides, malformed and non-object fallback, alias precedence/type blocking/conflicts, last duplicate JSON key, missing message, unknown levels, nested dangerous keys and no prototype mutation | PASS |
| T04 bytes/provenance | Every split of a BOM/UTF-8/CRLF sample plus one-byte partitions is identical. LF/CRLF/lone CR/NUL/noninitial BOM/final no-newline, exact line/byte intervals and original-byte hashes; invalid UTF-8 partial; UTF-16/32 rejected | PASS |
| T06 time subset | Fixed-offset assumptions, negative epoch milliseconds, years 0001–9999, leap day and calendar validation; reject Feb 30, leap seconds, >3 fractional digits, ambiguous naive times, -00:00, excessive offsets and UTC results outside range | PASS |
| Stage 1 framing | Stack/multiline-like input emits three separate one-line events in source order; no inferred severity or multiline claim | PASS |
| Mandatory foundational bounds | Physical line at cap−1/cap/cap+1 with CRLF, bounded retained prefix, full drain/hash and clean next record. Message/severity and service/ID byte caps; metadata bytes/depth/node caps; observed diagnostic-code deduplication and counter-overflow protection | PASS |
| Source byte cap logic | Injected progress at 10 GiB rejects the next chunk with SOURCE_BYTE_LIMIT and does not pull further input. This is a boundary logic test, **not** a 10 GiB physical workload or memory benchmark | PASS |
| T10 applicable schema/determinism | Always-present inspection envelope, protected source outcomes, exact counters, recursive key ordering including numeric-looking/astral keys, JSON parseability and LF. Repeated processes and different locale/TZ produce byte-identical JSON | PASS |
| T11 default protection | Nested sensitive keys of different value types; key/value assignments and quoted/unmatched values; headers, bearer, provider/JWT tokens, URI userinfo, complete/incomplete private-key blocks and marker idempotence. Short-prefix/custom-token/email misses asserted explicitly | PASS |
| T12 applicable output security | ESC/OSC/C0/C1/NUL/bidi/line-separator escaping; sensitive key sanitization; fake credentials absent from protected stdout/stderr and committed text/JSON files; no retained temporary output after successful runs | PASS |
| T15 basic input/output | Missing file and denied ancestor access return safe code/exit 4 and empty aggregate. Directories and actual junction ancestors are rejected. Initial size bounds ignore appended bytes; shrink preserves damaged pending evidence. Input aliases/existing output/missing parent refused; inputs unchanged | PASS |
| Safe commit | Actual exclusive local temporary file, sync/close, no-replace hard-link commit. A destination created after the temporary file wins the race and remains unchanged; only LogLens-owned temporary output is removed. Partial output commits with coverage partial; failed input does not commit | PASS |
| T16 basic writer/cancellation | Slow writer callback blocks the next producer pull; pending stdin and stalled-output cancellation complete under 2s, reader is destroyed, uncommitted file removed. Writer callback/error-event ordering and failure after cancellation do not produce unhandled errors | PASS |
| Entry-point signal status selection | Real Windows subprocesses with **injected Node SIGINT/SIGTERM events** return 130/143, no normal envelope, no residual temp, under 2s. This does not test OS delivery of those signals (D15) | PASS |
| EPIPE | Real subprocess with closed stdout returns **141**, with empty stderr | PASS |
| T19 arguments | Unknown/repeated/empty/invalid options and Stage 2 flags return 2 with no stdout. Help precedence opens no input; global-only version matches package. TTY guard, `--` literal filenames, stdin and NOT_AVAILABLE for future commands verified | PASS |

## Decisions and remaining limits

- D14 reconciles the explicitly requested Vitest/ESLint toolchain with the prior built-in-runner default, and keeps multiline/stack folding in Stage 2 as assigned by the authoritative stage plan. D15 distinguishes cancellation smoke from native OS signal delivery. See [the decision register](ENGINEERING_DECISIONS.md).
- **Known Stage 1 blocking defects: none identified by executed checks.** Inspection is implemented; full V1 is not. The complete supported-platform security/package matrix, performance targets and independent adversarial audit are not claimed.
- The sole skipped test is **POSIX-delivered SIGINT**, inapplicable on Windows. Actual Windows Ctrl+C delivery and native SIGTERM support are **NOT TESTED**; only injected Node signal events and AbortSignal cleanup are proven. Native delivery/latency evidence belongs to Stage 3; other OS package checks belong to Stage 4.
- POSIX permissions/no-follow behavior, Windows ACL visibility, hostile ancestor-replacement races across all reparse-point types, permission changes during cleanup, and crash/power-loss residue are **NOT TESTED** here. Actual ordinary Windows junction rejection and raced destination preservation passed. Pre/post-open component and descriptor identity checks do not establish an atomic guarantee against a hostile filesystem administrator.
- Same-size concurrent source overwrites remain undetectable; appends are ignored. Default redaction cannot detect arbitrary PII, encoded/custom/fragmented secrets or all short token prefixes. stdout is user-controlled storage; crash residue may require manual review.
- Multi-source/gzip/multiline/filter/search/group/correlation/report/export flags, benchmarks, fuzz/adversarial budgets, CI/tarball/install matrix and public registry/license decisions are **NOT TESTED / NOT IMPLEMENTED** as assigned to later stages. No release or production-readiness claim.

All mandatory **Stage 1** gates are PASS on the execution platform. **Stage 1 status: PASS.** This does not authorize Stage 2 or publication.
