# LogLens v0.1.0-beta.1 — Windows Experimental Beta

Date: 2026-10-14. **Experimental Windows x64 pre-release.** This is not production-ready.
The original multiplatform Stage 4 remains PARTIAL.

LogLens inspects exported application logs locally, without a server, database,
cloud account, AI model, telemetry or transmission of log data. Commands: `inspect`,
literal `search` with filters/context, conservative `group` fingerprints or exact
identifiers, and static `report`. Inputs: UTF-8 JSONL/text, documented multiline
exceptions, stdin, explicit sequential files and gzip/concatenated members. Outputs:
text, JSON, search NDJSON, Markdown and script-free HTML.

## Supported environment and installation

**Windows 11 x64 and Node.js 24.x only. Linux/macOS are not validated or supported
by this beta.** The archive contains a prebuilt Windows native backend. No consumer
compiler, binary download or install hook is required. **The npm package has not been
published**; package metadata stays `private:true`.

When the GitHub pre-release is available, download `thebraz-loglens-0.1.0-beta.1.tgz`
and `SHA256SUMS.txt`, verify the archive hash against the checksum file, then install:

```powershell
Get-FileHash .\thebraz-loglens-0.1.0-beta.1.tgz -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
npm install --global --offline --ignore-scripts --no-audit --no-fund .\thebraz-loglens-0.1.0-beta.1.tgz
loglens --version
loglens --help
loglens inspect app.jsonl --output-format=json
loglens search app.jsonl --query=failed --level=error,fatal --before=1 --after=1
loglens group app.jsonl --by=request-id
loglens report app.jsonl --output-format=html --output=incident.html
```

Outputs must be new names in existing directories. Default protection redacts defined
credential patterns and escapes injection/control characters. Correlation shows shared
identifiers, not cause. See the [user contract](USER_CONTRACT.md).

## Verification and security

Current Windows verification: clean tooling install/native build, typecheck/lint/clean
build and all five suites passed: **214 tests passed, two POSIX-specific tests skipped**.
Nine native filesystem scenarios, three real ACL/shell checks, native Ctrl+C exit130
and 16 CLI/schema workflows passed. npm audit reported zero known advisories. Pinned
Action commits were checked against the official repositories. POSIX signal and Linux
unnamed-mode skips are not Windows passes. Exact final archive/install results and
resource measurements are recorded in the source Windows acceptance report.
Publication requires an observed successful Windows CI run on the release commit.
The GitHub release records its actual CI result, archive identity and published assets.

Windows I/O binds traversal to retained checked handles, rejects reparse points,
publishes via atomic no-replace handle rename and discards only its owned temporary
file. Missing/incompatible backends fail closed. Finite LL-006/LL-008 regressions do
not establish exhaustive security or close the cross-platform findings. Archive checks
include exact file/byte/native hashes, isolated offline installation, actual npm shims,
input preservation, redaction, status/schema checks and uninstall.

## Known limitations

- Experimental status; finite tests/redaction canaries are not certification.
- Personal/health/custom/encoded/fragmented secrets and short tokens may remain.
  Review before sharing; fingerprints expose equality and possible guessing risk.
- Fixed input/retention/cardinality/output caps; saturation reports partial coverage
  and rankings among admitted groups. Check exit3 and output coverage.
- Windows privacy depends on directory ACLs. Crash/power loss may leave temporary
  output. Same-size concurrent overwrites are undetectable; later appends are ignored.
  UNC/device/extended namespaces are rejected.
- Unsupported multiline dialects/pretty JSON; missing times/levels/IDs stay explicit.
- Linux native verification, macOS safe output/native verification, full binary and
  exact-artifact matrix, remaining engine checks, Ubuntu reference/dedicated performance,
  multiplatform CI and npm readiness remain unfinished. No cross-platform claim.

Schemas and fingerprints stay v1. No persistent data migration is needed.
See [README](../README.md) and [CHANGELOG](../CHANGELOG.md).
