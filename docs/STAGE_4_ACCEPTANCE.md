# Stage 4 — 0.1.0-beta.1 — PARTIAL / NOT READY

Latest restricted milestone: the owner requested an experimental Windows x64 GitHub
pre-release on 2026-10-14, preserving every original multiplatform requirement below.
See [Windows beta acceptance](WINDOWS_BETA_ACCEPTANCE.md) for its current result.
Earlier evidence and authorization statements in this report are historical.

Authorized on 2026-10-14: native integration, LL-006/LL-008 remediation, full available
validation, local beta preparation. npm and GitHub publication remain NOT AUTHORIZED.

This report is updated after final verification. No mandatory gate is waived.
Windows evidence cannot establish Linux or macOS acceptance. In particular macOS
file output has no complete safe backend; it fails closed with UNSAFE_OUTPUT, which
preserves the security boundary but does not fulfill the mandatory functionality.

Candidate implementation: Windows handle-relative component traversal, root and
component reparse/type rejection, retained ancestors without delete sharing, async
bounded descriptor reads/writes via Node/libuv, exclusive temp with no write/delete
sharing, no-replace handle-relative rename, handle-owned discard. Linux implements
openat/no-follow plus O_TMPFILE and descriptor-source linkat; no path-based cleanup.

Package policy: Node-API v8, fixed package-relative resolution, gypfile:false,
no install hooks/downloads/runtime npm dependencies, explicit .node/manifest allowlist,
binary and source SHA-256 provenance. private:true remains active. Missing or
incompatible backend returns NOT_AVAILABLE; no unsafe fallback.

Mandatory blockers: macOS safe output implementation, real Ubuntu24.04 x64 and
macOS14+ arm64 security/package/signal evidence, all-platform exact final tarball,
dedicated Ubuntu performance acceptance, remote CI, confirmed registry authority
and repository metadata. Owner-selected MIT is retained from the existing checkout;
authenticated npm authority is not inferred from the package scope.

The historical filesystem failure log and legacy injection harness are preserved.
New native lifetime tests require working baseline attacks, attempted protected
attacks, exact selected/published bytes, untouched foreign fixtures, no owned temp
residue and preservation of later unknown entries. EPERM/EBUSY alone is not PASS.

## Executed Windows gates — 2026-10-14

Windows 11 x64 / OS 10.0.26200; Node24.19.0; npm11.6.4; PowerShell7.6.5;
node-gyp13.1.0; MSVC14.51 / VS2026; SDK10.0.26100.0. Executed first in a controlled
workspace copy, with a clean lockfile dependency installation and local Node headers.

| Gate | Actual evidence | Result |
| --- | --- | --- |
| Clean tooling install, native build, typecheck/lint/build | scripts/verify-windows.ps1 | PASS |
| Full regressions | 5 suites, 214 PASS, 2 platform skips (POSIX signal, Linux unnamed mode), 216 collected | PASS locally; skips retained |
| Filesystem | 9 native-boundary scenarios; actual baseline injection and postconditions | PASS on Windows |
| ACL and shell | 3 real NTFS/Unicode cases | PASS |
| Native Ctrl+C | hidden isolated console; exit130, no result/temp/footer | PASS |
| Package | 53 checks; exact allowlist/hashes, real normal offline install, installed shims, no fallback, uninstall | PASS on Windows |
| Advisories | npm audit: 0 known vulnerabilities | PASS of the query |
| Parser replay | 100000 records each JSONL/text; 13 parser/output source files match Stage3 manifest | PASS; no new 30-minute claim |
| CLI/schema | 16 independent workflow checks | PASS |
| Resource stress | four workloads, maximum measured RSS449.37MiB, cap512MiB unchanged | PASS local |
| Linux native/build/package | Ubuntu26.04 WSL exists but has no Node/compiler; not the reference environment | NOT TESTED |
| macOS safe file output | no complete native implementation | FAIL / BLOCKER |
| Exact final package on all supported OSes | only Windows image is packaged locally | NOT TESTED / BLOCKER |
| Dedicated Ubuntu24.04 performance and remote CI | environment/repository absent | NOT TESTED / BLOCKER |
| Registry authority | npm whoami returned401; scoped metadata404 is not ownership or reservation | BLOCKED |
| Repository/bugs/homepage identity | not configured; no remote created | BLOCKED |

Local candidate tarball SHA-256: 49e024a6c1309a7593175ebcf33312d80f4d1323cc2ce81b3837ba8d2df824ec. This private Windows-only
tarball is not the final publishable multiplatform release. Source-native SHA-256:
45460e7333b5173dc94f8b758a037b6deb91facfca2ad9faad4dfca721a53cdb; binary SHA-256: d2cc051851817b94a9efebaf5657c53eee0ba6934d1b6ff215f5719110fa9394.

Outcome for LL-006/LL-008 remediation across the required matrix: BLOCKED. Windows
production paths are integrated and pass the exercised regressions; Linux remains
unverified and macOS output is incomplete. Stage4 is NOT COMPLETE. No publication,
Git initialization, remote tag, release or scheduled follow-up was performed.
