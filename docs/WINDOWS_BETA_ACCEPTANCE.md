# Windows beta acceptance — 0.1.0-beta.1

Local Windows status: **PASS; remote CI pending before publication**. Date: 2026-10-14.
Scope: **Experimental Beta — Windows 11 x64, Node.js24.x**.
Linux/macOS are not validated or supported by this beta. Original Stage4: **PARTIAL**.

## Environment and exact artifact

Windows11 x64, OS10.0.26200; Node24.19.0; npm11.6.4; PowerShell7.6.5;
MSVC14.51 / VS2026 BuildTools; SDK10.0.26100.0. Zero runtime dependencies.
Package: `@thebraz/loglens` version `0.1.0-beta.1`, `private:true`, MIT retained.

Artifact: `thebraz-loglens-0.1.0-beta.1.tgz`, **112765 bytes**.
SHA-256: `2e667058664b08000b1d857ef8ccae8d2779d1d3314591198471ba64d78f276d`.
A matching `SHA256SUMS.txt` is prepared beside the archive in ignored `artifacts/`.
The historical 49e024... archive was preserved separately; its hash is not reused.

Native source SHA-256: `45460e7333b5173dc94f8b758a037b6deb91facfca2ad9faad4dfca721a53cdb`.
Native build-config SHA-256: `411230f25fc6cdd1885f3fc2304bbe0bd92c4244600a1dead469cea4201e93a9`.
Final native binary SHA-256: `1177c290435dddab7f0035ea12cd24b703c8aee354c8995f45f971610a32caaa`.
Manifest/native/archive/installed bytes were compared. There are no install hooks,
consumer compilation or installation downloads. Only win32-x64 is packaged.

## Current verification

| Gate / command | Actual result | Status |
| --- | --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | 144 locked development packages, clean installation | PASS |
| `npm run build:native` with local Node24 headers | Sequential MSVC compilation and current manifest | PASS |
| Clean generated dist, then `npm run check` | Typecheck/lint/build; 5 suites,214 passed,2 skipped,216 collected | PASS |
| `npm run security:filesystem` | 9 native schedules with working baseline attacks and exact postconditions | PASS |
| `pwsh -NoProfile -File scripts/audit-windows.ps1` | Actual NTFS deny ReadData/CreateFiles plus Unicode/LF PowerShell,3 cases | PASS |
| `pwsh -NoProfile -File scripts/audit-windows-console.ps1` | Real hidden-console Ctrl+C,exit130,34.3755ms; no destination/temp/footer | PASS |
| `npm run verify:stage2` | 16 independent CLI/schema/determinism workflows | PASS |
| `npm run verify:release-docs` | Versions/links/platform limits/Stage4 PARTIAL/private/no hooks | PASS |
| `npm audit --ignore-scripts --json` | 0 known advisories | PASS of current query |
| `npm run verify:package` | 53 checks; exact allowlist/hashes/mode/native image; normal offline empty-cache install; actual CMD/PowerShell shims; commands/schema/status/redaction/inputs; uninstall | PASS |
| `node scripts/stress-stage3.mjs` | 4 workloads, exact partial/output-limit outcomes and no input mutation/temp residue; max488.87109375MiB under512MiB | PASS local |
| `node benchmarks/large.mjs stage-3 large-stream-windows-beta` | 5368709120 bytes,5242880 exact events; CLI RSS185.76171875MiB under256MiB; driver57.9609375MiB;138.8673178s | PASS local |
| Historical extended parser fuzz attribution | 13 current core/output/framing files exactly match Stage3 manifest; prior JSONL774336/text1023968 records,30 minutes each | PASS attribution; not rerun30min |
| Official pinned Action commits | checkout3d3c42... and setup-node949feb... exist in official repos | PASS read-only check |
| Intended-commit remote Windows CI | Public repository created; first intended-commit run pending | NOT TESTED / BLOCKER |
| Published tag/release/downloaded asset integrity | No remote source/tag/release/asset was written | NOT TESTED / BLOCKER |

Two automated skips are specifically POSIX SIGINT (tests/io-cli.test.ts:283) and
Linux unnamed mode0600 output (tests/filesystem-gate.test.ts:89). They are not Windows
passes. Native Windows SIGTERM is not validated; the separate real Ctrl+C check is.
No dedicated Ubuntu throughput or broader engine compatibility claim is made.

The combined verify-windows.ps1 attempt stopped at EBUSY while a concurrent test held
an image. That driver run is not called PASS. The native build was repeated sequentially
and every constituent gate was then executed successfully as listed above. Initial
sandbox EPERM/INPUT_PERMISSION fixture failures were not accepted; the complete native
filesystem/ACL/console and regression checks were rerun with real Windows access.
Local raw evidence is under ignored `evidence/windows-beta/`; the fresh5GiB result is
`evidence/stage-3/large-stream-windows-beta.json`. No raw log dataset is committed.

## Audit and release changes

Independent offline baseline and architecture reviews plus current regressions found
no confirmed reportable Windows security vulnerability. LL-006/LL-008 Windows controls
use retained checked handles, reject reparses, prevent temporary replacement/writes,
rename with no replacement and discard only the owned handle. Baseline injections,
actual attempted attacks, exact selected/published bytes, preserved foreign entries
and no owned temp residue were checked. Finite schedules are not exhaustive proof.

No runtime parser/analysis/I/O behavior was changed in this preparation. Changes are
release docs/metadata, correct native-era README statements, CONTRIBUTING/SECURITY and
platform docs, Windows CI plus retained manual full-platform workflow, strict package
allowlist updates, documentation checks, and source-control exclusions/provenance.
Prospective source was inspected for credentials and local archives/caches/backups;
only demonstrably generated test detector canaries were identified. Local originals,
raw evidence and historical archives are preserved but ignored. npm remains unpublished.

## External blocker and remaining requirements

Destination: https://github.com/thebraz/LogLens. Authenticated account and public
repository identity/visibility were verified. Git was initialized locally on main
with the requested origin; no earlier Git history existed. Initial approval review
rejected attachment-based authorization; the owner then restated it directly in chat
and repository creation succeeded. No rejection was bypassed. No npm publication.

All local Windows gates passed. Remote CI on the intended release commit must be
observed successful before creating/pushing the release tag and publishing assets.
Actual Actions/release records bind the final commit, run, tag and asset identity.
No tag/release is claimed by this pre-push evidence snapshot.

The original Stage4 remains PARTIAL. Ubuntu24.04 reference testing/dedicated performance,
Linux native runtime, macOS safe output/native runtime, full native distribution matrix,
cross-platform final-artifact installation, remaining engine compatibility, multiplatform
CI and npm publication readiness remain mandatory outstanding requirements.
